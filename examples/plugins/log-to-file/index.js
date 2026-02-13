/**
 * Log-to-File Plugin
 *
 * Logs all auto-resume events to a file in ~/.claude/auto-resume/events.log
 * Useful for debugging, auditing, and tracking rate limit patterns.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Get the log file path
const getLogPath = () => {
  const claudeDir = path.join(os.homedir(), '.claude', 'auto-resume');

  // Ensure directory exists
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }

  return path.join(claudeDir, 'events.log');
};

// Format log entry
const formatLogEntry = (eventType, event) => {
  const timestamp = new Date().toISOString();
  const data = JSON.stringify(event, null, 2).split('\n').map((line, idx) =>
    idx === 0 ? line : `  ${line}`
  ).join('\n');

  return `[${timestamp}] ${eventType}\n${data}\n${'='.repeat(80)}\n`;
};

// Write to log file
const writeLog = async (eventType, event) => {
  try {
    const logPath = getLogPath();
    const logEntry = formatLogEntry(eventType, event);

    await fs.promises.appendFile(logPath, logEntry, 'utf8');

    console.log(`[log-to-file] Logged ${eventType} to ${logPath}`);
  } catch (error) {
    console.error(`[log-to-file] Error writing to log file:`, error.message);
    // Don't throw - logging failures shouldn't break the plugin system
  }
};

module.exports = {
  name: 'log-to-file',
  version: '1.0.0',
  description: 'Logs all auto-resume events to a file',

  hooks: {
    /**
     * Called when a rate limit is detected
     * @param {Object} event - Event data
     * @param {string} event.timestamp - ISO timestamp
     * @param {number} event.resetTime - Unix timestamp when rate limit resets
     * @param {string} event.conversationId - ID of the conversation
     */
    onRateLimitDetected: async (event) => {
      await writeLog('RATE_LIMIT_DETECTED', event);
    },

    /**
     * Called when a resume message is sent
     * @param {Object} event - Event data
     * @param {string} event.timestamp - ISO timestamp
     * @param {string} event.conversationId - ID of the conversation
     * @param {string} event.message - Resume message content
     */
    onResumeSent: async (event) => {
      await writeLog('RESUME_SENT', event);
    },

    /**
     * Called when the plugin is enabled
     * @param {Object} event - Event data
     * @param {string} event.timestamp - ISO timestamp
     */
    onPluginEnabled: async (event) => {
      await writeLog('PLUGIN_ENABLED', event);

      // Write a separator for new sessions
      try {
        const logPath = getLogPath();
        const separator = `\n${'#'.repeat(80)}\n# New Session Started\n${'#'.repeat(80)}\n\n`;
        await fs.promises.appendFile(logPath, separator, 'utf8');
      } catch (error) {
        console.error(`[log-to-file] Error writing session separator:`, error.message);
      }
    },

    /**
     * Called when the plugin is disabled
     * @param {Object} event - Event data
     * @param {string} event.timestamp - ISO timestamp
     */
    onPluginDisabled: async (event) => {
      await writeLog('PLUGIN_DISABLED', event);
    }
  }
};
