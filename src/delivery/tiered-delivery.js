const { discoverAllClaudeProcesses, sendKeystrokeSequence, buildResumeSequence } = require('./tmux-delivery');
const { sendViaPty } = require('./pty-delivery');

const TIER = {
  TMUX: 'tmux',
  PTY: 'pty',
  XDOTOOL: 'xdotool',
};

/**
 * Deliver resume keystrokes to ALL running Claude Code processes.
 * Discovers processes via ps/pgrep, classifies each as tmux or PTY, delivers to each.
 * Rate limits are account-level so all instances need the resume signal.
 *
 * @param {Object} opts
 * @param {string} [opts.resumeText='continue'] - Text to send as fallback prompt
 * @param {string} [opts.menuSelection='1'] - Menu option key to press
 * @param {Function} [opts.log] - Logging function(level, message)
 * @param {Function} [opts.xdotoolFallback] - Fallback when no processes found/delivered
 * @param {Function} [opts._discoverer] - Override discovery function (for testing)
 * @returns {Promise<{success: boolean, tiersAttempted: string[], targets: Array, error: string|null}>}
 */
async function deliverResume(opts = {}) {
  const {
    resumeText = 'continue',
    menuSelection = '1',
    log = () => {},
    xdotoolFallback = null,
    _discoverer = discoverAllClaudeProcesses,
  } = opts;

  const tiersAttempted = [TIER.TMUX]; // discovery always attempts tmux classification
  const targets = [];
  let anySuccess = false;
  let lastError = null;

  // Discover all Claude processes
  log('debug', 'Discovering all running claude processes...');
  let processes = [];
  try {
    processes = await _discoverer();
    log('info', `Found ${processes.length} claude process(es): ${
      processes.map(p => `PID ${p.pid} (${p.method})`).join(', ') || 'none'
    }`);
  } catch (err) {
    lastError = err.message;
    log('warning', `Process discovery failed: ${err.message}`);
  }

  // Deliver to each discovered process
  for (const proc of processes) {
    const entry = { pid: proc.pid, method: proc.method, success: false, error: null };

    try {
      if (proc.method === 'tmux') {
        const sequence = buildResumeSequence({ menuSelection, resumePrompt: resumeText });
        await sendKeystrokeSequence(proc.target, sequence);
        entry.success = true;
        log('success', `Delivered to PID ${proc.pid} via tmux pane ${proc.target}`);
      } else if (proc.method === 'pty') {
        if (!tiersAttempted.includes(TIER.PTY)) tiersAttempted.push(TIER.PTY);
        await sendViaPty(proc.ptyPath, resumeText, { menuSelection });
        entry.success = true;
        log('success', `Delivered to PID ${proc.pid} via PTY ${proc.ptyPath}`);
      }
      if (entry.success) anySuccess = true;
    } catch (err) {
      entry.error = err.message;
      lastError = err.message;
      log('warning', `Failed to deliver to PID ${proc.pid}: ${err.message}`);
    }

    targets.push(entry);
  }

  // Fallback to xdotool if nothing was found or delivered
  if (!anySuccess && xdotoolFallback) {
    tiersAttempted.push(TIER.XDOTOOL);
    try {
      log('debug', 'No processes reached, falling back to xdotool...');
      await xdotoolFallback();
      log('success', 'xdotool fallback succeeded');
      anySuccess = true;
    } catch (err) {
      lastError = err.message;
      log('warning', `xdotool fallback failed: ${err.message}`);
    }
  }

  return {
    success: anySuccess,
    tiersAttempted,
    targets,
    error: anySuccess ? null : (lastError || 'No claude processes found and no fallback available'),
  };
}

module.exports = { deliverResume, TIER };
