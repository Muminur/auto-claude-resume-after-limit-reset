const { execFile } = require('child_process');
const { resolvePty } = require('./pty-delivery');

async function detectTmuxSession(pid) {
  return new Promise((resolve) => {
    execFile('which', ['tmux'], (err, tmuxPath) => {
      if (err || !tmuxPath.trim()) {
        return resolve(null);
      }

      execFile('tmux', ['list-panes', '-a', '-F', '#{pane_pid} #{session_name}:#{window_index}.#{pane_index}'], (err, stdout) => {
        if (err || !stdout.trim()) {
          return resolve(null);
        }

        const paneMap = new Map();
        for (const line of stdout.trim().split('\n')) {
          const [panePid, sessionName] = line.trim().split(' ', 2);
          if (panePid && sessionName) {
            paneMap.set(parseInt(panePid, 10), sessionName);
          }
        }

        walkProcessTree(pid, paneMap).then(resolve);
      });
    });
  });
}

async function walkProcessTree(pid, paneMap) {
  let currentPid = pid;
  const visited = new Set();

  while (currentPid && currentPid > 1 && !visited.has(currentPid)) {
    visited.add(currentPid);

    if (paneMap.has(currentPid)) {
      return paneMap.get(currentPid);
    }

    currentPid = await getParentPid(currentPid);
  }

  return null;
}

function getParentPid(pid) {
  return new Promise((resolve) => {
    execFile('ps', ['-o', 'ppid=', '-p', String(pid)], (err, stdout) => {
      if (err || !stdout.trim()) {
        return resolve(null);
      }
      const ppid = parseInt(stdout.trim(), 10);
      resolve(isNaN(ppid) ? null : ppid);
    });
  });
}

async function sendViaTmux(sessionName, text) {
  return new Promise((resolve, reject) => {
    execFile('tmux', ['send-keys', '-t', sessionName, 'Escape'], (err) => {
      if (err) {
        return reject(new Error(`tmux send-keys Escape failed: ${err.message}`));
      }
      execFile('tmux', ['send-keys', '-t', sessionName, 'C-u'], (err) => {
        if (err) {
          return reject(new Error(`tmux send-keys C-u failed: ${err.message}`));
        }
        execFile('tmux', ['send-keys', '-t', sessionName, text, 'Enter'], (err) => {
          if (err) {
            return reject(new Error(`tmux send-keys text failed: ${err.message}`));
          }
          resolve();
        });
      });
    });
  });
}

/**
 * Find ALL tmux panes running Claude Code processes.
 * Checks pane_current_command and child processes for claude patterns.
 * @returns {Promise<Array<{target: string, pid: number, command: string}>>}
 */
async function findAllClaudePanes() {
  return new Promise((resolve) => {
    execFile('which', ['tmux'], (err, tmuxPath) => {
      if (err || !tmuxPath || !tmuxPath.trim()) {
        return resolve([]);
      }

      execFile('tmux', [
        'list-panes', '-a', '-F',
        '#{pane_pid} #{session_name}:#{window_index}.#{pane_index} #{pane_current_command}'
      ], (err, stdout) => {
        if (err || !stdout || !stdout.trim()) {
          return resolve([]);
        }

        const claudePatterns = /^(claude|node|2\.\d+\.\d+)$/i;
        const panes = [];
        const checkPromises = [];

        for (const line of stdout.trim().split('\n')) {
          const parts = line.trim().split(' ');
          if (parts.length < 3) continue;
          const pid = parseInt(parts[0], 10);
          const target = parts[1];
          const command = parts.slice(2).join(' ');

          if (isNaN(pid)) continue;

          // Direct match on pane command
          if (/claude/i.test(command)) {
            panes.push({ target, pid, command });
            continue;
          }

          // For node/versioned binaries, check child processes for claude
          if (claudePatterns.test(command)) {
            checkPromises.push(
              hasClaudeChild(pid).then((found) => {
                if (found) {
                  panes.push({ target, pid, command });
                }
              })
            );
          }
        }

        Promise.all(checkPromises).then(() => resolve(panes));
      });
    });
  });
}

/**
 * Check if a process has a child process matching claude patterns.
 * @param {number} pid
 * @returns {Promise<boolean>}
 */
function hasClaudeChild(pid) {
  return new Promise((resolve) => {
    execFile('pgrep', ['-P', String(pid), '-a'], (err, stdout) => {
      if (err || !stdout) return resolve(false);
      resolve(/claude/i.test(stdout));
    });
  });
}

/**
 * Send resume keystrokes to ALL provided tmux panes.
 * Uses the new keystroke sequence with delays for reliable delivery.
 *
 * @param {string} text - Text to send (e.g. "continue")
 * @param {Array<{target: string}>} panes - Panes to send to
 * @param {Object} [opts] - Options
 * @param {string} [opts.menuSelection] - Menu option key (default: '1')
 * @returns {Promise<{sent: number, failed: number, errors: string[]}>}
 */
async function sendToAllPanes(text, panes, opts = {}) {
  const sequence = buildResumeSequence({
    menuSelection: opts.menuSelection,
    resumePrompt: text,
  });

  let sent = 0;
  let failed = 0;
  const errors = [];

  for (const pane of panes) {
    try {
      await sendKeystrokeSequence(pane.target, sequence);
      sent++;
    } catch (err) {
      failed++;
      errors.push(`${pane.target}: ${err.message}`);
    }
  }

  return { sent, failed, errors };
}

