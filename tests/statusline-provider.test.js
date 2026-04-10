const fs = require('fs');
const path = require('path');
const os = require('os');

jest.mock('fs');
jest.mock('os');

os.homedir = jest.fn().mockReturnValue('/home/testuser');

const { getStatusLine } = require('../src/modules/statusline-provider');

describe('Daemon Health Status Line', () => {
  const mockHomeDir = '/home/testuser';
  const statusPath = path.join(mockHomeDir, '.claude', 'auto-resume', 'status.json');
  const pidPath = path.join(mockHomeDir, '.claude', 'auto-resume', 'daemon.pid');

  beforeEach(() => {
    jest.clearAllMocks();
    os.homedir.mockReturnValue(mockHomeDir);
  });

  it('should return countdown string when rate limit active with future reset_time', () => {
    const futureTime = new Date(Date.now() + 3600000 + 120000).toISOString(); // 1h 2m from now

    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockImplementation((filePath) => {
      if (filePath === statusPath) {
        return JSON.stringify({ detected: true, reset_time: futureTime });
      }
      if (filePath === pidPath) {
        return '12345';
      }
      return '';
    });

    const originalKill = process.kill;
    process.kill = jest.fn();

    const result = getStatusLine();

    // Should match countdown format like "⏱ 1h 2m"
    expect(result).toMatch(/⏱ \d+h \d+m/);

    process.kill = originalKill;
  });

  it('should return idle when daemon PID alive and no rate limit', () => {
    fs.existsSync.mockImplementation((p) => {
      if (p === pidPath) return true;
      if (p === statusPath) return false;
      return false;
    });
    fs.readFileSync.mockImplementation((filePath) => {
      if (filePath === pidPath) return '12345';
      return '';
    });

    const originalKill = process.kill;
    process.kill = jest.fn(); // No throw = alive

    const result = getStatusLine();

    expect(result).toBe('\u2713 idle');

    process.kill = originalKill;
  });

  it('should return stopped when daemon PID not alive', () => {
    fs.existsSync.mockImplementation((p) => {
      if (p === pidPath) return true;
      if (p === statusPath) return false;
      return false;
    });
    fs.readFileSync.mockImplementation((filePath) => {
      if (filePath === pidPath) return '99999';
      return '';
    });

    const originalKill = process.kill;
    process.kill = jest.fn(() => { throw new Error('ESRCH'); });

    const result = getStatusLine();

    expect(result).toBe('\u2717 stopped');

    process.kill = originalKill;
  });

  it('should return stopped when no PID file exists', () => {
    fs.existsSync.mockReturnValue(false);

    const result = getStatusLine();

    expect(result).toBe('\u2717 stopped');
  });

  it('should return stopped when rate limit reset_time is in the past', () => {
    const pastTime = new Date(Date.now() - 60000).toISOString(); // 1 min ago

    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockImplementation((filePath) => {
      if (filePath === statusPath) {
        return JSON.stringify({ detected: true, reset_time: pastTime });
      }
      if (filePath === pidPath) return '12345';
      return '';
    });

    const originalKill = process.kill;
    process.kill = jest.fn();

    const result = getStatusLine();

    // Past reset time should show idle (daemon running, rate limit expired)
    expect(result).toBe('\u2713 idle');

    process.kill = originalKill;
  });
});
