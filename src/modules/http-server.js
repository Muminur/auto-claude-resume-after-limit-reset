/**
 * HTTP Static File Server Module
 *
 * Serves the dashboard GUI files for Claude Code Auto-Resume.
 * Provides static file serving with proper MIME types and security.
 *
 * Features:
 * - Serve static files from configurable directory
 * - Proper MIME type detection
 * - Security: directory traversal prevention
 * - Default document (index.html)
 * - Query string handling
 *
 * @module HttpServer
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

/**
 * HttpServer class
 * Serves static files for the dashboard GUI
 */
class HttpServer extends EventEmitter {
  /**
   * Create an HttpServer instance
   * @param {Object} config - Server configuration
   * @param {number} [config.port=3737] - HTTP server port
   * @param {string} [config.staticDir] - Directory to serve static files from
   * @param {Object} [config.logger] - Logger object with log methods
   */
  constructor(config = {}) {
    super();

    this.config = {
      port: config.port || 3737,
      staticDir: config.staticDir || path.join(__dirname, '../../gui'),
      ...config
    };

    this.server = null;
    this.isRunning = false;
    this.logger = config.logger || console;

    // MIME types for common file extensions
    this.mimeTypes = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.json': 'application/json',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.ico': 'image/x-icon',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.ttf': 'font/ttf',
      '.eot': 'application/vnd.ms-fontobject'
    };
  }

  /**
   * Start the HTTP server
   * @returns {Promise<void>}
   * @throws {Error} If server fails to start or already running
   */
  async start() {
    if (this.isRunning) {
      throw new Error('Server is already running');
    }

    try {
      this._log('info', `Starting HTTP server on port ${this.config.port}`);

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

        this.server.on('error', reject);
      });

      this.isRunning = true;
      this._log('info', `HTTP server started on http://localhost:${this.config.port}`);
      this.emit('started', { port: this.config.port });
    } catch (error) {
      this._log('error', `Failed to start HTTP server: ${error.message}`);
      throw error;
    }
  }

  /**
   * Stop the HTTP server
   * @returns {Promise<void>}
   */
  async stop() {
    if (!this.isRunning) {
      return;
    }

    try {
      this._log('info', 'Stopping HTTP server');

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

      this._log('info', 'HTTP server stopped');
      this.emit('stopped');
    } catch (error) {
      this._log('error', `Error stopping HTTP server: ${error.message}`);
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
      port: this.config.port
    };
  }

  /**
   * Handle incoming HTTP request
   * @private
   * @param {http.IncomingMessage} req - HTTP request
   * @param {http.ServerResponse} res - HTTP response
   */
  _handleRequest(req, res) {
    try {
      // Security: Check raw URL for directory traversal BEFORE parsing
      // (URL constructor normalizes paths, so /../../../etc/passwd becomes /etc/passwd)
      if (this._isDirectoryTraversal(req.url)) {
        this._sendError(res, 403, 'Forbidden');
        return;
      }

      // Parse URL and extract pathname (ignore query string)
      const url = new URL(req.url, `http://${req.headers.host}`);
      let pathname = decodeURIComponent(url.pathname);

      // Default to index.html for root
      if (pathname === '/') {
        pathname = '/index.html';
      }

      // Construct file path
      const filePath = path.join(this.config.staticDir, pathname);

      // Security: Ensure file is within static directory
      const normalizedPath = path.normalize(filePath);
      const normalizedStaticDir = path.normalize(this.config.staticDir);
      if (!normalizedPath.startsWith(normalizedStaticDir)) {
        this._sendError(res, 403, 'Forbidden');
        return;
      }

      // Check if file exists
      if (!fs.existsSync(filePath)) {
        this._sendError(res, 404, 'Not Found');
        return;
      }

      // Read and serve file
      const content = fs.readFileSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const mimeType = this.mimeTypes[ext] || 'application/octet-stream';

      res.writeHead(200, { 'Content-Type': mimeType });
      res.end(content);

      this._log('debug', `${req.method} ${pathname} - 200`);
    } catch (error) {
      this._log('error', `Error handling request: ${error.message}`);
      this._sendError(res, 500, 'Internal Server Error');
    }
  }

  /**
   * Check for directory traversal attack patterns
   * @private
   * @param {string} pathname - URL pathname
   * @returns {boolean} True if traversal detected
   */
  _isDirectoryTraversal(pathname) {
    // Check for .. patterns (both encoded and plain)
    const decoded = decodeURIComponent(pathname);
    if (decoded.includes('..')) {
      return true;
    }

    // Check for double-encoded patterns
    if (pathname.includes('%2e%2e') || pathname.includes('%2E%2E')) {
      return true;
    }

    return false;
  }

  /**
   * Send error response
   * @private
   * @param {http.ServerResponse} res - HTTP response
   * @param {number} statusCode - HTTP status code
   * @param {string} message - Error message
   */
  _sendError(res, statusCode, message) {
    res.writeHead(statusCode, { 'Content-Type': 'text/plain' });
    res.end(message);
  }

  /**
   * Internal logging method
   * @private
   * @param {string} level - Log level
   * @param {string} message - Log message
   */
  _log(level, message) {
    try {
      const logMessage = `[HttpServer] ${message}`;

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

module.exports = HttpServer;