/**
 * Build a keystroke sequence for resuming Claude Code after rate limit.
 * Two-phase approach: (1) try menu option selection, (2) fall back to text input.
 *
 * @param {Object} opts
 * @param {string} [opts.menuSelection='1'] - Menu option key to press
 * @param {string} [opts.resumePrompt='continue'] - Text to type as fallback
 * @returns {Array<{keys: string[], delay: number}>}
 */
function buildResumeSequence(opts = {}) {
  const menuSelection = opts.menuSelection || '1';
  const resumePrompt = opts.resumePrompt || 'continue';

  return [
    // Phase 1: Dismiss any dialog/state
    { keys: ['Escape'], delay: 500 },
    { keys: ['Escape'], delay: 300 },
    // Phase 2: Try menu option selection (works when rate limit dialog is showing)
    { keys: [menuSelection], delay: 1000 },
    // Phase 3: Fallback - dismiss again and try text input
    { keys: ['Escape'], delay: 500 },
    { keys: ['Escape'], delay: 300 },
    { keys: ['C-u'], delay: 200 },
    { keys: [resumePrompt], delay: 200 },
    { keys: ['Enter'], delay: 0 },
  ];
}

/**
 * Send a keystroke sequence to a tmux pane with delays between steps.
 *
 * @param {string} paneTarget - tmux pane target (e.g. "2:0.0")
 * @param {Array<{keys: string[], delay: number}>} sequence - Steps to execute
 * @returns {Promise<void>}
 */
async function sendKeystrokeSequence(paneTarget, sequence) {
  for (const step of sequence) {
    await new Promise((resolve, reject) => {
      execFile('tmux', ['send-keys', '-t', paneTarget, ...step.keys], (err) => {
        if (err) return reject(new Error(`tmux send-keys failed: ${err.message}`));
        resolve();
      });
    });
    if (step.delay > 0) {
      await new Promise(resolve => setTimeout(resolve, step.delay));
    }
  }
}

/**
 * Find the tmux pane(s) to target for resume delivery.
 *
 * When claudePid is provided (from status.json), walks the process tree to find
 * the exact pane running that Claude instance — avoids sending to ALL Claude panes
 * including unrelated active sessions.
 *
 * Falls back to findAllClaudePanes() when no specific PID is known or when the
 * specific pane cannot be located.
 *
 * @param {number|null} claudePid - PID from status.json, or null
 * @returns {Promise<Array<{target: string, pid: number, command: string}>>}
 */
async function findClaudeTargetPanes(claudePid) {
  if (claudePid) {
    try {
      const sessionName = await detectTmuxSession(claudePid);
      if (sessionName) {
        return [{ target: sessionName, pid: claudePid, command: 'claude' }];
      }
    } catch (_err) {
      // Fall through to broad scan
    }
  }
  // No specific PID or pane not found — scan all Claude panes
  return findAllClaudePanes();
}

async function discoverAllClaudeProcesses() {
  const pids = await new Promise((resolve) => {
    execFile('ps', ['-eo', 'pid,comm', '--no-headers'], (err, stdout) => {
      if (err || !stdout.trim()) return resolve([]);
      const claudePatterns = /^(claude|node|2\.\d+\.\d+)$/i;
      const candidates = [];
      for (const line of stdout.trim().split('\n')) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 2) continue;
        const pid = parseInt(parts[0], 10);
        const comm = parts.slice(1).join(' ');
        if (!isNaN(pid) && claudePatterns.test(comm)) {
          candidates.push({ pid, comm });
        }
      }
      resolve(candidates);
    });
  });

  if (pids.length === 0) return [];

  // For direct claude matches, use the PID directly.
  // For node/versioned binaries, check if they have a claude child process.
  const claudePids = [];
  for (const { pid, comm } of pids) {
    if (/^claude$/i.test(comm)) {
      claudePids.push(pid);
    } else {
      const found = await hasClaudeChild(pid);
      if (found) claudePids.push(pid);
    }
  }

  if (claudePids.length === 0) return [];

  const paneMap = await new Promise((resolve) => {
    execFile('which', ['tmux'], (err, tmuxPath) => {
      if (err || !tmuxPath || !tmuxPath.trim()) return resolve(new Map());
      execFile('tmux', [
        'list-panes', '-a', '-F',
        '#{pane_pid} #{session_name}:#{window_index}.#{pane_index}'
      ], (err2, stdout) => {
        if (err2 || !stdout || !stdout.trim()) return resolve(new Map());
        const map = new Map();
        for (const line of stdout.trim().split('\n')) {
          const [panePid, target] = line.trim().split(' ', 2);
          if (panePid && target) map.set(parseInt(panePid, 10), target);
        }
        resolve(map);
      });
    });
  });

  const results = [];
  for (const pid of claudePids) {
    const tmuxTarget = await walkProcessTree(pid, paneMap);
    if (tmuxTarget) {
      results.push({ pid, method: 'tmux', target: tmuxTarget });
      continue;
    }
    const ptyPath = await resolvePty(pid);
    if (ptyPath && ptyPath.startsWith('/dev/pts/')) {
      results.push({ pid, method: 'pty', ptyPath });
    }
  }
  return results;
}

module.exports = { detectTmuxSession, sendViaTmux, walkProcessTree, getParentPid, findAllClaudePanes, findClaudeTargetPanes, sendToAllPanes, buildResumeSequence, sendKeystrokeSequence, discoverAllClaudeProcesses };
