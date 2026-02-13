describe('daemon module integration', () => {
  test('delivery modules are importable from daemon context', () => {
    const { deliverResume, TIER } = require('../../src/delivery/tiered-delivery');
    const { verifyResumeByTranscript } = require('../../src/verification/transcript-verifier');
    const { RateLimitQueue } = require('../../src/queue/rate-limit-queue');

    expect(typeof deliverResume).toBe('function');
    expect(typeof verifyResumeByTranscript).toBe('function');
    expect(typeof RateLimitQueue).toBe('function');
    expect(TIER.TMUX).toBe('tmux');
  });
});
