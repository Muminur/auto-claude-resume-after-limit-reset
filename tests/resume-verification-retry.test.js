const fs = require('fs');
const path = require('path');

jest.mock('fs');

const { verifyResumeWithRetry } = require('../src/modules/resume-verifier');

describe('Resume Verification + Retry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should succeed on first attempt when transcript updates', async () => {
    const transcriptPath = '/tmp/transcript.jsonl';
    const lastDetected = new Date('2025-01-01T10:00:00Z').toISOString();

    // Transcript has a new assistant entry after lastDetected
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(
      JSON.stringify({ type: 'assistant', timestamp: '2025-01-01T10:01:00Z', message: { content: 'ok' } }) + '\n'
    );

    const log = jest.fn();
    const resultPromise = verifyResumeWithRetry({
      transcriptPath,
      lastDetected,
      checkDelaySec: 0.01,
      maxRetries: 3,
      backoffSeconds: [0.01, 0.02, 0.04],
      log
    });

    // Advance to cover the initial delay
    jest.advanceTimersByTime(100);
    await Promise.resolve(); // flush microtasks
    jest.advanceTimersByTime(100);
    await Promise.resolve();

    const result = await resultPromise;
    expect(result.verified).toBe(true);
    expect(result.attempts).toBe(1);
  });

  it('should retry up to 3 times when transcript never updates', async () => {
    const transcriptPath = '/tmp/transcript.jsonl';
    const lastDetected = new Date('2025-01-01T10:00:00Z').toISOString();

    // Transcript has no new entries
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(
      JSON.stringify({ type: 'user', timestamp: '2025-01-01T09:00:00Z', message: {} }) + '\n'
    );

    const log = jest.fn();
    const resultPromise = verifyResumeWithRetry({
      transcriptPath,
      lastDetected,
      checkDelaySec: 0.01,
      maxRetries: 3,
      backoffSeconds: [0.01, 0.02, 0.04],
      log
    });

    // Advance through all retries
    for (let i = 0; i < 20; i++) {
      jest.advanceTimersByTime(100);
      await Promise.resolve();
    }

    const result = await resultPromise;
    expect(result.verified).toBe(false);
    expect(result.attempts).toBe(3);
  });

  it('should succeed on second attempt when transcript updates after first retry', async () => {
    const transcriptPath = '/tmp/transcript.jsonl';
    const lastDetected = new Date('2025-01-01T10:00:00Z').toISOString();

    let callCount = 0;
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockImplementation(() => {
      callCount++;
      if (callCount <= 1) {
        // First check: no new entries
        return JSON.stringify({ type: 'user', timestamp: '2025-01-01T09:00:00Z', message: {} }) + '\n';
      }
      // Second check: new assistant entry
      return JSON.stringify({ type: 'assistant', timestamp: '2025-01-01T10:01:00Z', message: { content: 'done' } }) + '\n';
    });

    const log = jest.fn();
    const resultPromise = verifyResumeWithRetry({
      transcriptPath,
      lastDetected,
      checkDelaySec: 0.01,
      maxRetries: 3,
      backoffSeconds: [0.01, 0.02, 0.04],
      log
    });

    for (let i = 0; i < 20; i++) {
      jest.advanceTimersByTime(100);
      await Promise.resolve();
    }

    const result = await resultPromise;
    expect(result.verified).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it('should log each retry attempt', async () => {
    const transcriptPath = '/tmp/transcript.jsonl';
    const lastDetected = new Date('2025-01-01T10:00:00Z').toISOString();

    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(
      JSON.stringify({ type: 'user', timestamp: '2025-01-01T09:00:00Z', message: {} }) + '\n'
    );

    const log = jest.fn();
    const resultPromise = verifyResumeWithRetry({
      transcriptPath,
      lastDetected,
      checkDelaySec: 0.01,
      maxRetries: 3,
      backoffSeconds: [0.01, 0.02, 0.04],
      log
    });

    for (let i = 0; i < 20; i++) {
      jest.advanceTimersByTime(100);
      await Promise.resolve();
    }

    await resultPromise;

    const retryLogs = log.mock.calls.filter(c =>
      typeof c[0] === 'string' && c[0].includes('Retry')
    );
    expect(retryLogs.length).toBeGreaterThanOrEqual(2);
  });
});
