const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

jest.mock('fs');
jest.mock('os');
jest.mock('child_process');

describe('Stale PID Validation', () => {
  const mockHomeDir = '/home/testuser';
  const mockPidFile = path.join(mockHomeDir, '.claude', 'auto-resume', 'daemon.pid');

  beforeEach(() => {
    jest.clearAllMocks();
    os.homedir.mockReturnValue(mockHomeDir);
  });

  describe('validatePid', () => {
    const { validatePid } = require('../src/modules/pid-validator');

    it('should return alive=true when process.kill(pid, 0) succeeds', () => {
      const originalKill = process.kill;
      process.kill = jest.fn();

      const result = validatePid(12345);
      expect(result.alive).toBe(true);
      expect(process.kill).toHaveBeenCalledWith(12345, 0);

      process.kill = originalKill;
    });

    it('should return alive=false when process.kill(pid, 0) throws', () => {
      const originalKill = process.kill;
      process.kill = jest.fn(() => { throw new Error('ESRCH'); });

      const result = validatePid(12345);
      expect(result.alive).toBe(false);

      process.kill = originalKill;
    });

    describe('Windows secondary check', () => {
      let originalPlatform;

      beforeEach(() => {
        originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      });

      afterEach(() => {
        if (originalPlatform) {
          Object.defineProperty(process, 'platform', originalPlatform);
        }
      });

      it('should use tasklist as secondary check on Windows when process.kill fails', () => {
        const originalKill = process.kill;
        process.kill = jest.fn(() => { throw new Error('ESRCH'); });

        execSync.mockReturnValue('node.exe   12345 Console  1  50,000 K');

        const result = validatePid(12345);
        expect(result.alive).toBe(true);
        expect(execSync).toHaveBeenCalledWith(
          expect.stringContaining('tasklist'),
          expect.any(Object)
        );

        process.kill = originalKill;
      });

      it('should return alive=false when tasklist finds no matching PID on Windows', () => {
        const originalKill = process.kill;
        process.kill = jest.fn(() => { throw new Error('ESRCH'); });

        execSync.mockReturnValue('INFO: No tasks are running which match the specified criteria.');

        const result = validatePid(12345);
        expect(result.alive).toBe(false);

        process.kill = originalKill;
      });
    });
  });

  describe('ensureDaemonWithPidValidation', () => {
    const { shouldStartDaemon } = require('../src/modules/pid-validator');

    it('should return true (start daemon) when PID file has dead PID', () => {
      const originalKill = process.kill;
      process.kill = jest.fn(() => { throw new Error('ESRCH'); });

      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('99999');

      const result = shouldStartDaemon(mockPidFile);
      expect(result).toBe(true);

      process.kill = originalKill;
    });

    it('should return false (skip) when PID file has live PID', () => {
      const originalKill = process.kill;
      process.kill = jest.fn(); // No throw = process alive

      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('12345');

      const result = shouldStartDaemon(mockPidFile);
      expect(result).toBe(false);

      process.kill = originalKill;
    });

    it('should return true when no PID file exists', () => {
      fs.existsSync.mockReturnValue(false);

      const result = shouldStartDaemon(mockPidFile);
      expect(result).toBe(true);
    });
  });
});
