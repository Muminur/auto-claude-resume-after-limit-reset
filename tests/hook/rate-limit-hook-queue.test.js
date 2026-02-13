const path = require('path');
const fs = require('fs');
const os = require('os');
const { RateLimitQueue } = require('../../src/queue/rate-limit-queue');

describe('rate-limit-hook queue integration', () => {
  const tmpDir = path.join(os.tmpdir(), 'hook-queue-test-' + process.pid);
  const statusFile = path.join(tmpDir, 'status.json');

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('hook can write to queue via RateLimitQueue', () => {
    const queue = new RateLimitQueue(statusFile);
    queue.addDetection({
      reset_time: '2026-02-13T14:00:00.000Z',
      timezone: 'Asia/Dhaka',
      message: 'resets 8pm (Asia/Dhaka)',
      claude_pid: 12345,
    });

    const data = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    expect(data.queue).toHaveLength(1);
    expect(data.queue[0].status).toBe('pending');
  });

  test('multiple hook invocations create separate queue entries', () => {
    const queue = new RateLimitQueue(statusFile);
    queue.addDetection({
      reset_time: '2026-02-12T14:00:00.000Z',
      message: 'resets 8pm',
      claude_pid: 11111,
    });
    queue.addDetection({
      reset_time: '2026-02-13T09:00:00.000Z',
      message: 'resets 3pm',
      claude_pid: 22222,
    });

    const data = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    expect(data.queue).toHaveLength(2);
  });
});
