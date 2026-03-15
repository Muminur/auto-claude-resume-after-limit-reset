const fs = require('fs');
const { execFile } = require('child_process');
const os = require('os');

async function resolvePty(pid) {
  if (os.platform() === 'darwin') {
    return resolvePtyMacOS(pid);
  }
  // Linux: read /proc/PID/fd/0
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

async function resolvePtyMacOS(pid) {
  return new Promise((resolve) => {
    execFile('ps', ['-o', 'tty=', '-p', String(pid)], (err, stdout) => {
      if (err || !stdout.trim() || stdout.trim() === '??') {
        return resolve(null);
      }
      const tty = stdout.trim(); // e.g. "ttys001"
      const ptyPath = `/dev/${tty}`;
      try {
        fs.accessSync(ptyPath, fs.constants.W_OK);
        resolve(ptyPath);
      } catch (_) {
        resolve(null);
      }
    });
  });
}

async function sendViaPty(ptyPath, text, opts = {}) {
  return new Promise((resolve, reject) => {
    try {
      const menuSelection = opts.menuSelection || '1';
      const fd = fs.openSync(ptyPath, 'w');

      // Phase 1: Dismiss any open dialog
      fs.writeSync(fd, Buffer.from([0x1B])); // Escape
      fs.writeSync(fd, Buffer.from([0x1B])); // Escape again

      // Phase 2: Try menu option selection
      fs.writeSync(fd, menuSelection);

      // Phase 3: Fallback — dismiss, clear line, type text
      fs.writeSync(fd, Buffer.from([0x1B])); // Escape
      fs.writeSync(fd, Buffer.from([0x1B])); // Escape again
      fs.writeSync(fd, Buffer.from([0x15])); // Ctrl+U (clear line)
      fs.writeSync(fd, text + '\r');          // text + CR (NOT LF)

      fs.closeSync(fd);
      resolve();
    } catch (err) {
      reject(new Error(`PTY write failed for ${ptyPath}: ${err.message}`));
    }
  });
}

module.exports = { resolvePty, sendViaPty };
