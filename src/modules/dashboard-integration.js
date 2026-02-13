/**
 * Dashboard Integration Module
 *
 * Coordinates all dashboard servers (HTTP, WebSocket, API) and provides
 * a unified interface for the daemon to manage the dashboard.
 *
 * Features:
 * - Start/stop all servers together
 * - StatusBridge for daemon-to-server communication
 * - Browser launching for GUI
 * - Graceful error handling
 *
 * @module DashboardIntegration
 */

const { exec } = require('child_process');
const { EventEmitter } = require('events');
const HttpServer = require('./http-server');
const WebSocketServer = require('./websocket-server');
const ApiServer = require('./api-server');
const StatusBridge = require('./status-bridge');

/**
 * DashboardIntegration class
 * Orchestrates all dashboard components
 */
class DashboardIntegration extends EventEmitter {
  /**
   * Create a DashboardIntegration instance
   * @param {Object} config - Dashboard configuration
   * @param {Object} config.configManager - Configuration manager instance
   * @param {Object} [config.logger] - Logger object with log methods
   */
  constructor(config = {}) {
    super();

    this.configManager = config.configManager;
    this.logger = config.logger || console;

    // Server instances
    this.httpServer = null;
    this.wsServer = null;
    this.apiServer = null;
    this.statusBridge = null;

    // State
    this.isRunning = false;
  }

  /**
   * Start all dashboard servers
   * @returns {Promise<void>}
   */
  async startServers() {
    try {
      this._log('info', 'Starting dashboard servers');

      // Get configuration
      const guiPort = this.configManager.get('gui.port') || 3737;
      const wsPort = this.configManager.get('websocket.port') || 3847;
      const apiPort = this.configManager.get('api.port') || 3848;
      const wsEnabled = this.configManager.get('websocket.enabled') !== false;
      const apiEnabled = this.configManager.get('api.enabled') !== false;

      // Create HTTP server (always enabled for GUI)
      this.httpServer = new HttpServer({
        port: guiPort,
        logger: this.logger
      });

      // Create WebSocket server if enabled
      if (wsEnabled) {
        this.wsServer = new WebSocketServer({
          port: wsPort,
          logger: this.logger,
          enableHeartbeat: true
        });
      }

      // Create API server if enabled
      if (apiEnabled) {
        // Create StatusBridge to connect daemon state to API
        this.statusBridge = new StatusBridge({
          wsServer: this.wsServer,
          logger: this.logger
        });

        this.apiServer = new ApiServer(
          {
            port: apiPort,
            logger: this.logger
          },
          {
            statusWatcher: this.statusBridge,
            configManager: this.configManager
          }
        );
      }

      // Register WebSocket message handlers
      this._registerMessageHandlers();

      // Start servers in order
      const startedServers = [];

      try {
        await this.httpServer.start();
        startedServers.push(this.httpServer);

        if (this.wsServer) {
          await this.wsServer.start();
          startedServers.push(this.wsServer);
        }

        if (this.apiServer) {
          await this.apiServer.start();
          startedServers.push(this.apiServer);
        }
      } catch (error) {
        // Cleanup on partial failure
        this._log('error', `Server startup failed: ${error.message}`);

        for (const server of startedServers) {
          try {
            await server.stop();
          } catch (stopError) {
            this._log('error', `Error stopping server during cleanup: ${stopError.message}`);
          }
        }

        throw error;
      }

      this.isRunning = true;
      this._log('info', 'All dashboard servers started');
      this.emit('started');
    } catch (error) {
      this._log('error', `Failed to start dashboard: ${error.message}`);
      throw error;
    }
  }

  /**
   * Stop all dashboard servers
   * @returns {Promise<void>}
   */
  async stopServers() {
    this._log('info', 'Stopping dashboard servers');

    const errors = [];

    // Stop servers in reverse order
    if (this.apiServer) {
      try {
        await this.apiServer.stop();
      } catch (error) {
        errors.push(error);
        this._log('error', `Error stopping API server: ${error.message}`);
      }
    }

    if (this.wsServer) {
      try {
        await this.wsServer.stop();
      } catch (error) {
        errors.push(error);
        this._log('error', `Error stopping WebSocket server: ${error.message}`);
      }
    }

    if (this.httpServer) {
      try {
        await this.httpServer.stop();
      } catch (error) {
        errors.push(error);
        this._log('error', `Error stopping HTTP server: ${error.message}`);
      }
    }

    this.isRunning = false;
    this._log('info', 'Dashboard servers stopped');
    this.emit('stopped');
  }

