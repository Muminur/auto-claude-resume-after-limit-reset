const { deliverResume, TIER } = require('../../src/delivery/tiered-delivery');

describe('tiered-delivery', () => {
  test('exports TIER constants', () => {
    expect(TIER.TMUX).toBe('tmux');
    expect(TIER.PTY).toBe('pty');
    expect(TIER.XDOTOOL).toBe('xdotool');
  });

  test('returns result object with tier and success fields', async () => {
    // deliverResume now scans all tmux panes for Claude processes,
    // so it may succeed if real Claude panes exist on this machine
    const result = await deliverResume({
      claudePid: 999999999,
      resumeText: 'continue',
    });
    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('tier');
    expect(result).toHaveProperty('tiersAttempted');
    expect(result.tiersAttempted).toEqual(expect.arrayContaining([TIER.TMUX]));
  }, 15000);

  test('attempts tmux tier regardless of claudePid', async () => {
    const result = await deliverResume({
      claudePid: null,
      resumeText: 'continue',
    });
    expect(result.tiersAttempted).toContain(TIER.TMUX);
  }, 15000);

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
