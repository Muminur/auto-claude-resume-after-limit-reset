const path = require('path');
const fs = require('fs');
const os = require('os');
const { RateLimitQueue } = require('../../src/queue/rate-limit-queue');

describe('RateLimitQueue', () => {
  const tmpDir = path.join(os.tmpdir(), 'auto-resume-queue-test-' + process.pid);
  const statusFile = path.join(tmpDir, 'status.json');
  let queue;

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    queue = new RateLimitQueue(statusFile);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('adds a new detection to the queue', () => {
    queue.addDetection({
      reset_time: '2026-02-13T14:00:00.000Z',
      timezone: 'Asia/Dhaka',
      message: 'resets 8pm (Asia/Dhaka)',
      claude_pid: 12345,
    });

    const data = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    expect(data.queue).toHaveLength(1);
    expect(data.queue[0].reset_time).toBe('2026-02-13T14:00:00.000Z');
    expect(data.queue[0].status).toBe('pending');
  });

  test('deduplicates by reset_time', () => {
    queue.addDetection({
      reset_time: '2026-02-13T14:00:00.000Z',
      timezone: 'Asia/Dhaka',
      message: 'resets 8pm (Asia/Dhaka)',
      claude_pid: 12345,
    });
    queue.addDetection({
      reset_time: '2026-02-13T14:00:00.000Z',
      timezone: 'Asia/Dhaka',
      message: 'resets 8pm (Asia/Dhaka)',
      claude_pid: 12345,
    });

    const data = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    expect(data.queue).toHaveLength(1);
  });

  test('appends different reset times', () => {
    queue.addDetection({
      reset_time: '2026-02-12T14:00:00.000Z',
      message: 'resets 8pm',
      claude_pid: 12345,
    });
    queue.addDetection({
      reset_time: '2026-02-13T09:00:00.000Z',
      message: 'resets 3pm',
      claude_pid: 12345,
    });

    const data = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    expect(data.queue).toHaveLength(2);
  });

  test('getNextPending returns earliest pending entry', () => {
    queue.addDetection({
      reset_time: '2026-02-13T09:00:00.000Z',
      message: 'later',
      claude_pid: 12345,
    });
    queue.addDetection({
      reset_time: '2026-02-12T14:00:00.000Z',
      message: 'earlier',
      claude_pid: 12345,
    });

    const next = queue.getNextPending();
    expect(next.message).toBe('earlier');
  });

  test('getNextPending returns null when queue is empty', () => {
    expect(queue.getNextPending()).toBeNull();
  });

  test('updateStatus changes entry status', () => {
    queue.addDetection({
      reset_time: '2026-02-13T14:00:00.000Z',
      message: 'test',
      claude_pid: 12345,
    });

    const entry = queue.getNextPending();
    queue.updateEntryStatus(entry.id, 'completed');

    const next = queue.getNextPending();
    expect(next).toBeNull();

    const data = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    expect(data.queue[0].status).toBe('completed');
  });

  test('maintains backward compatibility with old format', () => {
    fs.writeFileSync(statusFile, JSON.stringify({
      detected: true,
      reset_time: '2026-02-13T14:00:00.000Z',
      timezone: 'Asia/Dhaka',
      message: 'resets 8pm',
      last_detected: '2026-02-13T12:00:00.000Z',
      claude_pid: 12345,
    }));

    const next = queue.getNextPending();
    expect(next).not.toBeNull();
    expect(next.reset_time).toBe('2026-02-13T14:00:00.000Z');
  });
});
