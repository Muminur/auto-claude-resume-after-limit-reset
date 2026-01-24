/**
 * Tests for Dashboard Integration
 *
 * Covers:
 * - Server coordination (HTTP, WebSocket, API together)
 * - Status broadcasting to connected clients
 * - openGui() behavior
 * - Graceful startup and shutdown
 */

const { EventEmitter } = require('events');

// Mock child_process for browser opening
jest.mock('child_process', () => ({
  exec: jest.fn((cmd, callback) => {
    if (callback) callback(null, '', '');
  }),
  execSync: jest.fn()
}));

// Mock the server modules
let mockHttpServer;
let mockWsServer;
let mockApiServer;
let mockHttpServerShouldFail = false;
let mockHttpServerError = null;
let mockWsServerShouldFail = false;
let mockWsServerError = null;

jest.mock('../src/modules/http-server', () => {
  return jest.fn().mockImplementation((config) => {
    mockHttpServer = new (require('events').EventEmitter)();
    mockHttpServer.config = config || { port: 3737 };
    mockHttpServer.isRunning = false;
    mockHttpServer.start = jest.fn().mockImplementation(() => {
      if (mockHttpServerShouldFail) {
        return Promise.reject(mockHttpServerError);
      }
      mockHttpServer.isRunning = true;
      mockHttpServer.emit('started', { port: mockHttpServer.config.port });
      return Promise.resolve();
    });
    mockHttpServer.stop = jest.fn().mockImplementation(() => {
      mockHttpServer.isRunning = false;
      mockHttpServer.emit('stopped');
      return Promise.resolve();
    });
    mockHttpServer.getStatus = jest.fn().mockReturnValue({
      running: mockHttpServer.isRunning,
      port: mockHttpServer.config.port
    });
    return mockHttpServer;
  });
});

jest.mock('../src/modules/websocket-server', () => {
  return jest.fn().mockImplementation((config) => {
    mockWsServer = new (require('events').EventEmitter)();
    mockWsServer.config = config || { port: 3847 };
    mockWsServer.isRunning = false;
    mockWsServer.messageHandlers = new Map();
    mockWsServer.start = jest.fn().mockImplementation(() => {
      if (mockWsServerShouldFail) {
        return Promise.reject(mockWsServerError);
      }
      mockWsServer.isRunning = true;
      return Promise.resolve();
    });
    mockWsServer.stop = jest.fn().mockImplementation(() => {
      mockWsServer.isRunning = false;
      return Promise.resolve();
    });
    mockWsServer.broadcast = jest.fn();
    mockWsServer.broadcastStatus = jest.fn();
    mockWsServer.broadcastEvent = jest.fn();
    mockWsServer.getClients = jest.fn().mockReturnValue(0);
    mockWsServer.getStatus = jest.fn().mockReturnValue({
      running: mockWsServer.isRunning,
      port: mockWsServer.config.port,
      clients: 0
    });
    mockWsServer.registerHandler = jest.fn((type, handler) => {
      mockWsServer.messageHandlers.set(type, handler);
    });
    mockWsServer.send = jest.fn();
    return mockWsServer;
  });
});

jest.mock('../src/modules/api-server', () => {
  return jest.fn().mockImplementation((config) => {
    mockApiServer = new (require('events').EventEmitter)();
    mockApiServer.config = config || { port: 3848 };
    mockApiServer.isRunning = false;
    mockApiServer.start = jest.fn().mockImplementation(() => {
      mockApiServer.isRunning = true;
      return Promise.resolve();
    });
    mockApiServer.stop = jest.fn().mockImplementation(() => {
      mockApiServer.isRunning = false;
      return Promise.resolve();
    });
    mockApiServer.getStatus = jest.fn().mockReturnValue({
      running: mockApiServer.isRunning,
      port: mockApiServer.config.port
    });
    return mockApiServer;
  });
});

