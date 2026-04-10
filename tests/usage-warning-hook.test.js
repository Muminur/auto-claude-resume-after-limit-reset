const fs = require('fs');
const path = require('path');
const os = require('os');

jest.mock('fs');
jest.mock('os');

// Set mock before requiring module
os.homedir = jest.fn().mockReturnValue('/home/testuser');

const { checkUsageWarning, incrementSessionUsage } = require('../src/modules/usage-warning');

describe('Proactive Usage Warning Hook', () => {
  const mockHomeDir = '/home/testuser';
  const analyticsPath = path.join(mockHomeDir, '.claude', 'auto-resume', 'analytics.json');
  const sessionUsagePath = path.join(mockHomeDir, '.claude', 'auto-resume', 'session-usage.json');

  beforeEach(() => {
    jest.clearAllMocks();
    os.homedir.mockReturnValue(mockHomeDir);
    fs.mkdirSync.mockReturnValue(undefined);
    fs.writeFileSync.mockReturnValue(undefined);
  });

  describe('checkUsageWarning', () => {
    it('should emit warning at 80% of average threshold', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockImplementation((filePath) => {
        if (filePath === analyticsPath) {
          return JSON.stringify({ avgToolsBeforeRateLimit: 50 });
        }
        if (filePath === sessionUsagePath) {
          return JSON.stringify({ 'session-1': { count: 40 } });
        }
        return '{}';
      });

      const result = checkUsageWarning('session-1');

      expect(result.warning).toBe(true);
      expect(result.message).toContain('Rate limit likely');
    });

    it('should not emit warning below 80% threshold', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockImplementation((filePath) => {
        if (filePath === analyticsPath) {
          return JSON.stringify({ avgToolsBeforeRateLimit: 50 });
        }
        if (filePath === sessionUsagePath) {
          return JSON.stringify({ 'session-1': { count: 39 } });
        }
        return '{}';
      });

      const result = checkUsageWarning('session-1');

      expect(result.warning).toBe(false);
    });

    it('should return no warning when analytics file missing', () => {
      fs.existsSync.mockReturnValue(false);

      const result = checkUsageWarning('session-1');

      expect(result.warning).toBe(false);
    });

    it('should handle missing session usage data', () => {
      fs.existsSync.mockImplementation((p) => p === analyticsPath);
      fs.readFileSync.mockImplementation((filePath) => {
        if (filePath === analyticsPath) {
          return JSON.stringify({ avgToolsBeforeRateLimit: 50 });
        }
        return '{}';
      });

      const result = checkUsageWarning('new-session');

      expect(result.warning).toBe(false);
    });
  });

  describe('incrementSessionUsage', () => {
    it('should increment tool call count for session', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({ 'session-1': { count: 5 } }));

      incrementSessionUsage('session-1');

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        sessionUsagePath,
        expect.stringContaining('"count": 6'),
        'utf8'
      );
    });

    it('should initialize count for new session', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({}));

      incrementSessionUsage('new-session');

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        sessionUsagePath,
        expect.stringContaining('"count": 1'),
        'utf8'
      );
    });
  });
});
