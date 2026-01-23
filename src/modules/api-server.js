/**
 * REST API Server Module
 *
 * HTTP REST API server for Claude Code Auto-Resume.
 * Provides endpoints for status monitoring, configuration, session management,
 * and analytics data access.
 *
 * Features:
 * - RESTful API using Node.js built-in http module
 * - CORS support for browser access
 * - Simple rate limiting (100 req/min per IP)
 * - Optional API key authentication
 * - JSON request/response handling
 * - Comprehensive error handling and logging
 *
 * Endpoints:
 * - GET /api/health - Health check
 * - GET /api/status - All sessions status
 * - GET /api/status/:session - Single session status
 * - GET /api/config - Current configuration (sanitized)
 * - POST /api/resume/:session - Force resume a session
 * - GET /api/analytics - Analytics data
 *
 * @module ApiServer
 */

const http = require('http');
const { URL } = require('url');
const { EventEmitter } = require('events');

/**
 * ApiServer class
 * Manages HTTP REST API server for monitoring and control
 */
class ApiServer extends EventEmitter {
  /**
   * Create an ApiServer instance
   * @param {Object} config - Server configuration
   * @param {number} [config.port=3848] - API server port
   * @param {string} [config.apiKey] - Optional API key for authentication
   * @param {number} [config.rateLimit=100] - Max requests per minute per IP
   * @param {boolean} [config.cors=true] - Enable CORS
   * @param {Object} [config.logger] - Logger object with log methods
   * @param {Object} dependencies - Service dependencies
   * @param {Object} dependencies.statusWatcher - StatusWatcher instance
   * @param {Object} dependencies.configManager - Configuration manager
   * @param {Object} [dependencies.analyticsManager] - Optional analytics manager
   * @param {Function} [dependencies.resumeHandler] - Optional resume handler function
   */
  constructor(config = {}, dependencies = {}) {
    super();

    this.config = {
      port: config.port || 3848,
      apiKey: config.apiKey || null,
      rateLimit: config.rateLimit || 100,
      cors: config.cors !== undefined ? config.cors : true,
      ...config
    };

    // Dependencies
    this.statusWatcher = dependencies.statusWatcher;
    this.configManager = dependencies.configManager;
    this.analyticsManager = dependencies.analyticsManager || null;
    this.resumeHandler = dependencies.resumeHandler || null;

    // Server state
    this.server = null;
    this.isRunning = false;
    this.logger = config.logger || console;

    // Rate limiting state
    this.rateLimitMap = new Map(); // IP -> { count, resetTime }
    this.rateLimitInterval = null;

    // Request statistics
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      startTime: null
    };
  }

  /**
   * Start the API server
   * @returns {Promise<void>}
   * @throws {Error} If server fails to start
   */
  async start() {
    if (this.isRunning) {
      this._log('warning', 'API server already running');
      return;
    }

    try {
      this._log('info', `Starting API server on port ${this.config.port}`);

      // Validate dependencies
      if (!this.statusWatcher) {
        throw new Error('StatusWatcher dependency is required');
      }
      if (!this.configManager) {
        throw new Error('ConfigManager dependency is required');
      }

      // Create HTTP server
      this.server = http.createServer((req, res) => {
        this._handleRequest(req, res);
      });

      // Start server
      await new Promise((resolve, reject) => {
        this.server.listen(this.config.port, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Start rate limit cleanup interval
      this._startRateLimitCleanup();

      this.isRunning = true;
      this.stats.startTime = new Date();

      this._log('info', `API server started on http://localhost:${this.config.port}`);
      this.emit('started', { port: this.config.port });
    } catch (error) {
      this._log('error', `Failed to start API server: ${error.message}`);
      throw error;
    }
  }

  /**
   * Stop the API server
   * @returns {Promise<void>}
   */
  async stop() {
    if (!this.isRunning) {
      this._log('warning', 'API server not running');
      return;
    }

    try {
      this._log('info', 'Stopping API server');

      // Stop rate limit cleanup
      this._stopRateLimitCleanup();

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
      this.rateLimitMap.clear();

      this._log('info', 'API server stopped');
      this.emit('stopped');
    } catch (error) {
      this._log('error', `Error stopping API server: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get server status
   * @returns {Object} Status object
   */
  getStatus() {
    return {
      running: this.isRunning,
      port: this.config.port,
      uptime: this.isRunning && this.stats.startTime
        ? Date.now() - this.stats.startTime.getTime()
        : 0,
      stats: {
        totalRequests: this.stats.totalRequests,
        successfulRequests: this.stats.successfulRequests,
        failedRequests: this.stats.failedRequests
      }
    };
  }

  /**
   * Handle incoming HTTP request
   * @private
   * @param {http.IncomingMessage} req - HTTP request
   * @param {http.ServerResponse} res - HTTP response
   */
  async _handleRequest(req, res) {
    this.stats.totalRequests++;

    try {
      // Parse URL
      const url = new URL(req.url, `http://${req.headers.host}`);
      const pathname = url.pathname;
      const method = req.method;

      // Handle CORS
      if (this.config.cors) {
        this._setCorsHeaders(res);
        if (method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }
      }

      // Get client IP
      const clientIp = this._getClientIp(req);

      // Check rate limit
      if (!this._checkRateLimit(clientIp)) {
        this._sendError(res, 429, 'Rate limit exceeded');
        this.stats.failedRequests++;
        return;
      }

      // Check API key authentication
      if (this.config.apiKey && !this._authenticate(req)) {
        this._sendError(res, 401, 'Unauthorized');
        this.stats.failedRequests++;
        return;
      }

      // Route request
      const handled = await this._routeRequest(method, pathname, url, req, res);

      if (!handled) {
        this._sendError(res, 404, 'Not Found');
        this.stats.failedRequests++;
      } else {
        this.stats.successfulRequests++;
      }

      this._log('debug', `${method} ${pathname} - ${res.statusCode}`);
    } catch (error) {
      this._log('error', `Error handling request: ${error.message}`);
      this._sendError(res, 500, 'Internal Server Error');
      this.stats.failedRequests++;
    }
  }

  /**
   * Route request to appropriate handler
   * @private
   * @param {string} method - HTTP method
   * @param {string} pathname - URL pathname
   * @param {URL} url - Parsed URL object
   * @param {http.IncomingMessage} req - HTTP request
   * @param {http.ServerResponse} res - HTTP response
   * @returns {Promise<boolean>} True if handled
   */
  async _routeRequest(method, pathname, url, req, res) {
    // Health check
    if (method === 'GET' && pathname === '/api/health') {
      return this._handleHealth(req, res);
    }

    // All sessions status
    if (method === 'GET' && pathname === '/api/status') {
      return this._handleStatusAll(req, res);
    }

    // Single session status
    const statusMatch = pathname.match(/^\/api\/status\/([^/]+)$/);
    if (method === 'GET' && statusMatch) {
      return this._handleStatusSingle(statusMatch[1], req, res);
    }

    // Configuration
    if (method === 'GET' && pathname === '/api/config') {
      return this._handleConfig(req, res);
    }

    // Resume session
    const resumeMatch = pathname.match(/^\/api\/resume\/([^/]+)$/);
    if (method === 'POST' && resumeMatch) {
      return this._handleResume(resumeMatch[1], req, res);
    }

    // Analytics
    if (method === 'GET' && pathname === '/api/analytics') {
      return this._handleAnalytics(req, res);
    }

    return false;
  }

  /**
   * Handle health check endpoint
   * @private
   */
  _handleHealth(req, res) {
    const uptime = this.stats.startTime
      ? Math.floor((Date.now() - this.stats.startTime.getTime()) / 1000)
      : 0;

    this._sendJson(res, 200, {
      status: 'ok',
      uptime: uptime,
      timestamp: new Date().toISOString()
    });

    return true;
  }

  /**
   * Handle all sessions status endpoint
   * @private
   */
  _handleStatusAll(req, res) {
    try {
      const statuses = this.statusWatcher.getAllStatuses();

      this._sendJson(res, 200, {
        sessions: statuses,
        count: Object.keys(statuses).length,
        timestamp: new Date().toISOString()
      });

      return true;
    } catch (error) {
      this._log('error', `Error getting all statuses: ${error.message}`);
      this._sendError(res, 500, 'Failed to retrieve statuses');
      return true;
    }
  }

  /**
   * Handle single session status endpoint
   * @private
   */
  _handleStatusSingle(sessionId, req, res) {
    try {
      const status = this.statusWatcher.getStatus(sessionId);

      if (!status) {
        this._sendError(res, 404, 'Session not found');
        return true;
      }

      this._sendJson(res, 200, {
        session: sessionId,
        status: status,
        timestamp: new Date().toISOString()
      });

      return true;
    } catch (error) {
      this._log('error', `Error getting status for ${sessionId}: ${error.message}`);
      this._sendError(res, 500, 'Failed to retrieve status');
      return true;
    }
  }

  /**
   * Handle configuration endpoint
   * @private
   */
  _handleConfig(req, res) {
    try {
      const config = this.configManager.getConfig();

      // Sanitize config (remove sensitive data)
      const sanitized = this._sanitizeConfig(config);

      this._sendJson(res, 200, {
        config: sanitized,
        timestamp: new Date().toISOString()
      });

      return true;
    } catch (error) {
      this._log('error', `Error getting config: ${error.message}`);
      this._sendError(res, 500, 'Failed to retrieve configuration');
      return true;
    }
  }

  /**
   * Handle resume session endpoint
   * @private
   */
  async _handleResume(sessionId, req, res) {
    try {
      if (!this.resumeHandler) {
        this._sendError(res, 501, 'Resume functionality not implemented');
        return true;
      }

      // Check if session exists
      const status = this.statusWatcher.getStatus(sessionId);
      if (!status) {
        this._sendError(res, 404, 'Session not found');
        return true;
      }

      // Call resume handler
      await this.resumeHandler(sessionId);

      this._sendJson(res, 200, {
        session: sessionId,
        message: 'Resume triggered successfully',
        timestamp: new Date().toISOString()
      });

      this.emit('resume_triggered', { sessionId });
      return true;
    } catch (error) {
      this._log('error', `Error resuming session ${sessionId}: ${error.message}`);
      this._sendError(res, 500, 'Failed to resume session');
      return true;
    }
  }

  /**
   * Handle analytics endpoint
   * @private
   */
  _handleAnalytics(req, res) {
    try {
      if (!this.analyticsManager) {
        this._sendError(res, 501, 'Analytics not enabled');
        return true;
      }

      const analytics = this.analyticsManager.getAnalytics();

      this._sendJson(res, 200, {
        analytics: analytics,
        timestamp: new Date().toISOString()
      });

      return true;
    } catch (error) {
      this._log('error', `Error getting analytics: ${error.message}`);
      this._sendError(res, 500, 'Failed to retrieve analytics');
      return true;
    }
  }

  /**
   * Set CORS headers
   * @private
   */
  _setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
    res.setHeader('Access-Control-Max-Age', '86400');
  }

  /**
   * Get client IP address
   * @private
   */
  _getClientIp(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]
      || req.headers['x-real-ip']
      || req.socket.remoteAddress
      || 'unknown';
  }

  /**
   * Check rate limit for IP
   * @private
   * @returns {boolean} True if under limit
   */
  _checkRateLimit(ip) {
    const now = Date.now();
    const windowMs = 60000; // 1 minute

    if (!this.rateLimitMap.has(ip)) {
      this.rateLimitMap.set(ip, {
        count: 1,
        resetTime: now + windowMs
      });
      return true;
    }

    const record = this.rateLimitMap.get(ip);

    // Reset if window expired
    if (now >= record.resetTime) {
      record.count = 1;
      record.resetTime = now + windowMs;
      return true;
    }

    // Check limit
    if (record.count >= this.config.rateLimit) {
      return false;
    }

    record.count++;
    return true;
  }

  /**
   * Start rate limit cleanup interval
   * @private
   */
  _startRateLimitCleanup() {
    this.rateLimitInterval = setInterval(() => {
      const now = Date.now();
      for (const [ip, record] of this.rateLimitMap.entries()) {
        if (now >= record.resetTime) {
          this.rateLimitMap.delete(ip);
        }
      }
    }, 60000); // Cleanup every minute
  }

  /**
   * Stop rate limit cleanup interval
   * @private
   */
  _stopRateLimitCleanup() {
    if (this.rateLimitInterval) {
      clearInterval(this.rateLimitInterval);
      this.rateLimitInterval = null;
    }
  }

  /**
   * Authenticate request
   * @private
   * @returns {boolean} True if authenticated
   */
  _authenticate(req) {
    if (!this.config.apiKey) {
      return true;
    }

    // Check Authorization header
    const authHeader = req.headers['authorization'];
    if (authHeader) {
      const match = authHeader.match(/^Bearer (.+)$/);
      if (match && match[1] === this.config.apiKey) {
        return true;
      }
    }

    // Check X-API-Key header
    const apiKeyHeader = req.headers['x-api-key'];
    if (apiKeyHeader === this.config.apiKey) {
      return true;
    }

    return false;
  }

  /**
   * Sanitize configuration for public exposure
   * @private
   */
  _sanitizeConfig(config) {
    const sanitized = { ...config };

    // Remove sensitive fields
    delete sanitized.apiKey;
    delete sanitized.webhookUrl;
    delete sanitized.notificationTokens;

    // Mask watch paths (show only count)
    if (sanitized.watchPaths && Array.isArray(sanitized.watchPaths)) {
      sanitized.watchPaths = {
        count: sanitized.watchPaths.length,
        paths: sanitized.watchPaths.map(() => '[REDACTED]')
      };
    }

    return sanitized;
  }

  /**
   * Send JSON response
   * @private
   */
  _sendJson(res, statusCode, data) {
    res.writeHead(statusCode, {
      'Content-Type': 'application/json'
    });
    res.end(JSON.stringify(data, null, 2));
  }

  /**
   * Send error response
   * @private
   */
  _sendError(res, statusCode, message) {
    this._sendJson(res, statusCode, {
      error: true,
      statusCode: statusCode,
      message: message,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Internal logging method
   * @private
   */
  _log(level, message) {
    try {
      const logMessage = `[ApiServer] ${message}`;

      if (this.logger && typeof this.logger.log === 'function') {
        this.logger.log(level, logMessage);
      } else if (this.logger && typeof this.logger[level] === 'function') {
        this.logger[level](logMessage);
      } else {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [${level.toUpperCase()}] ${logMessage}`);
      }
    } catch (err) {
      // Fail silently to avoid breaking server flow
    }
  }
}

// Export the ApiServer class
module.exports = ApiServer;
