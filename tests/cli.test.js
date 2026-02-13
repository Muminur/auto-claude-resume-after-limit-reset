const { execSync, execFileSync } = require('child_process');
const path = require('path');

const DAEMON_PATH = path.join(__dirname, '..', 'auto-resume-daemon.js');

/**
 * Run the daemon CLI with a command and return { exitCode, stdout, stderr }.
 * We use a short timeout since CLI parsing should be near-instant for
 * commands that don't start long-running processes.
 *
 * For commands that start long-running processes (start, monitor, restart),
 * we set DAEMON_DRY_RUN=1 to skip actual daemon startup (tested separately).
 * Since that env var doesn't exist yet, these tests will hang/fail until
 * the implementation is done — which is expected for TDD.
 */
function runCli(command, { timeout = 5000 } = {}) {
  try {
    const stdout = execFileSync('node', [DAEMON_PATH, command], {
      encoding: 'utf8',
      timeout,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, DAEMON_DRY_RUN: '1' }
    });
    return { exitCode: 0, stdout, stderr: '' };
  } catch (err) {
    return {
      exitCode: err.status ?? 1,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? ''
    };
  }
}

describe('CLI command parsing', () => {
  test('help command exits 0', () => {
    const result = runCli('help');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('USAGE');
  });

  test('--help flag exits 0', () => {
    const result = runCli('--help');
    expect(result.exitCode).toBe(0);
  });

  test('unknown command exits 1', () => {
    const result = runCli('nonexistent-command');
    expect(result.exitCode).toBe(1);
  });

  // THE FAILING TESTS — these test the bug fix
  test('--monitor is accepted as a valid command (does not exit 1)', () => {
    const result = runCli('--monitor');
    expect(result.exitCode).not.toBe(1);
    // Should not contain "Unknown command"
    expect(result.stdout + result.stderr).not.toContain('Unknown command');
  });

  test('monitor is accepted as a valid command (does not exit 1)', () => {
    const result = runCli('monitor');
    expect(result.exitCode).not.toBe(1);
    expect(result.stdout + result.stderr).not.toContain('Unknown command');
  });
});
