const { resolvePty, sendViaPty } = require('../../src/delivery/pty-delivery');
const fs = require('fs');

describe('pty-delivery', () => {
  describe('resolvePty', () => {
    test('resolves PTY path for own process', async () => {
      const ptyPath = await resolvePty(process.pid);
      if (ptyPath) {
        expect(ptyPath).toMatch(/\/dev\/pts\/\d+|\/dev\/tty\w*/);
      }
    });

    test('returns null for non-existent PID', async () => {
      const result = await resolvePty(999999999);
      expect(result).toBeNull();
    });

    test('returns null for PID without terminal', async () => {
      const result = await resolvePty(1);
      expect(result).toBeNull();
    });
  });

  describe('sendViaPty', () => {
    test('rejects for non-existent PTY path', async () => {
      await expect(sendViaPty('/dev/pts/99999', 'continue'))
        .rejects.toThrow();
    });
  });
});
