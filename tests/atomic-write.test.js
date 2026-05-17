const fs = require('fs');
const path = require('path');
const os = require('os');

function atomicWriteSync(filePath, data) {
  const tmpFile = filePath + '.tmp';
  fs.writeFileSync(tmpFile, data, 'utf8');
  fs.renameSync(tmpFile, filePath);
}

describe('Atomic Write', () => {
  const testDir = path.join(os.tmpdir(), 'atomic-write-test-' + process.pid);

  beforeAll(() => { fs.mkdirSync(testDir, { recursive: true }); });
  afterAll(() => { fs.rmSync(testDir, { recursive: true, force: true }); });

  it('should write file atomically with no leftover tmp file', () => {
    const filePath = path.join(testDir, 'test.json');
    const data = JSON.stringify({ key: 'value' });
    atomicWriteSync(filePath, data);
    expect(fs.readFileSync(filePath, 'utf8')).toBe(data);
    expect(fs.existsSync(filePath + '.tmp')).toBe(false);
  });

  it('should overwrite existing file atomically', () => {
    const filePath = path.join(testDir, 'overwrite.json');
    atomicWriteSync(filePath, '{"old": true}');
    atomicWriteSync(filePath, '{"new": true}');
    expect(JSON.parse(fs.readFileSync(filePath, 'utf8')).new).toBe(true);
  });

  it('should produce valid JSON on sequential writes', () => {
    const filePath = path.join(testDir, 'concurrent.json');
    for (let i = 0; i < 20; i++) {
      atomicWriteSync(filePath, JSON.stringify({ iteration: i }));
    }
    const result = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    expect(result.iteration).toBe(19);
  });
});
