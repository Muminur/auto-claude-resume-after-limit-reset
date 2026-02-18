const { isResumeInProgress, setResumeInProgress } = require('../auto-resume-daemon');

/**
 * Tests for the isResumeInProgress mutex that prevents concurrent
 * attemptResume() calls from spamming terminals.
 *
 * The bug: After successful keystroke delivery, currentResetTime was set
 * to null. The Stop hook wrote new status.json, and watchStatusFile()
 * started new countdowns because the guard (!currentResetTime) was true.
 * This caused multiple concurrent attemptResume() calls.
 *
 * The fix: An isResumeInProgress flag that guards watchStatusFile() and
 * startCountdown() from triggering while a resume attempt is active.
 */

describe('resume mutex (isResumeInProgress)', () => {
  it('should export isResumeInProgress as a function', () => {
    expect(typeof isResumeInProgress).toBe('function');
  });

  it('should export setResumeInProgress as a function', () => {
    expect(typeof setResumeInProgress).toBe('function');
  });

  it('should return false by default (no resume in progress)', () => {
    // Reset to known state
    setResumeInProgress(false);
    expect(isResumeInProgress()).toBe(false);
  });

  it('should return true after being set to true', () => {
    setResumeInProgress(true);
    expect(isResumeInProgress()).toBe(true);
    // Clean up
    setResumeInProgress(false);
  });

  it('should return false after being set back to false', () => {
    setResumeInProgress(true);
    setResumeInProgress(false);
    expect(isResumeInProgress()).toBe(false);
  });
});
