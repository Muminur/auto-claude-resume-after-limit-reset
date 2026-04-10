/**
 * Windows Terminal Named Pipe Delivery
 *
 * Detects Windows Terminal sessions via WT_SESSION env var and attempts
 * to deliver resume keystrokes via named pipe before falling back to
 * PowerShell SendWait.
 *
 * @module WtPipe
 */

const net = require('net');

/**
 * Get the Windows Terminal named pipe path from WT_SESSION env var.
 *
 * @returns {string|null} Named pipe path or null if not in Windows Terminal
 */
function getWindowsTerminalPipePath() {
  const wtSession = process.env.WT_SESSION;
  if (!wtSession) return null;
  return `\\\\.\\pipe\\WT_Session_${wtSession}`;
}

/**
 * Attempt to deliver resume text via Windows Terminal named pipe.
 *
 * @param {string} resumeText - Text to send (e.g., 'continue')
 * @returns {Promise<{ attempted: boolean, success?: boolean, pipePath?: string, error?: string }>}
 */
async function tryNamedPipeDelivery(resumeText) {
  const pipePath = getWindowsTerminalPipePath();

  if (!pipePath) {
    return { attempted: false };
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve({ attempted: true, success: false, pipePath, error: 'timeout' });
    }, 5000);

    const socket = net.connect({ path: pipePath }, () => {
      // Connected successfully, write the resume text + Enter
      socket.write(resumeText + '\r\n', () => {
        clearTimeout(timeout);
        socket.end();
        resolve({ attempted: true, success: true, pipePath });
      });
    });

    socket.on('error', (err) => {
      clearTimeout(timeout);
      socket.destroy();
      resolve({ attempted: true, success: false, pipePath, error: err.message });
    });
  });
}

module.exports = { getWindowsTerminalPipePath, tryNamedPipeDelivery };
