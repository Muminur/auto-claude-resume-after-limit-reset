const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

jest.mock('fs');

const { createStatusFileWatcher } = require('../src/modules/status-file-watcher');

describe('Event-Driven File Watching', () => {
  let mockFsWatcher;
  let watchCallback;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockFsWatcher = new EventEmitter();
    mockFsWatcher.close = jest.fn();

    // Capture the listener callback passed to fs.watch(path, listener)
    watchCallback = null;
    fs.watch = jest.fn().mockImplementation((filePath, listener) => {
      watchCallback = listener;
      return mockFsWatcher;
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should use fs.watch when available and fire callback on change', () => {
    const callback = jest.fn();
    const watcher = createStatusFileWatcher('/tmp/status.json', callback, {
      pollInterval: 5000,
      debounceMs: 50
    });

    expect(watcher.mode).toBe('watch');
    expect(fs.watch).toHaveBeenCalled();

    // Simulate fs.watch firing 'change'
    watchCallback('change', 'status.json');

    // Advance past debounce
    jest.advanceTimersByTime(100);

    expect(callback).toHaveBeenCalledTimes(1);
    watcher.close();
  });

  it('should fall back to polling when fs.watch throws', () => {
    fs.watch = jest.fn().mockImplementation(() => {
      throw new Error('fs.watch not supported');
    });
    fs.existsSync = jest.fn().mockReturnValue(false);

    const callback = jest.fn();
    const watcher = createStatusFileWatcher('/tmp/status.json', callback, { pollInterval: 1000 });

    expect(watcher.mode).toBe('poll');
    expect(watcher.interval).toBeDefined();
    expect(watcher.pollInterval).toBe(1000);

    watcher.close();
  });

  it('should debounce rapid fs.watch events', () => {
    const callback = jest.fn();
    const watcher = createStatusFileWatcher('/tmp/status.json', callback, {
      pollInterval: 5000,
      debounceMs: 100
    });

    // Fire 5 rapid events via the listener callback
    watchCallback('change', 'status.json');
    watchCallback('change', 'status.json');
    watchCallback('change', 'status.json');
    watchCallback('change', 'status.json');
    watchCallback('change', 'status.json');

    jest.advanceTimersByTime(200);

    expect(callback).toHaveBeenCalledTimes(1);
    watcher.close();
  });

  it('should use pollInterval as fallback interval', () => {
    fs.watch = jest.fn().mockImplementation(() => {
      throw new Error('not supported');
    });
    fs.existsSync = jest.fn().mockReturnValue(false);

    const callback = jest.fn();
    const watcher = createStatusFileWatcher('/tmp/status.json', callback, { pollInterval: 3000 });

    expect(watcher.mode).toBe('poll');
    expect(watcher.pollInterval).toBe(3000);

    watcher.close();
  });

  it('should close fs.watch watcher on close()', () => {
    const watcher = createStatusFileWatcher('/tmp/status.json', jest.fn(), { pollInterval: 5000 });
    watcher.close();

    expect(mockFsWatcher.close).toHaveBeenCalled();
  });

  it('should detect file changes when polling', () => {
    fs.watch = jest.fn().mockImplementation(() => {
      throw new Error('not supported');
    });
    fs.existsSync = jest.fn().mockReturnValue(true);
    fs.statSync = jest.fn()
      .mockReturnValueOnce({ mtimeMs: 1000 })
      .mockReturnValueOnce({ mtimeMs: 2000 });

    const callback = jest.fn();
    const watcher = createStatusFileWatcher('/tmp/status.json', callback, { pollInterval: 1000 });

    // First poll sets baseline
    jest.advanceTimersByTime(1000);
    expect(callback).not.toHaveBeenCalled();

    // Second poll detects change
    jest.advanceTimersByTime(1000);
    expect(callback).toHaveBeenCalledTimes(1);

    watcher.close();
  });
});
