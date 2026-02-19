const fs = require('fs');

async function resolvePty(pid) {
  try {
    const fdPath = `/proc/${pid}/fd/0`;
    const target = fs.readlinkSync(fdPath);

    if (target.startsWith('/dev/pts/') || target.startsWith('/dev/tty')) {
      return target;
    }

    return null;
  } catch (err) {
    return null;
  }
}

async function sendViaPty(ptyPath, text) {
  return new Promise((resolve, reject) => {
    try {
      const fd = fs.openSync(ptyPath, 'w');

      // Send Escape (0x1B) to dismiss any menu
      fs.writeSync(fd, Buffer.from([0x1B]));

      // Send Ctrl+U (0x15) to clear line
      fs.writeSync(fd, Buffer.from([0x15]));

      // Send the text followed by Enter (0x0D carriage return, NOT 0x0A linefeed)
      // Claude Code TUI requires \r to submit; \n only adds a newline without submitting
      fs.writeSync(fd, text + '\r');

      fs.closeSync(fd);
      resolve();
    } catch (err) {
      reject(new Error(`PTY write failed for ${ptyPath}: ${err.message}`));
    }
  });
}

module.exports = { resolvePty, sendViaPty };
