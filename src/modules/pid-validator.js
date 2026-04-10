/**
 * Stale PID Validation
 *
 * Validates whether a PID from daemon.pid is still alive.
 * Uses process.kill(pid, 0) as primary check.
 * On Windows, falls back to tasklist as secondary verification.
 *
 * @module PidValidator
 */

const fs = require('fs');
const { execSync } = require('child_process');

/**
 * Validate whether a process with the given PID is alive.
 *
 * @param {number} pid - Process ID to check
 * @returns {{ alive: boolean }}
 */
function validatePid(pid) {
  // Primary check: process.kill with signal 0
  try {
    process.kill(pid, 0);
    return { alive: true };
  } catch (e) {
    // Primary check says dead
  }

  // On Windows, use tasklist as secondary check
  if (process.platform === 'win32') {
    try {
      const output = execSync(`tasklist /FI "PID eq ${pid}" /NH`, {
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 5000
      });
      if (output.includes(pid.toString())) {
        return { alive: true };
      }
    } catch (e) {
      // tasklist failed, consider dead
    }
  }

  return { alive: false };
}

/**
 * Determine if the daemon should be started based on PID file state.
 *
 * @param {string} pidFilePath - Path to daemon.pid
 * @returns {boolean} True if daemon needs to be started
 */
function shouldStartDaemon(pidFilePath) {
  if (!fs.existsSync(pidFilePath)) {
    return true; // No PID file, need to start
  }

  try {
    const pidStr = fs.readFileSync(pidFilePath, 'utf8').trim();
    const pid = parseInt(pidStr, 10);

    if (isNaN(pid)) {
      return true; // Invalid PID, need to start
    }

    const { alive } = validatePid(pid);
    return !alive; // Start if not alive
  } catch (e) {
    return true; // Error reading, need to start
  }
}

module.exports = { validatePid, shouldStartDaemon };
