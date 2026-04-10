const fs = require('fs');
const path = require('path');
const os = require('os');

jest.mock('fs');
jest.mock('os');

os.homedir = jest.fn().mockReturnValue('/home/testuser');

const { createSimulatedStatus } = require('../scripts/simulate');

describe('/auto-resume:simulate Command', () => {
  const mockHomeDir = '/home/testuser';
  const statusPath = path.join(mockHomeDir, '.claude', 'auto-resume', 'status.json');

  beforeEach(() => {
    jest.clearAllMocks();
    os.homedir.mockReturnValue(mockHomeDir);
    fs.existsSync.mockReturnValue(true);
    fs.mkdirSync.mockReturnValue(undefined);
    fs.writeFileSync.mockReturnValue(undefined);
  });

  it('should create status.json with correct shape', () => {
    const result = createSimulatedStatus();

    expect(result.detected).toBe(true);
    expect(result.last_task_context).toBe('Simulated task context');
    expect(result.resume_prompt).toBe('Continue with: Simulated task context');
    expect(result.reset_time).toBeDefined();
    expect(result.message).toBeDefined();
  });

  it('should set reset_time in the future', () => {
    const result = createSimulatedStatus();

    const resetTime = new Date(result.reset_time);
    const now = new Date();

    expect(resetTime.getTime()).toBeGreaterThan(now.getTime());
  });

  it('should set reset_time approximately 30 seconds in the future', () => {
    const before = Date.now();
    const result = createSimulatedStatus();
    const after = Date.now();

    const resetTime = new Date(result.reset_time).getTime();

    // Should be 25-35 seconds in the future (allowing for execution time)
    expect(resetTime - before).toBeGreaterThanOrEqual(25000);
    expect(resetTime - after).toBeLessThanOrEqual(35000);
  });

  it('should write status.json to correct path', () => {
    const { writeSimulatedStatus } = require('../scripts/simulate');

    writeSimulatedStatus();

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      statusPath,
      expect.any(String),
      'utf8'
    );

    // Verify written content is valid JSON
    const writtenContent = fs.writeFileSync.mock.calls[0][1];
    const parsed = JSON.parse(writtenContent);
    expect(parsed.detected).toBe(true);
  });

  it('should create directory if it does not exist', () => {
    fs.existsSync.mockReturnValue(false);

    const { writeSimulatedStatus } = require('../scripts/simulate');
    writeSimulatedStatus();

    expect(fs.mkdirSync).toHaveBeenCalledWith(
      path.join(mockHomeDir, '.claude', 'auto-resume'),
      { recursive: true }
    );
  });

  it('should include sessions array', () => {
    const result = createSimulatedStatus();
    expect(Array.isArray(result.sessions)).toBe(true);
  });
});
