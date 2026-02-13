const { detectTmuxSession, sendViaTmux } = require('../../src/delivery/tmux-delivery');

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
