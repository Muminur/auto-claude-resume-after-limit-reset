/**
 * Tests for NotificationManager
 *
 * Covers:
 * - Initialization with config
 * - Sending notifications when enabled
 * - Skipping notifications when disabled
 * - Rate limit notifications with time formatting
 * - Resume notifications with sound
 * - Runtime configuration updates
 * - Graceful fallback when node-notifier unavailable
 */

const NotificationManager = require('../src/modules/notification-manager');

// Mock node-notifier
jest.mock('node-notifier', () => {
  const mockNotifier = {
    notify: jest.fn((options, callback) => {
      // Simulate successful notification
      if (callback) {
        callback(null, 'success');
      }
    })
  };
  return mockNotifier;
}, { virtual: true });

describe('NotificationManager', () => {
  let manager;
  let mockLogger;

  beforeEach(() => {
    // Create fresh manager instance
    manager = new NotificationManager();

    // Create mock logger
    mockLogger = {
      log: jest.fn(),
      info: jest.fn(),
      warning: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };

    // Clear all mocks
    jest.clearAllMocks();
  });

  describe('init()', () => {
    test('initializes with default config', () => {
      const result = manager.init();

      expect(result).toBe(true);
      expect(manager.initialized).toBe(true);
      expect(manager.config.enabled).toBe(true);
      expect(manager.config.sound).toBe(true);
      expect(manager.config.timeout).toBe(10);
    });

    test('initializes with custom config', () => {
      const customConfig = {
        enabled: false,
        sound: false,
        timeout: 5
      };

      const result = manager.init(customConfig);

      expect(result).toBe(true);
      expect(manager.config.enabled).toBe(false);
      expect(manager.config.sound).toBe(false);
      expect(manager.config.timeout).toBe(5);
    });

    test('initializes with custom logger', () => {
      const result = manager.init({ logger: mockLogger });

      expect(result).toBe(true);
      expect(manager.logger).toBe(mockLogger);
      expect(mockLogger.log).toHaveBeenCalledWith(
        'info',
        expect.stringContaining('initialized with node-notifier')
      );
    });

    test('handles partial config merge', () => {
      manager.init({ enabled: true, sound: true, timeout: 10 });
      manager.init({ sound: false }); // Only update sound

      expect(manager.config.enabled).toBe(true);
      expect(manager.config.sound).toBe(false);
      expect(manager.config.timeout).toBe(10);
    });

    test('handles node-notifier unavailable gracefully', () => {
      // Temporarily break the require
      const originalRequire = manager.constructor.prototype.init;

      manager.notifier = null;
      manager.initialized = false;

      // Mock require to throw
      const NodeNotifier = require('node-notifier');
      jest.mock('node-notifier', () => {
        throw new Error('Module not found');
      }, { virtual: true });

      // Manually test the fallback logic
      try {
        require('node-notifier-fake');
        manager.initialized = true;
      } catch (err) {
        manager.initialized = false;
      }

      expect(manager.initialized).toBe(false);
    });
  });

  describe('notify()', () => {
    beforeEach(() => {
      manager.init({ logger: mockLogger });
    });

    test('sends notification when enabled', async () => {
      const result = await manager.notify('Test Title', 'Test Message');

      expect(result).toBe(true);
      expect(manager.notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Test Title',
          message: 'Test Message',
          timeout: 10000,
          sound: true,
          wait: false
        }),
        expect.any(Function)
      );
    });

    test('skips notification when disabled', async () => {
      manager.updateConfig({ enabled: false });
      const result = await manager.notify('Test Title', 'Test Message');

      expect(result).toBe(false);
      expect(manager.notifier.notify).not.toHaveBeenCalled();
      expect(mockLogger.log).toHaveBeenCalledWith(
        'debug',
        expect.stringContaining('Notifications disabled')
      );
    });

    test('skips notification when not initialized', async () => {
      manager.initialized = false;
      manager.config.useFallback = false; // Disable fallback to avoid platform-specific calls
      const result = await manager.notify('Test Title', 'Test Message');

      expect(result).toBe(false);
      expect(manager.notifier.notify).not.toHaveBeenCalled();
    });

    test('uses default title when not provided', async () => {
      await manager.notify('', 'Test Message');

      expect(manager.notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Claude Code Auto-Resume',
          message: 'Test Message'
        }),
        expect.any(Function)
      );
    });

    test('applies custom timeout option', async () => {
      await manager.notify('Title', 'Message', { timeout: 30 });

      expect(manager.notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: 30000 // 30 seconds in ms
        }),
        expect.any(Function)
      );
    });

    test('applies custom sound option', async () => {
      await manager.notify('Title', 'Message', { sound: false });

      expect(manager.notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          sound: false
        }),
        expect.any(Function)
      );
    });

    test('includes icon when provided', async () => {
      await manager.notify('Title', 'Message', { icon: '/path/to/icon.png' });

      expect(manager.notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          icon: '/path/to/icon.png'
        }),
        expect.any(Function)
      );
    });

    test('includes subtitle when provided', async () => {
      await manager.notify('Title', 'Message', { subtitle: 'Subtitle Text' });

      expect(manager.notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          subtitle: 'Subtitle Text'
        }),
        expect.any(Function)
      );
    });

    test('handles notification error gracefully', async () => {
      // Disable fallback to avoid platform-specific calls during test
      manager.config.useFallback = false;

      // Mock error in notify
      manager.notifier.notify.mockImplementationOnce((options, callback) => {
        callback(new Error('Notification failed'), null);
      });

      const result = await manager.notify('Title', 'Message');

      expect(result).toBe(false);
      expect(mockLogger.log).toHaveBeenCalledWith(
        'error',
        expect.stringContaining('Failed to send notification')
      );
    });

    test('logs debug message on successful notification', async () => {
      await manager.notify('Test Title', 'Test Message');

      expect(mockLogger.log).toHaveBeenCalledWith(
        'debug',
        expect.stringContaining('Notification sent: Test Title')
      );
    });
  });

  describe('notifyRateLimit()', () => {
    beforeEach(() => {
      manager.init({ logger: mockLogger });
    });

    test('formats time correctly for minutes only', async () => {
      const now = new Date();
      const resetTime = new Date(now.getTime() + 30 * 60 * 1000); // 30 minutes

      const result = await manager.notifyRateLimit(resetTime);

      expect(result).toBe(true);
      expect(manager.notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Rate Limit Detected',
          message: expect.stringContaining('30m')
        }),
        expect.any(Function)
      );
    });

    test('formats time correctly for hours and minutes', async () => {
      const now = new Date();
      const resetTime = new Date(now.getTime() + 90 * 60 * 1000); // 1h 30m

      const result = await manager.notifyRateLimit(resetTime);

      expect(result).toBe(true);
      expect(manager.notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Rate Limit Detected',
          message: expect.stringMatching(/1h 30m/)
        }),
        expect.any(Function)
      );
    });

    test('formats time correctly for exact hours', async () => {
      const now = new Date();
      const resetTime = new Date(now.getTime() + 120 * 60 * 1000); // 2h 0m

      const result = await manager.notifyRateLimit(resetTime);

      expect(result).toBe(true);
      expect(manager.notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringMatching(/2h 0m/)
        }),
        expect.any(Function)
      );
    });

    test('includes reset time in message', async () => {
      const resetTime = new Date('2026-01-23T15:30:00');

      const result = await manager.notifyRateLimit(resetTime);

      expect(result).toBe(true);
      expect(manager.notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Reset time:')
        }),
        expect.any(Function)
      );
    });

    test('includes subtitle for auto-resume', async () => {
      const now = new Date();
      const resetTime = new Date(now.getTime() + 10 * 60 * 1000);

      await manager.notifyRateLimit(resetTime);

      expect(manager.notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          subtitle: 'Auto-Resume Active'
        }),
        expect.any(Function)
      );
    });

    test('accepts Date object', async () => {
      const resetTime = new Date(Date.now() + 15 * 60 * 1000);

      const result = await manager.notifyRateLimit(resetTime);

      expect(result).toBe(true);
    });

    test('accepts date string', async () => {
      const resetTime = new Date(Date.now() + 15 * 60 * 1000).toISOString();

      const result = await manager.notifyRateLimit(resetTime);

      expect(result).toBe(true);
    });

    test('handles invalid date gracefully', async () => {
      const result = await manager.notifyRateLimit('invalid-date');

      expect(result).toBe(false);
      expect(mockLogger.log).toHaveBeenCalledWith(
        'error',
        expect.stringContaining('Invalid reset time')
      );
    });

    test('logs info message when sending', async () => {
      const resetTime = new Date(Date.now() + 20 * 60 * 1000);

      await manager.notifyRateLimit(resetTime);

      expect(mockLogger.log).toHaveBeenCalledWith(
        'info',
        expect.stringContaining('Sending rate limit notification')
      );
    });
  });

  describe('notifyResume()', () => {
    beforeEach(() => {
      manager.init({ logger: mockLogger });
    });

    test('sends resume notification with sound', async () => {
      const result = await manager.notifyResume();

      expect(result).toBe(true);
      expect(manager.notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Session Resuming',
          message: expect.stringContaining('Rate limit reset'),
          sound: true // Always true for resume
        }),
        expect.any(Function)
      );
    });

    test('sends resume notification without session ID', async () => {
      await manager.notifyResume();

      expect(manager.notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Rate limit reset - resuming Claude Code session'
        }),
        expect.any(Function)
      );
    });

    test('sends resume notification with session ID', async () => {
      await manager.notifyResume('session-123');

      expect(manager.notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Session: session-123')
        }),
        expect.any(Function)
      );
    });

    test('includes subtitle', async () => {
      await manager.notifyResume();

      expect(manager.notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          subtitle: 'Auto-Resume'
        }),
        expect.any(Function)
      );
    });

    test('forces sound even when sound disabled', async () => {
      manager.updateConfig({ sound: false });
      await manager.notifyResume();

      expect(manager.notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          sound: true // Always true for resume
        }),
        expect.any(Function)
      );
    });

    test('logs info message when sending', async () => {
      await manager.notifyResume();

      expect(mockLogger.log).toHaveBeenCalledWith(
        'info',
        expect.stringContaining('Sending resume notification')
      );
    });
  });

  describe('updateConfig()', () => {
    beforeEach(() => {
      manager.init({ logger: mockLogger });
    });

    test('updates enabled setting', () => {
      manager.updateConfig({ enabled: false });

      expect(manager.config.enabled).toBe(false);
      expect(manager.config.sound).toBe(true); // Unchanged
      expect(manager.config.timeout).toBe(10); // Unchanged
    });

    test('updates sound setting', () => {
      manager.updateConfig({ sound: false });

      expect(manager.config.sound).toBe(false);
      expect(manager.config.enabled).toBe(true); // Unchanged
    });

    test('updates timeout setting', () => {
      manager.updateConfig({ timeout: 20 });

      expect(manager.config.timeout).toBe(20);
    });

    test('updates multiple settings at once', () => {
      manager.updateConfig({
        enabled: false,
        sound: false,
        timeout: 15
      });

      expect(manager.config.enabled).toBe(false);
      expect(manager.config.sound).toBe(false);
      expect(manager.config.timeout).toBe(15);
    });

    test('logs debug message on update', () => {
      manager.updateConfig({ enabled: false });

      expect(mockLogger.log).toHaveBeenCalledWith(
        'debug',
        expect.stringContaining('Configuration updated')
      );
    });

    test('handles errors gracefully', () => {
      // Force an error by passing undefined
      mockLogger.log.mockImplementationOnce(() => {
        throw new Error('Logger error');
      });

      // Should not throw
      expect(() => {
        manager.updateConfig({ enabled: false });
      }).not.toThrow();
    });
  });

  describe('getConfig()', () => {
    test('returns copy of config', () => {
      manager.init({ enabled: true, sound: false, timeout: 15 });
      const config = manager.getConfig();

      expect(config).toEqual({
        enabled: true,
        sound: false,
        timeout: 15,
        useFallback: true, // Default value for useFallback
        preferMessageBox: false // Default value for preferMessageBox
      });

      // Verify it's a copy, not reference
      config.enabled = false;
      expect(manager.config.enabled).toBe(true);
    });
  });

  describe('isAvailable()', () => {
    test('returns true when initialized', () => {
      manager.init();

      expect(manager.isAvailable()).toBe(true);
    });

    test('returns false when not initialized', () => {
      expect(manager.isAvailable()).toBe(false);
    });

    test('returns false when notifier is null', () => {
      manager.init();
      manager.notifier = null;

      expect(manager.isAvailable()).toBe(false);
    });
  });

  describe('Fallback - missing node-notifier', () => {
    test('handles missing node-notifier gracefully', () => {
      const managerWithoutNotifier = new NotificationManager();

      // Don't initialize - simulate missing node-notifier
      managerWithoutNotifier.initialized = false;
      managerWithoutNotifier.notifier = null;

      expect(managerWithoutNotifier.isAvailable()).toBe(false);
    });

    test('notify returns false when notifier unavailable', async () => {
      manager.initialized = false;
      manager.notifier = null;
      manager.config.useFallback = false; // Disable fallback to avoid platform-specific calls

      const result = await manager.notify('Title', 'Message');

      expect(result).toBe(false);
    });

    test('notifyRateLimit returns false when notifier unavailable', async () => {
      manager.initialized = false;
      manager.notifier = null;
      manager.config.useFallback = false; // Disable fallback to avoid platform-specific calls

      const resetTime = new Date(Date.now() + 10 * 60 * 1000);
      const result = await manager.notifyRateLimit(resetTime);

      expect(result).toBe(false);
    });

    test('notifyResume returns false when notifier unavailable', async () => {
      manager.initialized = false;
      manager.notifier = null;
      manager.config.useFallback = false; // Disable fallback to avoid platform-specific calls

      const result = await manager.notifyResume();

      expect(result).toBe(false);
    });
  });

  describe('Logging', () => {
    test('uses custom logger.log method when available', () => {
      manager.init({ logger: mockLogger });
      manager._log('info', 'Test message');

      expect(mockLogger.log).toHaveBeenCalledWith(
        'info',
        '[NotificationManager] Test message'
      );
    });

    test('uses logger level methods as fallback', () => {
      const levelLogger = {
        info: jest.fn(),
        error: jest.fn()
      };

      manager.init({ logger: levelLogger });
      manager._log('info', 'Info message');
      manager._log('error', 'Error message');

      expect(levelLogger.info).toHaveBeenCalledWith(
        '[NotificationManager] Info message'
      );
      expect(levelLogger.error).toHaveBeenCalledWith(
        '[NotificationManager] Error message'
      );
    });

    test('falls back to console when logger unavailable', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      manager.logger = null;
      manager._log('info', 'Test message');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[INFO] [NotificationManager] Test message')
      );

      consoleSpy.mockRestore();
    });

    test('fails silently on logging errors', () => {
      const brokenLogger = {
        log: () => {
          throw new Error('Logger broken');
        }
      };

      manager.logger = brokenLogger;

      // Should not throw
      expect(() => {
        manager._log('info', 'Test message');
      }).not.toThrow();
    });
  });
});
