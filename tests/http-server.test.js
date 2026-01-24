/**
 * Tests for HttpServer
 *
 * Covers:
 * - Constructor initialization with config
 * - start() - starts server on configured port
 * - stop() - stops server gracefully
 * - File serving - index.html, css, js files
 * - 404 handling for non-existent files
 * - Content-Type headers
 * - Security - directory traversal prevention
 */

const path = require('path');
const { EventEmitter } = require('events');

// Mock the http module
let mockServer;
let requestHandler;

jest.mock('http', () => {
  const { EventEmitter } = require('events');

  class MockServer extends EventEmitter {
    listen(port, callback) {
      this.port = port;
      this.listening = true;
      process.nextTick(() => {
        if (callback) callback();
      });
    }

    close(callback) {
      this.listening = false;
      process.nextTick(() => {
        this.emit('close');
        if (callback) callback();
      });
    }
  }

  return {
    createServer: jest.fn((handler) => {
      requestHandler = handler;
      mockServer = new MockServer();
      return mockServer;
    })
  };
});

// Mock the fs module
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  statSync: jest.fn()
}));

// Helper to simulate HTTP request/response
function createMockRequest(options = {}) {
  const req = new EventEmitter();
  req.method = options.method || 'GET';
  req.url = options.url || '/';
  req.headers = {
    host: 'localhost:3737',
    ...options.headers
  };
  req.socket = {
    remoteAddress: options.ip || '127.0.0.1'
  };
  return req;
}

function createMockResponse() {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.headers = {};
  res.body = '';

  res.writeHead = jest.fn((statusCode, headers) => {
    res.statusCode = statusCode;
    if (headers) {
      Object.assign(res.headers, headers);
    }
  });

  res.setHeader = jest.fn((name, value) => {
    res.headers[name] = value;
  });

  res.end = jest.fn((data) => {
    if (data) {
      res.body = data;
    }
    process.nextTick(() => res.emit('finish'));
  });

  return res;
}