  /**
   * Open the GUI in the default browser
   * @returns {Promise<void>}
   */
  async openGui() {
    // Start HTTP server if not running
    if (!this.httpServer || !this.httpServer.isRunning) {
      // Create minimal server for GUI only
      const guiPort = this.configManager.get('gui.port') || 3737;
      const wsPort = this.configManager.get('websocket.port') || 3847;

      this.httpServer = new HttpServer({
        port: guiPort,
        logger: this.logger
      });

      await this.httpServer.start();
    }

    // Build URL with WebSocket port parameter
    const guiPort = this.configManager.get('gui.port') || 3737;
    const wsPort = this.configManager.get('websocket.port') || 3847;
    const url = `http://localhost:${guiPort}?wsPort=${wsPort}`;

    // Open browser based on platform
    const cmd = this._getOpenCommand(url);

    return new Promise((resolve, reject) => {
      exec(cmd, (error) => {
        if (error) {
          this._log('error', `Failed to open browser: ${error.message}`);
          reject(error);
        } else {
          this._log('info', `Opened GUI at ${url}`);
          resolve();
        }
      });
    });
  }

  /**
   * Broadcast status to connected WebSocket clients
   * @param {Object} status - Status object
   */
  broadcastStatus(status) {
    if (this.wsServer) {
      this.wsServer.broadcastStatus(status);
    }
  }

  /**
   * Broadcast event to connected WebSocket clients
   * @param {string} event - Event name
   * @param {Object} data - Event data
   */
  broadcastEvent(event, data) {
    if (this.wsServer) {
      this.wsServer.broadcastEvent(event, data);
    }
  }

  /**
   * Get status of all servers
   * @returns {Object} Status object
   */
  getStatus() {
    return {
      httpServer: this.httpServer ? this.httpServer.getStatus() : { running: false },
      wsServer: this.wsServer ? this.wsServer.getStatus() : { running: false },
      apiServer: this.apiServer ? this.apiServer.getStatus() : { running: false }
    };
  }

  /**
   * Get platform-specific command to open URL
   * @private
   * @param {string} url - URL to open
   * @returns {string} Command string
   */
  _getOpenCommand(url) {
    switch (process.platform) {
      case 'darwin':
        return `open "${url}"`;
      case 'win32':
        return `start "" "${url}"`;
      default:
        return `xdg-open "${url}"`;
    }
  }


