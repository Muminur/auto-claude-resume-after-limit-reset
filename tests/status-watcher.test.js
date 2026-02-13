const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

// Mock fs and chokidar modules before requiring status-watcher
jest.mock('fs');
jest.mock('chokidar');

const chokidar = require('chokidar');
const StatusWatcher = require('../src/modules/status-watcher');

describe('StatusWatcher', () => {
  let mockWatcher;
  let mockLogger;

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();

    // Create mock chokidar watcher
    mockWatcher = new EventEmitter();
    mockWatcher.close = jest.fn().mockResolvedValue();
    mockWatcher.on = jest.fn((event, handler) => {
      mockWatcher.addListener(event, handler);
      return mockWatcher;
    });

    // Mock chokidar.watch to return our mock watcher
    chokidar.watch = jest.fn().mockReturnValue(mockWatcher);

    // Mock logger
    mockLogger = {
      log: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      warning: jest.fn(),
      error: jest.fn()
    };

    // Default fs mock implementations
    fs.existsSync = jest.fn().mockReturnValue(true);
    fs.readFileSync = jest.fn().mockReturnValue(JSON.stringify({
      rateLimitResetTime: null,
      lastUpdated: '2025-01-24T10:00:00.000Z'
    }));
  });

  describe('constructor', () => {
    it('should initialize with default config', () => {
      const watcher = new StatusWatcher();

      expect(watcher.config.watchPaths).toEqual([]);
      expect(watcher.config.debounceDelay).toBe(100);
      expect(watcher.config.persistent).toBe(true);
      expect(watcher.config.logger).toBe(console);
      expect(watcher.isWatching).toBe(false);
    });

    it('should initialize with custom config', () => {
      const config = {
        watchPaths: ['/path1', '/path2'],
        debounceDelay: 200,
        persistent: false,
        logger: mockLogger
      };

      const watcher = new StatusWatcher(config);

      expect(watcher.config.watchPaths).toEqual(['/path1', '/path2']);
      expect(watcher.config.debounceDelay).toBe(200);
      expect(watcher.config.persistent).toBe(false);
      expect(watcher.config.logger).toBe(mockLogger);
    });

    it('should initialize empty state maps', () => {
      const watcher = new StatusWatcher();

      expect(watcher.watchers).toBeInstanceOf(Map);
      expect(watcher.sessions).toBeInstanceOf(Map);
      expect(watcher.statuses).toBeInstanceOf(Map);
      expect(watcher.debounceTimers).toBeInstanceOf(Map);
      expect(watcher.watchers.size).toBe(0);
      expect(watcher.sessions.size).toBe(0);
      expect(watcher.statuses.size).toBe(0);
    });

    it('should extend EventEmitter', () => {
      const watcher = new StatusWatcher();
      expect(watcher).toBeInstanceOf(EventEmitter);
    });
  });

  describe('start', () => {
    it('should start watching configured paths', async () => {
      const config = {
        watchPaths: ['/path/to/status1.json', '/path/to/status2.json'],
        logger: mockLogger
      };

      const watcher = new StatusWatcher(config);
      await watcher.start();

      expect(watcher.isWatching).toBe(true);
      expect(chokidar.watch).toHaveBeenCalledTimes(2);
      expect(mockLogger.log).toHaveBeenCalledWith('info', expect.stringContaining('Starting StatusWatcher'));
    });

    it('should not start if already watching', async () => {
      const watcher = new StatusWatcher({ logger: mockLogger });
      await watcher.start();

      chokidar.watch.mockClear();
      await watcher.start();

      expect(chokidar.watch).not.toHaveBeenCalled();
      expect(mockLogger.log).toHaveBeenCalledWith('debug', expect.stringContaining('already started'));
    });

    it('should add initial watch paths from config', async () => {
      const config = {
        watchPaths: ['/path1/status.json'],
        logger: mockLogger
      };

      const watcher = new StatusWatcher(config);
      await watcher.start();

      expect(watcher.sessions.size).toBe(1);
      expect(watcher.watchers.size).toBe(1);
    });

    it('should handle start errors gracefully', async () => {
      const config = {
        watchPaths: ['/invalid/path'],
        logger: mockLogger
      };

      chokidar.watch.mockImplementation(() => {
        throw new Error('Watch failed');
      });

      const watcher = new StatusWatcher(config);

      await expect(watcher.start()).rejects.toThrow('Watch failed');
      expect(mockLogger.log).toHaveBeenCalledWith('error', expect.stringContaining('Failed to start'));
    });

    it('should load initial status if file exists', async () => {
      const mockStatus = {
        rateLimitResetTime: '2025-01-24T12:00:00.000Z',
        lastUpdated: '2025-01-24T10:00:00.000Z'
      };

      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify(mockStatus));

      const watcher = new StatusWatcher({
        watchPaths: ['/path/status.json'],
        logger: mockLogger
      });

      await watcher.start();

      const statuses = watcher.getAllStatuses();
      const sessionId = Object.keys(statuses)[0];
      expect(statuses[sessionId].rateLimitResetTime).toBe(mockStatus.rateLimitResetTime);
    });
  });

  describe('stop', () => {
    it('should stop all watchers and clear state', async () => {
      const watcher = new StatusWatcher({
        watchPaths: ['/path1/status.json', '/path2/status.json'],
        logger: mockLogger
      });

      await watcher.start();
      await watcher.stop();

      expect(mockWatcher.close).toHaveBeenCalledTimes(2);
      expect(watcher.isWatching).toBe(false);
      expect(watcher.watchers.size).toBe(0);
      expect(watcher.sessions.size).toBe(0);
      expect(watcher.statuses.size).toBe(0);
      expect(mockLogger.log).toHaveBeenCalledWith('info', expect.stringContaining('stopped'));
    });

    it('should not stop if not watching', async () => {
      const watcher = new StatusWatcher({ logger: mockLogger });
      await watcher.stop();

      expect(mockWatcher.close).not.toHaveBeenCalled();
      expect(mockLogger.log).toHaveBeenCalledWith('debug', expect.stringContaining('not running'));
    });

    it('should clear debounce timers on stop', async () => {
      const watcher = new StatusWatcher({
        watchPaths: ['/path/status.json'],
        logger: mockLogger
      });

      await watcher.start();

      // Simulate adding a debounce timer
      const timer = setTimeout(() => {}, 1000);
      watcher.debounceTimers.set('/path/status.json', timer);

      await watcher.stop();

      expect(watcher.debounceTimers.size).toBe(0);
    });

    it('should handle watcher close errors gracefully', async () => {
      const watcher = new StatusWatcher({
        watchPaths: ['/path/status.json'],
        logger: mockLogger
      });

      await watcher.start();

      mockWatcher.close.mockRejectedValue(new Error('Close failed'));

      await watcher.stop();

      expect(mockLogger.log).toHaveBeenCalledWith('warning', expect.stringContaining('Error closing watcher'));
      expect(watcher.isWatching).toBe(false);
    });

    it('should throw on unexpected errors during stop', async () => {
      const watcher = new StatusWatcher({
        watchPaths: ['/path/status.json'],
        logger: mockLogger
      });

      await watcher.start();

      // Force an error by making watchers.entries() fail
      Object.defineProperty(watcher.watchers, 'entries', {
        get: () => {
          throw new Error('Unexpected error');
        }
      });

      await expect(watcher.stop()).rejects.toThrow('Unexpected error');
    });
  });

  describe('addWatchPath', () => {
    it('should add new watch path with auto-generated session ID', async () => {
      const watcher = new StatusWatcher({ logger: mockLogger });

      const sessionId = await watcher.addWatchPath('/home/user/project1/status.json');

      expect(sessionId).toBe('project1');
      expect(watcher.sessions.has(sessionId)).toBe(true);
      expect(watcher.watchers.size).toBe(1);
      expect(chokidar.watch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          persistent: true,
          ignoreInitial: true
        })
      );
    });

    it('should add new watch path with custom label', async () => {
      const watcher = new StatusWatcher({ logger: mockLogger });

      const sessionId = await watcher.addWatchPath('/path/status.json', 'custom-label');

      expect(sessionId).toBe('custom-label');
      expect(watcher.sessions.get(sessionId).label).toBe('custom-label');
    });

    it('should normalize paths for cross-platform compatibility', async () => {
      const watcher = new StatusWatcher({ logger: mockLogger });

      await watcher.addWatchPath('C:\\Users\\test\\status.json');

      const normalizedPath = path.normalize('C:\\Users\\test\\status.json');
      expect(watcher.watchers.has(normalizedPath)).toBe(true);
    });

    it('should return existing session ID if path already watched', async () => {
      const watcher = new StatusWatcher({ logger: mockLogger });

      const sessionId1 = await watcher.addWatchPath('/path/status.json', 'session1');
      const sessionId2 = await watcher.addWatchPath('/path/status.json', 'session2');

      expect(sessionId1).toBe(sessionId2);
      expect(watcher.sessions.size).toBe(1);
    });

    it('should handle duplicate directory names with counter', async () => {
      const watcher = new StatusWatcher({ logger: mockLogger });

      const id1 = await watcher.addWatchPath('/home/project/status.json');
      const id2 = await watcher.addWatchPath('/var/project/status.json');

      expect(id1).toBe('project');
      expect(id2).toBe('project-1');
    });

    it('should set up chokidar event handlers', async () => {
      const watcher = new StatusWatcher({ logger: mockLogger });

      await watcher.addWatchPath('/path/status.json');

      expect(mockWatcher.on).toHaveBeenCalledWith('change', expect.any(Function));
      expect(mockWatcher.on).toHaveBeenCalledWith('add', expect.any(Function));
      expect(mockWatcher.on).toHaveBeenCalledWith('unlink', expect.any(Function));
      expect(mockWatcher.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('should load initial status if file exists', async () => {
      const mockStatus = {
        rateLimitResetTime: null,
        lastUpdated: '2025-01-24T10:00:00.000Z'
      };

      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify(mockStatus));

      const watcher = new StatusWatcher({ logger: mockLogger });
      const sessionId = await watcher.addWatchPath('/path/status.json');

      expect(watcher.statuses.has(sessionId)).toBe(true);
      expect(watcher.statuses.get(sessionId).lastUpdated).toBe(mockStatus.lastUpdated);
    });

    it('should handle missing initial status file gracefully', async () => {
      fs.existsSync.mockReturnValue(false);

      const watcher = new StatusWatcher({ logger: mockLogger });
      const sessionId = await watcher.addWatchPath('/path/status.json');

      expect(watcher.statuses.has(sessionId)).toBe(false);
      expect(mockLogger.log).not.toHaveBeenCalledWith('error', expect.anything());
    });

    it('should handle invalid initial status JSON gracefully', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('{ invalid json }');

      const watcher = new StatusWatcher({ logger: mockLogger });
      const sessionId = await watcher.addWatchPath('/path/status.json');

      expect(watcher.statuses.has(sessionId)).toBe(false);
      expect(mockLogger.log).toHaveBeenCalledWith('warning', expect.stringContaining('Failed to read initial status'));
    });
  });

  describe('removeWatchPath', () => {
    it('should remove watch path by path', async () => {
      const watcher = new StatusWatcher({ logger: mockLogger });
      const watchPath = '/path/status.json';

      await watcher.addWatchPath(watchPath);
      const result = await watcher.removeWatchPath(watchPath);

      expect(result).toBe(true);
      expect(watcher.watchers.size).toBe(0);
      expect(watcher.sessions.size).toBe(0);
      expect(watcher.statuses.size).toBe(0);
      expect(mockWatcher.close).toHaveBeenCalled();
    });

    it('should remove watch path by session ID', async () => {
      const watcher = new StatusWatcher({ logger: mockLogger });

      const sessionId = await watcher.addWatchPath('/path/status.json');
      const result = await watcher.removeWatchPath(sessionId);

      expect(result).toBe(true);
      expect(watcher.sessions.size).toBe(0);
    });

    it('should return false if path not found', async () => {
      const watcher = new StatusWatcher({ logger: mockLogger });

      const result = await watcher.removeWatchPath('/nonexistent/path');

      expect(result).toBe(false);
      expect(mockLogger.log).toHaveBeenCalledWith('warning', expect.stringContaining('not found'));
    });

    it('should clear debounce timer when removing path', async () => {
      const watcher = new StatusWatcher({ logger: mockLogger });
      const watchPath = '/path/status.json';

      await watcher.addWatchPath(watchPath);

      const normalizedPath = path.normalize(watchPath);
      const timer = setTimeout(() => {}, 1000);
      watcher.debounceTimers.set(normalizedPath, timer);

      await watcher.removeWatchPath(watchPath);

      expect(watcher.debounceTimers.has(normalizedPath)).toBe(false);
    });

    it('should handle watcher close errors gracefully', async () => {
      const watcher = new StatusWatcher({ logger: mockLogger });

      await watcher.addWatchPath('/path/status.json');

      mockWatcher.close.mockRejectedValue(new Error('Close failed'));

      const result = await watcher.removeWatchPath('/path/status.json');

      expect(result).toBe(false);
      expect(mockLogger.log).toHaveBeenCalledWith('error', expect.stringContaining('Failed to remove'));
    });
  });

  describe('getAllStatuses', () => {
    it('should return empty object when no sessions', () => {
      const watcher = new StatusWatcher();
      const statuses = watcher.getAllStatuses();

      expect(statuses).toEqual({});
    });

    it('should return all statuses with session info', async () => {
      const watcher = new StatusWatcher({ logger: mockLogger });

      fs.readFileSync.mockReturnValue(JSON.stringify({
        rateLimitResetTime: null,
        lastUpdated: '2025-01-24T10:00:00.000Z'
      }));

      await watcher.addWatchPath('/path1/status.json', 'session1');
      await watcher.addWatchPath('/path2/status.json', 'session2');

      const statuses = watcher.getAllStatuses();

      expect(Object.keys(statuses).length).toBe(2);
      expect(statuses['session1']).toHaveProperty('sessionInfo');
      expect(statuses['session1'].sessionInfo.id).toBe('session1');
      expect(statuses['session1'].sessionInfo.label).toBe('session1');
      expect(statuses['session2']).toHaveProperty('sessionInfo');
    });

    it('should include status properties in result', async () => {
      const mockStatus = {
        rateLimitResetTime: '2025-01-24T12:00:00.000Z',
        lastUpdated: '2025-01-24T10:00:00.000Z',
        customField: 'value'
      };

      fs.readFileSync.mockReturnValue(JSON.stringify(mockStatus));

      const watcher = new StatusWatcher({ logger: mockLogger });
      await watcher.addWatchPath('/path/status.json', 'test');

      const statuses = watcher.getAllStatuses();

      expect(statuses['test'].rateLimitResetTime).toBe(mockStatus.rateLimitResetTime);
      expect(statuses['test'].lastUpdated).toBe(mockStatus.lastUpdated);
      expect(statuses['test'].customField).toBe('value');
    });
  });

  describe('getStatus', () => {
    it('should return null for non-existent session', () => {
      const watcher = new StatusWatcher();
      const status = watcher.getStatus('nonexistent');

      expect(status).toBeNull();
    });

    it('should return status with session info for existing session', async () => {
      const mockStatus = {
        rateLimitResetTime: null,
        lastUpdated: '2025-01-24T10:00:00.000Z'
      };

      fs.readFileSync.mockReturnValue(JSON.stringify(mockStatus));

      const watcher = new StatusWatcher({ logger: mockLogger });
      const sessionId = await watcher.addWatchPath('/path/status.json', 'test');

      const status = watcher.getStatus(sessionId);

      expect(status).not.toBeNull();
      expect(status.sessionInfo.id).toBe('test');
      expect(status.lastUpdated).toBe(mockStatus.lastUpdated);
    });

    it('should include all status properties', async () => {
      const mockStatus = {
        rateLimitResetTime: '2025-01-24T12:00:00.000Z',
        lastUpdated: '2025-01-24T10:00:00.000Z',
        customField: 'value'
      };

      fs.readFileSync.mockReturnValue(JSON.stringify(mockStatus));

      const watcher = new StatusWatcher({ logger: mockLogger });
      const sessionId = await watcher.addWatchPath('/path/status.json');

      const status = watcher.getStatus(sessionId);

      expect(status.rateLimitResetTime).toBe(mockStatus.rateLimitResetTime);
      expect(status.customField).toBe('value');
    });
  });

  describe('Events', () => {
    describe('statusChange event', () => {
      it('should emit statusChange when file changes', async () => {
        const watcher = new StatusWatcher({ logger: mockLogger, debounceDelay: 10 });
        const sessionId = await watcher.addWatchPath('/path/status.json');

        const statusChangeHandler = jest.fn();
        watcher.on('statusChange', statusChangeHandler);

        const newStatus = {
          rateLimitResetTime: '2025-01-24T12:00:00.000Z',
          lastUpdated: '2025-01-24T11:00:00.000Z'
        };

        fs.readFileSync.mockReturnValue(JSON.stringify(newStatus));

        // Trigger file change
        mockWatcher.emit('change', path.normalize('/path/status.json'));

        // Wait for debounce
        await new Promise(resolve => setTimeout(resolve, 20));

        expect(statusChangeHandler).toHaveBeenCalledWith(
          sessionId,
          expect.objectContaining(newStatus),
          expect.any(Object)
        );
      });

      it('should emit statusChange with null when file deleted', async () => {
        const watcher = new StatusWatcher({ logger: mockLogger });
        const sessionId = await watcher.addWatchPath('/path/status.json');

        const statusChangeHandler = jest.fn();
        watcher.on('statusChange', statusChangeHandler);

        // Trigger file unlink
        mockWatcher.emit('unlink', path.normalize('/path/status.json'));

        expect(statusChangeHandler).toHaveBeenCalledWith(
          sessionId,
          null,
          expect.any(Object)
        );
      });

      it('should include previous status in statusChange event', async () => {
        const initialStatus = {
          rateLimitResetTime: null,
          lastUpdated: '2025-01-24T10:00:00.000Z'
        };

        fs.readFileSync.mockReturnValue(JSON.stringify(initialStatus));

        const watcher = new StatusWatcher({ logger: mockLogger, debounceDelay: 10 });
        const sessionId = await watcher.addWatchPath('/path/status.json');

        const statusChangeHandler = jest.fn();
        watcher.on('statusChange', statusChangeHandler);

        const newStatus = {
          rateLimitResetTime: '2025-01-24T12:00:00.000Z',
          lastUpdated: '2025-01-24T11:00:00.000Z'
        };

        fs.readFileSync.mockReturnValue(JSON.stringify(newStatus));

        mockWatcher.emit('change', path.normalize('/path/status.json'));

        await new Promise(resolve => setTimeout(resolve, 20));

        expect(statusChangeHandler).toHaveBeenCalledWith(
          sessionId,
          expect.objectContaining(newStatus),
          expect.objectContaining(initialStatus)
        );
      });
    });

    describe('rateLimitDetected event', () => {
      it('should emit rateLimitDetected when rate limit appears', async () => {
        const initialStatus = {
          rateLimitResetTime: null,
          lastUpdated: '2025-01-24T10:00:00.000Z'
        };

        fs.readFileSync.mockReturnValue(JSON.stringify(initialStatus));

        const watcher = new StatusWatcher({ logger: mockLogger, debounceDelay: 10 });
        const sessionId = await watcher.addWatchPath('/path/status.json');

        const rateLimitHandler = jest.fn();
        watcher.on('rateLimitDetected', rateLimitHandler);

        const newStatus = {
          rateLimitResetTime: '2025-01-24T12:00:00.000Z',
          lastUpdated: '2025-01-24T11:00:00.000Z'
        };

        fs.readFileSync.mockReturnValue(JSON.stringify(newStatus));

        mockWatcher.emit('change', path.normalize('/path/status.json'));

        await new Promise(resolve => setTimeout(resolve, 20));

        expect(rateLimitHandler).toHaveBeenCalledWith(sessionId, '2025-01-24T12:00:00.000Z');
      });

      it('should emit rateLimitDetected when reset time changes', async () => {
        const initialStatus = {
          rateLimitResetTime: '2025-01-24T12:00:00.000Z',
          lastUpdated: '2025-01-24T10:00:00.000Z'
        };

        fs.readFileSync.mockReturnValue(JSON.stringify(initialStatus));

        const watcher = new StatusWatcher({ logger: mockLogger, debounceDelay: 10 });
        const sessionId = await watcher.addWatchPath('/path/status.json');

        const rateLimitHandler = jest.fn();
        watcher.on('rateLimitDetected', rateLimitHandler);

        const newStatus = {
          rateLimitResetTime: '2025-01-24T13:00:00.000Z',
          lastUpdated: '2025-01-24T11:00:00.000Z'
        };

        fs.readFileSync.mockReturnValue(JSON.stringify(newStatus));

        mockWatcher.emit('change', path.normalize('/path/status.json'));

        await new Promise(resolve => setTimeout(resolve, 20));

        expect(rateLimitHandler).toHaveBeenCalledWith(sessionId, '2025-01-24T13:00:00.000Z');
      });

      it('should not emit rateLimitDetected if reset time unchanged', async () => {
        const initialStatus = {
          rateLimitResetTime: '2025-01-24T12:00:00.000Z',
          lastUpdated: '2025-01-24T10:00:00.000Z'
        };

        fs.readFileSync.mockReturnValue(JSON.stringify(initialStatus));

        const watcher = new StatusWatcher({ logger: mockLogger, debounceDelay: 10 });
        const sessionId = await watcher.addWatchPath('/path/status.json');

        const rateLimitHandler = jest.fn();
        watcher.on('rateLimitDetected', rateLimitHandler);

        const newStatus = {
          rateLimitResetTime: '2025-01-24T12:00:00.000Z',
          lastUpdated: '2025-01-24T11:00:00.000Z'
        };

        fs.readFileSync.mockReturnValue(JSON.stringify(newStatus));

        mockWatcher.emit('change', path.normalize('/path/status.json'));

        await new Promise(resolve => setTimeout(resolve, 20));

        expect(rateLimitHandler).not.toHaveBeenCalled();
      });
    });

    describe('rateLimitCleared event', () => {
      it('should emit rateLimitCleared when rate limit removed', async () => {
        const initialStatus = {
          rateLimitResetTime: '2025-01-24T12:00:00.000Z',
          lastUpdated: '2025-01-24T10:00:00.000Z'
        };

        fs.readFileSync.mockReturnValue(JSON.stringify(initialStatus));

        const watcher = new StatusWatcher({ logger: mockLogger, debounceDelay: 10 });
        const sessionId = await watcher.addWatchPath('/path/status.json');

        const rateLimitClearedHandler = jest.fn();
        watcher.on('rateLimitCleared', rateLimitClearedHandler);

        const newStatus = {
          rateLimitResetTime: null,
          lastUpdated: '2025-01-24T11:00:00.000Z'
        };

        fs.readFileSync.mockReturnValue(JSON.stringify(newStatus));

        mockWatcher.emit('change', path.normalize('/path/status.json'));

        await new Promise(resolve => setTimeout(resolve, 20));

        expect(rateLimitClearedHandler).toHaveBeenCalledWith(sessionId);
      });

      it('should not emit rateLimitCleared if no previous rate limit', async () => {
        const initialStatus = {
          rateLimitResetTime: null,
          lastUpdated: '2025-01-24T10:00:00.000Z'
        };

        fs.readFileSync.mockReturnValue(JSON.stringify(initialStatus));

        const watcher = new StatusWatcher({ logger: mockLogger, debounceDelay: 10 });
        await watcher.addWatchPath('/path/status.json');

        const rateLimitClearedHandler = jest.fn();
        watcher.on('rateLimitCleared', rateLimitClearedHandler);

        const newStatus = {
          rateLimitResetTime: null,
          lastUpdated: '2025-01-24T11:00:00.000Z'
        };

        fs.readFileSync.mockReturnValue(JSON.stringify(newStatus));

        mockWatcher.emit('change', path.normalize('/path/status.json'));

        await new Promise(resolve => setTimeout(resolve, 20));

        expect(rateLimitClearedHandler).not.toHaveBeenCalled();
      });
    });

    describe('error event', () => {
      it('should emit error on watcher error', async () => {
        const watcher = new StatusWatcher({ logger: mockLogger });
        const sessionId = await watcher.addWatchPath('/path/status.json');

        const errorHandler = jest.fn();
        watcher.on('error', errorHandler);

        const testError = new Error('Watch error');
        mockWatcher.emit('error', testError);

        expect(errorHandler).toHaveBeenCalledWith(sessionId, testError);
      });

      it('should emit error on file parsing error', async () => {
        const watcher = new StatusWatcher({ logger: mockLogger, debounceDelay: 10 });
        const sessionId = await watcher.addWatchPath('/path/status.json');

        const errorHandler = jest.fn();
        watcher.on('error', errorHandler);

        fs.readFileSync.mockReturnValue('{ invalid json }');

        mockWatcher.emit('change', path.normalize('/path/status.json'));

        await new Promise(resolve => setTimeout(resolve, 20));

        expect(errorHandler).toHaveBeenCalledWith(sessionId, expect.any(Error));
      });
    });
  });

  describe('Error handling', () => {
    it('should handle invalid JSON gracefully', async () => {
      const watcher = new StatusWatcher({ logger: mockLogger, debounceDelay: 10 });
      const sessionId = await watcher.addWatchPath('/path/status.json');

      const errorHandler = jest.fn();
      watcher.on('error', errorHandler);

      fs.readFileSync.mockReturnValue('{ "incomplete": ');

      mockWatcher.emit('change', path.normalize('/path/status.json'));

      await new Promise(resolve => setTimeout(resolve, 20));

      expect(errorHandler).toHaveBeenCalled();
      expect(errorHandler.mock.calls[0][1].message).toContain('Invalid JSON');
    });

    it('should handle empty status files', async () => {
      fs.readFileSync.mockReturnValue('');

      const watcher = new StatusWatcher({ logger: mockLogger, debounceDelay: 10 });
      const sessionId = await watcher.addWatchPath('/path/status.json');

      const statusChangeHandler = jest.fn();
      watcher.on('statusChange', statusChangeHandler);

      fs.readFileSync.mockReturnValue('');

      mockWatcher.emit('change', path.normalize('/path/status.json'));

      await new Promise(resolve => setTimeout(resolve, 20));

      expect(statusChangeHandler).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({}),
        expect.anything()
      );
    });

    it('should handle missing status files', async () => {
      fs.readFileSync.mockImplementation(() => {
        throw { code: 'ENOENT', message: 'File not found' };
      });

      const watcher = new StatusWatcher({ logger: mockLogger, debounceDelay: 10 });
      await watcher.addWatchPath('/path/status.json');

      const errorHandler = jest.fn();
      watcher.on('error', errorHandler);

      mockWatcher.emit('change', path.normalize('/path/status.json'));

      await new Promise(resolve => setTimeout(resolve, 20));

      expect(errorHandler).toHaveBeenCalled();
    });

    it('should handle file read permission errors', async () => {
      fs.readFileSync.mockImplementation(() => {
        throw { code: 'EACCES', message: 'Permission denied' };
      });

      const watcher = new StatusWatcher({ logger: mockLogger, debounceDelay: 10 });
      await watcher.addWatchPath('/path/status.json');

      const errorHandler = jest.fn();
      watcher.on('error', errorHandler);

      mockWatcher.emit('change', path.normalize('/path/status.json'));

      await new Promise(resolve => setTimeout(resolve, 20));

      expect(errorHandler).toHaveBeenCalled();
    });
  });

  describe('Debouncing', () => {
    it('should debounce rapid file changes', async () => {
      const watcher = new StatusWatcher({ logger: mockLogger, debounceDelay: 50 });
      await watcher.addWatchPath('/path/status.json');

      const statusChangeHandler = jest.fn();
      watcher.on('statusChange', statusChangeHandler);

      // Trigger multiple rapid changes
      mockWatcher.emit('change', path.normalize('/path/status.json'));
      mockWatcher.emit('change', path.normalize('/path/status.json'));
      mockWatcher.emit('change', path.normalize('/path/status.json'));

      // Wait for debounce
      await new Promise(resolve => setTimeout(resolve, 60));

      // Should only process once
      expect(statusChangeHandler).toHaveBeenCalledTimes(1);
    });

    it('should clear previous debounce timer on new change', async () => {
      const watcher = new StatusWatcher({ logger: mockLogger, debounceDelay: 100 });
      const watchPath = '/path/status.json';

      await watcher.addWatchPath(watchPath);

      mockWatcher.emit('change', path.normalize(watchPath));
      await new Promise(resolve => setTimeout(resolve, 50));

      // Second change should reset timer
      mockWatcher.emit('change', path.normalize(watchPath));
      await new Promise(resolve => setTimeout(resolve, 50));

      const normalizedPath = path.normalize(watchPath);
      expect(watcher.debounceTimers.has(normalizedPath)).toBe(true);
    });
  });

  describe('Logging', () => {
    it('should log with custom logger', async () => {
      const watcher = new StatusWatcher({ logger: mockLogger });

      await watcher.start();

      expect(mockLogger.log).toHaveBeenCalledWith('info', expect.stringContaining('[StatusWatcher]'));
    });

    it('should fallback to console if logger unavailable', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      // Create watcher with a logger that has neither log() nor level methods
      const watcher = new StatusWatcher({ logger: {} });
      watcher._log('info', 'test message');

      // The logger implementation calls console.log with timestamp, level, and message
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringMatching(/\[.*\] \[INFO\] \[StatusWatcher\] test message/));

      consoleSpy.mockRestore();
    });

    it('should handle logging errors silently', () => {
      const badLogger = {
        log: jest.fn(() => {
          throw new Error('Logging failed');
        })
      };

      const watcher = new StatusWatcher({ logger: badLogger });

      // Should not throw
      expect(() => watcher._log('info', 'test')).not.toThrow();
    });
  });
});
