/**
 * Tests for WebSocketServer
 *
 * Covers:
 * - Constructor initialization with config
 * - start() - starts server on configured port
 * - stop() - stops server gracefully
 * - broadcast() - sends to all clients
 * - broadcastStatus() - respects subscriptions
 * - Message handling - ping/pong, subscribe/unsubscribe
 * - getClients() - returns client count
 * - Error handling - invalid messages, connection errors
 */

const WebSocketServer = require('../src/modules/websocket-server');

// Mock the ws library
const mockClients = [];
let mockServer;

jest.mock('ws', () => {
  const { EventEmitter } = require('events');

  class MockWebSocket extends EventEmitter {
    constructor() {
      super();
      this.readyState = 1; // OPEN
      mockClients.push(this);
    }

    send(data) {
      if (this.readyState === 1) {
        this.lastSent = data;
      }
    }

    close(code, reason) {
      this.readyState = 3; // CLOSED
      process.nextTick(() => this.emit('close', code, reason));
    }

    terminate() {
      this.readyState = 3;
      process.nextTick(() => this.emit('close', 1006, 'terminated'));
    }

    ping() {
      this.pinged = true;
    }
  }

  class MockServer extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      mockServer = this;
    }

    close(callback) {
      process.nextTick(() => {
        this.emit('close');
        if (callback) callback();
      });
    }
  }

  MockWebSocket.OPEN = 1;
  MockWebSocket.CLOSED = 3;

  return {
    Server: MockServer,
    WebSocket: MockWebSocket,
    OPEN: 1,
    CLOSED: 3
  };
});

const WebSocket = require('ws');

// Helper to simulate client connection
function simulateConnection(server) {
  const ws = new WebSocket.WebSocket();
  process.nextTick(() => {
    mockServer.emit('connection', ws);
  });
  return ws;
}

