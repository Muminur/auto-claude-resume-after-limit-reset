/**
 * Tests for ApiServer
 *
 * Covers:
 * - Constructor initialization with config and dependencies
 * - start() - starts server on configured port
 * - stop() - stops server gracefully
 * - GET /api/health - returns health status
 * - GET /api/status - returns all session statuses
 * - GET /api/status/:session - returns single session status
 * - GET /api/config - returns sanitized configuration
 * - POST /api/resume/:session - triggers session resume
 * - GET /api/analytics - returns analytics data
 * - CORS headers - present on responses
 * - Rate limiting - blocks after configured limit
 * - API key authentication - when configured
 * - Error responses - proper status codes
 */

const ApiServer = require('../src/modules/api-server');
const http = require('http');

// Mock the http module
let mockServer;
let requestHandler;
let mockSockets = [];

jest.mock('http', () => {
  const { EventEmitter } = require('events');

  class MockServer extends EventEmitter {
    listen(port, callback) {
      process.nextTick(() => {
        if (callback) callback();
      });
    }

    close(callback) {
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

// Helper to simulate HTTP request/response
function createMockRequest(options = {}) {
  const { EventEmitter } = require('events');

  const req = new EventEmitter();
  req.method = options.method || 'GET';
  req.url = options.url || '/';
  req.headers = {
    host: 'localhost:3848',
    ...options.headers
  };
  req.socket = {
    remoteAddress: options.ip || '127.0.0.1'
  };

  return req;
}

function createMockResponse() {
  const { EventEmitter } = require('events');

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
      res.body += data;
    }
    process.nextTick(() => res.emit('finish'));
  });

  return res;
}

describe('ApiServer', () => {
  let server;
  let mockStatusWatcher;
  let mockConfigManager;
  let mockAnalyticsManager;
  let mockResumeHandler;
  let mockLogger;

  beforeEach(() => {
    // Reset mocks
    mockSockets = [];
    mockServer = null;
    requestHandler = null;
    jest.clearAllMocks();

    // Create mock dependencies
    mockStatusWatcher = {
      getAllStatuses: jest.fn(() => ({
        'session1': { status: 'active', lastUpdate: Date.now() },
        'session2': { status: 'waiting', lastUpdate: Date.now() }
      })),
      getStatus: jest.fn((sessionId) => {
        if (sessionId === 'session1') {
          return { status: 'active', lastUpdate: Date.now() };
        }
        return null;
      })
    };

    mockConfigManager = {
      getConfig: jest.fn(() => ({
        checkInterval: 5000,
        apiKey: 'secret-key-123',
        webhookUrl: 'https://example.com/webhook',
        notificationTokens: ['token1', 'token2'],
        watchPaths: ['/path1', '/path2']
      }))
    };

    mockAnalyticsManager = {
      getAnalytics: jest.fn(() => ({
        totalResumes: 10,
        successRate: 0.95,
        averageResumeTime: 1500
      }))
    };

    mockResumeHandler = jest.fn(async (sessionId) => {
      // Simulate resume logic
      return { success: true, sessionId };
    });

    mockLogger = {
      log: jest.fn()
    };
  });

  describe('constructor()', () => {
    test('initializes with default config', () => {
      server = new ApiServer({}, {
        statusWatcher: mockStatusWatcher,
        configManager: mockConfigManager
      });

      expect(server.config.port).toBe(3848);
      expect(server.config.rateLimit).toBe(100);
      expect(server.config.cors).toBe(true);
      expect(server.config.apiKey).toBeNull();
    });

    test('initializes with custom config', () => {
      server = new ApiServer({
        port: 8080,
        apiKey: 'custom-key',
        rateLimit: 50,
        cors: false,
        logger: mockLogger
      }, {
        statusWatcher: mockStatusWatcher,
        configManager: mockConfigManager
      });

      expect(server.config.port).toBe(8080);
      expect(server.config.apiKey).toBe('custom-key');
      expect(server.config.rateLimit).toBe(50);
      expect(server.config.cors).toBe(false);
      expect(server.logger).toBe(mockLogger);
    });

    test('stores dependencies correctly', () => {
      server = new ApiServer({}, {
        statusWatcher: mockStatusWatcher,
        configManager: mockConfigManager,
        analyticsManager: mockAnalyticsManager,
        resumeHandler: mockResumeHandler
      });

      expect(server.statusWatcher).toBe(mockStatusWatcher);
      expect(server.configManager).toBe(mockConfigManager);
      expect(server.analyticsManager).toBe(mockAnalyticsManager);
      expect(server.resumeHandler).toBe(mockResumeHandler);
    });

    test('initializes server state', () => {
      server = new ApiServer({}, {
        statusWatcher: mockStatusWatcher,
        configManager: mockConfigManager
      });

      expect(server.server).toBeNull();
      expect(server.isRunning).toBe(false);
      expect(server.stats.totalRequests).toBe(0);
      expect(server.stats.successfulRequests).toBe(0);
      expect(server.stats.failedRequests).toBe(0);
      expect(server.stats.startTime).toBeNull();
    });
  });

  describe('start()', () => {
    test('starts server on configured port', async () => {
      server = new ApiServer({ port: 3848 }, {
        statusWatcher: mockStatusWatcher,
        configManager: mockConfigManager
      });

      await server.start();

      expect(http.createServer).toHaveBeenCalled();
      expect(mockServer).toBeDefined();
      expect(server.isRunning).toBe(true);
      expect(server.stats.startTime).toBeInstanceOf(Date);
    });

    test('does not start if already running', async () => {
      // Spy on console.log since the logger uses it as fallback
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      server = new ApiServer({}, {
        statusWatcher: mockStatusWatcher,
        configManager: mockConfigManager
      });

      await server.start();
      const firstServer = server.server;

      await server.start();

      expect(server.server).toBe(firstServer);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('warning'), expect.stringContaining('already running'));

      consoleSpy.mockRestore();
    });

    test('throws error if statusWatcher missing', async () => {
      server = new ApiServer({}, {
        configManager: mockConfigManager
      });

      await expect(server.start()).rejects.toThrow('StatusWatcher dependency is required');
    });

    test('throws error if configManager missing', async () => {
      server = new ApiServer({}, {
        statusWatcher: mockStatusWatcher
      });

      await expect(server.start()).rejects.toThrow('ConfigManager dependency is required');
    });

    test('emits started event', async () => {
      server = new ApiServer({ port: 3848 }, {
        statusWatcher: mockStatusWatcher,
        configManager: mockConfigManager
      });

      const startedPromise = new Promise(resolve => {
        server.on('started', resolve);
      });

      await server.start();
      const event = await startedPromise;

      expect(event.port).toBe(3848);
    });
  });

  describe('stop()', () => {
    test('stops server gracefully', async () => {
      server = new ApiServer({}, {
        statusWatcher: mockStatusWatcher,
        configManager: mockConfigManager
      });

      await server.start();
      expect(server.isRunning).toBe(true);

      await server.stop();

      expect(server.isRunning).toBe(false);
      expect(server.server).toBeNull();
      expect(server.rateLimitMap.size).toBe(0);
    });

    test('does not stop if not running', async () => {
      // Spy on console.log since the logger uses it as fallback
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      server = new ApiServer({}, {
        statusWatcher: mockStatusWatcher,
        configManager: mockConfigManager
      });

      await server.stop();

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('warning'), expect.stringContaining('not running'));

      consoleSpy.mockRestore();
    });

    test('emits stopped event', async () => {
      server = new ApiServer({}, {
        statusWatcher: mockStatusWatcher,
        configManager: mockConfigManager
      });

      await server.start();

      const stoppedPromise = new Promise(resolve => {
        server.on('stopped', resolve);
      });

      await server.stop();
      await stoppedPromise;

      expect(server.isRunning).toBe(false);
    });
  });

  describe('GET /api/health', () => {
    beforeEach(async () => {
      server = new ApiServer({}, {
        statusWatcher: mockStatusWatcher,
        configManager: mockConfigManager
      });
      await server.start();
    });

    afterEach(async () => {
      await server.stop();
    });

    test('returns health status', async () => {
      const req = createMockRequest({ url: '/api/health' });
      const res = createMockResponse();

      await requestHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.headers['Content-Type']).toBe('application/json');

      const body = JSON.parse(res.body);
      expect(body.status).toBe('ok');
      expect(body.uptime).toBeGreaterThanOrEqual(0);
      expect(body.timestamp).toBeDefined();
    });

    test('includes CORS headers when enabled', async () => {
      const req = createMockRequest({ url: '/api/health' });
      const res = createMockResponse();

      await requestHandler(req, res);

      expect(res.headers['Access-Control-Allow-Origin']).toBe('*');
      expect(res.headers['Access-Control-Allow-Methods']).toBeDefined();
      expect(res.headers['Access-Control-Allow-Headers']).toBeDefined();
    });
  });

  describe('GET /api/status', () => {
    beforeEach(async () => {
      server = new ApiServer({}, {
        statusWatcher: mockStatusWatcher,
        configManager: mockConfigManager
      });
      await server.start();
    });

    afterEach(async () => {
      await server.stop();
    });

    test('returns all session statuses', async () => {
      const req = createMockRequest({ url: '/api/status' });
      const res = createMockResponse();

      await requestHandler(req, res);

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      expect(body.sessions).toBeDefined();
      expect(body.sessions.session1).toBeDefined();
      expect(body.sessions.session2).toBeDefined();
      expect(body.count).toBe(2);
      expect(body.timestamp).toBeDefined();
    });

    test('calls statusWatcher.getAllStatuses()', async () => {
      const req = createMockRequest({ url: '/api/status' });
      const res = createMockResponse();

      await requestHandler(req, res);

      expect(mockStatusWatcher.getAllStatuses).toHaveBeenCalled();
    });
  });

  describe('GET /api/status/:session', () => {
    beforeEach(async () => {
      server = new ApiServer({}, {
        statusWatcher: mockStatusWatcher,
        configManager: mockConfigManager
      });
      await server.start();
    });

    afterEach(async () => {
      await server.stop();
    });

    test('returns single session status', async () => {
      const req = createMockRequest({ url: '/api/status/session1' });
      const res = createMockResponse();

      await requestHandler(req, res);

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      expect(body.session).toBe('session1');
      expect(body.status).toBeDefined();
      expect(body.status.status).toBe('active');
      expect(body.timestamp).toBeDefined();
    });

    test('returns 404 for non-existent session', async () => {
      const req = createMockRequest({ url: '/api/status/nonexistent' });
      const res = createMockResponse();

      await requestHandler(req, res);

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);

      expect(body.error).toBe(true);
      expect(body.message).toBe('Session not found');
    });
  });

  describe('GET /api/config', () => {
    beforeEach(async () => {
      server = new ApiServer({}, {
        statusWatcher: mockStatusWatcher,
        configManager: mockConfigManager
      });
      await server.start();
    });

    afterEach(async () => {
      await server.stop();
    });

    test('returns sanitized configuration', async () => {
      const req = createMockRequest({ url: '/api/config' });
      const res = createMockResponse();

      await requestHandler(req, res);

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      expect(body.config).toBeDefined();
      expect(body.config.checkInterval).toBe(5000);
      expect(body.timestamp).toBeDefined();
    });

    test('sanitizes sensitive fields', async () => {
      const req = createMockRequest({ url: '/api/config' });
      const res = createMockResponse();

      await requestHandler(req, res);

      const body = JSON.parse(res.body);

      // Sensitive fields should be removed
      expect(body.config.apiKey).toBeUndefined();
      expect(body.config.webhookUrl).toBeUndefined();
      expect(body.config.notificationTokens).toBeUndefined();
    });

    test('masks watch paths', async () => {
      const req = createMockRequest({ url: '/api/config' });
      const res = createMockResponse();

      await requestHandler(req, res);

      const body = JSON.parse(res.body);

      expect(body.config.watchPaths).toBeDefined();
      expect(body.config.watchPaths.count).toBe(2);
      expect(body.config.watchPaths.paths).toEqual(['[REDACTED]', '[REDACTED]']);
    });
  });

  describe('POST /api/resume/:session', () => {
    beforeEach(async () => {
      server = new ApiServer({}, {
        statusWatcher: mockStatusWatcher,
        configManager: mockConfigManager,
        resumeHandler: mockResumeHandler
      });
      await server.start();
    });

    afterEach(async () => {
      await server.stop();
    });

    test('triggers session resume', async () => {
      const req = createMockRequest({
        method: 'POST',
        url: '/api/resume/session1'
      });
      const res = createMockResponse();

      await requestHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(mockResumeHandler).toHaveBeenCalledWith('session1');

      const body = JSON.parse(res.body);
      expect(body.session).toBe('session1');
      expect(body.message).toBe('Resume triggered successfully');
    });

    test('emits resume_triggered event', async () => {
      const req = createMockRequest({
        method: 'POST',
        url: '/api/resume/session1'
      });
      const res = createMockResponse();

      const eventPromise = new Promise(resolve => {
        server.on('resume_triggered', resolve);
      });

      await requestHandler(req, res);
      const event = await eventPromise;

      expect(event.sessionId).toBe('session1');
    });

    test('returns 404 for non-existent session', async () => {
      const req = createMockRequest({
        method: 'POST',
        url: '/api/resume/nonexistent'
      });
      const res = createMockResponse();

      await requestHandler(req, res);

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.message).toBe('Session not found');
    });

    test('returns 501 if resumeHandler not configured', async () => {
      // Create server without resumeHandler
      await server.stop();
      server = new ApiServer({}, {
        statusWatcher: mockStatusWatcher,
        configManager: mockConfigManager
      });
      await server.start();

      const req = createMockRequest({
        method: 'POST',
        url: '/api/resume/session1'
      });
      const res = createMockResponse();

      await requestHandler(req, res);

      expect(res.statusCode).toBe(501);
      const body = JSON.parse(res.body);
      expect(body.message).toBe('Resume functionality not implemented');
    });
  });

  describe('GET /api/analytics', () => {
    beforeEach(async () => {
      server = new ApiServer({}, {
        statusWatcher: mockStatusWatcher,
        configManager: mockConfigManager,
        analyticsManager: mockAnalyticsManager
      });
      await server.start();
    });

    afterEach(async () => {
      await server.stop();
    });

    test('returns analytics data', async () => {
      const req = createMockRequest({ url: '/api/analytics' });
      const res = createMockResponse();

      await requestHandler(req, res);

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      expect(body.analytics).toBeDefined();
      expect(body.analytics.totalResumes).toBe(10);
      expect(body.analytics.successRate).toBe(0.95);
      expect(body.timestamp).toBeDefined();
    });

    test('returns 501 if analytics not enabled', async () => {
      // Create server without analyticsManager
      await server.stop();
      server = new ApiServer({}, {
        statusWatcher: mockStatusWatcher,
        configManager: mockConfigManager
      });
      await server.start();

      const req = createMockRequest({ url: '/api/analytics' });
      const res = createMockResponse();

      await requestHandler(req, res);

      expect(res.statusCode).toBe(501);
      const body = JSON.parse(res.body);
      expect(body.message).toBe('Analytics not enabled');
    });
  });

  describe('CORS headers', () => {
    test('sets CORS headers when enabled', async () => {
      server = new ApiServer({ cors: true }, {
        statusWatcher: mockStatusWatcher,
        configManager: mockConfigManager
      });
      await server.start();

      const req = createMockRequest({ url: '/api/health' });
      const res = createMockResponse();

      await requestHandler(req, res);

      expect(res.headers['Access-Control-Allow-Origin']).toBe('*');
      expect(res.headers['Access-Control-Allow-Methods']).toBe('GET, POST, OPTIONS');
      expect(res.headers['Access-Control-Allow-Headers']).toBe('Content-Type, Authorization, X-API-Key');
      expect(res.headers['Access-Control-Max-Age']).toBe('86400');

      await server.stop();
    });

    test('handles OPTIONS preflight requests', async () => {
      server = new ApiServer({ cors: true }, {
        statusWatcher: mockStatusWatcher,
        configManager: mockConfigManager
      });
      await server.start();

      const req = createMockRequest({
        method: 'OPTIONS',
        url: '/api/health'
      });
      const res = createMockResponse();

      await requestHandler(req, res);

      expect(res.statusCode).toBe(204);
      expect(res.headers['Access-Control-Allow-Origin']).toBe('*');

      await server.stop();
    });

    test('does not set CORS headers when disabled', async () => {
      server = new ApiServer({ cors: false }, {
        statusWatcher: mockStatusWatcher,
        configManager: mockConfigManager
      });
      await server.start();

      const req = createMockRequest({ url: '/api/health' });
      const res = createMockResponse();

      await requestHandler(req, res);

      expect(res.headers['Access-Control-Allow-Origin']).toBeUndefined();

      await server.stop();
    });
  });

  describe('Rate limiting', () => {
    beforeEach(async () => {
      server = new ApiServer({ rateLimit: 5 }, {
        statusWatcher: mockStatusWatcher,
        configManager: mockConfigManager
      });
      await server.start();
    });

    afterEach(async () => {
      await server.stop();
    });

    test('allows requests under limit', async () => {
      for (let i = 0; i < 5; i++) {
        const req = createMockRequest({
          url: '/api/health',
          ip: '192.168.1.1'
        });
        const res = createMockResponse();

        await requestHandler(req, res);
        expect(res.statusCode).toBe(200);
      }
    });

    test('blocks requests over limit', async () => {
      // Make 5 requests (at limit)
      for (let i = 0; i < 5; i++) {
        const req = createMockRequest({
          url: '/api/health',
          ip: '192.168.1.1'
        });
        const res = createMockResponse();
        await requestHandler(req, res);
      }

      // Next request should be blocked
      const req = createMockRequest({
        url: '/api/health',
        ip: '192.168.1.1'
      });
      const res = createMockResponse();

      await requestHandler(req, res);

      expect(res.statusCode).toBe(429);
      const body = JSON.parse(res.body);
      expect(body.message).toBe('Rate limit exceeded');
    });

    test('tracks different IPs separately', async () => {
      // IP 1: Make 5 requests
      for (let i = 0; i < 5; i++) {
        const req = createMockRequest({
          url: '/api/health',
          ip: '192.168.1.1'
        });
        const res = createMockResponse();
        await requestHandler(req, res);
      }

      // IP 2: Should still work
      const req = createMockRequest({
        url: '/api/health',
        ip: '192.168.1.2'
      });
      const res = createMockResponse();

      await requestHandler(req, res);
      expect(res.statusCode).toBe(200);
    });
  });

  describe('API key authentication', () => {
    beforeEach(async () => {
      server = new ApiServer({ apiKey: 'secret-key-123' }, {
        statusWatcher: mockStatusWatcher,
        configManager: mockConfigManager
      });
      await server.start();
    });

    afterEach(async () => {
      await server.stop();
    });

    test('accepts valid Bearer token', async () => {
      const req = createMockRequest({
        url: '/api/health',
        headers: {
          'authorization': 'Bearer secret-key-123'
        }
      });
      const res = createMockResponse();

      await requestHandler(req, res);

      expect(res.statusCode).toBe(200);
    });

    test('accepts valid X-API-Key header', async () => {
      const req = createMockRequest({
        url: '/api/health',
        headers: {
          'x-api-key': 'secret-key-123'
        }
      });
      const res = createMockResponse();

      await requestHandler(req, res);

      expect(res.statusCode).toBe(200);
    });

    test('rejects invalid API key', async () => {
      const req = createMockRequest({
        url: '/api/health',
        headers: {
          'authorization': 'Bearer wrong-key'
        }
      });
      const res = createMockResponse();

      await requestHandler(req, res);

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.message).toBe('Unauthorized');
    });

    test('rejects missing API key', async () => {
      const req = createMockRequest({ url: '/api/health' });
      const res = createMockResponse();

      await requestHandler(req, res);

      expect(res.statusCode).toBe(401);
    });
  });

  describe('Error responses', () => {
    beforeEach(async () => {
      server = new ApiServer({}, {
        statusWatcher: mockStatusWatcher,
        configManager: mockConfigManager
      });
      await server.start();
    });

    afterEach(async () => {
      await server.stop();
    });

    test('returns 404 for unknown routes', async () => {
      const req = createMockRequest({ url: '/api/unknown' });
      const res = createMockResponse();

      await requestHandler(req, res);

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.error).toBe(true);
      expect(body.message).toBe('Not Found');
      expect(body.statusCode).toBe(404);
      expect(body.timestamp).toBeDefined();
    });

    test('returns 500 on internal errors', async () => {
      // Make statusWatcher throw error
      mockStatusWatcher.getAllStatuses.mockImplementation(() => {
        throw new Error('Database error');
      });

      const req = createMockRequest({ url: '/api/status' });
      const res = createMockResponse();

      await requestHandler(req, res);

      expect(res.statusCode).toBe(500);
      const body = JSON.parse(res.body);
      expect(body.error).toBe(true);
      expect(body.message).toBe('Failed to retrieve statuses');
    });

    test('increments failed request counter', async () => {
      const req = createMockRequest({ url: '/api/unknown' });
      const res = createMockResponse();

      const initialFailed = server.stats.failedRequests;
      await requestHandler(req, res);

      expect(server.stats.failedRequests).toBe(initialFailed + 1);
    });

    test('increments successful request counter', async () => {
      const req = createMockRequest({ url: '/api/health' });
      const res = createMockResponse();

      const initialSuccess = server.stats.successfulRequests;
      await requestHandler(req, res);

      expect(server.stats.successfulRequests).toBe(initialSuccess + 1);
    });
  });

  describe('getStatus()', () => {
    test('returns server status', async () => {
      server = new ApiServer({ port: 3848 }, {
        statusWatcher: mockStatusWatcher,
        configManager: mockConfigManager
      });

      await server.start();

      const status = server.getStatus();

      expect(status.running).toBe(true);
      expect(status.port).toBe(3848);
      expect(status.uptime).toBeGreaterThanOrEqual(0);
      expect(status.stats.totalRequests).toBe(0);
      expect(status.stats.successfulRequests).toBe(0);
      expect(status.stats.failedRequests).toBe(0);

      await server.stop();
    });

    test('returns stopped status', () => {
      server = new ApiServer({}, {
        statusWatcher: mockStatusWatcher,
        configManager: mockConfigManager
      });

      const status = server.getStatus();

      expect(status.running).toBe(false);
      expect(status.uptime).toBe(0);
    });
  });
});
