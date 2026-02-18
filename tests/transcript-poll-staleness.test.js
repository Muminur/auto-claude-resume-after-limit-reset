const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Tests for transcript poll staleness bug fix.
 *
 * The bug: startTranscriptPolling() in auto-resume-daemon.js calls
 * analyzeTranscript() on .jsonl files and writes the result to status.json
 * without checking whether reset_time is already in the past. Old rate limit
 * messages persist in transcripts, so the poll re-detects them and writes a
 * stale reset_time, causing an infinite resume-flooding loop.
 *
 * The fix: a validation function isResetTimeStale(resetTime, thresholdMs)
 * that rejects reset times too far in the past.
 */

// This import should FAIL — the function does not exist yet (TDD Red phase)
const { isResetTimeStale } = require('../auto-resume-daemon');

describe('transcript poll staleness - isResetTimeStale', () => {
  const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

  describe('stale reset_time rejection', () => {
    it('should return true for a reset_time 3 hours in the past', () => {
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
      expect(isResetTimeStale(threeHoursAgo, TWO_HOURS_MS)).toBe(true);
    });

    it('should return true for a reset_time 24 hours in the past', () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      expect(isResetTimeStale(yesterday, TWO_HOURS_MS)).toBe(true);
    });

    it('should return true for a reset_time 1 week in the past', () => {
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      expect(isResetTimeStale(oneWeekAgo, TWO_HOURS_MS)).toBe(true);
    });
  });

  describe('fresh reset_time acceptance', () => {
    it('should return false for a reset_time 1 hour in the future', () => {
      const oneHourFromNow = new Date(Date.now() + 1 * 60 * 60 * 1000).toISOString();
      expect(isResetTimeStale(oneHourFromNow, TWO_HOURS_MS)).toBe(false);
    });

    it('should return false for a reset_time 5 hours in the future', () => {
      const fiveHoursFromNow = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString();
      expect(isResetTimeStale(fiveHoursFromNow, TWO_HOURS_MS)).toBe(false);
    });

    it('should return false for a reset_time exactly now', () => {
      const now = new Date().toISOString();
      expect(isResetTimeStale(now, TWO_HOURS_MS)).toBe(false);
    });
  });

  describe('grace period (recently expired)', () => {
    it('should return false for a reset_time 30 minutes in the past (within 2h grace)', () => {
      const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      expect(isResetTimeStale(thirtyMinAgo, TWO_HOURS_MS)).toBe(false);
    });

    it('should return false for a reset_time 1 hour 59 minutes in the past (within 2h grace)', () => {
      const almostTwoHoursAgo = new Date(Date.now() - (2 * 60 * 60 * 1000 - 60000)).toISOString();
      expect(isResetTimeStale(almostTwoHoursAgo, TWO_HOURS_MS)).toBe(false);
    });

    it('should return true for a reset_time exactly 2 hours in the past (at boundary)', () => {
      const exactlyTwoHoursAgo = new Date(Date.now() - TWO_HOURS_MS).toISOString();
      expect(isResetTimeStale(exactlyTwoHoursAgo, TWO_HOURS_MS)).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle a custom threshold (e.g. 30 minutes)', () => {
      const THIRTY_MIN_MS = 30 * 60 * 1000;
      const fortyMinAgo = new Date(Date.now() - 40 * 60 * 1000).toISOString();
      expect(isResetTimeStale(fortyMinAgo, THIRTY_MIN_MS)).toBe(true);
    });

    it('should handle epoch time (1970) as stale', () => {
      const epoch = new Date(0).toISOString();
      expect(isResetTimeStale(epoch, TWO_HOURS_MS)).toBe(true);
    });

    it('should handle invalid date string gracefully', () => {
      expect(isResetTimeStale('not-a-date', TWO_HOURS_MS)).toBe(true);
    });

    it('should handle null/undefined gracefully', () => {
      expect(isResetTimeStale(null, TWO_HOURS_MS)).toBe(true);
      expect(isResetTimeStale(undefined, TWO_HOURS_MS)).toBe(true);
    });
  });
});
