/**
 * Status Watcher Module
 *
 * File watcher for monitoring multiple Claude Code status.json files.
 * Uses chokidar for reliable cross-platform file watching.
 *
 * Features:
 * - Watch multiple status.json files simultaneously
 * - Aggregate status from all watched sessions
 * - Emit events for status changes, rate limits
 * - Support session labeling/identification
 * - Graceful error handling for parsing issues
 * - Cross-platform path support
 *
 * Events:
 * - statusChange: (sessionId, status, previousStatus) - Any status change
 * - rateLimitDetected: (sessionId, resetTime) - Rate limit detected
 * - rateLimitCleared: (sessionId) - Rate limit cleared
 * - error: (sessionId, error) - File parsing or watch error
 *
 * @module StatusWatcher
 */

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const chokidar = require('chokidar');

/**
 * StatusWatcher class
 * Watches multiple status.json files and aggregates their state
 */
class StatusWatcher extends EventEmitter {
  /**
   * Create a StatusWatcher instance
   * @param {Object} config - Configuration object
   * @param {string[]} [config.watchPaths=[]] - Array of status.json file paths to watch
   * @param {number} [config.debounceDelay=100] - Debounce delay for file changes (ms)
   * @param {boolean} [config.persistent=true] - Keep process running while watching
   * @param {Object} [config.logger] - Logger object with log methods
   */
  constructor(config = {}) {
    super();

    this.config = {
      watchPaths: config.watchPaths || [],
      debounceDelay: config.debounceDelay || 100,
      persistent: config.persistent !== undefined ? config.persistent : true,
      logger: config.logger || console
    };

    // Watcher state
    this.watchers = new Map(); // Map of path -> chokidar watcher
    this.sessions = new Map(); // Map of sessionId -> session data
    this.statuses = new Map(); // Map of sessionId -> current status
    this.debounceTimers = new Map(); // Map of path -> debounce timer
    this.isWatching = false;
  }

  /**
   * Start watching all configured paths
   * @returns {Promise<void>}
   */
  async start() {
    try {
      if (this.isWatching) {
        this._log('debug', 'StatusWatcher already started');
        return;
      }

      this._log('info', 'Starting StatusWatcher');

      // Add initial watch paths from config
      for (const watchPath of this.config.watchPaths) {
        await this.addWatchPath(watchPath);
      }

      this.isWatching = true;
      this._log('info', `StatusWatcher started with ${this.watchers.size} paths`);
    } catch (error) {
      this._log('error', `Failed to start StatusWatcher: ${error.message}`);
      throw error;
    }
  }

  /**
   * Stop watching all paths
   * @returns {Promise<void>}
   */
  async stop() {
    try {
      if (!this.isWatching) {
        this._log('debug', 'StatusWatcher not running');
        return;
      }

      this._log('info', 'Stopping StatusWatcher');

      // Clear all debounce timers
      for (const timer of this.debounceTimers.values()) {
        clearTimeout(timer);
      }
      this.debounceTimers.clear();

      // Close all watchers
      const closePromises = [];
      for (const [watchPath, watcher] of this.watchers.entries()) {
        closePromises.push(
          watcher.close().catch(err => {
            this._log('warning', `Error closing watcher for ${watchPath}: ${err.message}`);
          })
        );
      }

      await Promise.all(closePromises);

      // Clear state
      this.watchers.clear();
      this.sessions.clear();
      this.statuses.clear();
      this.isWatching = false;

      this._log('info', 'StatusWatcher stopped');
    } catch (error) {
      this._log('error', `Error stopping StatusWatcher: ${error.message}`);
      throw error;
    }
  }

