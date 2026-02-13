const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execSync } = require('child_process');

// Mock modules before requiring the script
jest.mock('fs');
jest.mock('child_process');
jest.mock('os');

// Import the functions we're testing
const {
  findDaemonPath,
  isDaemonRunning,
  startDaemon,
  main,
  formatHookOutput
} = require('../scripts/ensure-daemon-running');

describe('ensure-daemon-running', () => {
  const mockHomeDir = '/home/testuser';
  const mockAutoResumeDir = path.join(mockHomeDir, '.claude', 'auto-resume');
  const mockPidFile = path.join(mockAutoResumeDir, 'daemon.pid');
  const mockLogFile = path.join(mockAutoResumeDir, 'daemon.log');

  let originalEnv;
  let consoleLogSpy;
  let processExitSpy;

  beforeEach(() => {
    jest.clearAllMocks();

    // Store original environment
    originalEnv = { ...process.env };

    // Mock os.homedir
    os.homedir.mockReturnValue(mockHomeDir);

    // Spy on console.log and process.exit
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    processExitSpy = jest.spyOn(process, 'exit').mockImplementation();

    // Default mock implementations
    fs.existsSync.mockReturnValue(false);
    fs.readFileSync.mockReturnValue('');
    fs.readdirSync.mockReturnValue([]);
    fs.mkdirSync.mockReturnValue(undefined);
    fs.openSync.mockReturnValue(1);

    // Mock child_process
    execSync.mockReturnValue('');
    spawn.mockReturnValue({
      pid: 12345,
      unref: jest.fn()
    });
  });

  afterEach(() => {
    // Restore environment
    process.env = originalEnv;
    consoleLogSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  describe('findDaemonPath', () => {
    it('should return plugin daemon path when CLAUDE_PLUGIN_ROOT is set and daemon exists', () => {
      const pluginRoot = '/path/to/plugin';
      process.env.CLAUDE_PLUGIN_ROOT = pluginRoot;
      const expectedPath = path.join(pluginRoot, 'auto-resume-daemon.js');

      fs.existsSync.mockImplementation(p => p === expectedPath);

      const result = findDaemonPath();

      expect(result).toBe(expectedPath);
      expect(fs.existsSync).toHaveBeenCalledWith(expectedPath);
    });

    it('should return manual install path when no plugin root and manual daemon exists', () => {
      delete process.env.CLAUDE_PLUGIN_ROOT;
      const manualPath = path.join(mockAutoResumeDir, 'auto-resume-daemon.js');

      fs.existsSync.mockImplementation(p => p === manualPath);

      const result = findDaemonPath();

      expect(result).toBe(manualPath);
    });

    it('should search plugin cache when no other locations have daemon', () => {
      delete process.env.CLAUDE_PLUGIN_ROOT;
      const pluginCache = path.join(mockHomeDir, '.claude', 'plugins', 'cache');
      const daemonInCache = path.join(pluginCache, 'some-plugin', 'auto-resume-daemon.js');

      fs.existsSync.mockImplementation(p => {
        return p === pluginCache || p === daemonInCache;
      });

      fs.readdirSync.mockImplementation((dir) => {
        if (dir === pluginCache) {
          return [{ name: 'some-plugin', isDirectory: () => true }];
        }
        if (dir === path.join(pluginCache, 'some-plugin')) {
          return [{ name: 'auto-resume-daemon.js', isDirectory: () => false }];
        }
        return [];
      });

      const result = findDaemonPath();

      expect(result).toBe(daemonInCache);
      expect(fs.existsSync).toHaveBeenCalledWith(pluginCache);
    });

    it('should search deeply nested directories in plugin cache', () => {
      delete process.env.CLAUDE_PLUGIN_ROOT;
      const pluginCache = path.join(mockHomeDir, '.claude', 'plugins', 'cache');
      const nestedPath = path.join(pluginCache, 'plugin1', 'nested', 'auto-resume-daemon.js');

      fs.existsSync.mockImplementation(p => p === pluginCache || p === nestedPath);

      fs.readdirSync.mockImplementation((dir) => {
        if (dir === pluginCache) {
          return [{ name: 'plugin1', isDirectory: () => true }];
        }
        if (dir === path.join(pluginCache, 'plugin1')) {
          return [{ name: 'nested', isDirectory: () => true }];
        }
        if (dir === path.join(pluginCache, 'plugin1', 'nested')) {
          return [{ name: 'auto-resume-daemon.js', isDirectory: () => false }];
        }
        return [];
      });

      const result = findDaemonPath();

      expect(result).toBe(nestedPath);
    });

    it('should return null when daemon not found anywhere', () => {
      delete process.env.CLAUDE_PLUGIN_ROOT;
      fs.existsSync.mockReturnValue(false);

      const result = findDaemonPath();

      expect(result).toBeNull();
    });

    it('should ignore search errors and return null gracefully', () => {
      delete process.env.CLAUDE_PLUGIN_ROOT;
      const pluginCache = path.join(mockHomeDir, '.claude', 'plugins', 'cache');

      fs.existsSync.mockImplementation(p => p === pluginCache);
      fs.readdirSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const result = findDaemonPath();

      expect(result).toBeNull();
    });

    it('should skip directories that are not daemon files', () => {
      delete process.env.CLAUDE_PLUGIN_ROOT;
      const pluginCache = path.join(mockHomeDir, '.claude', 'plugins', 'cache');

      fs.existsSync.mockImplementation(p => p === pluginCache);
      fs.readdirSync.mockImplementation(() => [
        { name: 'some-file.txt', isDirectory: () => false },
        { name: 'some-dir', isDirectory: () => true }
      ]);

      const result = findDaemonPath();

      expect(result).toBeNull();
    });
  });

  describe('isDaemonRunning', () => {
    it('should return false when PID file does not exist', () => {
      fs.existsSync.mockReturnValue(false);

      const result = isDaemonRunning();

      expect(result).toBe(false);
      expect(fs.existsSync).toHaveBeenCalledWith(mockPidFile);
    });

    it('should return false when PID is invalid (NaN)', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('not-a-number');

      const result = isDaemonRunning();

      expect(result).toBe(false);
    });

    it('should return false when PID is empty string', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('   ');

      const result = isDaemonRunning();

      expect(result).toBe(false);
    });

    describe('Windows platform', () => {
      let originalPlatform;

      beforeEach(() => {
        originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
        Object.defineProperty(process, 'platform', {
          value: 'win32',
          configurable: true
        });
      });

      afterEach(() => {
        if (originalPlatform) {
          Object.defineProperty(process, 'platform', originalPlatform);
        }
      });

      it('should return true when process is running (Windows tasklist)', () => {
        fs.existsSync.mockReturnValue(true);
        fs.readFileSync.mockReturnValue('12345');
        execSync.mockReturnValue('node.exe                      12345 Console                    1     50,000 K');

        const result = isDaemonRunning();

        expect(result).toBe(true);
        expect(execSync).toHaveBeenCalledWith(
          'tasklist /FI "PID eq 12345" /NH',
          { encoding: 'utf8', stdio: 'pipe' }
        );
      });

      it('should return false when process is not running (Windows)', () => {
        fs.existsSync.mockReturnValue(true);
        fs.readFileSync.mockReturnValue('12345');
        execSync.mockReturnValue('INFO: No tasks are running which match the specified criteria.');

        const result = isDaemonRunning();

        expect(result).toBe(false);
      });

      it('should return false when tasklist throws error (Windows)', () => {
        fs.existsSync.mockReturnValue(true);
        fs.readFileSync.mockReturnValue('12345');
        execSync.mockImplementation(() => {
          throw new Error('Command failed');
        });

        const result = isDaemonRunning();

        expect(result).toBe(false);
      });
    });

    describe('Unix platform', () => {
      let originalPlatform;
      let originalKill;

      beforeEach(() => {
        originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
        Object.defineProperty(process, 'platform', {
          value: 'linux',
          configurable: true
        });
        originalKill = process.kill;
        process.kill = jest.fn();
      });

      afterEach(() => {
        if (originalPlatform) {
          Object.defineProperty(process, 'platform', originalPlatform);
        }
        process.kill = originalKill;
      });

      it('should return true when process is running (Unix kill -0)', () => {
        fs.existsSync.mockReturnValue(true);
        fs.readFileSync.mockReturnValue('12345');
        process.kill.mockReturnValue(undefined);

        const result = isDaemonRunning();

        expect(result).toBe(true);
        expect(process.kill).toHaveBeenCalledWith(12345, 0);
      });

      it('should return false when process is not running (Unix)', () => {
        fs.existsSync.mockReturnValue(true);
        fs.readFileSync.mockReturnValue('12345');
        process.kill.mockImplementation(() => {
          throw new Error('ESRCH');
        });

        const result = isDaemonRunning();

        expect(result).toBe(false);
      });
    });

    it('should return false when readFileSync throws error', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const result = isDaemonRunning();

      expect(result).toBe(false);
    });
  });

  describe('startDaemon', () => {
    const daemonPath = '/path/to/auto-resume-daemon.js';

    it('should create auto-resume directory if it does not exist', () => {
      fs.existsSync.mockReturnValue(false);

      startDaemon(daemonPath);

      expect(fs.mkdirSync).toHaveBeenCalledWith(mockAutoResumeDir, { recursive: true });
    });

    it('should not create directory if it already exists', () => {
      fs.existsSync.mockReturnValue(true);

      startDaemon(daemonPath);

      expect(fs.mkdirSync).not.toHaveBeenCalled();
    });

    it('should open log file for stdout and stderr', () => {
      startDaemon(daemonPath);

      expect(fs.openSync).toHaveBeenCalledWith(mockLogFile, 'a');
      expect(fs.openSync).toHaveBeenCalledTimes(2);
    });

    it('should spawn daemon process with correct arguments', () => {
      startDaemon(daemonPath);

      expect(spawn).toHaveBeenCalledWith(
        'node',
        [daemonPath, 'start'],
        expect.objectContaining({
          detached: true,
          stdio: ['ignore', 1, 1],
          cwd: mockAutoResumeDir,
          env: expect.objectContaining({ DAEMON_AUTOSTART: 'true' })
        })
      );
    });

    it('should call unref on spawned child process', () => {
      const mockChild = {
        pid: 12345,
        unref: jest.fn()
      };
      spawn.mockReturnValue(mockChild);

      startDaemon(daemonPath);

      expect(mockChild.unref).toHaveBeenCalled();
    });

    it('should return child PID', () => {
      const mockChild = {
        pid: 99999,
        unref: jest.fn()
      };
      spawn.mockReturnValue(mockChild);

      const result = startDaemon(daemonPath);

      expect(result).toBe(99999);
    });

    it('should preserve existing environment variables', () => {
      process.env.CUSTOM_VAR = 'test-value';

      startDaemon(daemonPath);

      expect(spawn).toHaveBeenCalledWith(
        'node',
        [daemonPath, 'start'],
        expect.objectContaining({
          env: expect.objectContaining({
            CUSTOM_VAR: 'test-value',
            DAEMON_AUTOSTART: 'true'
          })
        })
      );
    });
  });

  describe('main', () => {
    it('should return running status when daemon already running', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('12345');

      // Mock Unix platform
      const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        configurable: true
      });
      const originalKill = process.kill;
      process.kill = jest.fn();

      main();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: 'Auto-resume daemon is running'
          },
          status: 'running'
        })
      );
      expect(processExitSpy).toHaveBeenCalledWith(0);

      // Cleanup
      if (originalPlatform) {
        Object.defineProperty(process, 'platform', originalPlatform);
      }
      process.kill = originalKill;
    });

    it('should return not_found when daemon path not found', () => {
      fs.existsSync.mockReturnValue(false);

      main();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: 'Auto-resume daemon not installed'
          },
          status: 'not_found'
        })
      );
      expect(processExitSpy).toHaveBeenCalledWith(0);
    });

    it('should start daemon and return started status', () => {
      const pluginRoot = '/path/to/plugin';
      process.env.CLAUDE_PLUGIN_ROOT = pluginRoot;
      const daemonPath = path.join(pluginRoot, 'auto-resume-daemon.js');

      // Daemon file exists, but not running
      fs.existsSync.mockImplementation(p => {
        if (p === daemonPath) return true;
        if (p === mockPidFile) return false;
        return false;
      });

      const mockChild = {
        pid: 54321,
        unref: jest.fn()
      };
      spawn.mockReturnValue(mockChild);

      main();

      expect(spawn).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: 'Auto-resume daemon started'
          },
          status: 'started',
          pid: 54321,
          daemonPath: daemonPath
        })
      );
      expect(processExitSpy).toHaveBeenCalledWith(0);
    });

    it('should handle errors gracefully and exit 0', () => {
      fs.existsSync.mockImplementation(() => {
        throw new Error('Unexpected filesystem error');
      });

      main();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: 'Auto-resume error: Unexpected filesystem error'
          },
          status: 'error'
        })
      );
      expect(processExitSpy).toHaveBeenCalledWith(0);
    });

    it('should exit 0 even on spawn failure', () => {
      const pluginRoot = '/path/to/plugin';
      process.env.CLAUDE_PLUGIN_ROOT = pluginRoot;
      const daemonPath = path.join(pluginRoot, 'auto-resume-daemon.js');

      fs.existsSync.mockImplementation(p => {
        if (p === daemonPath) return true;
        if (p === mockPidFile) return false;
        return false;
      });

      spawn.mockImplementation(() => {
        throw new Error('Failed to spawn process');
      });

      main();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('error')
      );
      expect(processExitSpy).toHaveBeenCalledWith(0);
    });

    it('should not fail session start on any error', () => {
      // Simulate various failure scenarios
      const errorScenarios = [
        () => fs.existsSync.mockImplementation(() => { throw new Error('existsSync error'); }),
        () => fs.readFileSync.mockImplementation(() => { throw new Error('readFileSync error'); }),
        () => spawn.mockImplementation(() => { throw new Error('spawn error'); })
      ];

      errorScenarios.forEach((setupError, index) => {
        jest.clearAllMocks();
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
        processExitSpy = jest.spyOn(process, 'exit').mockImplementation();

        setupError();
        main();

        expect(processExitSpy).toHaveBeenCalledWith(0);

        consoleLogSpy.mockRestore();
        processExitSpy.mockRestore();
      });
    });

    it('should output valid JSON in all cases', () => {
      const scenarios = [
        // Running
        () => {
          fs.existsSync.mockReturnValue(true);
          fs.readFileSync.mockReturnValue('12345');
          const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
          Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
          const originalKill = process.kill;
          process.kill = jest.fn();
          main();
          if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform);
          process.kill = originalKill;
        },
        // Not found
        () => {
          fs.existsSync.mockReturnValue(false);
          main();
        },
        // Error
        () => {
          fs.existsSync.mockImplementation(() => { throw new Error('Test error'); });
          main();
        }
      ];

      scenarios.forEach((scenario, index) => {
        jest.clearAllMocks();
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
        processExitSpy = jest.spyOn(process, 'exit').mockImplementation();

        scenario();

        expect(consoleLogSpy).toHaveBeenCalled();
        const output = consoleLogSpy.mock.calls[0][0];
        expect(() => JSON.parse(output)).not.toThrow();

        consoleLogSpy.mockRestore();
        processExitSpy.mockRestore();
      });
    });
  });

  describe('edge cases', () => {
    it('should handle PID file with whitespace', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('  12345  \n');

      const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        configurable: true
      });
      const originalKill = process.kill;
      process.kill = jest.fn();

      const result = isDaemonRunning();

      expect(process.kill).toHaveBeenCalledWith(12345, 0);

      if (originalPlatform) {
        Object.defineProperty(process, 'platform', originalPlatform);
      }
      process.kill = originalKill;
    });

    it('should handle very large PID numbers', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('2147483647'); // Max 32-bit int

      const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        configurable: true
      });
      const originalKill = process.kill;
      process.kill = jest.fn();

      isDaemonRunning();

      expect(process.kill).toHaveBeenCalledWith(2147483647, 0);

      if (originalPlatform) {
        Object.defineProperty(process, 'platform', originalPlatform);
      }
      process.kill = originalKill;
    });

    it('should handle daemon path with spaces', () => {
      const daemonPath = '/path with spaces/auto-resume-daemon.js';

      startDaemon(daemonPath);

      expect(spawn).toHaveBeenCalledWith(
        'node',
        [daemonPath, 'start'],
        expect.any(Object)
      );
    });

    it('should handle missing HOME directory', () => {
      os.homedir.mockReturnValue('');

      const result = findDaemonPath();

      // Should still attempt to construct paths, even if empty
      expect(result).toBeNull();
    });

    it('should handle circular symlinks in plugin cache search', () => {
      delete process.env.CLAUDE_PLUGIN_ROOT;
      const pluginCache = path.join(mockHomeDir, '.claude', 'plugins', 'cache');

      fs.existsSync.mockImplementation(p => p === pluginCache);

      let callCount = 0;
      fs.readdirSync.mockImplementation(() => {
        callCount++;
        // Prevent infinite loop
        if (callCount > 100) {
          throw new Error('Maximum call stack size exceeded');
        }
        return [{ name: 'self', isDirectory: () => true }];
      });

      const result = findDaemonPath();

      // Should handle gracefully without infinite loop
      expect(result).toBeNull();
    });
  });

  describe('integration scenarios', () => {
    it('should complete full startup flow from plugin location', () => {
      const pluginRoot = '/usr/local/lib/claude/plugins/auto-resume';
      process.env.CLAUDE_PLUGIN_ROOT = pluginRoot;
      const daemonPath = path.join(pluginRoot, 'auto-resume-daemon.js');

      // Daemon exists but not running
      fs.existsSync.mockImplementation(p => {
        if (p === daemonPath) return true;
        if (p === mockPidFile) return false;
        return false;
      });

      const mockChild = {
        pid: 11111,
        unref: jest.fn()
      };
      spawn.mockReturnValue(mockChild);

      main();

      expect(spawn).toHaveBeenCalledWith(
        'node',
        [daemonPath, 'start'],
        expect.any(Object)
      );
      expect(mockChild.unref).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('started')
      );
      expect(processExitSpy).toHaveBeenCalledWith(0);
    });

    it('should complete full startup flow from manual install', () => {
      delete process.env.CLAUDE_PLUGIN_ROOT;
      const daemonPath = path.join(mockAutoResumeDir, 'auto-resume-daemon.js');

      fs.existsSync.mockImplementation(p => {
        if (p === daemonPath) return true;
        if (p === mockPidFile) return false;
        return false;
      });

      const mockChild = {
        pid: 22222,
        unref: jest.fn()
      };
      spawn.mockReturnValue(mockChild);

      main();

      expect(spawn).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('"pid":22222')
      );
    });

    it('should complete full startup flow from plugin cache', () => {
      delete process.env.CLAUDE_PLUGIN_ROOT;
      const pluginCache = path.join(mockHomeDir, '.claude', 'plugins', 'cache');
      const daemonInCache = path.join(pluginCache, 'auto-resume-v1', 'auto-resume-daemon.js');

      fs.existsSync.mockImplementation(p => {
        if (p === pluginCache) return true;
        if (p === daemonInCache) return true;
        if (p === mockPidFile) return false;
        return false;
      });

      fs.readdirSync.mockImplementation((dir) => {
        if (dir === pluginCache) {
          return [{ name: 'auto-resume-v1', isDirectory: () => true }];
        }
        if (dir === path.join(pluginCache, 'auto-resume-v1')) {
          return [{ name: 'auto-resume-daemon.js', isDirectory: () => false }];
        }
        return [];
      });

      const mockChild = {
        pid: 33333,
        unref: jest.fn()
      };
      spawn.mockReturnValue(mockChild);

      main();

      expect(spawn).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('"pid":33333')
      );
    });
  });

  describe('formatHookOutput', () => {
    it('should create correct hookSpecificOutput structure', () => {
      const result = formatHookOutput('running', 'Daemon is active');

      expect(result).toEqual({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: 'Daemon is active'
        },
        status: 'running'
      });
    });

    it('should include extra fields when provided', () => {
      const result = formatHookOutput('started', 'Daemon started', {
        pid: 12345,
        daemonPath: '/path/to/daemon.js'
      });

      expect(result).toEqual({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: 'Daemon started'
        },
        status: 'started',
        pid: 12345,
        daemonPath: '/path/to/daemon.js'
      });
    });

    it('should handle error status', () => {
      const result = formatHookOutput('error', 'Something went wrong');

      expect(result).toEqual({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: 'Something went wrong'
        },
        status: 'error'
      });
    });

    it('should work with empty extra object', () => {
      const result = formatHookOutput('not_found', 'Not installed', {});

      expect(result).toEqual({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: 'Not installed'
        },
        status: 'not_found'
      });
    });
  });
});
