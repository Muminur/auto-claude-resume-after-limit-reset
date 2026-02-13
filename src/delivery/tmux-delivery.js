const { execFile } = require('child_process');

async function detectTmuxSession(pid) {
  return new Promise((resolve) => {
    execFile('which', ['tmux'], (err, tmuxPath) => {
      if (err || !tmuxPath.trim()) {
        return resolve(null);
      }

      execFile('tmux', ['list-panes', '-a', '-F', '#{pane_pid} #{session_name}'], (err, stdout) => {
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

module.exports = { detectTmuxSession, sendViaTmux, walkProcessTree, getParentPid };
