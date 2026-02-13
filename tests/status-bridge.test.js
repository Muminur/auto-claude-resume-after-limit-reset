/**
 * Tests for StatusBridge
 *
 * Covers:
 * - Constructor initialization
 * - getAllStatuses() - returns daemon status formatted for API
 * - getStatus(sessionId) - returns specific session status
 * - Status change notifications - triggers WebSocket broadcasts
 * - Integration with ApiServer as statusWatcher
 */

const { EventEmitter } = require('events');

describe('StatusBridge', () => {
  let StatusBridge;
  let bridge;
  let mockDaemonState;
  let mockWsServer;
  let mockLogger;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    // Mock daemon state - simulates the daemon's internal state
    mockDaemonState = {
      currentStatus: null,
      resetTime: null,
      isRateLimited: false,
      sessions: new Map()
    };

    // Mock WebSocket server
    mockWsServer = {
      broadcast: jest.fn(),
      broadcastStatus: jest.fn(),
      broadcastEvent: jest.fn(),
      getClients: jest.fn().mockReturnValue(0)
    };

    StatusBridge = require('../src/modules/status-bridge');
  });

  describe('constructor()', () => {
    it('should accept daemon state reference', () => {
      bridge = new StatusBridge({ daemonState: mockDaemonState });
      expect(bridge.daemonState).toBe(mockDaemonState);
    });

    it('should accept WebSocket server reference', () => {
      bridge = new StatusBridge({ wsServer: mockWsServer });
      expect(bridge.wsServer).toBe(mockWsServer);
    });

    it('should accept logger parameter', () => {
      bridge = new StatusBridge({ logger: mockLogger });
      expect(bridge.logger).toBe(mockLogger);
    });

    it('should work without dependencies (graceful degradation)', () => {
      bridge = new StatusBridge({});
      expect(bridge).toBeDefined();
    });
  });

  describe('getAllStatuses()', () => {
    beforeEach(() => {
      bridge = new StatusBridge({
        daemonState: mockDaemonState,
        wsServer: mockWsServer,
        logger: mockLogger
      });
    });

    it('should return empty object when no rate limit', () => {
      mockDaemonState.isRateLimited = false;
      mockDaemonState.currentStatus = null;

      const statuses = bridge.getAllStatuses();

      expect(statuses).toEqual({});
    });

    it('should return status when rate limit active', () => {
      const resetTime = new Date('2026-01-25T20:00:00Z');
      mockDaemonState.isRateLimited = true;
      mockDaemonState.currentStatus = {
        detected: true,
        reset_time: resetTime.toISOString(),
        message: 'Rate limit hit',
        timezone: 'UTC'
      };

      const statuses = bridge.getAllStatuses();

      expect(statuses).toHaveProperty('default');
      expect(statuses.default.detected).toBe(true);
      expect(statuses.default.reset_time).toBe(resetTime.toISOString());
    });

    it('should return multiple sessions when available', () => {
      mockDaemonState.sessions.set('session1', {
        detected: true,
        reset_time: '2026-01-25T20:00:00Z',
        message: 'Session 1 rate limited'
      });
      mockDaemonState.sessions.set('session2', {
        detected: false,
        reset_time: null,
        message: null
      });

      const statuses = bridge.getAllStatuses();

      expect(Object.keys(statuses)).toContain('session1');
      expect(Object.keys(statuses)).toContain('session2');
    });
  });

  describe('getStatus(sessionId)', () => {
    beforeEach(() => {
      bridge = new StatusBridge({
        daemonState: mockDaemonState,
        wsServer: mockWsServer,
        logger: mockLogger
      });
    });

    it('should return null for unknown session', () => {
      const status = bridge.getStatus('unknown-session');
      expect(status).toBeNull();
    });

    it('should return status for default session', () => {
      mockDaemonState.currentStatus = {
        detected: true,
        reset_time: '2026-01-25T20:00:00Z',
        message: 'Rate limited'
      };

      const status = bridge.getStatus('default');

      expect(status).not.toBeNull();
      expect(status.detected).toBe(true);
    });

    it('should return status for named session', () => {
      mockDaemonState.sessions.set('my-session', {
        detected: true,
        reset_time: '2026-01-25T21:00:00Z',
        message: 'My session limited'
      });

      const status = bridge.getStatus('my-session');

      expect(status).not.toBeNull();
      expect(status.message).toBe('My session limited');
    });
  });

  describe('notifyStatusChange()', () => {
    beforeEach(() => {
      bridge = new StatusBridge({
        daemonState: mockDaemonState,
        wsServer: mockWsServer,
        logger: mockLogger
      });
    });

    it('should broadcast to WebSocket on rate limit detection', () => {
      const status = {
        detected: true,
        reset_time: '2026-01-25T20:00:00Z',
        message: 'Rate limit detected'
      };

      bridge.notifyStatusChange('rate_limit', status);

      expect(mockWsServer.broadcastEvent).toHaveBeenCalledWith('rate_limit', status);
    });

    it('should broadcast status updates', () => {
      const status = {
        detected: true,
        reset_time: '2026-01-25T20:00:00Z'
      };

      bridge.notifyStatusChange('status', status);

      expect(mockWsServer.broadcastStatus).toHaveBeenCalledWith(status);
    });

    it('should broadcast countdown updates', () => {
      const countdown = {
        remaining: 3600,
        formatted: '1:00:00'
      };

      bridge.notifyStatusChange('countdown', countdown);

      expect(mockWsServer.broadcastEvent).toHaveBeenCalledWith('countdown', countdown);
    });

    it('should broadcast resume completion', () => {
      const resumeData = {
        success: true,
        sessionId: 'default',
        timestamp: Date.now()
      };

      bridge.notifyStatusChange('resume_success', resumeData);

      expect(mockWsServer.broadcastEvent).toHaveBeenCalledWith('resume_success', resumeData);
    });

    it('should handle missing WebSocket server gracefully', () => {
      bridge = new StatusBridge({
        daemonState: mockDaemonState,
        logger: mockLogger
        // No wsServer
      });

      expect(() => {
        bridge.notifyStatusChange('status', { detected: false });
      }).not.toThrow();
    });
  });

  describe('getAnalytics()', () => {
    beforeEach(() => {
      bridge = new StatusBridge({
        daemonState: mockDaemonState,
        wsServer: mockWsServer,
        logger: mockLogger
      });
    });

    it('should return analytics data when available', () => {
      mockDaemonState.analytics = {
        last7Days: { rateLimitCount: 5 },
        last30Days: { rateLimitCount: 15 },
        allTime: { totalRateLimits: 50 }
      };

      const analytics = bridge.getAnalytics();

      expect(analytics).toHaveProperty('last7Days');
      expect(analytics.last7Days.rateLimitCount).toBe(5);
    });

    it('should return empty object when no analytics', () => {
      mockDaemonState.analytics = null;

      const analytics = bridge.getAnalytics();

      expect(analytics).toEqual({});
    });
  });

  describe('integration with ApiServer', () => {
    it('should implement statusWatcher interface for ApiServer', () => {
      bridge = new StatusBridge({
        daemonState: mockDaemonState,
        wsServer: mockWsServer,
        logger: mockLogger
      });

      // ApiServer expects these methods
      expect(typeof bridge.getAllStatuses).toBe('function');
      expect(typeof bridge.getStatus).toBe('function');
    });

    it('should emit events compatible with ApiServer', () => {
      bridge = new StatusBridge({
        daemonState: mockDaemonState,
        wsServer: mockWsServer,
        logger: mockLogger
      });

      const eventHandler = jest.fn();
      bridge.on('statusChange', eventHandler);

      bridge.emitStatusChange({ detected: true });

      expect(eventHandler).toHaveBeenCalled();
    });
  });

  describe('updateDaemonState()', () => {
    beforeEach(() => {
      bridge = new StatusBridge({
        daemonState: mockDaemonState,
        wsServer: mockWsServer,
        logger: mockLogger
      });
    });

    it('should update internal daemon state reference', () => {
      const newState = {
        isRateLimited: true,
        currentStatus: { detected: true }
      };

      bridge.updateDaemonState(newState);

      expect(bridge.daemonState.isRateLimited).toBe(true);
    });

    it('should trigger broadcast after state update', () => {
      bridge.updateDaemonState({
        currentStatus: { detected: true, reset_time: '2026-01-25T20:00:00Z' }
      });

      expect(mockWsServer.broadcastStatus).toHaveBeenCalled();
    });
  });
});
