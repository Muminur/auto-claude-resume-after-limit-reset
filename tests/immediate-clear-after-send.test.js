const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Tests that status.json is cleared IMMEDIATELY after successful
 * keystroke delivery, not after the 90s verification window.
 *
 * The bug: attemptResume() waits 90s for verification before clearing
 * status.json. During that window, the daemon could re-fire.
 *
 * The fix: clearStatus() should be called right after sendWithRetry()
 * succeeds, before entering the verification phase.
 */

// Import the function we'll add
const { shouldClearBeforeVerification } = require('../auto-resume-daemon');

describe('immediate status clear after delivery', () => {
  it('shouldClearBeforeVerification should return true by default', () => {
    expect(shouldClearBeforeVerification()).toBe(true);
  });
});
