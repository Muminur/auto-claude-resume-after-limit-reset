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
