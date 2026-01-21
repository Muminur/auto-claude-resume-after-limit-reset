#!/usr/bin/env node

/**
 * Claude Code Auto-Resume Daemon
 *
 * Background service that watches for rate limit status and automatically
 * resumes Claude Code terminal sessions when limits reset.
 *
 * Features:
 * - File-based status watching (~/.claude/auto-resume/status.json)
 * - Cross-platform terminal automation (Windows/Linux/macOS)
 * - Countdown timer with console display
 * - Process management (start/stop/status)
 * - PID file and logging
 * - Graceful shutdown handling
 *
 * @version 1.0.0
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');

const VERSION = '1.0.0';
const HOME_DIR = os.homedir();
const BASE_DIR = path.join(HOME_DIR, '.claude', 'auto-resume');
const STATUS_FILE = path.join(BASE_DIR, 'status.json');
const PID_FILE = path.join(BASE_DIR, 'daemon.pid');
const LOG_FILE = path.join(BASE_DIR, 'daemon.log');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};

// State management
let isRunning = false;
let watchInterval = null;
let countdownInterval = null;
let currentResetTime = null;
let lastStatusMtime = null;

/**
 * Logging utility
 */
function log(level, message) {
  const timestamp = new Date().toISOString();
  const prefix = {
    info: `${colors.cyan}[INFO]${colors.reset}`,
    success: `${colors.green}[SUCCESS]${colors.reset}`,
    warning: `${colors.yellow}[WARNING]${colors.reset}`,
    error: `${colors.red}[ERROR]${colors.reset}`,
    debug: `${colors.blue}[DEBUG]${colors.reset}`,
  };

  const logMessage = `[${timestamp}] ${level.toUpperCase()}: ${message}`;
  const consoleMessage = `${prefix[level] || ''} ${message}`;

  // Write to console
  console.log(consoleMessage);

  // Write to log file
  try {
    fs.appendFileSync(LOG_FILE, logMessage + '\n');
  } catch (err) {
    // Ignore log file errors
  }
}

/**
 * Ensure required directories exist
 */
function ensureDirectories() {
  if (!fs.existsSync(BASE_DIR)) {
    fs.mkdirSync(BASE_DIR, { recursive: true });
    log('info', `Created directory: ${BASE_DIR}`);
  }
}

/**
 * Write PID file
 */
function writePidFile() {
  fs.writeFileSync(PID_FILE, process.pid.toString());
  log('debug', `PID file written: ${PID_FILE} (PID: ${process.pid})`);
}

/**
 * Remove PID file
 */
function removePidFile() {
  try {
    if (fs.existsSync(PID_FILE)) {
      fs.unlinkSync(PID_FILE);
      log('debug', 'PID file removed');
    }
  } catch (err) {
    log('error', `Failed to remove PID file: ${err.message}`);
  }
}

/**
 * Read PID from file
 */
function readPidFile() {
  try {
    if (fs.existsSync(PID_FILE)) {
      const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
      return isNaN(pid) ? null : pid;
    }
  } catch (err) {
    log('error', `Failed to read PID file: ${err.message}`);
  }
  return null;
}

/**
 * Check if process is running
 */
