/**
 * WebSocket Server Module
 *
 * Real-time WebSocket server for Claude Code Auto-Resume status updates.
 * Provides JSON-RPC style messaging protocol for broadcasting session status,
 * events, and notifications to connected clients.
 *
 * Features:
 * - WebSocket server using 'ws' library
 * - JSON-RPC style message protocol
 * - Client subscriptions with session filtering
 * - Heartbeat/ping-pong for connection health
 * - Graceful reconnection handling
 * - Comprehensive error handling and logging
 *
 * Message Protocol:
 * - status: Broadcast session status updates
 * - event: Broadcast application events
 * - subscribe: Client subscribes to specific sessions
 * - unsubscribe: Client unsubscribes from sessions
 * - ping/pong: Connection health check
 *
 * @module WebSocketServer
 */

const WebSocket = require('ws');
const { EventEmitter } = require('events');

/**
 * WebSocketServer class
 * Manages WebSocket connections and broadcasts status updates
 */
class WebSocketServer extends EventEmitter {
  /**
   * Create a WebSocketServer instance
   * @param {Object} config - Server configuration
   * @param {number} [config.port=3847] - WebSocket server port
   * @param {number} [config.pingInterval=30000] - Heartbeat interval in ms
   * @param {number} [config.pingTimeout=5000] - Heartbeat timeout in ms
   * @param {Object} [config.logger] - Logger object with log methods
   */
  constructor(config = {}) {
    super();

    this.config = {
      port: config.port || 3847,
      pingInterval: config.pingInterval || 30000,
      pingTimeout: config.pingTimeout || 5000,
      enableHeartbeat: config.enableHeartbeat !== false, // Default true, set false for testing
      ...config
    };

    this.server = null;
    this.clients = new Map(); // Map<WebSocket, ClientState>
    this.isRunning = false;
    this.pingIntervalId = null;
    this.logger = config.logger || console;
    this.messageHandlers = new Map(); // Custom message handlers
  }

  /**
   * Start the WebSocket server
   * @returns {Promise<void>}
   * @throws {Error} If server fails to start
   */
  async start() {
    if (this.isRunning) {
      this._log('warning', 'WebSocket server already running');
      return;
    }

    try {
      this._log('info', `Starting WebSocket server on port ${this.config.port}`);

      // Create WebSocket server
      this.server = new WebSocket.Server({
        port: this.config.port,
        clientTracking: false // We track clients manually
      });

      // Set up event handlers
      this.server.on('connection', this._handleConnection.bind(this));
      this.server.on('error', this._handleServerError.bind(this));
      this.server.on('close', this._handleServerClose.bind(this));

      // Start heartbeat interval
      this._startHeartbeat();

      this.isRunning = true;
      this._log('info', `WebSocket server started on ws://localhost:${this.config.port}`);

      this.emit('started', { port: this.config.port });
    } catch (error) {
      this._log('error', `Failed to start WebSocket server: ${error.message}`);
      throw error;
    }
  }

  /**
   * Stop the WebSocket server
   * @returns {Promise<void>}
   */
  async stop() {
    if (!this.isRunning) {
      this._log('warning', 'WebSocket server not running');
      return;
    }

    try {
      this._log('info', 'Stopping WebSocket server');

      // Stop heartbeat
      this._stopHeartbeat();

      // Close all client connections
      for (const [ws] of this.clients) {
        ws.close(1000, 'Server shutting down');
      }
      this.clients.clear();

      // Close server
      await new Promise((resolve, reject) => {
        if (this.server) {
          this.server.close((err) => {
            if (err) reject(err);
            else resolve();
          });
        } else {
          resolve();
        }
      });

      this.server = null;
      this.isRunning = false;

      this._log('info', 'WebSocket server stopped');
      this.emit('stopped');
    } catch (error) {
      this._log('error', `Error stopping WebSocket server: ${error.message}`);
      throw error;
    }
  }