describe('WebSocketServer', () => {
  let server;
  let mockLogger;

  // Default config that disables heartbeat to prevent setInterval loops in tests
  const testConfig = {
    enableHeartbeat: false,
    logger: null
  };

  beforeEach(() => {
    // Always use real timers by default to avoid setInterval infinite loops
    jest.useRealTimers();

    mockLogger = {
      log: jest.fn()
    };

    mockClients.length = 0;
    mockServer = null;
    jest.clearAllMocks();
  });

  afterEach(async () => {
    // Ensure real timers are restored
    jest.useRealTimers();

    if (server && server.isRunning) {
      try {
        await server.stop();
      } catch (error) {
        // Ignore errors during cleanup
      }
    }
  }, 10000); // 10 second timeout for cleanup

  describe('constructor()', () => {
    it('should initialize with default config', () => {
      server = new WebSocketServer();

      expect(server.config.port).toBe(3847);
      expect(server.config.pingInterval).toBe(30000);
      expect(server.config.pingTimeout).toBe(5000);
      expect(server.isRunning).toBe(false);
      expect(server.clients).toBeInstanceOf(Map);
    });

    it('should initialize with custom config', () => {
      server = new WebSocketServer({
        port: 4000,
        pingInterval: 15000,
        pingTimeout: 3000,
        logger: mockLogger
      });

      expect(server.config.port).toBe(4000);
      expect(server.config.pingInterval).toBe(15000);
      expect(server.config.pingTimeout).toBe(3000);
      expect(server.logger).toBe(mockLogger);
    });

    it('should extend EventEmitter', () => {
      server = new WebSocketServer();
      expect(typeof server.on).toBe('function');
      expect(typeof server.emit).toBe('function');
    });
  });

  describe('start()', () => {
    it('should start WebSocket server on configured port', () => {
      server = new WebSocketServer({ port: 3847, logger: mockLogger, enableHeartbeat: false });

      server.start();

      expect(server.isRunning).toBe(true);
      expect(server.server).toBeDefined();
      expect(server.server.options.port).toBe(3847);
      expect(mockLogger.log).toHaveBeenCalledWith(
        'info',
        expect.stringContaining('Starting WebSocket server')
      );
    });

    it('should emit started event with port', (done) => {
      server = new WebSocketServer({ port: 3847, logger: mockLogger, enableHeartbeat: false });

      server.on('started', (data) => {
        expect(data).toEqual({ port: 3847 });
        done();
      });

      server.start();
    });

    it('should start heartbeat interval', () => {
      server = new WebSocketServer({ port: 3847, logger: mockLogger, enableHeartbeat: false });

      server.start();

      expect(server.pingIntervalId).toBeDefined();
    });

    it('should warn if already running', () => {
      server = new WebSocketServer({ port: 3847, logger: mockLogger, enableHeartbeat: false });

      server.start();
      server.start();

      expect(mockLogger.log).toHaveBeenCalledWith(
        'warning',
        expect.stringContaining('already running')
      );
    });
  });

  describe('stop()', () => {
    it('should stop running server gracefully', (done) => {
      server = new WebSocketServer({ port: 3847, logger: mockLogger, enableHeartbeat: false });

      server.start();

      server.stop().then(() => {
        expect(server.isRunning).toBe(false);
        expect(server.server).toBe(null);
        expect(server.pingIntervalId).toBe(null);
        done();
      });
    });

    it('should emit stopped event', (done) => {
      server = new WebSocketServer({ port: 3847, logger: mockLogger, enableHeartbeat: false });

      server.on('stopped', () => {
        done();
      });

      server.start();
      server.stop();
    });

    it('should close all client connections', (done) => {
      server = new WebSocketServer({ port: 3847, logger: mockLogger, enableHeartbeat: false });

      server.start();

      const ws1 = simulateConnection(server);
      const ws2 = simulateConnection(server);

      setTimeout(() => {
        server.stop().then(() => {
          expect(server.clients.size).toBe(0);
          done();
        });
      }, 10);
    });

    it('should warn if not running', (done) => {
      server = new WebSocketServer({ port: 3847, logger: mockLogger, enableHeartbeat: false });

      server.stop().then(() => {
        expect(mockLogger.log).toHaveBeenCalledWith(
          'warning',
          expect.stringContaining('not running')
        );
        done();
      });
    });
  });

  describe('broadcast()', () => {
    it('should send message to all connected clients', (done) => {
      server = new WebSocketServer({ port: 3847, logger: mockLogger, enableHeartbeat: false });
      server.start();

      const ws1 = simulateConnection(server);
      const ws2 = simulateConnection(server);

      setTimeout(() => {
        const message = { type: 'test', data: { value: 123 } };
        const count = server.broadcast(message);

        expect(count).toBe(2);
        expect(ws1.lastSent).toBe(JSON.stringify(message));
        expect(ws2.lastSent).toBe(JSON.stringify(message));
        done();
      }, 10);
    });

    it('should return 0 if server not running', () => {
      server = new WebSocketServer({ port: 3847, logger: mockLogger, enableHeartbeat: false });

      const message = { type: 'test', data: {} };
      const count = server.broadcast(message);

      expect(count).toBe(0);
      expect(mockLogger.log).toHaveBeenCalledWith(
        'warning',
        expect.stringContaining('server not running')
      );
    });

    it('should skip clients not in OPEN state', (done) => {
      server = new WebSocketServer({ port: 3847, logger: mockLogger, enableHeartbeat: false });
      server.start();

      const ws1 = simulateConnection(server);
      const ws2 = simulateConnection(server);

      setTimeout(() => {
        ws2.readyState = 3; // CLOSED
        ws1.lastSent = undefined; // Clear welcome message
        ws2.lastSent = undefined; // Clear welcome message

        const message = { type: 'test', data: {} };
        const count = server.broadcast(message);

        expect(count).toBe(1);
        expect(ws1.lastSent).toBeDefined();
        expect(ws2.lastSent).toBeUndefined();
        done();
      }, 10);
    });
  });

  describe('broadcastStatus()', () => {
    it('should send status to all subscribed clients', (done) => {
      server = new WebSocketServer({ port: 3847, logger: mockLogger, enableHeartbeat: false });
      server.start();

      const ws1 = simulateConnection(server);

      setTimeout(() => {
        const status = {
          session: 'test-session',
          state: 'waiting',
          resetTime: new Date('2026-01-24T12:00:00Z')
        };

        const count = server.broadcastStatus(status);

        expect(count).toBe(1);
        expect(ws1.lastSent).toContain('"type":"status"');
        expect(ws1.lastSent).toContain('"state":"waiting"');
        done();
      }, 10);
    });

    it('should respect wildcard subscriptions', (done) => {
      server = new WebSocketServer({ port: 3847, logger: mockLogger, enableHeartbeat: false });
      server.start();

      const ws1 = simulateConnection(server);

      setTimeout(() => {
        const status = { session: 'any-session', state: 'active' };
        const count = server.broadcastStatus(status);

        expect(count).toBe(1);
        expect(ws1.lastSent).toBeDefined();
        done();
      }, 10);
    });

    it('should filter by session subscription', (done) => {
      server = new WebSocketServer({ port: 3847, logger: mockLogger, enableHeartbeat: false });
      server.start();

      const ws1 = simulateConnection(server);
      const ws2 = simulateConnection(server);

      setTimeout(() => {
        const state1 = server.clients.get(ws1);
        const state2 = server.clients.get(ws2);
        state1.subscriptions = ['session-a'];
        state2.subscriptions = ['session-b'];

        ws1.lastSent = undefined; // Clear welcome message
        ws2.lastSent = undefined; // Clear welcome message

        const status = { session: 'session-a', state: 'active' };
        const count = server.broadcastStatus(status);

        expect(count).toBe(1);
        expect(ws1.lastSent).toBeDefined();
        expect(ws2.lastSent).toBeUndefined();
        done();
      }, 10);
    });

    it('should return 0 if server not running', () => {
      server = new WebSocketServer({ port: 3847, logger: mockLogger, enableHeartbeat: false });

      const status = { session: 'test', state: 'active' };
      const count = server.broadcastStatus(status);

      expect(count).toBe(0);
    });
  });

  describe('Message handling', () => {
    describe('ping/pong', () => {
      it('should respond to ping with pong', (done) => {
        server = new WebSocketServer({ port: 3847, logger: mockLogger, enableHeartbeat: false });
        server.start();

        const ws = simulateConnection(server);

        setTimeout(() => {
          ws.emit('message', JSON.stringify({ type: 'ping' }));

          setTimeout(() => {
            expect(ws.lastSent).toContain('"type":"pong"');
            done();
          }, 5);
        }, 10);
      });

      it('should update isAlive on pong', (done) => {
        server = new WebSocketServer({ port: 3847, logger: mockLogger, enableHeartbeat: false });
        server.start();

        const ws = simulateConnection(server);

        setTimeout(() => {
          const state = server.clients.get(ws);
          state.isAlive = false;

          ws.emit('pong');

          expect(state.isAlive).toBe(true);
          done();
        }, 10);
      });
    });

    describe('subscribe/unsubscribe', () => {
      it('should handle subscribe message', (done) => {
        server = new WebSocketServer({ port: 3847, logger: mockLogger, enableHeartbeat: false });
        server.start();

        const ws = simulateConnection(server);

        setTimeout(() => {
          const subscribeMsg = {
            type: 'subscribe',
            data: { sessions: ['session-1', 'session-2'] }
          };

          ws.emit('message', JSON.stringify(subscribeMsg));

          setTimeout(() => {
            const state = server.clients.get(ws);
            expect(state.subscriptions).toContain('session-1');
            expect(state.subscriptions).toContain('session-2');
            expect(ws.lastSent).toContain('"type":"subscribed"');
            done();
          }, 5);
        }, 10);
      });

      it('should handle unsubscribe message', (done) => {
        server = new WebSocketServer({ port: 3847, logger: mockLogger, enableHeartbeat: false });
        server.start();

        const ws = simulateConnection(server);

        setTimeout(() => {
          const state = server.clients.get(ws);
          state.subscriptions = ['session-1', 'session-2', 'session-3'];

          const unsubscribeMsg = {
            type: 'unsubscribe',
            data: { sessions: ['session-1', 'session-3'] }
          };

          ws.emit('message', JSON.stringify(unsubscribeMsg));

          setTimeout(() => {
            expect(state.subscriptions).toEqual(['session-2']);
            expect(ws.lastSent).toContain('"type":"unsubscribed"');
            done();
          }, 5);
        }, 10);
      });

      it('should reject subscribe with invalid sessions', (done) => {
        server = new WebSocketServer({ port: 3847, logger: mockLogger, enableHeartbeat: false });
        server.start();

        const ws = simulateConnection(server);

        setTimeout(() => {
          const subscribeMsg = {
            type: 'subscribe',
            data: { sessions: 'not-an-array' }
          };

          ws.emit('message', JSON.stringify(subscribeMsg));

          setTimeout(() => {
            expect(ws.lastSent).toContain('"type":"error"');
            done();
          }, 5);
        }, 10);
      });

      it('should avoid duplicate subscriptions', (done) => {
        server = new WebSocketServer({ port: 3847, logger: mockLogger, enableHeartbeat: false });
        server.start();

        const ws = simulateConnection(server);

        setTimeout(() => {
          const state = server.clients.get(ws);
          state.subscriptions = ['session-1'];

          const subscribeMsg = {
            type: 'subscribe',
            data: { sessions: ['session-1', 'session-2'] }
          };

          ws.emit('message', JSON.stringify(subscribeMsg));

          setTimeout(() => {
            const session1Count = state.subscriptions.filter(s => s === 'session-1').length;
            expect(session1Count).toBe(1);
            expect(state.subscriptions).toContain('session-2');
            done();
          }, 5);
        }, 10);
      });
    });

    describe('unknown messages', () => {
      it('should send error for unknown message type', (done) => {
        server = new WebSocketServer({ port: 3847, logger: mockLogger, enableHeartbeat: false });
        server.start();

        const ws = simulateConnection(server);

        setTimeout(() => {
          ws.emit('message', JSON.stringify({ type: 'unknown' }));

          setTimeout(() => {
            expect(ws.lastSent).toContain('"type":"error"');
            expect(mockLogger.log).toHaveBeenCalledWith(
              'warning',
              expect.stringContaining('Unknown message type')
            );
            done();
          }, 5);
        }, 10);
      });
    });
  });

  describe('Error handling', () => {
    it('should handle invalid JSON messages', (done) => {
      server = new WebSocketServer({ port: 3847, logger: mockLogger, enableHeartbeat: false });
      server.start();

      const ws = simulateConnection(server);

      setTimeout(() => {
        ws.emit('message', 'invalid-json{');

        setTimeout(() => {
          expect(ws.lastSent).toContain('"type":"error"');
          expect(mockLogger.log).toHaveBeenCalledWith(
            'error',
            expect.stringContaining('Error handling message')
          );
          done();
        }, 5);
      }, 10);
    });

    it('should handle client errors', (done) => {
      server = new WebSocketServer({ port: 3847, logger: mockLogger, enableHeartbeat: false });
      server.start();

      const ws = simulateConnection(server);

      setTimeout(() => {
        const error = new Error('Client connection error');
        ws.emit('error', error);

        setTimeout(() => {
          expect(mockLogger.log).toHaveBeenCalledWith(
            'error',
            expect.stringContaining('Client connection error')
          );
          done();
        }, 5);
      }, 10);
    });

    it('should handle server errors', (done) => {
      server = new WebSocketServer({ port: 3847, logger: mockLogger, enableHeartbeat: false });
      const errorSpy = jest.fn();
      server.on('error', errorSpy);

      server.start();

      const error = new Error('Server error');
      mockServer.emit('error', error);

      setTimeout(() => {
        expect(errorSpy).toHaveBeenCalledWith(error);
        expect(mockLogger.log).toHaveBeenCalledWith(
          'error',
          expect.stringContaining('Server error')
        );
        done();
      }, 5);
    });

    it('should remove client on connection close', (done) => {
      server = new WebSocketServer({ port: 3847, logger: mockLogger, enableHeartbeat: false });
      server.start();

      const ws = simulateConnection(server);

      setTimeout(() => {
        expect(server.clients.size).toBe(1);

        ws.emit('close');

        setTimeout(() => {
          expect(server.clients.size).toBe(0);
          done();
        }, 5);
      }, 10);
    });

    it('should emit client_disconnected event', (done) => {
      server = new WebSocketServer({ port: 3847, logger: mockLogger, enableHeartbeat: false });
      const disconnectSpy = jest.fn();
      server.on('client_disconnected', disconnectSpy);

      server.start();

      const ws = simulateConnection(server);

      setTimeout(() => {
        const state = server.clients.get(ws);
        ws.emit('close');

        setTimeout(() => {
          expect(disconnectSpy).toHaveBeenCalledWith({ clientId: state.id });
          done();
        }, 5);
      }, 10);
    });
  });

  describe('getClients()', () => {
    it('should return 0 when no clients connected', () => {
      server = new WebSocketServer({ port: 3847, logger: mockLogger, enableHeartbeat: false });
      server.start();

      expect(server.getClients()).toBe(0);
    });

    it('should return correct client count', (done) => {
      server = new WebSocketServer({ port: 3847, logger: mockLogger, enableHeartbeat: false });
      server.start();

      simulateConnection(server);
      simulateConnection(server);
      simulateConnection(server);

      setTimeout(() => {
        expect(server.getClients()).toBe(3);
        done();
      }, 10);
    });

    it('should update count when clients disconnect', (done) => {
      server = new WebSocketServer({ port: 3847, logger: mockLogger, enableHeartbeat: false });
      server.start();

      const ws1 = simulateConnection(server);
      const ws2 = simulateConnection(server);

      setTimeout(() => {
        expect(server.getClients()).toBe(2);

        ws1.emit('close');

        setTimeout(() => {
          expect(server.getClients()).toBe(1);
          done();
        }, 5);
      }, 10);
    });
  });

  describe('Connection handling', () => {
    it('should send welcome message on connection', (done) => {
      server = new WebSocketServer({ port: 3847, logger: mockLogger, enableHeartbeat: false });
      server.start();

      const ws = simulateConnection(server);

      setTimeout(() => {
        expect(ws.lastSent).toContain('"type":"welcome"');
        done();
      }, 10);
    });

    it('should emit client_connected event', (done) => {
      server = new WebSocketServer({ port: 3847, logger: mockLogger, enableHeartbeat: false });
      const connectSpy = jest.fn();
      server.on('client_connected', connectSpy);

      server.start();
      simulateConnection(server);

      setTimeout(() => {
        expect(connectSpy).toHaveBeenCalledWith({
          clientId: expect.stringMatching(/^client_/)
        });
        done();
      }, 10);
    });

    it('should initialize client with default subscriptions', (done) => {
      server = new WebSocketServer({ port: 3847, logger: mockLogger, enableHeartbeat: false });
      server.start();

      const ws = simulateConnection(server);

      setTimeout(() => {
        const state = server.clients.get(ws);
        expect(state.subscriptions).toEqual(['*']);
        expect(state.isAlive).toBe(true);
        expect(state.connectedAt).toBeInstanceOf(Date);
        done();
      }, 10);
    });
  });

  describe('getStatus()', () => {
    it('should return server status', (done) => {
      server = new WebSocketServer({ port: 3847, logger: mockLogger, enableHeartbeat: false });

      const beforeStatus = server.getStatus();
      expect(beforeStatus.running).toBe(false);
      expect(beforeStatus.port).toBe(3847);
      expect(beforeStatus.clients).toBe(0);

      server.start();
      simulateConnection(server);

      setTimeout(() => {
        const afterStatus = server.getStatus();
        expect(afterStatus.running).toBe(true);
        expect(afterStatus.port).toBe(3847);
        expect(afterStatus.clients).toBe(1);
        done();
      }, 10);
    });
  });

  describe('broadcastEvent()', () => {
    it('should broadcast event to all clients', (done) => {
      server = new WebSocketServer({ port: 3847, logger: mockLogger, enableHeartbeat: false });
      server.start();

      const ws = simulateConnection(server);

      setTimeout(() => {
        const count = server.broadcastEvent('test-event', { data: 'value' });

        expect(count).toBe(1);
        expect(ws.lastSent).toContain('"type":"event"');
        expect(ws.lastSent).toContain('"event":"test-event"');
        done();
      }, 10);
    });
  });
});
