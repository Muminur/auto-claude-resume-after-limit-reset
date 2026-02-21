const { detectTmuxSession, sendViaTmux, discoverAllClaudeProcesses } = require('../../src/delivery/tmux-delivery');

describe('tmux-delivery', () => {
  describe('detectTmuxSession', () => {
    test('returns null when PID is not in any tmux session', async () => {
      const result = await detectTmuxSession(process.pid);
      expect(result).toBeNull();
    });

    test('returns null for non-existent PID', async () => {
      const result = await detectTmuxSession(999999999);
      expect(result).toBeNull();
    });

    test('returns null when tmux is not installed', async () => {
      const origPath = process.env.PATH;
      process.env.PATH = '';
      const result = await detectTmuxSession(process.pid);
      process.env.PATH = origPath;
      expect(result).toBeNull();
    });
  });

  describe('sendViaTmux', () => {
    test('rejects when session does not exist', async () => {
      await expect(sendViaTmux('nonexistent-session-12345', 'continue'))
        .rejects.toThrow();
    });
  });
});

describe('discoverAllClaudeProcesses', () => {
  test('returns an array', async () => {
    const results = await discoverAllClaudeProcesses();
    expect(Array.isArray(results)).toBe(true);
  });

  test('each entry has pid, method, and either target or ptyPath', async () => {
    const results = await discoverAllClaudeProcesses();
    for (const entry of results) {
      expect(typeof entry.pid).toBe('number');
      expect(['tmux', 'pty']).toContain(entry.method);
      if (entry.method === 'tmux') {
        expect(typeof entry.target).toBe('string');
        expect(entry.target).toMatch(/^.+:\d+\.\d+$/);
      } else {
        expect(typeof entry.ptyPath).toBe('string');
        expect(entry.ptyPath).toMatch(/^\/dev\/pts\//);
      }
    }
  });
});
