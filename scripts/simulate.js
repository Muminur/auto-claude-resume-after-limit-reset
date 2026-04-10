#!/usr/bin/env node

/**
 * Simulate Rate Limit Status
 *
 * Creates a status.json with a simulated rate limit detection
 * for testing the auto-resume daemon flow.
 *
 * Usage: node scripts/simulate.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

function getStatusDir() {
  return path.join(os.homedir(), '.claude', 'auto-resume');
}

function getStatusPath() {
  return path.join(getStatusDir(), 'status.json');
}

/**
 * Create a simulated status object with reset_time 30 seconds from now.
 *
 * @returns {Object} Simulated status data
 */
function createSimulatedStatus() {
  const resetTime = new Date(Date.now() + 30000); // 30 seconds from now

  return {
    detected: true,
    reset_time: resetTime.toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    last_detected: new Date().toISOString(),
    message: 'Simulated rate limit for testing',
    last_task_context: 'Simulated task context',
    resume_prompt: 'Continue with: Simulated task context',
    sessions: ['simulated-session']
  };
}

/**
 * Write simulated status to disk.
 */
function writeSimulatedStatus() {
  const statusDir = getStatusDir();
  if (!fs.existsSync(statusDir)) {
    fs.mkdirSync(statusDir, { recursive: true });
  }

  const status = createSimulatedStatus();
  fs.writeFileSync(getStatusPath(), JSON.stringify(status, null, 2), 'utf8');

  return status;
}

// Run directly
if (require.main === module) {
  try {
    const status = writeSimulatedStatus();
    console.log('Simulated rate limit status written to:', getStatusPath());
    console.log('Reset time:', status.reset_time);
    console.log('The daemon should pick this up and start a countdown.');
  } catch (err) {
    console.error('Failed to write simulated status:', err.message);
    process.exit(1);
  }
}

module.exports = { createSimulatedStatus, writeSimulatedStatus };
