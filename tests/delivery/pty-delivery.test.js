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

    test('sends \\r (0x0D carriage return) as Enter, NOT \\n (0x0A linefeed)', async () => {
      // BUG: old code sent text + '\n' which shows as newline in TUI but never submits.
      // Claude Code TUI requires \r (CR) to submit, not \n (LF).
      const written = [];
      const origOpen = fs.openSync;
      const origWrite = fs.writeSync;
      const origClose = fs.closeSync;

      fs.openSync = () => 99;
      fs.writeSync = (_fd, data) => { written.push(data); };
      fs.closeSync = () => {};

      try {
        await sendViaPty('/dev/pts/test', 'continue');
      } finally {
        fs.openSync = origOpen;
        fs.writeSync = origWrite;
        fs.closeSync = origClose;
      }

      // Find the write that contains the text "continue"
      const textWrite = written.find(w => typeof w === 'string' && w.includes('continue'));
      expect(textWrite).toBeDefined();
      // Must end with CR (0x0D), not LF (0x0A)
      expect(textWrite).toMatch(/\r$/);
      expect(textWrite).not.toMatch(/\n/);
    });

    test('sends Escape (0x1B) before text to dismiss any menu', async () => {
      const written = [];
      const origOpen = fs.openSync;
      const origWrite = fs.writeSync;
      const origClose = fs.closeSync;

      fs.openSync = () => 99;
      fs.writeSync = (_fd, data) => { written.push(data); };
      fs.closeSync = () => {};

      try {
        await sendViaPty('/dev/pts/test', 'continue');
      } finally {
        fs.openSync = origOpen;
        fs.writeSync = origWrite;
        fs.closeSync = origClose;
      }

      // First non-string write should be Escape (0x1B)
      const bufferWrites = written.filter(w => Buffer.isBuffer(w));
      expect(bufferWrites.length).toBeGreaterThanOrEqual(1);
      expect(bufferWrites[0][0]).toBe(0x1B); // ESC
    });
  });
});
