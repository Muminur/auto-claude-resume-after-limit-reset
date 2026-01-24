/**
 * StatusBridge Module
 *
 * Bridges the daemon's internal state to the API and WebSocket servers.
 * Provides a unified interface for status queries and broadcasts.
 *
 * Features:
 * - Implements statusWatcher interface for ApiServer
 * - Triggers WebSocket broadcasts on status changes
 * - Formats daemon state for API consumption
 * - Analytics data access
 *
 * @module StatusBridge
 */

const { EventEmitter } = require('events');

/**
 * StatusBridge class
 * Bridges daemon state to API/WebSocket format
 */
class StatusBridge extends EventEmitter {
  /**
   * Create a StatusBridge instance
   * @param {Object} config - Bridge configuration
   * @param {Object} [config.daemonState] - Reference to daemon's internal state
   * @param {Object} [config.wsServer] - WebSocket server instance
   * @param {Object} [config.logger] - Logger object with log methods
   */
  constructor(config = {}) {
    super();

    this.daemonState = config.daemonState || {
      currentStatus: null,
      resetTime: null,
      isRateLimited: false,
      sessions: new Map(),
      analytics: null
    };

    this.wsServer = config.wsServer || null;
    this.logger = config.logger || console;
  }

  /**
   * Get all session statuses
   * Implements statusWatcher.getAllStatuses() interface for ApiServer
   * @returns {Object} Map of session IDs to status objects
   */
  getAllStatuses() {
    const statuses = {};

    // Add default session status if rate limited
    if (this.daemonState.isRateLimited && this.daemonState.currentStatus) {
      statuses.default = this.daemonState.currentStatus;
    }

    // Add named sessions
    if (this.daemonState.sessions && this.daemonState.sessions instanceof Map) {
      for (const [sessionId, status] of this.daemonState.sessions) {
        statuses[sessionId] = status;
      }
    }

    return statuses;
  }

  /**
   * Get status for a specific session
   * Implements statusWatcher.getStatus(sessionId) interface for ApiServer
   * @param {string} sessionId - Session identifier
   * @returns {Object|null} Status object or null if not found
   */
  getStatus(sessionId) {
    // Check default session
    if (sessionId === 'default') {
      return this.daemonState.currentStatus || null;
    }

    // Check named sessions
    if (this.daemonState.sessions && this.daemonState.sessions instanceof Map) {
      return this.daemonState.sessions.get(sessionId) || null;
    }

    return null;
  }

  /**
   * Notify status change and broadcast to WebSocket clients
   * @param {string} eventType - Type of event (status, rate_limit, countdown, resume_success)
   * @param {Object} data - Event data
   */
  notifyStatusChange(eventType, data) {
    if (!this.wsServer) {
      this._log('debug', `No WebSocket server configured, skipping broadcast for ${eventType}`);
      return;
    }

    try {
      switch (eventType) {
        case 'status':
          this.wsServer.broadcastStatus(data);
          break;

        case 'rate_limit':
        case 'countdown':
        case 'resume_success':
          this.wsServer.broadcastEvent(eventType, data);
          break;

        default:
          this.wsServer.broadcastEvent(eventType, data);
      }

      this._log('debug', `Broadcast ${eventType} event`);
    } catch (error) {
      this._log('error', `Error broadcasting ${eventType}: ${error.message}`);
    }
  }

  /**
   * Get analytics data
   * @returns {Object} Analytics data or empty object
   */
  getAnalytics() {
    return this.daemonState.analytics || {};
  }

  /**
   * Update daemon state reference
   * @param {Object} newState - New state values to merge
   */
  updateDaemonState(newState) {
    // Merge new state
    Object.assign(this.daemonState, newState);

    // Broadcast status update if we have a current status
    if (newState.currentStatus && this.wsServer) {
      this.wsServer.broadcastStatus(newState.currentStatus);
    }

    this._log('debug', 'Daemon state updated');
  }

  /**
   * Emit status change event
   * Compatible with ApiServer event handling
   * @param {Object} status - Status object
   */
  emitStatusChange(status) {
    this.emit('statusChange', status);
  }

  /**
   * Internal logging method
   * @private
   * @param {string} level - Log level
   * @param {string} message - Log message
   */
  _log(level, message) {
    try {
      const logMessage = `[StatusBridge] ${message}`;

      if (this.logger && typeof this.logger.log === 'function') {
        this.logger.log(level, logMessage);
      } else if (this.logger && typeof this.logger[level] === 'function') {
        this.logger[level](logMessage);
      } else {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [${level.toUpperCase()}] ${logMessage}`);
      }
    } catch (err) {
      // Fail silently
    }
  }
}

module.exports = StatusBridge;