jest.mock('../src/modules/status-bridge', () => {
  return jest.fn().mockImplementation((config) => {
    const bridge = new (require('events').EventEmitter)();
    bridge.getAllStatuses = jest.fn().mockReturnValue({});
    bridge.getStatus = jest.fn().mockReturnValue(null);
    bridge.notifyStatusChange = jest.fn();
    bridge.getAnalytics = jest.fn().mockReturnValue({});
    bridge.updateDaemonState = jest.fn();
    return bridge;
  });
});

describe('DashboardIntegration', () => {
  let DashboardIntegration;
  let dashboard;
  let mockLogger;
  let mockConfigManager;
  let childProcess;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    // Reset failure flags
    mockHttpServerShouldFail = false;
    mockHttpServerError = null;
    mockWsServerShouldFail = false;
    mockWsServerError = null;

    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    mockConfigManager = {
      get: jest.fn((key) => {
        const config = {
          'gui.enabled': true,
          'gui.port': 3737,
          'websocket.enabled': true,
          'websocket.port': 3847,
          'api.enabled': true,
          'api.port': 3848
        };
        return config[key];
      }),
      getConfig: jest.fn().mockReturnValue({
        gui: { enabled: true, port: 3737 },
        websocket: { enabled: true, port: 3847 },
        api: { enabled: true, port: 3848 }
      })
    };

    childProcess = require('child_process');

    DashboardIntegration = require('../src/modules/dashboard-integration');
  });

  describe('constructor()', () => {
    it('should initialize with config manager', () => {
      dashboard = new DashboardIntegration({
        configManager: mockConfigManager,
        logger: mockLogger
      });

      expect(dashboard.configManager).toBe(mockConfigManager);
    });

    it('should initialize with logger', () => {
      dashboard = new DashboardIntegration({
        configManager: mockConfigManager,
        logger: mockLogger
      });

      expect(dashboard.logger).toBe(mockLogger);
    });
  });

  describe('startServers()', () => {
    beforeEach(() => {
      dashboard = new DashboardIntegration({
        configManager: mockConfigManager,
        logger: mockLogger
      });
    });

    it('should start all servers when startServers() called', async () => {
      await dashboard.startServers();

      expect(mockHttpServer.start).toHaveBeenCalled();
      expect(mockWsServer.start).toHaveBeenCalled();
      expect(mockApiServer.start).toHaveBeenCalled();
    });

    it('should create StatusBridge and pass to ApiServer', async () => {
      await dashboard.startServers();

      expect(dashboard.statusBridge).toBeDefined();
    });

    it('should use ports from config manager', async () => {
      await dashboard.startServers();

      expect(mockHttpServer.config.port).toBe(3737);
    });

    it('should skip disabled servers', async () => {
      mockConfigManager.get.mockImplementation((key) => {
        if (key === 'websocket.enabled') return false;
        if (key === 'api.enabled') return false;
        return true;
      });

      await dashboard.startServers();

      // Only HTTP server should start
      expect(mockHttpServer.start).toHaveBeenCalled();
    });

    it('should emit "started" event when all servers running', async () => {
      const startedHandler = jest.fn();
      dashboard.on('started', startedHandler);

      await dashboard.startServers();

      expect(startedHandler).toHaveBeenCalled();
    });
  });

  describe('stopServers()', () => {
    beforeEach(async () => {
      dashboard = new DashboardIntegration({
        configManager: mockConfigManager,
        logger: mockLogger
      });
      await dashboard.startServers();
    });

    it('should stop all servers on stopServers()', async () => {
      await dashboard.stopServers();

      expect(mockHttpServer.stop).toHaveBeenCalled();
      expect(mockWsServer.stop).toHaveBeenCalled();
      expect(mockApiServer.stop).toHaveBeenCalled();
    });

    it('should emit "stopped" event', async () => {
      const stoppedHandler = jest.fn();
      dashboard.on('stopped', stoppedHandler);

      await dashboard.stopServers();

      expect(stoppedHandler).toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      mockHttpServer.stop.mockRejectedValue(new Error('Stop failed'));

      await expect(dashboard.stopServers()).resolves.not.toThrow();
    });
  });

  describe('Status Broadcasting', () => {
    beforeEach(async () => {
      dashboard = new DashboardIntegration({
        configManager: mockConfigManager,
        logger: mockLogger
      });
      await dashboard.startServers();
    });

    it('should broadcast "status" message on rate limit detection', () => {
      const status = {
        detected: true,
        reset_time: '2026-01-25T20:00:00Z'
      };

      dashboard.broadcastStatus(status);

      expect(mockWsServer.broadcastStatus).toHaveBeenCalledWith(status);
    });

    it('should broadcast "rate_limit" event with reset_time', () => {
      const event = {
        type: 'rate_limit',
        reset_time: '2026-01-25T20:00:00Z',
        message: 'Rate limit hit'
      };

      dashboard.broadcastEvent('rate_limit', event);

      expect(mockWsServer.broadcastEvent).toHaveBeenCalledWith('rate_limit', event);
    });

    it('should broadcast "resume_success" after successful resume', () => {
      const event = {
        success: true,
        sessionId: 'default',
        timestamp: Date.now()
      };

      dashboard.broadcastEvent('resume_success', event);

      expect(mockWsServer.broadcastEvent).toHaveBeenCalledWith('resume_success', event);
    });

    it('should handle broadcast when WebSocket server not running', async () => {
      await dashboard.stopServers();

      expect(() => {
        dashboard.broadcastStatus({ detected: false });
      }).not.toThrow();
    });
  });

  describe('openGui()', () => {
    beforeEach(() => {
      dashboard = new DashboardIntegration({
        configManager: mockConfigManager,
        logger: mockLogger
      });
    });

    it('should start HTTP server if not running', async () => {
      await dashboard.openGui();

      expect(mockHttpServer.start).toHaveBeenCalled();
    });

    it('should open browser with localhost URL', async () => {
      await dashboard.openGui();

      expect(childProcess.exec).toHaveBeenCalled();
      const callArg = childProcess.exec.mock.calls[0][0];
      expect(callArg).toContain('localhost:3737');
    });

    it('should use configured GUI port', async () => {
      mockConfigManager.get.mockImplementation((key) => {
        if (key === 'gui.port') return 8080;
        return true;
      });

      await dashboard.openGui();

      const callArg = childProcess.exec.mock.calls[0][0];
      expect(callArg).toContain('8080');
    });

    it('should not restart server if already running', async () => {
      await dashboard.startServers();
      mockHttpServer.start.mockClear();

      await dashboard.openGui();

      // Should not call start again since already running
      expect(mockHttpServer.start).not.toHaveBeenCalled();
    });

    it('should include wsPort query parameter in URL', async () => {
      await dashboard.openGui();

      const callArg = childProcess.exec.mock.calls[0][0];
      expect(callArg).toContain('wsPort=3847');
    });
  });

  describe('getStatus()', () => {
    beforeEach(() => {
      dashboard = new DashboardIntegration({
        configManager: mockConfigManager,
        logger: mockLogger
      });
    });

    it('should return status of all servers', async () => {
      await dashboard.startServers();

      const status = dashboard.getStatus();

      expect(status).toHaveProperty('httpServer');
      expect(status).toHaveProperty('wsServer');
      expect(status).toHaveProperty('apiServer');
    });

    it('should return running: false when servers stopped', () => {
      const status = dashboard.getStatus();

      expect(status.httpServer.running).toBe(false);
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      dashboard = new DashboardIntegration({
        configManager: mockConfigManager,
        logger: mockLogger
      });
    });

    it('should handle port-in-use gracefully', async () => {
      mockHttpServerShouldFail = true;
      mockHttpServerError = new Error('EADDRINUSE');

      await expect(dashboard.startServers()).rejects.toThrow('EADDRINUSE');
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should log server startup errors', async () => {
      mockWsServerShouldFail = true;
      mockWsServerError = new Error('WebSocket failed');

      try {
        await dashboard.startServers();
      } catch (e) {
        // Expected
      }

      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should cleanup on partial startup failure', async () => {
      // HTTP starts, WS fails
      mockWsServerShouldFail = true;
      mockWsServerError = new Error('WS failed');

      try {
        await dashboard.startServers();
      } catch (e) {
        // Expected
      }

      // HTTP should be stopped since WS failed
      expect(mockHttpServer.stop).toHaveBeenCalled();
    });
  });

  describe('WebSocket Message Handling', () => {
    beforeEach(() => {
      dashboard = new DashboardIntegration({
        configManager: mockConfigManager,
        logger: mockLogger
      });
    });

    it('should register handlers when WebSocket server starts', async () => {
      await dashboard.startServers();

      expect(mockWsServer.registerHandler).toHaveBeenCalled();
      // Should register at least status, config, and analytics handlers
      const registeredTypes = mockWsServer.registerHandler.mock.calls.map(call => call[0]);
      expect(registeredTypes).toContain('status');
      expect(registeredTypes).toContain('config');
      expect(registeredTypes).toContain('analytics');
    });

    it('should respond to status request with session data', async () => {
      await dashboard.startServers();

      // Get the status handler that was registered
      const statusHandler = mockWsServer.messageHandlers.get('status');
      expect(statusHandler).toBeDefined();

      // Mock ws and state
      const mockWs = {};
      const mockState = { subscriptions: ['*'] };

      // Call the handler
      statusHandler(mockWs, mockState, { type: 'status' });

      // Verify it sends a response
      expect(mockWsServer.send).toHaveBeenCalledWith(
        mockWs,
        expect.objectContaining({
          type: 'status',
          sessions: expect.any(Array)
        })
      );
    });

    it('should respond to config request with configuration', async () => {
      await dashboard.startServers();

      const configHandler = mockWsServer.messageHandlers.get('config');
      expect(configHandler).toBeDefined();

      const mockWs = {};
      const mockState = { subscriptions: ['*'] };

      configHandler(mockWs, mockState, { type: 'config' });

      expect(mockWsServer.send).toHaveBeenCalledWith(
        mockWs,
        expect.objectContaining({
          type: 'config',
          config: expect.any(Object)
        })
      );
    });

    it('should respond to analytics request with chart data', async () => {
      await dashboard.startServers();

      const analyticsHandler = mockWsServer.messageHandlers.get('analytics');
      expect(analyticsHandler).toBeDefined();

      const mockWs = {};
      const mockState = { subscriptions: ['*'] };

      analyticsHandler(mockWs, mockState, { type: 'analytics' });

      expect(mockWsServer.send).toHaveBeenCalledWith(
        mockWs,
        expect.objectContaining({
          type: 'analytics',
          data: expect.any(Array)
        })
      );
    });

    it('should include daemon stats in status response', async () => {
      await dashboard.startServers();

      const statusHandler = mockWsServer.messageHandlers.get('status');
      const mockWs = {};

      statusHandler(mockWs, {}, { type: 'status' });

      expect(mockWsServer.send).toHaveBeenCalledWith(
        mockWs,
        expect.objectContaining({
          type: 'status',
          stats: expect.objectContaining({
            uptime: expect.any(Number)
          })
        })
      );
    });

    it('should not register handlers when WebSocket server disabled', async () => {
      mockConfigManager.get.mockImplementation((key) => {
        if (key === 'websocket.enabled') return false;
        if (key === 'gui.enabled') return true;
        if (key === 'api.enabled') return false;
        return true;
      });

      await dashboard.startServers();

      // registerHandler should not be called since WS is disabled
      expect(mockWsServer.registerHandler).not.toHaveBeenCalled();
    });
  });
});