  /**
   * Broadcast message to all connected clients
   * @param {Object} message - Message object to broadcast
   * @returns {number} Number of clients message was sent to
   */
  broadcast(message) {
    if (!this.isRunning) {
      this._log('warning', 'Cannot broadcast - server not running');
      return 0;
    }

    const payload = JSON.stringify(message);
    let sentCount = 0;

    for (const [ws, state] of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(payload);
          sentCount++;
        } catch (error) {
          this._log('error', `Error sending to client: ${error.message}`);
        }
      }
    }

    this._log('debug', `Broadcast message to ${sentCount} clients`);
    return sentCount;
  }

  /**
   * Broadcast status update to subscribed clients
   * @param {Object} status - Status object
   * @param {string} [status.session] - Session identifier
   * @param {string} [status.state] - Current state
   * @param {Date|string} [status.resetTime] - Rate limit reset time
   * @returns {number} Number of clients message was sent to
   */
  broadcastStatus(status) {
    const message = {
      type: 'status',
      timestamp: new Date().toISOString(),
      data: status
    };

    // Filter clients based on subscriptions
    const sessionId = status.session;
    let sentCount = 0;

    if (!this.isRunning) {
      this._log('warning', 'Cannot broadcast status - server not running');
      return 0;
    }

    const payload = JSON.stringify(message);

    for (const [ws, state] of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        // Check if client is subscribed to this session
        if (this._isSubscribed(state, sessionId)) {
          try {
            ws.send(payload);
            sentCount++;
          } catch (error) {
            this._log('error', `Error sending status to client: ${error.message}`);
          }
        }
      }
    }

    this._log('debug', `Broadcast status to ${sentCount} subscribed clients`);
    return sentCount;
  }

  /**
   * Broadcast event to all connected clients
   * @param {string} event - Event name
   * @param {*} payload - Event payload
   * @returns {number} Number of clients message was sent to
   */
  broadcastEvent(event, payload) {
    const message = {
      type: 'event',
      timestamp: new Date().toISOString(),
      data: {
        event,
        payload
      }
    };

    return this.broadcast(message);
  }

  /**
   * Get number of connected clients
   * @returns {number} Number of connected clients
   */
  getClients() {
    return this.clients.size;
  }

  /**
   * Get server status
   * @returns {Object} Status object
   */
  getStatus() {
    return {
      running: this.isRunning,
      port: this.config.port,
      clients: this.clients.size,
      uptime: this.isRunning ? process.uptime() : 0
    };
  }

  /**
   * Handle new WebSocket connection
   * @private
   * @param {WebSocket} ws - WebSocket client
   */
  _handleConnection(ws) {
    const clientId = this._generateClientId();
    this._log('info', `Client connected: ${clientId}`);

    // Initialize client state
    const state = {
      id: clientId,
      subscriptions: ['*'], // Default: subscribe to all sessions
      isAlive: true,
      connectedAt: new Date()
    };

    this.clients.set(ws, state);

    // Set up client event handlers
    ws.on('message', (data) => this._handleMessage(ws, state, data));
    ws.on('pong', () => this._handlePong(ws, state));
    ws.on('close', () => this._handleClientClose(ws, state));
    ws.on('error', (error) => this._handleClientError(ws, state, error));

    // Send welcome message
    this._send(ws, {
      type: 'welcome',
      data: {
        clientId,
        serverVersion: '1.0.0',
        timestamp: new Date().toISOString()
      }
    });

    this.emit('client_connected', { clientId });
  }

  /**
   * Handle message from client
   * @private
   * @param {WebSocket} ws - WebSocket client
   * @param {Object} state - Client state
   * @param {string|Buffer} data - Message data
   */
  _handleMessage(ws, state, data) {
    try {
      const message = JSON.parse(data.toString());
      this._log('debug', `Message from ${state.id}: ${message.type}`);

      switch (message.type) {
        case 'ping':
          this._handlePing(ws, state);
          break;

        case 'subscribe':
          this._handleSubscribe(ws, state, message.data);
          break;

        case 'unsubscribe':
          this._handleUnsubscribe(ws, state, message.data);
          break;

        default:
          // Check for registered custom handlers
          if (this.messageHandlers.has(message.type)) {
            const handler = this.messageHandlers.get(message.type);
            try {
              handler(ws, state, message);
            } catch (err) {
              this._log('error', `Handler error for ${message.type}: ${err.message}`);
              this._send(ws, { type: 'error', data: { message: 'Handler error' } });
            }
          } else {
            this._log('warning', `Unknown message type: ${message.type}`);
            this._send(ws, {
              type: 'error',
              data: { message: 'Unknown message type' }
            });
          }
      }
    } catch (error) {
      this._log('error', `Error handling message: ${error.message}`);
      this._send(ws, {
        type: 'error',
        data: { message: 'Invalid message format' }
      });
    }
  }

  /**
   * Handle ping message
   * @private
   * @param {WebSocket} ws - WebSocket client
   * @param {Object} state - Client state
   */
  _handlePing(ws, state) {
    state.isAlive = true;
    this._send(ws, { type: 'pong' });
  }

  /**
   * Handle pong response
   * @private
   * @param {WebSocket} ws - WebSocket client
   * @param {Object} state - Client state
   */
  _handlePong(ws, state) {
    state.isAlive = true;
  }

  /**
   * Handle subscribe message
   * @private
   * @param {WebSocket} ws - WebSocket client
   * @param {Object} state - Client state
   * @param {Object} data - Subscribe data
   */
  _handleSubscribe(ws, state, data) {
    try {
      const sessions = data.sessions || [];

      if (!Array.isArray(sessions)) {
        throw new Error('sessions must be an array');
      }

      // Add to subscriptions (avoid duplicates)
      for (const session of sessions) {
        if (!state.subscriptions.includes(session)) {
          state.subscriptions.push(session);
        }
      }

      this._log('debug', `Client ${state.id} subscribed to: ${sessions.join(', ')}`);

      this._send(ws, {
        type: 'subscribed',
        data: { sessions: state.subscriptions }
      });
    } catch (error) {
      this._log('error', `Error handling subscribe: ${error.message}`);
      this._send(ws, {
        type: 'error',
        data: { message: error.message }
      });
    }
  }

  /**
   * Handle unsubscribe message
   * @private
   * @param {WebSocket} ws - WebSocket client
   * @param {Object} state - Client state
   * @param {Object} data - Unsubscribe data
   */
  _handleUnsubscribe(ws, state, data) {
    try {
      const sessions = data.sessions || [];

      if (!Array.isArray(sessions)) {
        throw new Error('sessions must be an array');
      }

      // Remove from subscriptions
      state.subscriptions = state.subscriptions.filter(
        s => !sessions.includes(s)
      );

      this._log('debug', `Client ${state.id} unsubscribed from: ${sessions.join(', ')}`);

      this._send(ws, {
        type: 'unsubscribed',
        data: { sessions: state.subscriptions }
      });
    } catch (error) {
      this._log('error', `Error handling unsubscribe: ${error.message}`);
      this._send(ws, {
        type: 'error',
        data: { message: error.message }
      });
    }
  }

  /**
   * Handle client close
   * @private
   * @param {WebSocket} ws - WebSocket client
   * @param {Object} state - Client state
   */
  _handleClientClose(ws, state) {
    this._log('info', `Client disconnected: ${state.id}`);
    this.clients.delete(ws);
    this.emit('client_disconnected', { clientId: state.id });
  }

  /**
   * Handle client error
   * @private
   * @param {WebSocket} ws - WebSocket client
   * @param {Object} state - Client state
   * @param {Error} error - Error object
   */
  _handleClientError(ws, state, error) {
    this._log('error', `Client error (${state.id}): ${error.message}`);
  }

  /**
   * Handle server error
   * @private
   * @param {Error} error - Error object
   */
  _handleServerError(error) {
    this._log('error', `Server error: ${error.message}`);
    this.emit('error', error);
  }

  /**
   * Handle server close
   * @private
   */
  _handleServerClose() {
    this._log('info', 'Server closed');
    this.isRunning = false;
    this.emit('closed');
  }

  /**
   * Start heartbeat interval
   * @private
   */
  _startHeartbeat() {
    // Skip heartbeat if disabled (useful for testing)
    if (!this.config.enableHeartbeat) {
      return;
    }

    this.pingIntervalId = setInterval(() => {
      for (const [ws, state] of this.clients) {
        if (!state.isAlive) {
          this._log('debug', `Terminating inactive client: ${state.id}`);
          ws.terminate();
          this.clients.delete(ws);
          continue;
        }

        state.isAlive = false;
        ws.ping();
      }
    }, this.config.pingInterval);

    this._log('debug', `Heartbeat started (interval: ${this.config.pingInterval}ms)`);
  }

  /**
   * Stop heartbeat interval
   * @private
   */
  _stopHeartbeat() {
    if (this.pingIntervalId) {
      clearInterval(this.pingIntervalId);
      this.pingIntervalId = null;
      this._log('debug', 'Heartbeat stopped');
    }
  }

  /**
   * Check if client is subscribed to session
   * @private
   * @param {Object} state - Client state
   * @param {string} sessionId - Session identifier
   * @returns {boolean} True if subscribed
   */
  _isSubscribed(state, sessionId) {
    // Subscribed to all sessions
    if (state.subscriptions.includes('*')) {
      return true;
    }

    // Subscribed to specific session
    if (sessionId && state.subscriptions.includes(sessionId)) {
      return true;
    }

    return false;
  }

  /**
   * Send message to client
   * @private
   * @param {WebSocket} ws - WebSocket client
   * @param {Object} message - Message object
   */
  _send(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(message));
      } catch (error) {
        this._log('error', `Error sending message: ${error.message}`);
      }
    }
  }


  /**
   * Register a custom message handler for a message type
   * @param {string} messageType - The message type to handle
   * @param {function} handler - Function(ws, state, message) to handle messages
   */
  registerHandler(messageType, handler) {
    this.messageHandlers.set(messageType, handler);
    this._log('debug', `Registered handler for message type: ${messageType}`);
  }

  /**
   * Public method to send a message to a client (for use by handlers)
   * @param {WebSocket} ws - The WebSocket client
   * @param {object} message - The message to send
   */
  send(ws, message) {
    this._send(ws, message);
  }

  /**
   * Generate unique client ID
   * @private
   * @returns {string} Client ID
   */
  _generateClientId() {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Internal logging method
   * @private
   * @param {string} level - Log level (info, warning, error, debug)
   * @param {string} message - Log message
   */
  _log(level, message) {
    try {
      const logMessage = `[WebSocketServer] ${message}`;

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
      // Fail silently to avoid breaking server flow
    }
  }
}

// Export the WebSocketServer class
module.exports = WebSocketServer;