describe('HttpServer', () => {
  let HttpServer;
  let server;
  let mockLogger;
  let fs;
  let http;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    // Re-require mocked modules after resetModules
    fs = require('fs');
    http = require('http');

    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    // Reset mocks
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('<html>test</html>');
    fs.statSync.mockReturnValue({ isFile: () => true, isDirectory: () => false });

    // Re-require after mocks are set up
    HttpServer = require('../src/modules/http-server');
  });

  describe('constructor()', () => {
    it('should initialize with default port 3737', () => {
      server = new HttpServer();
      expect(server.config.port).toBe(3737);
    });

    it('should accept custom port via config', () => {
      server = new HttpServer({ port: 8080 });
      expect(server.config.port).toBe(8080);
    });

    it('should accept staticDir parameter', () => {
      const customDir = '/custom/path';
      server = new HttpServer({ staticDir: customDir });
      expect(server.config.staticDir).toBe(customDir);
    });

    it('should accept logger parameter', () => {
      server = new HttpServer({ logger: mockLogger });
      expect(server.logger).toBe(mockLogger);
    });
  });

  describe('start()', () => {
    beforeEach(() => {
      server = new HttpServer({ logger: mockLogger });
    });

    it('should create HTTP server on configured port', async () => {
      await server.start();
      expect(http.createServer).toHaveBeenCalled();
      expect(mockServer.port).toBe(3737);
    });

    it('should emit "started" event with port', async () => {
      const startedHandler = jest.fn();
      server.on('started', startedHandler);

      await server.start();

      expect(startedHandler).toHaveBeenCalledWith({ port: 3737 });
    });

    it('should set isRunning to true', async () => {
      expect(server.isRunning).toBe(false);
      await server.start();
      expect(server.isRunning).toBe(true);
    });

    it('should reject if already running', async () => {
      await server.start();
      await expect(server.start()).rejects.toThrow('Server is already running');
    });
  });

  describe('stop()', () => {
    beforeEach(async () => {
      server = new HttpServer({ logger: mockLogger });
      await server.start();
    });

    it('should close server gracefully', async () => {
      await server.stop();
      expect(mockServer.listening).toBe(false);
    });

    it('should emit "stopped" event', async () => {
      const stoppedHandler = jest.fn();
      server.on('stopped', stoppedHandler);

      await server.stop();

      expect(stoppedHandler).toHaveBeenCalled();
    });

    it('should set isRunning to false', async () => {
      expect(server.isRunning).toBe(true);
      await server.stop();
      expect(server.isRunning).toBe(false);
    });

    it('should be idempotent (safe to call twice)', async () => {
      await server.stop();
      await expect(server.stop()).resolves.not.toThrow();
    });
  });

  describe('getStatus()', () => {
    beforeEach(() => {
      server = new HttpServer({ logger: mockLogger });
    });

    it('should return { running: false } when stopped', () => {
      const status = server.getStatus();
      expect(status.running).toBe(false);
    });

    it('should return { running: true, port } when started', async () => {
      await server.start();
      const status = server.getStatus();
      expect(status.running).toBe(true);
      expect(status.port).toBe(3737);
    });
  });

  describe('request handling', () => {
    beforeEach(async () => {
      server = new HttpServer({ logger: mockLogger });
      await server.start();
    });

    it('should serve index.html at root path /', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('<html>Dashboard</html>');

      const req = createMockRequest({ url: '/' });
      const res = createMockResponse();

      requestHandler(req, res);

      await new Promise(resolve => res.on('finish', resolve));

      expect(res.statusCode).toBe(200);
      expect(res.headers['Content-Type']).toBe('text/html');
      expect(res.body).toBe('<html>Dashboard</html>');
    });

    it('should serve app.js with correct Content-Type', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('console.log("test");');

      const req = createMockRequest({ url: '/app.js' });
      const res = createMockResponse();

      requestHandler(req, res);

      await new Promise(resolve => res.on('finish', resolve));

      expect(res.statusCode).toBe(200);
      expect(res.headers['Content-Type']).toBe('application/javascript');
    });

    it('should serve styles.css with correct Content-Type', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('body { color: red; }');

      const req = createMockRequest({ url: '/styles.css' });
      const res = createMockResponse();

      requestHandler(req, res);

      await new Promise(resolve => res.on('finish', resolve));

      expect(res.statusCode).toBe(200);
      expect(res.headers['Content-Type']).toBe('text/css');
    });

    it('should return 404 for non-existent files', async () => {
      fs.existsSync.mockReturnValue(false);

      const req = createMockRequest({ url: '/nonexistent.html' });
      const res = createMockResponse();

      requestHandler(req, res);

      await new Promise(resolve => res.on('finish', resolve));

      expect(res.statusCode).toBe(404);
    });

    it('should prevent directory traversal attacks', async () => {
      const req = createMockRequest({ url: '/../../../etc/passwd' });
      const res = createMockResponse();

      requestHandler(req, res);

      await new Promise(resolve => res.on('finish', resolve));

      expect(res.statusCode).toBe(403);
    });

    it('should prevent encoded directory traversal', async () => {
      const req = createMockRequest({ url: '/%2e%2e/%2e%2e/etc/passwd' });
      const res = createMockResponse();

      requestHandler(req, res);

      await new Promise(resolve => res.on('finish', resolve));

      expect(res.statusCode).toBe(403);
    });

    it('should handle query strings correctly', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('<html>test</html>');

      const req = createMockRequest({ url: '/index.html?wsPort=3847' });
      const res = createMockResponse();

      requestHandler(req, res);

      await new Promise(resolve => res.on('finish', resolve));

      expect(res.statusCode).toBe(200);
    });
  });

  describe('MIME types', () => {
    beforeEach(async () => {
      server = new HttpServer({ logger: mockLogger });
      await server.start();
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('content');
    });

    const mimeTypes = [
      { ext: '.html', mime: 'text/html' },
      { ext: '.css', mime: 'text/css' },
      { ext: '.js', mime: 'application/javascript' },
      { ext: '.json', mime: 'application/json' },
      { ext: '.svg', mime: 'image/svg+xml' },
      { ext: '.png', mime: 'image/png' },
      { ext: '.ico', mime: 'image/x-icon' }
    ];

    mimeTypes.forEach(({ ext, mime }) => {
      it(`should return ${mime} for ${ext} files`, async () => {
        const req = createMockRequest({ url: `/file${ext}` });
        const res = createMockResponse();

        requestHandler(req, res);

        await new Promise(resolve => res.on('finish', resolve));

        expect(res.headers['Content-Type']).toBe(mime);
      });
    });
  });
});
