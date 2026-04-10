const fs = require('fs');
const path = require('path');
const os = require('os');
const EventEmitter = require('events');

jest.mock('fs');
jest.mock('os');

os.homedir = jest.fn().mockReturnValue('/home/testuser');

describe('Hot-Reload Config', () => {
  let watchCallback;
  let mockFsWatcher;

  beforeEach(() => {
    jest.clearAllMocks();
    os.homedir.mockReturnValue('/home/testuser');

    mockFsWatcher = new EventEmitter();
    mockFsWatcher.close = jest.fn();

    fs.watch = jest.fn().mockImplementation((filePath, listener) => {
      watchCallback = listener;
      return mockFsWatcher;
    });
  });

  describe('createConfigWatcher', () => {
    const { createConfigWatcher } = require('../src/modules/config-hot-reload');

    it('should reload config when fs.watch fires change event', () => {
      const configPath = '/home/testuser/.claude/auto-resume/config.json';
      const newConfig = { resumePrompt: 'please continue', checkInterval: 8000 };

      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify(newConfig));

      const onReload = jest.fn();
      const watcher = createConfigWatcher(configPath, onReload);

      // Simulate config file change
      watchCallback('change', 'config.json');

      expect(onReload).toHaveBeenCalledWith(newConfig);

      watcher.close();
    });

    it('should not call onReload when config file is invalid JSON', () => {
      const configPath = '/home/testuser/.claude/auto-resume/config.json';

      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('{ invalid json }');

      const onReload = jest.fn();
      const watcher = createConfigWatcher(configPath, onReload);

      watchCallback('change', 'config.json');

      expect(onReload).not.toHaveBeenCalled();

      watcher.close();
    });

    it('should fall back to polling when fs.watch throws', () => {
      jest.useFakeTimers();
      fs.watch = jest.fn().mockImplementation(() => {
        throw new Error('not supported');
      });

      const configPath = '/tmp/config.json';
      const newConfig = { resumePrompt: 'go' };

      fs.existsSync.mockReturnValue(true);
      fs.statSync = jest.fn()
        .mockReturnValueOnce({ mtimeMs: 1000 })
        .mockReturnValueOnce({ mtimeMs: 2000 });
      fs.readFileSync.mockReturnValue(JSON.stringify(newConfig));

      const onReload = jest.fn();
      const watcher = createConfigWatcher(configPath, onReload, { pollInterval: 1000 });

      expect(watcher.mode).toBe('poll');

      // First poll sets baseline
      jest.advanceTimersByTime(1000);
      // Second poll detects change
      jest.advanceTimersByTime(1000);

      expect(onReload).toHaveBeenCalledWith(newConfig);

      watcher.close();
      jest.useRealTimers();
    });

    it('should close watcher on close()', () => {
      const configPath = '/tmp/config.json';
      const watcher = createConfigWatcher(configPath, jest.fn());

      watcher.close();

      expect(mockFsWatcher.close).toHaveBeenCalled();
    });
  });
});
