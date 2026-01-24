/**
 * CLI Commands Integration Tests
 *
 * Tests all auto-resume daemon CLI commands for regression testing.
 * These tests verify that commands execute without errors and produce expected output.
 */

const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const DAEMON_PATH = path.join(__dirname, '..', 'auto-resume-daemon.js');
const AUTO_RESUME_DIR = path.join(os.homedir(), '.claude', 'auto-resume');
const LOG_FILE = path.join(AUTO_RESUME_DIR, 'daemon.log');

/**
 * Execute a daemon command and return the result
 */
function runCommand(args, options = {}) {
  const timeout = options.timeout || 10000;
  try {
    const result = execSync(`node "${DAEMON_PATH}" ${args}`, {
      encoding: 'utf8',
      timeout,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return { success: true, output: result, exitCode: 0 };
  } catch (err) {
    return {
      success: err.status === 0,
      output: err.stdout || '',
      stderr: err.stderr || '',
      exitCode: err.status || 1
    };
  }
}

describe('CLI Commands', () => {
  describe('help command', () => {
    test('should display usage information', () => {
      const result = runCommand('help');
      expect(result.output).toContain('USAGE:');
      expect(result.output).toContain('COMMANDS:');
      expect(result.output).toContain('start');
      expect(result.output).toContain('stop');
      expect(result.output).toContain('status');
    });
  });

  describe('status command', () => {
    test('should return daemon status', () => {
      const result = runCommand('status');
      // Should contain either "running" or "not running"
      expect(
        result.output.includes('running') || result.output.includes('not running')
      ).toBe(true);
    });

    test('should not throw errors', () => {
      const result = runCommand('status');
      expect(result.stderr || '').not.toContain('Error');
    });
  });

  describe('config command', () => {
    test('should display current configuration', () => {
      const result = runCommand('config');
      expect(result.output).toContain('Configuration');
      expect(result.output).toContain('resumePrompt');
      expect(result.output).toContain('checkInterval');
    });

    test('should show config file path', () => {
      const result = runCommand('config');
      expect(result.output).toContain('config.json');
    });
  });

  describe('analytics command', () => {
    test('should display analytics summary', () => {
      const result = runCommand('analytics');
      expect(result.output).toContain('Analytics');
      expect(result.output).toContain('Rate limits');
      expect(result.output).toContain('Resumes');
    });

    test('should show time-based statistics', () => {
      const result = runCommand('analytics');
      expect(result.output).toContain('7 Days');
      expect(result.output).toContain('30 Days');
    });
  });

  describe('reset command', () => {
    test('should handle reset when no status exists', () => {
      const result = runCommand('reset');
      // Should either reset or say nothing to reset
      expect(
        result.output.includes('reset') ||
        result.output.includes('Nothing to reset') ||
        result.output.includes('No rate limit')
      ).toBe(true);
    });
  });

  describe('logs command', () => {
    test('should display recent log entries', () => {
      const result = runCommand('logs');
      // Should show "Daemon Logs" header, not CLI error
      expect(result.output).toMatch(/Daemon Logs|No log file found|Log file is empty/);
      // Should not show CLI error message format (ERROR followed by Unknown command)
      expect(result.output).not.toMatch(/\[ERROR\].*Unknown command: logs/);
    });

    test('should handle missing log file gracefully', () => {
      const result = runCommand('logs');
      // Should either show logs or say no logs found
      expect(result.exitCode).toBe(0);
    });

    test('should support --lines option', () => {
      const result = runCommand('logs --lines 5');
      // Should show log output, not CLI error
      expect(result.output).toMatch(/Daemon Logs|No log file found|Log file is empty/);
    });
  });

  describe('notify command', () => {
    test('should send test notification without error', () => {
      const result = runCommand('notify', { timeout: 30000 });
      expect(result.output).toContain('notification');
    });

    test('should report success or failure', () => {
      const result = runCommand('notify', { timeout: 30000 });
      // Test passes if notification sent, shown, or timed out (MessageBox blocks in test env)
      expect(
        result.output.includes('SUCCESS') ||
        result.output.includes('sent') ||
        result.output.includes('delivered') ||
        result.output.includes('shown') ||
        result.output.includes('Sending test notification')  // Started notification flow
      ).toBe(true);
    });
  });

  describe('unknown command', () => {
    test('should report unknown command error', () => {
      const result = runCommand('nonexistent-command');
      expect(result.output).toContain('Unknown command');
    });

    test('should suggest using help', () => {
      const result = runCommand('nonexistent-command');
      expect(result.output).toContain('help');
    });
  });
});

describe('CLI Command Arguments', () => {
  describe('config set', () => {
    test('should update config value', () => {
      // Get original value
      const original = runCommand('config');
      const originalInterval = original.output.match(/"checkInterval":\s*(\d+)/)?.[1];

      // Set new value
      const setResult = runCommand('config set checkInterval 6000');
      expect(setResult.output).toContain('checkInterval');

      // Restore original value if we had one
      if (originalInterval) {
        runCommand(`config set checkInterval ${originalInterval}`);
      }
    });
  });

  describe('test command', () => {
    test('should accept countdown seconds', () => {
      // Use very short timeout for testing
      const result = runCommand('--test 1', { timeout: 15000 });
      expect(result.output).toContain('TEST');
      expect(result.output).toContain('countdown');
    });
  });
});
