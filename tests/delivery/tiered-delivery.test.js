const { deliverResume, TIER } = require('../../src/delivery/tiered-delivery');

describe('tiered-delivery', () => {
  test('exports TIER constants', () => {
    expect(TIER.TMUX).toBe('tmux');
    expect(TIER.PTY).toBe('pty');
    expect(TIER.XDOTOOL).toBe('xdotool');
  });

  test('returns result with success, tiersAttempted, and targets fields', async () => {
    const result = await deliverResume({ resumeText: 'continue' });
    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('tiersAttempted');
    expect(result).toHaveProperty('targets');
    expect(Array.isArray(result.targets)).toBe(true);
  }, 30000);

  test('tiersAttempted always includes tmux (discovery always runs)', async () => {
    const result = await deliverResume({ resumeText: 'continue' });
    expect(result.tiersAttempted).toContain(TIER.TMUX);
  }, 30000);

  test('accepts optional log function', async () => {
    const logs = [];
    await deliverResume({
      resumeText: 'continue',
      log: (level, msg) => logs.push({ level, msg }),
    });
    expect(logs.length).toBeGreaterThan(0);
  }, 30000);

  test('falls back to xdotool when discoverer returns empty', async () => {
    let xdotoolCalled = false;
    const result = await deliverResume({
      resumeText: 'continue',
      _discoverer: async () => [],
      xdotoolFallback: async () => { xdotoolCalled = true; },
    });
    expect(xdotoolCalled).toBe(true);
    expect(result.tiersAttempted).toContain(TIER.XDOTOOL);
  }, 10000);
});
