/**
 * Notification Manager
 *
 * Cross-platform desktop notification manager for Claude Code Auto-Resume.
 * Provides desktop notifications for rate limit events and session resumption.
 *
 * Features:
 * - Cross-platform notifications via node-notifier
 * - Windows PowerShell MessageBox fallback when toast notifications fail
 * - Configurable notification settings (enabled, sound, useFallback)
 * - Graceful fallback when node-notifier unavailable
 * - Rate limit and resume event notifications
 * - Comprehensive error handling and logging
 *
 * @module NotificationManager
 */

/**
 * NotificationManager class
 * Handles desktop notifications with configuration support
 */
class NotificationManager {
  /**
   * Create a NotificationManager instance
   */
  constructor() {
    this.config = {
      enabled: true,
      sound: true,
      timeout: 10, // seconds
      useFallback: true, // Enable Windows fallback
      preferMessageBox: false // Use MessageBox as primary on Windows (bypasses toast)
    };
    this.notifier = null;
    this.initialized = false;
    this.logger = console; // Default logger
  }

  /**
   * Initialize the notification manager
   * @param {Object} config - Configuration object
   * @param {boolean} [config.enabled=true] - Enable/disable notifications
   * @param {boolean} [config.sound=true] - Enable/disable notification sounds
   * @param {number} [config.timeout=10] - Notification timeout in seconds
   * @param {boolean} [config.useFallback=true] - Enable Windows PowerShell fallback
   * @param {boolean} [config.preferMessageBox=false] - Use MessageBox as primary on Windows (bypasses toast)
   * @param {Object} [config.logger] - Logger object with log methods
   * @returns {boolean} True if initialized successfully
   */
  init(config = {}) {
    try {
      // Merge configuration
      this.config = {
        ...this.config,
        ...config
      };

      // Set logger if provided
      if (config.logger) {
        this.logger = config.logger;
      }

      // Try to load node-notifier
      try {
        this.notifier = require('node-notifier');
        this.initialized = true;
        this._log('info', 'Notification manager initialized with node-notifier');
        return true;
      } catch (err) {
        this._log('warning', 'node-notifier not available - notifications disabled');
        this._log('debug', `Error loading node-notifier: ${err.message}`);
        this.initialized = false;
        return false;
      }
    } catch (err) {
      this._log('error', `Failed to initialize notification manager: ${err.message}`);
      this.initialized = false;
      return false;
    }
  }

  /**
   * Send a desktop notification
   * @param {string} title - Notification title
   * @param {string} message - Notification message
   * @param {Object} [options={}] - Additional notification options
   * @param {string} [options.icon] - Path to icon file
   * @param {string} [options.sound] - Override sound setting
   * @param {number} [options.timeout] - Override timeout setting
   * @param {string} [options.subtitle] - Subtitle (macOS)
   * @returns {Promise<boolean>} True if notification sent successfully
   */
  async notify(title, message, options = {}) {
    try {
      // Check if notifications are enabled
      if (!this.config.enabled) {
        this._log('debug', 'Notifications disabled, skipping notification');
        return false;
      }

      // On Windows, use MessageBox directly if preferMessageBox is enabled
      // This bypasses toast notifications which may not work on some systems
      // Skip MessageBox in CI/test environments as it blocks waiting for user input
      const isCI = process.env.CI || process.env.JEST_WORKER_ID || process.env.NODE_ENV === 'test';
      if (this.config.preferMessageBox && process.platform === 'win32' && !isCI) {
        const titleText = title || 'Claude Code Auto-Resume';
        const messageText = message || '';
        this._log('debug', 'Using MessageBox as preferred notification method');
        return await this._showWindowsFallback(titleText, messageText);
      }

      // Check if notifier is available
      if (!this.initialized || !this.notifier) {
        this._log('debug', 'Notifier not initialized, trying fallback if available');

        // Try platform-specific fallback if enabled
        if (this.config.useFallback) {
          const platform = process.platform;
          const titleText = title || 'Claude Code Auto-Resume';
          const messageText = message || '';

          if (platform === 'win32') {
            return await this._showWindowsFallback(titleText, messageText);
          } else if (platform === 'darwin') {
            return await this._showMacOSFallback(titleText, messageText);
          } else if (platform === 'linux') {
            return await this._showLinuxFallback(titleText, messageText);
          }
        }

        return false;
      }

      // Build notification options
      const notificationOptions = {
        title: title || 'Claude Code Auto-Resume',
        message: message || '',
        timeout: (options.timeout ?? this.config.timeout) * 1000, // Convert to ms
        sound: options.sound ?? this.config.sound,
        wait: false // Don't wait for user interaction
      };

      // Add optional parameters
      if (options.icon) {
        notificationOptions.icon = options.icon;
      }

      if (options.subtitle) {
        notificationOptions.subtitle = options.subtitle;
      }

      // Send notification
      return new Promise((resolve) => {
        this.notifier.notify(notificationOptions, async (err, response) => {
          if (err) {
            this._log('error', `Failed to send notification: ${err.message}`);

            // Try platform-specific fallback if enabled
            if (this.config.useFallback) {
              const platform = process.platform;
              this._log('debug', `Attempting ${platform} fallback`);

              let fallbackSuccess = false;
              if (platform === 'win32') {
                fallbackSuccess = await this._showWindowsFallback(
                  notificationOptions.title,
                  notificationOptions.message
                );
              } else if (platform === 'darwin') {
                fallbackSuccess = await this._showMacOSFallback(
                  notificationOptions.title,
                  notificationOptions.message
                );
              } else if (platform === 'linux') {
                fallbackSuccess = await this._showLinuxFallback(
                  notificationOptions.title,
                  notificationOptions.message
                );
              }

              resolve(fallbackSuccess);
            } else {
              resolve(false);
            }
          } else {
            this._log('debug', `Notification sent: ${title}`);
            resolve(true);
          }
        });
      });
    } catch (err) {
      this._log('error', `Error sending notification: ${err.message}`);

      // Try platform-specific fallback if enabled
      if (this.config.useFallback) {
        const platform = process.platform;
        const titleText = title || 'Claude Code Auto-Resume';
        const messageText = message || '';

        this._log('debug', `Attempting ${platform} fallback after error`);

        if (platform === 'win32') {
          return await this._showWindowsFallback(titleText, messageText);
        } else if (platform === 'darwin') {
          return await this._showMacOSFallback(titleText, messageText);
        } else if (platform === 'linux') {
          return await this._showLinuxFallback(titleText, messageText);
        }
      }

      return false;
    }
  }