  /**
   * Add a new path to watch
   * @param {string} watchPath - Path to status.json file
   * @param {string} [label] - Optional label for the session
   * @returns {Promise<string>} Session ID
   */
  async addWatchPath(watchPath, label = null) {
    try {
      // Normalize path for cross-platform compatibility
      const normalizedPath = path.normalize(watchPath);

      // Check if already watching this path
      if (this.watchers.has(normalizedPath)) {
        this._log('debug', `Already watching path: ${normalizedPath}`);
        // Return existing session ID
        for (const [sessionId, session] of this.sessions.entries()) {
          if (session.path === normalizedPath) {
            return sessionId;
          }
        }
      }

      // Generate session ID from path and label
      const sessionId = this._generateSessionId(normalizedPath, label);

      // Create session data
      const session = {
        id: sessionId,
        path: normalizedPath,
        label: label || path.basename(path.dirname(normalizedPath)),
        addedAt: new Date()
      };

      this.sessions.set(sessionId, session);

      // Read initial status if file exists
      if (fs.existsSync(normalizedPath)) {
        try {
          const status = this._readStatusFile(normalizedPath);
          this.statuses.set(sessionId, status);
          this._log('debug', `Initial status loaded for ${sessionId}`);
        } catch (error) {
          this._log('warning', `Failed to read initial status for ${normalizedPath}: ${error.message}`);
        }
      }

      // Create watcher for this path
      const watcher = chokidar.watch(normalizedPath, {
        persistent: this.config.persistent,
        ignoreInitial: true, // Don't trigger on initial add
        awaitWriteFinish: {
          stabilityThreshold: 100,
          pollInterval: 50
        }
      });

      // Set up event handlers
      watcher.on('change', (filePath) => {
        this._handleFileChange(sessionId, filePath);
      });

      watcher.on('add', (filePath) => {
        this._handleFileChange(sessionId, filePath);
      });

      watcher.on('unlink', (filePath) => {
        this._handleFileUnlink(sessionId, filePath);
      });

      watcher.on('error', (error) => {
        this._log('error', `Watcher error for ${normalizedPath}: ${error.message}`);
        this.emit('error', sessionId, error);
      });

      this.watchers.set(normalizedPath, watcher);

      this._log('info', `Added watch path: ${normalizedPath} (${sessionId})`);

      return sessionId;
    } catch (error) {
      this._log('error', `Failed to add watch path ${watchPath}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Remove a watch path
   * @param {string} pathOrSessionId - Path or session ID to remove
   * @returns {Promise<boolean>} True if removed successfully
   */
  async removeWatchPath(pathOrSessionId) {
    try {
      // Try to find by path first
      let normalizedPath = path.normalize(pathOrSessionId);
      let sessionId = null;

      // Find session by path or ID
      for (const [sid, session] of this.sessions.entries()) {
        if (session.path === normalizedPath || sid === pathOrSessionId) {
          sessionId = sid;
          normalizedPath = session.path;
          break;
        }
      }

      if (!sessionId) {
        this._log('warning', `Watch path not found: ${pathOrSessionId}`);
        return false;
      }

      // Clear debounce timer
      if (this.debounceTimers.has(normalizedPath)) {
        clearTimeout(this.debounceTimers.get(normalizedPath));
        this.debounceTimers.delete(normalizedPath);
      }

      // Close and remove watcher
      const watcher = this.watchers.get(normalizedPath);
      if (watcher) {
        await watcher.close();
        this.watchers.delete(normalizedPath);
      }

      // Remove session data
      this.sessions.delete(sessionId);
      this.statuses.delete(sessionId);

      this._log('info', `Removed watch path: ${normalizedPath} (${sessionId})`);

      return true;
    } catch (error) {
      this._log('error', `Failed to remove watch path ${pathOrSessionId}: ${error.message}`);
      return false;
    }
  }

  /**
   * Get all current statuses
   * @returns {Object} Map of session IDs to status objects
   */
  getAllStatuses() {
    const result = {};

    for (const [sessionId, status] of this.statuses.entries()) {
      const session = this.sessions.get(sessionId);
      result[sessionId] = {
        ...status,
        sessionInfo: {
          id: session.id,
          label: session.label,
          path: session.path,
          addedAt: session.addedAt
        }
      };
    }

    return result;
  }

  /**
   * Get status for a specific session
   * @param {string} sessionId - Session ID
   * @returns {Object|null} Status object or null if not found
   */
  getStatus(sessionId) {
    const status = this.statuses.get(sessionId);
    if (!status) {
      return null;
    }

    const session = this.sessions.get(sessionId);
    return {
      ...status,
      sessionInfo: {
        id: session.id,
        label: session.label,
        path: session.path,
        addedAt: session.addedAt
      }
    };
  }

  /**
   * Handle file change event (debounced)
   * @private
   * @param {string} sessionId - Session ID
   * @param {string} filePath - File path that changed
   */
  _handleFileChange(sessionId, filePath) {
    // Clear existing debounce timer
    if (this.debounceTimers.has(filePath)) {
      clearTimeout(this.debounceTimers.get(filePath));
    }

    // Set new debounce timer
    const timer = setTimeout(() => {
      this._processFileChange(sessionId, filePath);
      this.debounceTimers.delete(filePath);
    }, this.config.debounceDelay);

    this.debounceTimers.set(filePath, timer);
  }

  /**
   * Handle file unlink event
   * @private
   * @param {string} sessionId - Session ID
   * @param {string} filePath - File path that was unlinked
   */
  _handleFileUnlink(sessionId, filePath) {
    this._log('debug', `Status file deleted: ${filePath}`);

    const previousStatus = this.statuses.get(sessionId);
    this.statuses.delete(sessionId);

    this.emit('statusChange', sessionId, null, previousStatus);
  }

  /**
   * Process file change and emit events
   * @private
   * @param {string} sessionId - Session ID
   * @param {string} filePath - File path that changed
   */
  _processFileChange(sessionId, filePath) {
    try {
      // Read and parse status file
      const newStatus = this._readStatusFile(filePath);
      const previousStatus = this.statuses.get(sessionId) || null;

      // Store new status
      this.statuses.set(sessionId, newStatus);

      // Emit statusChange event
      this.emit('statusChange', sessionId, newStatus, previousStatus);

      // Check for rate limit changes
      this._checkRateLimitChanges(sessionId, newStatus, previousStatus);

      this._log('debug', `Status updated for ${sessionId}`);
    } catch (error) {
      this._log('error', `Failed to process status change for ${filePath}: ${error.message}`);
      this.emit('error', sessionId, error);
    }
  }

  /**
   * Check for rate limit changes and emit events
   * @private
   * @param {string} sessionId - Session ID
   * @param {Object} newStatus - New status object
   * @param {Object|null} previousStatus - Previous status object
   */
  _checkRateLimitChanges(sessionId, newStatus, previousStatus) {
    const newRateLimit = newStatus.rateLimitResetTime || null;
    const prevRateLimit = previousStatus?.rateLimitResetTime || null;

    // Rate limit detected (new or changed)
    if (newRateLimit && newRateLimit !== prevRateLimit) {
      this._log('info', `Rate limit detected for ${sessionId}: ${newRateLimit}`);
      this.emit('rateLimitDetected', sessionId, newRateLimit);
    }

    // Rate limit cleared
    if (!newRateLimit && prevRateLimit) {
      this._log('info', `Rate limit cleared for ${sessionId}`);
      this.emit('rateLimitCleared', sessionId);
    }
  }

  /**
   * Read and parse status file
   * @private
   * @param {string} filePath - Path to status.json file
   * @returns {Object} Parsed status object
   * @throws {Error} If file cannot be read or parsed
   */
  _readStatusFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');

      // Handle empty files
      if (!content || content.trim() === '') {
        return {};
      }

      const status = JSON.parse(content);

      // Normalize status object
      return {
        rateLimitResetTime: status.rateLimitResetTime || null,
        lastUpdated: status.lastUpdated || new Date().toISOString(),
        ...status
      };
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid JSON in status file: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Generate a unique session ID
   * @private
   * @param {string} filePath - File path
   * @param {string|null} label - Optional label
   * @returns {string} Session ID
   */
  _generateSessionId(filePath, label) {
    if (label) {
      return label;
    }

    // Use directory name as session ID
    const dirName = path.basename(path.dirname(filePath));

    // If multiple sessions have the same directory name, append a counter
    let sessionId = dirName;
    let counter = 1;

    while (this.sessions.has(sessionId)) {
      sessionId = `${dirName}-${counter}`;
      counter++;
    }

    return sessionId;
  }

  /**
   * Internal logging method
   * @private
   * @param {string} level - Log level (info, warning, error, debug)
   * @param {string} message - Log message
   */
  _log(level, message) {
    try {
      const logMessage = `[StatusWatcher] ${message}`;

      if (this.config.logger && typeof this.config.logger.log === 'function') {
        this.config.logger.log(level, logMessage);
      } else if (this.config.logger && typeof this.config.logger[level] === 'function') {
        this.config.logger[level](logMessage);
      } else {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [${level.toUpperCase()}] ${logMessage}`);
      }
    } catch (err) {
      // Fail silently to avoid breaking watcher flow
    }
  }
}

// Export the StatusWatcher class
module.exports = StatusWatcher;
