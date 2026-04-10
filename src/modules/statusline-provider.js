/**
 * Daemon Health Status Line Provider
 *
 * Provides a single-line status string for display in terminals,
 * status bars, or API endpoints.
 *
 * States:
 * - "⏱ Xh Ym" - Rate limit active, countdown to reset
 * - "✓ idle"   - Daemon running, no rate limit
 * - "✗ stopped" - Daemon not running
 *
 * @module StatusLineProvider
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

function getBasePath() {
  return path.join(os.homedir(), '.claude', 'auto-resume');
}

function getStatusPath() {
  return path.join(getBasePath(), 'status.json');
}

function getPidPath() {
  return path.join(getBasePath(), 'daemon.pid');
}

/**
 * Check if the daemon PID is alive.
 * @returns {boolean}
 */
function isDaemonAlive() {
  const pidPath = getPidPath();
  try {
    if (!fs.existsSync(pidPath)) return false;
    const pid = parseInt(fs.readFileSync(pidPath, 'utf8').trim(), 10);
    if (isNaN(pid)) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read current status.json synchronously.
 * @returns {Object|null}
 */
function readStatus() {
  const statusPath = getStatusPath();
  try {
    if (!fs.existsSync(statusPath)) return null;
    return JSON.parse(fs.readFileSync(statusPath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Format milliseconds as "Xh Ym" countdown string.
 * @param {number} ms - Milliseconds remaining
 * @returns {string}
 */
function formatCountdown(ms) {
  if (ms <= 0) return '0h 0m';
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${minutes}m`;
}

/**
 * Get a single-line daemon health status string.
 *
 * @returns {string} Status line
 */
function getStatusLine() {
  const status = readStatus();
  const alive = isDaemonAlive();

  // Check for active rate limit with future reset time
  if (status && status.detected && status.reset_time) {
    const resetTime = new Date(status.reset_time).getTime();
    const now = Date.now();
    const remaining = resetTime - now;

    if (remaining > 0) {
      return `\u23f1 ${formatCountdown(remaining)}`;
    }
  }

  // Daemon alive but no active rate limit
  if (alive) {
    return '\u2713 idle';
  }

  // Daemon not running
  return '\u2717 stopped';
}

module.exports = { getStatusLine };
