const fs = require('fs');
const os = require('os');

jest.mock('fs');
jest.mock('os');

os.homedir = jest.fn().mockReturnValue('/home/testuser');

describe('Rate Limit Pattern Versioning', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    os.homedir.mockReturnValue('/home/testuser');
  });

  describe('loadPatterns', () => {
    const { loadPatterns, matchesRateLimitPattern, DEFAULT_PATTERNS } = require('../src/modules/pattern-matcher');

    it('should load custom patterns from config', () => {
      const config = {
        detection: {
          patternVersion: '1.0.0',
          patterns: ['custom rate limit (\\d+)']
        }
      };

      const patterns = loadPatterns(config);

      expect(patterns.length).toBe(1);
      expect(patterns[0]).toBeInstanceOf(RegExp);
    });

    it('should match using custom pattern from config', () => {
      const config = {
        detection: {
          patternVersion: '1.0.0',
          patterns: ['custom rate limit (\\d+)']
        }
      };

      const patterns = loadPatterns(config);
      const result = matchesRateLimitPattern('custom rate limit 42', patterns);

      expect(result).toBe(true);
    });

    it('should fall back to hardcoded patterns when config missing', () => {
      const patterns = loadPatterns({});

      expect(patterns.length).toBe(DEFAULT_PATTERNS.length);
      expect(patterns.length).toBeGreaterThan(0);
    });

    it('should fall back to hardcoded patterns when config patterns invalid', () => {
      const config = {
        detection: {
          patterns: ['[invalid regex']
        }
      };

      const patterns = loadPatterns(config);

      // Should fall back to defaults since regex is invalid
      expect(patterns.length).toBe(DEFAULT_PATTERNS.length);
    });

    it('should match standard rate limit messages with default patterns', () => {
      const patterns = loadPatterns({});

      expect(matchesRateLimitPattern("You've hit your usage limit resets 7pm (UTC)", patterns)).toBe(true);
      expect(matchesRateLimitPattern("Rate limit exceeded", patterns)).toBe(true);
      expect(matchesRateLimitPattern("too many requests", patterns)).toBe(true);
    });

    it('should not match non-rate-limit messages', () => {
      const patterns = loadPatterns({});

      expect(matchesRateLimitPattern("Hello world", patterns)).toBe(false);
      expect(matchesRateLimitPattern("Fix the rate limit hook code", patterns)).toBe(false);
    });
  });
});
