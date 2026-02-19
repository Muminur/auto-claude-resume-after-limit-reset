const { detectTmuxSession, sendViaTmux, findAllClaudePanes, sendToAllPanes } = require('./tmux-delivery');
const { resolvePty, sendViaPty } = require('./pty-delivery');

const TIER = {
  TMUX: 'tmux',
  PTY: 'pty',
  XDOTOOL: 'xdotool',
};

/**
 * Deliver resume keystrokes using the best available method.
 * Tries tiers in order: tmux > PTY write > xdotool.
 *
 * @param {Object} opts
 * @param {number} opts.claudePid - Claude Code process PID
 * @param {string} opts.resumeText - Text to send (default: "continue")
 * @param {Function} [opts.log] - Logging function(level, message)
 * @param {Function} [opts.xdotoolFallback] - Existing xdotool function for Tier 3
 * @returns {Promise<{success: boolean, tier: string|null, error: string|null, tiersAttempted: string[]}>}
 */
async function deliverResume(opts) {
  const { claudePid, resumeText = 'continue', menuSelection, log = () => {}, xdotoolFallback = null } = opts;
  const tiersAttempted = [];
  let lastError = null;

  // Tier 1: tmux (multi-pane: find ALL panes running Claude)
  try {
    log('debug', `Tier 1 (tmux): scanning all panes for Claude processes...`);
    tiersAttempted.push(TIER.TMUX);
    const claudePanes = await findAllClaudePanes();
    if (claudePanes.length > 0) {
      log('info', `Tier 1 (tmux): found ${claudePanes.length} Claude pane(s): ${claudePanes.map(p => p.target).join(', ')}`);
      const result = await sendToAllPanes(resumeText, claudePanes, { menuSelection });
      log('success', `Tier 1 (tmux): sent to ${result.sent}/${claudePanes.length} panes`);
      if (result.failed > 0) {
        log('warning', `Tier 1 (tmux): ${result.failed} pane(s) failed: ${result.errors.join('; ')}`);
      }
      if (result.sent > 0) {
        return { success: true, tier: TIER.TMUX, error: null, tiersAttempted };
      }
    } else {
      log('debug', 'Tier 1 (tmux): no Claude panes found, skipping');
    }
  } catch (err) {
    lastError = err.message;
    log('warning', `Tier 1 (tmux) failed: ${err.message}`);
  }

  // Tier 2: PTY write
  try {
    log('debug', `Tier 2 (PTY): resolving PTY for PID ${claudePid}...`);
    tiersAttempted.push(TIER.PTY);
    const ptyPath = await resolvePty(claudePid);
    if (ptyPath) {
      log('info', `Tier 2 (PTY): found ${ptyPath}, writing directly...`);
      await sendViaPty(ptyPath, resumeText);
      log('success', `Tier 2 (PTY): sent "${resumeText}" to ${ptyPath}`);
      return { success: true, tier: TIER.PTY, error: null, tiersAttempted };
    } else {
      log('debug', 'Tier 2 (PTY): could not resolve PTY path, skipping');
    }
  } catch (err) {
    lastError = err.message;
    log('warning', `Tier 2 (PTY) failed: ${err.message}`);
  }

  // Tier 3: xdotool (existing implementation)
  if (xdotoolFallback) {
    try {
      log('debug', 'Tier 3 (xdotool): falling back to xdotool...');
      tiersAttempted.push(TIER.XDOTOOL);
      await xdotoolFallback();
      log('success', 'Tier 3 (xdotool): keystrokes sent');
      return { success: true, tier: TIER.XDOTOOL, error: null, tiersAttempted };
    } catch (err) {
      lastError = err.message;
      log('warning', `Tier 3 (xdotool) failed: ${err.message}`);
    }
  } else {
    tiersAttempted.push(TIER.XDOTOOL);
    log('debug', 'Tier 3 (xdotool): no fallback function provided, skipping');
  }

  return {
    success: false,
    tier: null,
    error: lastError || 'All delivery tiers failed',
    tiersAttempted,
  };
}

module.exports = { deliverResume, TIER };
