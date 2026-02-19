const { buildResumeSequence, sendKeystrokeSequence } = require('../../src/delivery/tmux-delivery');

/**
 * Tests for the keystroke sequence builder and sender.
 *
 * The bug: sendViaTmux sends ESC → C-u → "continue" → Enter with NO delays.
 * Claude Code's TUI doesn't process the sequence correctly:
 *   - Enter adds a newline instead of submitting
 *   - The rate limit menu option "1" is never tried
 *   - No delays between keystrokes causes TUI misprocessing
 *
 * The fix: A configurable keystroke sequence with delays between steps.
 * Two strategies: (1) press "1" to select menu option, (2) ESC + type + submit.
 */

describe('buildResumeSequence', () => {
  it('should return an array of keystroke steps', () => {
    const seq = buildResumeSequence({});
    expect(Array.isArray(seq)).toBe(true);
    expect(seq.length).toBeGreaterThan(0);
  });

  it('each step should have keys array and delay number', () => {
    const seq = buildResumeSequence({});
    for (const step of seq) {
      expect(Array.isArray(step.keys)).toBe(true);
      expect(step.keys.length).toBeGreaterThan(0);
      expect(typeof step.delay).toBe('number');
      expect(step.delay).toBeGreaterThanOrEqual(0);
    }
  });

  it('should start with Escape to dismiss any dialog/state', () => {
    const seq = buildResumeSequence({});
    expect(seq[0].keys).toContain('Escape');
    expect(seq[0].delay).toBeGreaterThanOrEqual(300);
  });

  it('should include menu selection "1" by default', () => {
    const seq = buildResumeSequence({});
    const menuStep = seq.find(s => s.keys.includes('1'));
    expect(menuStep).toBeDefined();
  });

  it('should use custom menuSelection from options', () => {
    const seq = buildResumeSequence({ menuSelection: '2' });
    const menuStep = seq.find(s => s.keys.includes('2'));
    expect(menuStep).toBeDefined();
  });

  it('should include text input "continue" as fallback', () => {
    const seq = buildResumeSequence({});
    const textStep = seq.find(s => s.keys.includes('continue'));
    expect(textStep).toBeDefined();
  });

  it('should use custom resumePrompt from options', () => {
    const seq = buildResumeSequence({ resumePrompt: 'go on' });
    const textStep = seq.find(s => s.keys.includes('go on'));
    expect(textStep).toBeDefined();
  });

  it('should end with Enter to submit the text fallback', () => {
    const seq = buildResumeSequence({});
    const lastStep = seq[seq.length - 1];
    expect(lastStep.keys).toContain('Enter');
  });

  it('should have inter-step delays for TUI processing', () => {
    const seq = buildResumeSequence({});
    const stepsWithDelay = seq.filter(s => s.delay > 0);
    // At least half the steps should have delays
    expect(stepsWithDelay.length).toBeGreaterThanOrEqual(Math.floor(seq.length / 2));
  });

  it('should have a substantial delay after menu selection for TUI transition', () => {
    const seq = buildResumeSequence({});
    const menuStep = seq.find(s => s.keys.includes('1'));
    expect(menuStep.delay).toBeGreaterThanOrEqual(500);
  });
});

describe('sendKeystrokeSequence', () => {
  it('should be a function', () => {
    expect(typeof sendKeystrokeSequence).toBe('function');
  });
});
