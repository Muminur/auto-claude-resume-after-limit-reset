const { deliverResume, TIER } = require('../../src/delivery/tiered-delivery');

describe('tiered-delivery', () => {
  test('exports TIER constants', () => {
    expect(TIER.TMUX).toBe('tmux');
    expect(TIER.PTY).toBe('pty');
    expect(TIER.XDOTOOL).toBe('xdotool');
  });

  test('returns result object with tier and success fields', async () => {
    // With a non-existent PID, all tiers should fail
    const result = await deliverResume({
      claudePid: 999999999,
      resumeText: 'continue',
    });
    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('tier');
    expect(result).toHaveProperty('error');
  });

  test('falls through all tiers for invalid PID', async () => {
    const result = await deliverResume({
      claudePid: 999999999,
      resumeText: 'continue',
    });
    expect(result.success).toBe(false);
    expect(result.tiersAttempted).toEqual(
      expect.arrayContaining([TIER.TMUX, TIER.PTY])
    );
  });

  test('accepts optional log function', async () => {
    const logs = [];
    const logFn = (level, msg) => logs.push({ level, msg });

    await deliverResume({
      claudePid: 999999999,
      resumeText: 'continue',
      log: logFn,
    });

    expect(logs.length).toBeGreaterThan(0);
    expect(logs.some(l => l.msg.includes('tmux'))).toBe(true);
  });
});
