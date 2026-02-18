const fs = require('fs');
const path = require('path');
const os = require('os');

// The daemon currently only exports { main }.
// These tests expect isResetTimeStale to be exported — they MUST fail (TDD Red phase).
const { isResetTimeStale } = require('../auto-resume-daemon');

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

describe('daemon staleness guard - isResetTimeStale', () => {
  describe('stale status rejection', () => {
    it('should return true when reset_time is older than the threshold', () => {
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
      expect(isResetTimeStale(threeHoursAgo, TWO_HOURS_MS)).toBe(true);
    });

    it('should return false when reset_time is within the threshold', () => {
      const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
      expect(isResetTimeStale(oneHourAgo, TWO_HOURS_MS)).toBe(false);
    });

    it('should return false when reset_time is in the future', () => {
      const oneHourFromNow = new Date(Date.now() + 1 * 60 * 60 * 1000).toISOString();
      expect(isResetTimeStale(oneHourFromNow, TWO_HOURS_MS)).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should return true when reset_time is exactly at the threshold boundary', () => {
      // Exactly 2 hours ago (at the boundary) should be considered stale
      const exactlyAtThreshold = new Date(Date.now() - TWO_HOURS_MS).toISOString();
      expect(isResetTimeStale(exactlyAtThreshold, TWO_HOURS_MS)).toBe(true);
    });

    it('should handle invalid ISO strings gracefully', () => {
      // Invalid date strings should be treated as stale (reject them)
      expect(isResetTimeStale('not-a-date', TWO_HOURS_MS)).toBe(true);
    });

    it('should handle null/undefined gracefully', () => {
      expect(isResetTimeStale(null, TWO_HOURS_MS)).toBe(true);
      expect(isResetTimeStale(undefined, TWO_HOURS_MS)).toBe(true);
    });
  });
});

describe('daemon staleness guard - readStatus integration', () => {
  const tmpDir = path.join(os.tmpdir(), 'daemon-staleness-test-' + process.pid);
  const statusFile = path.join(tmpDir, 'status.json');

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    try {
      if (fs.existsSync(statusFile)) fs.unlinkSync(statusFile);
      fs.rmdirSync(tmpDir);
    } catch (e) {
      // cleanup best-effort
    }
  });

  it('should reject status.json with reset_time 5 hours in the past', () => {
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    const staleStatus = {
      detected: true,
      reset_time: fiveHoursAgo,
      message: "You've hit your limit",
      timezone: 'UTC'
    };
    fs.writeFileSync(statusFile, JSON.stringify(staleStatus));

    // isResetTimeStale should flag this as stale
    expect(isResetTimeStale(staleStatus.reset_time, TWO_HOURS_MS)).toBe(true);
  });

  it('should accept status.json with reset_time in the future', () => {
    const oneHourFromNow = new Date(Date.now() + 1 * 60 * 60 * 1000).toISOString();
    const freshStatus = {
      detected: true,
      reset_time: oneHourFromNow,
      message: "You've hit your limit",
      timezone: 'UTC'
    };
    fs.writeFileSync(statusFile, JSON.stringify(freshStatus));

    expect(isResetTimeStale(freshStatus.reset_time, TWO_HOURS_MS)).toBe(false);
  });

  it('should accept status.json with reset_time recently in the past (within threshold)', () => {
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const recentStatus = {
      detected: true,
      reset_time: thirtyMinAgo,
      message: "You've hit your limit",
      timezone: 'UTC'
    };
    fs.writeFileSync(statusFile, JSON.stringify(recentStatus));

    expect(isResetTimeStale(recentStatus.reset_time, TWO_HOURS_MS)).toBe(false);
  });
});
