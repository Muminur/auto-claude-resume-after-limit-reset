#!/usr/bin/env node

/**
 * Example: Claude Code Plugin Integration
 *
 * This example shows how to integrate the auto-resume daemon
 * with a Claude Code plugin that detects rate limits.
 *
 * Usage:
 * 1. Your plugin detects a rate limit message from Claude
 * 2. Parse the reset time using parseResetTime()
 * 3. Write status file using writeRateLimitStatus()
 * 4. The daemon (if running) will automatically handle the resume
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Configuration
const BASE_DIR = path.join(os.homedir(), '.claude', 'auto-resume');
const STATUS_FILE = path.join(BASE_DIR, 'status.json');

// Timezone offsets (hours from UTC)
const timezoneOffsets = {
  // Asia
  'Asia/Dhaka': 6,
  'Asia/Kolkata': 5.5,
  'Asia/Tokyo': 9,
  'Asia/Shanghai': 8,
  'Asia/Singapore': 8,
  'Asia/Seoul': 9,
  'Asia/Dubai': 4,
  'Asia/Jakarta': 7,
  'Asia/Manila': 8,
  'Asia/Bangkok': 7,
  'Asia/Hong_Kong': 8,
  // Americas
  'America/New_York': -5,
  'America/Los_Angeles': -8,
  'America/Chicago': -6,
  'America/Denver': -7,
  'America/Toronto': -5,
  'America/Vancouver': -8,
  'America/Sao_Paulo': -3,
  // Europe
  'Europe/London': 0,
  'Europe/Paris': 1,
  'Europe/Berlin': 1,
  'Europe/Moscow': 3,
  'Europe/Amsterdam': 1,
  // Australia
  'Australia/Sydney': 11,
  'Australia/Melbourne': 11,
  'Australia/Perth': 8,
  // Pacific
  'Pacific/Auckland': 13,
  'Pacific/Honolulu': -10,
  // Default
  UTC: 0,
  GMT: 0,
};

/**
 * Get timezone offset in hours
 */
function getTimezoneOffset(timezoneName) {
  if (timezoneOffsets[timezoneName] !== undefined) {
    return timezoneOffsets[timezoneName];
  }

  // Try to get from system
  try {
    const now = new Date();
    const localOffset = -now.getTimezoneOffset() / 60;
    return localOffset;
  } catch {
    return 0;
  }
}

/**
 * Parse reset time from rate limit message
 * @param {string} message - The rate limit message
 * @returns {Date|null} - The reset time or null if parsing failed
 */
function parseResetTime(message) {
  // Pattern: resets Xam/pm (Timezone) or resets X:XXam/pm (Timezone)
  const pattern =
    /resets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*\(([^)]+)\)/i;
  const match = message.match(pattern);

  if (!match) {
    return null;
  }

  let hour = parseInt(match[1], 10);
  const minute = match[2] ? parseInt(match[2], 10) : 0;
  const period = match[3].toLowerCase();
  const timezone = match[4];

  // Convert to 24-hour format
  if (period === 'am') {
    if (hour === 12) hour = 0;
  } else {
    if (hour !== 12) hour += 12;
  }

  // Get timezone offsets
  const tzOffset = getTimezoneOffset(timezone);
  const localOffset = -new Date().getTimezoneOffset() / 60;
  const offsetDiff = localOffset - tzOffset;

  // Build reset time
  const now = new Date();
  const resetTime = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    hour,
    minute,
    0,
    0
  );

  // Adjust for timezone difference
  resetTime.setTime(resetTime.getTime() + offsetDiff * 60 * 60 * 1000);

  // If reset time has passed, add a day
  if (resetTime < now) {
    resetTime.setDate(resetTime.getDate() + 1);
  }

  return resetTime;
}

/**
 * Write rate limit status for daemon to pick up
 * @param {Date} resetTime - When the rate limit resets
 * @param {string} message - Original rate limit message
 * @param {string} timezone - Timezone name
 */
function writeRateLimitStatus(resetTime, message, timezone) {
  // Ensure directory exists
  if (!fs.existsSync(BASE_DIR)) {
    fs.mkdirSync(BASE_DIR, { recursive: true });
  }

  // Create status object
  const status = {
    detected: true,
    reset_time: resetTime.toISOString(),
    message: message,
    timezone: timezone,
    timestamp: new Date().toISOString(),
  };

  // Write to file
  fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2));

  console.log('✓ Rate limit status written to:', STATUS_FILE);
  console.log('✓ Reset time:', resetTime.toLocaleString());
  console.log('✓ Daemon will auto-resume when ready');
}

