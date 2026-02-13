const path = require('path');
const fs = require('fs');
const os = require('os');
const { verifyResumeByTranscript } = require('../../src/verification/transcript-verifier');

describe('transcript-verifier', () => {
  const tmpDir = path.join(os.tmpdir(), 'auto-resume-test-' + process.pid);
  const testTranscript = path.join(tmpDir, 'test-transcript.jsonl');

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(testTranscript, '{"type":"assistant","message":"hello"}\n');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns true when transcript has new content after baseline', async () => {
    const baselineMtime = fs.statSync(testTranscript).mtimeMs;
    const baselineSize = fs.statSync(testTranscript).size;

    setTimeout(() => {
      fs.appendFileSync(testTranscript, '{"type":"assistant","message":"resumed"}\n');
    }, 100);

    const result = await verifyResumeByTranscript({
      transcriptPath: testTranscript,
      baselineMtime,
      baselineSize,
      timeoutMs: 2000,
      pollIntervalMs: 50,
    });
    expect(result.verified).toBe(true);
  });

  test('returns false when transcript has no new content within timeout', async () => {
    const baselineMtime = fs.statSync(testTranscript).mtimeMs;
    const baselineSize = fs.statSync(testTranscript).size;

    const result = await verifyResumeByTranscript({
      transcriptPath: testTranscript,
      baselineMtime,
      baselineSize,
      timeoutMs: 300,
      pollIntervalMs: 50,
    });
    expect(result.verified).toBe(false);
  });

  test('returns false for non-existent transcript path', async () => {
    const result = await verifyResumeByTranscript({
      transcriptPath: '/tmp/nonexistent-transcript.jsonl',
      baselineMtime: 0,
      baselineSize: 0,
      timeoutMs: 300,
      pollIntervalMs: 50,
    });
    expect(result.verified).toBe(false);
  });
});