function isProcessRunning(pid) {
  try {
    // process.kill with signal 0 checks if process exists
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Stop daemon by PID
 */
function stopDaemon() {
  const pid = readPidFile();

  if (!pid) {
    log('warning', 'No PID file found. Daemon may not be running.');
    return false;
  }

  if (!isProcessRunning(pid)) {
    log('warning', `Process ${pid} is not running. Cleaning up...`);
    removePidFile();
    return false;
  }

  log('info', `Stopping daemon (PID: ${pid})...`);

  try {
    process.kill(pid, 'SIGTERM');

    // Wait for process to exit (with timeout)
    let attempts = 0;
    const maxAttempts = 50; // 5 seconds

    const waitForExit = setInterval(() => {
      attempts++;

      if (!isProcessRunning(pid)) {
        clearInterval(waitForExit);
        removePidFile();
        log('success', 'Daemon stopped successfully');
        return true;
      }

      if (attempts >= maxAttempts) {
        clearInterval(waitForExit);
        log('warning', 'Daemon did not stop gracefully. Forcing...');
        try {
          process.kill(pid, 'SIGKILL');
          removePidFile();
          log('success', 'Daemon forcefully stopped');
        } catch (err) {
          log('error', `Failed to force stop: ${err.message}`);
        }
      }
    }, 100);

    return true;
  } catch (err) {
    log('error', `Failed to stop daemon: ${err.message}`);
    return false;
  }
}

/**
 * Get daemon status
 */
function getDaemonStatus() {
  const pid = readPidFile();

  if (!pid) {
    log('info', 'Daemon is not running (no PID file)');
    return { running: false };
  }

  if (!isProcessRunning(pid)) {
    log('warning', 'Daemon PID file exists but process is not running');
    log('info', 'Run "node auto-resume-daemon.js start" to start the daemon');
    return { running: false, stale: true };
  }

  log('success', `Daemon is running (PID: ${pid})`);

  // Try to read status file
  try {
    if (fs.existsSync(STATUS_FILE)) {
      const status = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
      log('info', `Status: ${JSON.stringify(status, null, 2)}`);
      return { running: true, pid, status };
    }
  } catch (err) {
    log('debug', `Could not read status file: ${err.message}`);
  }

  return { running: true, pid };
}

/**
 * Format time remaining as HH:MM:SS
 */
function formatTimeRemaining(ms) {
  if (ms < 0) return '00:00:00';

  const seconds = Math.floor(ms / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/**
 * Send keystrokes to Claude Code terminals
 */
async function sendContinueToTerminals() {
  const platform = os.platform();
  const text = 'continue';

  return new Promise((resolve, reject) => {
    if (platform === 'win32') {
      // Windows: Find all Claude Code windows and send keystrokes
      const script = `
        Add-Type -AssemblyName System.Windows.Forms

        # Get all windows with "Claude" in the title
        $windows = Get-Process | Where-Object { $_.MainWindowTitle -match "Claude" }

        if ($windows) {
          foreach ($window in $windows) {
            # Bring window to front (optional)
            # [System.Windows.Forms.Application]::SetForegroundWindow($window.MainWindowHandle)

            Start-Sleep -Milliseconds 500
            [System.Windows.Forms.SendKeys]::SendWait('${text.replace(/'/g, "''")}')
            Start-Sleep -Milliseconds 100
            [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
            Start-Sleep -Milliseconds 500
          }

          Write-Output "Sent to $($windows.Count) window(s)"
        } else {
          Write-Output "No Claude windows found"
        }
      `;

      exec(`powershell -Command "${script.replace(/"/g, '\\"')}"`, (error, stdout) => {
        if (error) {
          log('error', `Failed to send keystrokes: ${error.message}`);
          reject(error);
        } else {
          log('success', `Keystrokes sent: ${stdout.trim()}`);
          resolve();
        }
      });
    } else if (platform === 'darwin') {
      // macOS: Use osascript to find and send to Terminal/iTerm windows
      const script = `
        tell application "System Events"
          set terminalApps to {"Terminal", "iTerm", "iTerm2"}

          repeat with appName in terminalApps
            if (exists process appName) then
              tell process appName
                set frontmost to true
                keystroke "${text}"
                keystroke return
                delay 0.5
              end tell
            end if
          end repeat
        end tell
      `;

      exec(`osascript -e '${script}'`, (error, stdout) => {
        if (error) {
          log('error', `Failed to send keystrokes: ${error.message}`);
          reject(error);
        } else {
          log('success', `Sent: '${text}' + Enter to terminal windows`);
          resolve();
        }
      });
    } else {
      // Linux: Use xdotool to find and send to terminal windows
      exec('which xdotool', (error) => {
        if (error) {
          log('error', 'xdotool not found. Please install it:');
          log('info', '  Ubuntu/Debian: sudo apt-get install xdotool');
          log('info', '  RHEL/CentOS: sudo yum install xdotool');
          log('info', '  Arch: sudo pacman -S xdotool');
          reject(new Error('xdotool not found'));
          return;
        }

        // Find all terminal windows and send keystrokes
        const findAndSend = `
          # Find windows with common terminal classes
          for wid in $(xdotool search --class "gnome-terminal|konsole|xterm|terminator|alacritty|kitty" 2>/dev/null); do
            xdotool windowactivate --sync $wid
            sleep 0.2
            xdotool type --clearmodifiers "${text}"
            xdotool key Return
            sleep 0.3
          done
        `;

        exec(findAndSend, (err, stdout) => {
          if (err) {
            log('error', `Failed to send keystrokes: ${err.message}`);
            reject(err);
          } else {
            log('success', `Sent: '${text}' + Enter to terminal windows`);
            resolve();
          }
        });
      });
    }
  });
}

/**
 * Clear status file
 */
function clearStatus() {
  try {
    if (fs.existsSync(STATUS_FILE)) {
      fs.unlinkSync(STATUS_FILE);
      log('debug', 'Status file cleared');
    }
  } catch (err) {
    log('error', `Failed to clear status file: ${err.message}`);
  }
}

/**
 * Start countdown timer display
 */
function startCountdown(resetTime) {
  if (countdownInterval) {
    clearInterval(countdownInterval);
  }

  currentResetTime = resetTime;

  countdownInterval = setInterval(() => {
    const now = new Date();
    const remaining = currentResetTime - now;

    if (remaining <= 0) {
      clearInterval(countdownInterval);
      countdownInterval = null;
      process.stdout.write(
        `\r${colors.green}[READY] Reset time reached! Sending continue...${colors.reset}\n`
      );

      // Send continue to terminals
      sendContinueToTerminals()
        .then(() => {
          log('success', 'Auto-resume completed!');
          clearStatus();
          currentResetTime = null;
        })
        .catch((err) => {
          log('error', `Auto-resume failed: ${err.message}`);
        });
    } else {
      const formatted = formatTimeRemaining(remaining);
      process.stdout.write(
        `\r${colors.yellow}[WAITING] Resuming in ${formatted}...${colors.reset}`
      );
    }
  }, 1000);
}

/**
 * Stop countdown timer
 */
function stopCountdown() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
    process.stdout.write('\n');
  }
  currentResetTime = null;
}

/**
 * Read and parse status file
 */
function readStatus() {
  try {
    if (!fs.existsSync(STATUS_FILE)) {
      return null;
    }

    const content = fs.readFileSync(STATUS_FILE, 'utf8');
    const status = JSON.parse(content);

    // Validate required fields
    if (!status.detected || !status.reset_time) {
      return null;
    }

    return status;
  } catch (err) {
    log('error', `Failed to read status file: ${err.message}`);
    return null;
  }
}

/**
 * Watch status file for changes
 */
function watchStatusFile() {
  // Check status file every second
  watchInterval = setInterval(() => {
    try {
      if (!fs.existsSync(STATUS_FILE)) {
        // No status file, stop countdown if running
        if (currentResetTime) {
          log('info', 'Status file removed, stopping countdown');
          stopCountdown();
        }
        return;
      }

      const stats = fs.statSync(STATUS_FILE);
      const currentMtime = stats.mtimeMs;

      // Check if file was modified
      if (lastStatusMtime && currentMtime === lastStatusMtime) {
        return; // No changes
      }

      lastStatusMtime = currentMtime;

      // Read and parse status
      const status = readStatus();

      if (!status) {
        return;
      }

      // Check if rate limit is detected
      if (status.detected && status.reset_time) {
        const resetTime = new Date(status.reset_time);

        if (isNaN(resetTime.getTime())) {
          log('error', `Invalid reset_time in status file: ${status.reset_time}`);
          return;
        }

        // Only start new countdown if reset time changed
        if (!currentResetTime || currentResetTime.getTime() !== resetTime.getTime()) {
          log('warning', '');
          log('warning', 'Rate limit detected!');
          log('info', `Reset time: ${resetTime.toLocaleString()}`);
          log('info', `Message: ${status.message || 'N/A'}`);
          log('debug', `Timezone: ${status.timezone || 'N/A'}`);

          startCountdown(resetTime);
        }
      } else if (!status.detected && currentResetTime) {
        // Rate limit cleared manually
        log('info', 'Rate limit cleared, stopping countdown');
        stopCountdown();
      }
    } catch (err) {
      log('error', `Error watching status file: ${err.message}`);
    }
  }, 1000);

  log('success', 'Watching status file for changes...');
  log('info', `Status file: ${STATUS_FILE}`);
  log('info', 'Press Ctrl+C to stop daemon');
}

/**
 * Start daemon
 */
function startDaemon() {
  // Check if already running
  const existingPid = readPidFile();
  if (existingPid && isProcessRunning(existingPid)) {
    log('warning', `Daemon is already running (PID: ${existingPid})`);
    log('info', 'Run "node auto-resume-daemon.js stop" to stop it first');
    process.exit(1);
  }

  // Clean up stale PID file
  if (existingPid) {
    removePidFile();
  }

  // Ensure directories exist
  ensureDirectories();

  // Write PID file
  writePidFile();

  // Setup signal handlers
  setupSignalHandlers();

  // Show banner
  showBanner();

  log('success', `Daemon started (PID: ${process.pid})`);
  log('info', `Log file: ${LOG_FILE}`);
  log('info', `PID file: ${PID_FILE}`);

  // Start watching
  isRunning = true;
  watchStatusFile();
}

/**
 * Setup signal handlers for graceful shutdown
 */
function setupSignalHandlers() {
  const shutdown = (signal) => {
    console.log('');
    log('info', `Received ${signal}, shutting down gracefully...`);

    // Stop watching
    if (watchInterval) {
      clearInterval(watchInterval);
      watchInterval = null;
    }

    // Stop countdown
    stopCountdown();

    // Remove PID file
    removePidFile();

    log('success', 'Daemon stopped');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Handle uncaught errors
  process.on('uncaughtException', (err) => {
    log('error', `Uncaught exception: ${err.message}`);
    log('error', err.stack);
    shutdown('ERROR');
  });
}

/**
 * Show banner
 */
function showBanner() {
  console.log('');
  console.log(
    `${colors.magenta}  ╔═══════════════════════════════════════════════════════════════╗${colors.reset}`
  );
  console.log(
    `${colors.magenta}  ║      Claude Code Auto-Resume Daemon v${VERSION}                 ║${colors.reset}`
  );
  console.log(
    `${colors.magenta}  ║      Background service for automatic session resume          ║${colors.reset}`
  );
  console.log(
    `${colors.magenta}  ╚═══════════════════════════════════════════════════════════════╝${colors.reset}`
  );
  console.log('');
}

/**
 * Show help
 */
function showHelp() {
  showBanner();
  console.log(`
USAGE:
    node auto-resume-daemon.js <command>

COMMANDS:
    start       Start the daemon in background
    stop        Stop the running daemon
    status      Check daemon status
    restart     Restart the daemon
    help        Show this help message

DAEMON BEHAVIOR:
    1. Watches: ${STATUS_FILE}
    2. When rate limit detected (status.detected = true):
       - Parses reset_time from status file
       - Shows countdown timer in console
       - When reset time arrives:
         - Finds all Claude Code terminal windows
         - Sends "continue" + Enter keystroke
         - Clears the status file
    3. Logs all activity to: ${LOG_FILE}

STATUS FILE FORMAT:
    {
      "detected": true,
      "reset_time": "2026-01-21T20:00:00.000Z",
      "message": "You've hit your limit · resets 8pm (Asia/Dhaka)",
      "timezone": "Asia/Dhaka"
    }

CROSS-PLATFORM SUPPORT:
    Windows: Uses PowerShell to find and control Claude windows
    Linux:   Uses xdotool (requires installation)
    macOS:   Uses osascript to control Terminal/iTerm

EXAMPLES:
    # Start daemon
    node auto-resume-daemon.js start

    # Check if running
    node auto-resume-daemon.js status

    # Stop daemon
    node auto-resume-daemon.js stop

    # Restart daemon
    node auto-resume-daemon.js restart

FILES:
    Status:  ${STATUS_FILE}
    PID:     ${PID_FILE}
    Log:     ${LOG_FILE}

`);
}

/**
 * Main entry point
 */
function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';

  switch (command) {
    case 'start':
      startDaemon();
      break;

    case 'stop':
      stopDaemon();
      process.exit(0);
      break;

    case 'status':
      getDaemonStatus();
      process.exit(0);
      break;

    case 'restart':
      log('info', 'Restarting daemon...');
      stopDaemon();
      setTimeout(() => {
        startDaemon();
      }, 1000);
      break;

    case 'help':
    case '--help':
    case '-h':
      showHelp();
      process.exit(0);
      break;

    default:
      log('error', `Unknown command: ${command}`);
      log('info', 'Run "node auto-resume-daemon.js help" for usage');
      process.exit(1);
  }
}

// Run main
main();