  /**
   * Send rate limit notification
   * @param {Date|string} resetTime - Time when rate limit resets
   * @returns {Promise<boolean>} True if notification sent successfully
   */
  async notifyRateLimit(resetTime) {
    try {
      const resetDate = resetTime instanceof Date ? resetTime : new Date(resetTime);

      if (isNaN(resetDate.getTime())) {
        this._log('error', `Invalid reset time: ${resetTime}`);
        return false;
      }

      const now = new Date();
      const remaining = resetDate - now;
      const minutes = Math.ceil(remaining / (60 * 1000));
      const hours = Math.floor(minutes / 60);

      let timeMessage;
      if (hours > 0) {
        const remainingMinutes = minutes % 60;
        timeMessage = `${hours}h ${remainingMinutes}m`;
      } else {
        timeMessage = `${minutes}m`;
      }

      const title = 'Rate Limit Detected';
      const message = `Claude Code will auto-resume in ${timeMessage}\nReset time: ${resetDate.toLocaleTimeString()}`;

      this._log('info', `Sending rate limit notification: ${timeMessage} remaining`);

      return await this.notify(title, message, {
        subtitle: 'Auto-Resume Active'
      });
    } catch (err) {
      this._log('error', `Error sending rate limit notification: ${err.message}`);
      return false;
    }
  }

  /**
   * Send resume notification
   * @param {string} [sessionId] - Session identifier (optional)
   * @returns {Promise<boolean>} True if notification sent successfully
   */
  async notifyResume(sessionId = null) {
    try {
      const title = 'Session Resuming';
      let message = 'Rate limit reset - resuming Claude Code session';

      if (sessionId) {
        message += `\nSession: ${sessionId}`;
      }

      this._log('info', 'Sending resume notification');

      return await this.notify(title, message, {
        subtitle: 'Auto-Resume',
        sound: true // Always play sound for resume
      });
    } catch (err) {
      this._log('error', `Error sending resume notification: ${err.message}`);
      return false;
    }
  }

  /**
   * Update configuration
   * @param {Object} config - Configuration object
   * @param {boolean} [config.enabled] - Enable/disable notifications
   * @param {boolean} [config.sound] - Enable/disable notification sounds
   * @param {number} [config.timeout] - Notification timeout in seconds
   */
  updateConfig(config) {
    try {
      this.config = {
        ...this.config,
        ...config
      };
      this._log('debug', `Configuration updated: ${JSON.stringify(this.config)}`);
    } catch (err) {
      this._log('error', `Failed to update configuration: ${err.message}`);
    }
  }

