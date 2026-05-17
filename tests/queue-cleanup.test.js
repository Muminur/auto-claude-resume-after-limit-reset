const fs = require('fs');
const path = require('path');
const os = require('os');
const { RateLimitQueue } = require('../src/queue/rate-limit-queue');

describe('RateLimitQueue Cleanup & Atomic Write', () => {
  let testDir, testFile, queue;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), 'queue-test-' + process.pid + '-' + Date.now());
    fs.mkdirSync(testDir, { recursive: true });
    testFile = path.join(testDir, 'status.json');
    queue = new RateLimitQueue(testFile);
  });

  afterEach(() => { fs.rmSync(testDir, { recursive: true, force: true }); });

  it('should prune completed entries older than 30 days', () => {
    const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const recentDate = new Date().toISOString();
    const data = {
      queue: [
        { id: 'old', reset_time: oldDate, status: 'completed', completed_at: oldDate },
        { id: 'recent', reset_time: recentDate, status: 'pending' },
      ],
      last_hook_run: null,
    };
    fs.writeFileSync(testFile, JSON.stringify(data), 'utf8');
    queue.addDetection({ reset_time: new Date(Date.now() + 3600000).toISOString() });
    const result = JSON.parse(fs.readFileSync(testFile, 'utf8'));
    const ids = result.queue.map((e) => e.id);
    expect(ids).not.toContain('old');
    expect(ids).toContain('recent');
  });

  it('should keep completed entries younger than 30 days', () => {
    const recentDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
    const data = {
      queue: [
        { id: 'recent-completed', reset_time: recentDate, status: 'completed', completed_at: recentDate },
      ],
      last_hook_run: null,
    };
    fs.writeFileSync(testFile, JSON.stringify(data), 'utf8');
    queue.addDetection({ reset_time: new Date(Date.now() + 3600000).toISOString() });
    const result = JSON.parse(fs.readFileSync(testFile, 'utf8'));
    expect(result.queue.map((e) => e.id)).toContain('recent-completed');
  });

  it('should use atomic write with no .tmp file left', () => {
    queue.addDetection({ reset_time: new Date(Date.now() + 3600000).toISOString() });
    expect(fs.existsSync(testFile)).toBe(true);
    expect(fs.existsSync(testFile + '.tmp')).toBe(false);
  });

  it('should deduplicate by reset_time', () => {
    const resetTime = new Date(Date.now() + 3600000).toISOString();
    queue.addDetection({ reset_time: resetTime });
    queue.addDetection({ reset_time: resetTime });
    const data = JSON.parse(fs.readFileSync(testFile, 'utf8'));
    expect(data.queue.filter((e) => e.reset_time === resetTime).length).toBe(1);
  });

  it('should migrate old single-slot format', () => {
    const oldFormat = {
      detected: true,
      reset_time: new Date(Date.now() + 3600000).toISOString(),
      timezone: 'UTC',
      message: 'test',
    };
    fs.writeFileSync(testFile, JSON.stringify(oldFormat), 'utf8');
    const next = queue.getNextPending();
    expect(next).not.toBeNull();
    expect(next.reset_time).toBe(oldFormat.reset_time);
  });
});