/**
 * Clear rate limit status (optional, daemon clears it automatically)
 */
function clearRateLimitStatus() {
  try {
    if (fs.existsSync(STATUS_FILE)) {
      fs.unlinkSync(STATUS_FILE);
      console.log('✓ Rate limit status cleared');
    }
  } catch (err) {
    console.error('✗ Failed to clear status:', err.message);
  }
}

/**
 * Check if daemon is running
 */
function isDaemonRunning() {
  const pidFile = path.join(BASE_DIR, 'daemon.pid');

  try {
    if (!fs.existsSync(pidFile)) {
      return false;
    }

    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    if (isNaN(pid)) {
      return false;
    }

    // Check if process is running
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

// ============================================================================
// Example Usage
// ============================================================================

/**
 * Example 1: Basic integration
 */
function example1_basicIntegration() {
  console.log('\n=== Example 1: Basic Integration ===\n');

  // Simulate receiving a rate limit message from Claude
  const rateLimitMessage = "You've hit your limit · resets 8pm (Asia/Dhaka)";

  console.log('Rate limit detected:', rateLimitMessage);

  // Parse the reset time
  const resetTime = parseResetTime(rateLimitMessage);

  if (!resetTime) {
    console.error('✗ Failed to parse reset time');
    return;
  }

  console.log('Parsed reset time:', resetTime.toLocaleString());

  // Write status for daemon
  writeRateLimitStatus(resetTime, rateLimitMessage, 'Asia/Dhaka');

  // Check if daemon is running
  if (isDaemonRunning()) {
    console.log('\n✓ Daemon is running - auto-resume will happen automatically');
  } else {
    console.log('\n✗ Daemon is not running');
    console.log('  Start it with: node auto-resume-daemon.js start');
  }
}

/**
 * Example 2: Plugin hook integration
 */
function example2_pluginHook() {
  console.log('\n=== Example 2: Plugin Hook Integration ===\n');

  // This would be called from your plugin's message handler
  function onClaudeMessage(message) {
    // Check if it's a rate limit message
    if (
      message.includes("hit your limit") ||
      message.includes("You've hit your limit")
    ) {
      console.log('Rate limit detected in message');

      // Parse reset time
      const resetTime = parseResetTime(message);

      if (resetTime) {
        // Extract timezone from message
        const tzMatch = message.match(/\(([^)]+)\)/);
        const timezone = tzMatch ? tzMatch[1] : 'UTC';

        // Write status
        writeRateLimitStatus(resetTime, message, timezone);

        // Notify user
        console.log('\n✓ Auto-resume scheduled for:', resetTime.toLocaleString());

        if (!isDaemonRunning()) {
          console.log('\n⚠ Daemon is not running!');
          console.log('  Start it with: node auto-resume-daemon.js start');
          console.log('  Or the script will just track the status.');
        }
      } else {
        console.error('✗ Could not parse reset time from message');
      }
    }
  }

  // Simulate receiving a message
  onClaudeMessage("You've hit your limit · resets 9:30pm (America/New_York)");
}

/**
 * Example 3: Manual status creation
 */
function example3_manualStatus() {
  console.log('\n=== Example 3: Manual Status Creation ===\n');

  // Create a status for testing (resets in 1 minute)
  const resetTime = new Date(Date.now() + 60 * 1000);

  writeRateLimitStatus(
    resetTime,
    'Manual test - resets in 1 minute',
    'UTC'
  );

  console.log('\n✓ Test status created');
  console.log('  The daemon will send "continue" in 1 minute');
}

/**
 * Example 4: Status monitoring
 */
function example4_statusMonitoring() {
  console.log('\n=== Example 4: Status Monitoring ===\n');

  // Watch for status changes
  if (!fs.existsSync(STATUS_FILE)) {
    console.log('No status file exists yet');
    return;
  }

  console.log('Current status:');
  const status = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
  console.log(JSON.stringify(status, null, 2));

  const resetTime = new Date(status.reset_time);
  const now = new Date();
  const remaining = resetTime - now;

  if (remaining > 0) {
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    console.log(`\nTime until reset: ${minutes}m ${seconds}s`);
  } else {
    console.log('\nReset time has passed');
  }
}

/**
 * Example 5: Complete plugin integration
 */
function example5_completePlugin() {
  console.log('\n=== Example 5: Complete Plugin Integration ===\n');

  class ClaudeAutoResumePlugin {
    constructor() {
      this.baseDir = BASE_DIR;
      this.statusFile = STATUS_FILE;
      this.enabled = true;
    }

    /**
     * Initialize the plugin
     */
    init() {
      // Ensure directory exists
      if (!fs.existsSync(this.baseDir)) {
        fs.mkdirSync(this.baseDir, { recursive: true });
      }

      console.log('✓ Plugin initialized');
      console.log('  Status file:', this.statusFile);

      // Check daemon status
      if (isDaemonRunning()) {
        console.log('✓ Daemon is running');
      } else {
        console.log('⚠ Daemon is not running');
        console.log('  Auto-resume will not work until daemon is started');
      }
    }

    /**
     * Handle incoming messages from Claude
     */
    onMessage(message) {
      if (!this.enabled) return;

      // Check for rate limit
      if (this.isRateLimitMessage(message)) {
        this.handleRateLimit(message);
      }
    }

    /**
     * Check if message is a rate limit
     */
    isRateLimitMessage(message) {
      return (
        message.includes("hit your limit") ||
        message.includes("You've hit your limit")
      );
    }

    /**
     * Handle rate limit detection
     */
    handleRateLimit(message) {
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('⚠ RATE LIMIT DETECTED');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      const resetTime = parseResetTime(message);

      if (!resetTime) {
        console.error('✗ Failed to parse reset time');
        console.error('  Message:', message);
        return;
      }

      const tzMatch = message.match(/\(([^)]+)\)/);
      const timezone = tzMatch ? tzMatch[1] : 'UTC';

      console.log('Message:', message);
      console.log('Reset Time:', resetTime.toLocaleString());
      console.log('Timezone:', timezone);

      // Write status
      writeRateLimitStatus(resetTime, message, timezone);

      // Calculate wait time
      const waitMs = resetTime - new Date();
      const waitMin = Math.floor(waitMs / 60000);
      const waitSec = Math.floor((waitMs % 60000) / 1000);

      console.log(`\n✓ Auto-resume scheduled in ${waitMin}m ${waitSec}s`);

      if (isDaemonRunning()) {
        console.log('✓ Daemon will handle the resume automatically');
      } else {
        console.log('\n⚠ Daemon is not running!');
        console.log('  Start it with: node auto-resume-daemon.js start');
      }

      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    }

    /**
     * Enable plugin
     */
    enable() {
      this.enabled = true;
      console.log('✓ Plugin enabled');
    }

    /**
     * Disable plugin
     */
    disable() {
      this.enabled = false;
      console.log('✓ Plugin disabled');
    }

    /**
     * Get current status
     */
    getStatus() {
      try {
        if (fs.existsSync(this.statusFile)) {
          return JSON.parse(fs.readFileSync(this.statusFile, 'utf8'));
        }
      } catch {
        return null;
      }
      return null;
    }

    /**
     * Clear status
     */
    clearStatus() {
      clearRateLimitStatus();
    }
  }

  // Example usage
  const plugin = new ClaudeAutoResumePlugin();
  plugin.init();

  // Simulate receiving a rate limit message
  console.log('\nSimulating rate limit message...\n');
  plugin.onMessage("You've hit your limit · resets 10pm (America/Los_Angeles)");
}

// ============================================================================
// CLI Interface
// ============================================================================

function showHelp() {
  console.log(`
Claude Code Plugin Integration Examples

USAGE:
    node plugin-integration.js [example]

EXAMPLES:
    1    Basic integration
    2    Plugin hook integration
    3    Manual status creation (for testing)
    4    Status monitoring
    5    Complete plugin integration

    all  Run all examples

    node plugin-integration.js 1
    node plugin-integration.js all

`);
}

// Main
const example = process.argv[2];

if (!example || example === '--help' || example === '-h') {
  showHelp();
} else if (example === 'all') {
  example1_basicIntegration();
  example2_pluginHook();
  example3_manualStatus();
  example4_statusMonitoring();
  example5_completePlugin();
} else if (example === '1') {
  example1_basicIntegration();
} else if (example === '2') {
  example2_pluginHook();
} else if (example === '3') {
  example3_manualStatus();
} else if (example === '4') {
  example4_statusMonitoring();
} else if (example === '5') {
  example5_completePlugin();
} else {
  console.error('Unknown example:', example);
  showHelp();
  process.exit(1);
}