  /**
   * Register message handlers with the WebSocket server
   */
  _registerMessageHandlers() {
    if (!this.wsServer) return;

    // Status request handler
    this.wsServer.registerHandler('status', (ws, state, message) => {
      const statuses = this.statusBridge ? this.statusBridge.getAllStatuses() : {};
      const sessions = Object.entries(statuses).map(([id, status]) => ({
        id,
        ...status
      }));

      this.wsServer.send(ws, {
        type: 'status',
        sessions: sessions,
        stats: this._getDaemonStats()
      });
    });

    // Config request handler
    this.wsServer.registerHandler('config', (ws, state, message) => {
      const config = this.configManager.getConfig();
      this.wsServer.send(ws, {
        type: 'config',
        config: config
      });
    });

    // Analytics request handler
    this.wsServer.registerHandler('analytics', (ws, state, message) => {
      const analytics = this.statusBridge ? this.statusBridge.getAnalytics() : {};
      this.wsServer.send(ws, {
        type: 'analytics',
        data: analytics.chartData || []
      });
    });

    // Resume session handler
    this.wsServer.registerHandler('resume', (ws, state, message) => {
      const sessionId = message.session_id || 'default';
      this._log('info', `Resume requested for session: ${sessionId}`);

      // Emit event for daemon to handle
      this.emit('action:resume', { sessionId });

      // Send acknowledgment
      this.wsServer.send(ws, {
        type: 'action_response',
        action: 'resume',
        success: true,
        message: `Resume triggered for session ${sessionId}`
      });
    });

    // Clear session handler
    this.wsServer.registerHandler('clear', (ws, state, message) => {
      const sessionId = message.session_id || 'default';
      this._log('info', `Clear requested for session: ${sessionId}`);

      // Emit event for daemon to handle
      this.emit('action:clear', { sessionId });

      // Send acknowledgment
      this.wsServer.send(ws, {
        type: 'action_response',
        action: 'clear',
        success: true,
        message: `Status cleared for session ${sessionId}`
      });
    });

    // Reset status handler
    this.wsServer.registerHandler('reset_status', (ws, state, message) => {
      this._log('info', 'Reset status requested');

      // Emit event for daemon to handle
      this.emit('action:reset_status');

      // Send acknowledgment
      this.wsServer.send(ws, {
        type: 'action_response',
        action: 'reset_status',
        success: true,
        message: 'Status reset triggered'
      });
    });

    // Config update handler
    this.wsServer.registerHandler('config_update', (ws, state, message) => {
      const config = message.config || {};
      this._log('info', 'Config update requested');

      // Emit event for daemon to handle
      this.emit('action:config_update', { config });

      // Send acknowledgment
      this.wsServer.send(ws, {
        type: 'action_response',
        action: 'config_update',
        success: true,
        message: 'Configuration updated'
      });
    });

    // Get logs handler
    this.wsServer.registerHandler('get_logs', (ws, state, message) => {
      this._log('debug', 'Logs requested');

      // Return recent logs from memory (or file)
      const logs = this._getRecentLogs();

      this.wsServer.send(ws, {
        type: 'logs',
        logs: logs
      });
    });

    this._log('debug', 'Registered WebSocket message handlers');
  }

  /**
   * Update daemon status in the StatusBridge
   * Called by the daemon when rate limit status changes
   * @param {Object} status - Current daemon status
   * @param {boolean} status.detected - Whether rate limit is detected
   * @param {string} [status.reset_time] - ISO timestamp for rate limit reset
   * @param {string} [status.message] - Status message
   */
  updateDaemonStatus(status) {
    if (!this.statusBridge) {
      this._log('warning', 'StatusBridge not initialized');
      return;
    }

    // Update StatusBridge state
    this.statusBridge.daemonState.isRateLimited = status.detected || false;
    this.statusBridge.daemonState.currentStatus = status.detected ? {
      detected: status.detected,
      reset_time: status.reset_time,
      message: status.message || 'Rate limit detected'
    } : null;

    // Broadcast status update to all WebSocket clients
    if (this.wsServer && status.detected) {
      this.wsServer.broadcastStatus({
        detected: status.detected,
        reset_time: status.reset_time,
        message: status.message
      });
    } else if (this.wsServer) {
      // Broadcast cleared status
      this.wsServer.broadcastStatus({
        detected: false,
        message: 'No rate limit'
      });
    }

    this._log('debug', `Daemon status updated: detected=${status.detected}`);
  }

  /**
   * Get daemon statistics for the status response
   */
  _getDaemonStats() {
    return {
      uptime: process.uptime(),
      total_resumes: this._totalResumes || 0,
      success_rate: this._successRate || 1.0,
      peak_hour: this._peakHour || '--'
    };
  }

  /**
   * Get recent logs for the GUI
   * @returns {Array} Array of recent log entries
   */
  _getRecentLogs() {
    // Return logs from memory buffer or empty array
    return this._logBuffer || [];
  }

  /**
   * Add a log entry to the buffer (for GUI display)
   * @param {string} level - Log level
   * @param {string} message - Log message
   */
  addLogEntry(level, message) {
    if (!this._logBuffer) {
      this._logBuffer = [];
    }

    this._logBuffer.push({
      timestamp: new Date().toISOString(),
      level,
      message
    });

    // Keep only last 100 entries
    if (this._logBuffer.length > 100) {
      this._logBuffer.shift();
    }
  }

  /**
   * Internal logging method
   * @private
   * @param {string} level - Log level
   * @param {string} message - Log message
   */
  _log(level, message) {
    try {
      const logMessage = `[DashboardIntegration] ${message}`;

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

module.exports = DashboardIntegration;