  /**
   * Get current configuration
   * @returns {Object} Current configuration
   */
  getConfig() {
    return { ...this.config };
  }

  /**
   * Check if notifications are available
   * @returns {boolean} True if notifications are available
   */
  isAvailable() {
    return this.initialized && this.notifier !== null;
  }

  /**
   * Show Windows PowerShell MessageBox fallback
   * @private
   * @param {string} title - MessageBox title
   * @param {string} message - MessageBox message
   * @returns {Promise<boolean>} True if MessageBox shown successfully
   */
  async _showWindowsFallback(title, message) {
    try {
      const { exec } = require('child_process');

      // Escape single quotes and backslashes in the message and title
      const escapeForPowerShell = (str) => {
        return str
          .replace(/\\/g, '\\\\')
          .replace(/'/g, "''")
          .replace(/\r?\n/g, "`n");
      };

      const escapedTitle = escapeForPowerShell(title);
      const escapedMessage = escapeForPowerShell(message);

      const command = `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('${escapedMessage}', '${escapedTitle}', 'OK', 'Information')"`;

      this._log('debug', 'Showing Windows PowerShell MessageBox fallback');

      return new Promise((resolve) => {
        exec(command, { windowsHide: true }, (error, stdout, stderr) => {
          if (error) {
            this._log('error', `Windows fallback failed: ${error.message}`);
            resolve(false);
          } else {
            this._log('info', 'Windows PowerShell MessageBox shown successfully');
            resolve(true);
          }
        });
      });
    } catch (err) {
      this._log('error', `Error showing Windows fallback: ${err.message}`);
      return false;
    }
  }

  /**
   * Show macOS notification fallback using osascript
   * @private
   * @param {string} title - Notification title
   * @param {string} message - Notification message
   * @returns {Promise<boolean>} True if notification shown successfully
   */
  async _showMacOSFallback(title, message) {
    try {
      const { exec } = require('child_process');

      // Escape single quotes and backslashes for AppleScript
      const escapeForAppleScript = (str) => {
        return str
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"')
          .replace(/\r?\n/g, '\\n');
      };

      const escapedTitle = escapeForAppleScript(title);
      const escapedMessage = escapeForAppleScript(message);

      const command = `osascript -e 'display notification "${escapedMessage}" with title "${escapedTitle}"'`;

      this._log('debug', 'Showing macOS osascript notification fallback');

      return new Promise((resolve) => {
        exec(command, (error, stdout, stderr) => {
          if (error) {
            this._log('error', `macOS fallback failed: ${error.message}`);
            resolve(false);
          } else {
            this._log('info', 'macOS notification shown successfully');
            resolve(true);
          }
        });
      });
    } catch (err) {
      this._log('error', `Error showing macOS fallback: ${err.message}`);
      return false;
    }
  }

  /**
   * Show Linux notification fallback using notify-send
   * @private
   * @param {string} title - Notification title
   * @param {string} message - Notification message
   * @returns {Promise<boolean>} True if notification shown successfully
   */
  async _showLinuxFallback(title, message) {
    try {
      const { exec } = require('child_process');

      // Escape single quotes for shell
      const escapeForShell = (str) => {
        return str.replace(/'/g, "'\\''");
      };

      const escapedTitle = escapeForShell(title);
      const escapedMessage = escapeForShell(message);

      const command = `notify-send '${escapedTitle}' '${escapedMessage}'`;

      this._log('debug', 'Showing Linux notify-send fallback');

      return new Promise((resolve) => {
        exec(command, (error, stdout, stderr) => {
          if (error) {
            this._log('error', `Linux fallback failed: ${error.message}`);
            resolve(false);
          } else {
            this._log('info', 'Linux notification shown successfully');
            resolve(true);
          }
        });
      });
    } catch (err) {
      this._log('error', `Error showing Linux fallback: ${err.message}`);
      return false;
    }
  }

  /**
   * Internal logging method
   * @private
   * @param {string} level - Log level (info, warning, error, debug)
   * @param {string} message - Log message
   */
  _log(level, message) {
    try {
      const logMessage = `[NotificationManager] ${message}`;

      if (this.logger && typeof this.logger.log === 'function') {
        // Use custom logger if available
        this.logger.log(level, logMessage);
      } else if (this.logger && typeof this.logger[level] === 'function') {
        // Use logger level methods if available
        this.logger[level](logMessage);
      } else {
        // Fallback to console
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [${level.toUpperCase()}] ${logMessage}`);
      }
    } catch (err) {
      // Fail silently to avoid breaking notification flow
    }
  }
}

// Export the NotificationManager class
module.exports = NotificationManager;
