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

// New tiered delivery modules
const { deliverResume } = require('./src/delivery/tiered-delivery');
const { verifyResumeByTranscript } = require('./src/verification/transcript-verifier');
const { RateLimitQueue } = require('./src/queue/rate-limit-queue');

// Load modules with graceful fallback
let configManager = null;
let AnalyticsCollector = null;
let NotificationManager = null;

try {
  configManager = require('./src/modules/config-manager');
} catch (err) {
  // Module not available, will show error when command is used
}

try {
  AnalyticsCollector = require('./src/modules/analytics-collector');
} catch (err) {
  // Module not available, will show error when command is used
}

try {
  NotificationManager = require('./src/modules/notification-manager');
} catch (err) {
  // Module not available, will show error when command is used
}

let DashboardIntegration = null;
try {
  DashboardIntegration = require('./src/modules/dashboard-integration');
} catch (err) {
  // Module not available, will show error when command is used
}

const VERSION = '1.3.0';
const HOME_DIR = os.homedir();
const BASE_DIR = path.join(HOME_DIR, '.claude', 'auto-resume');
const STATUS_FILE = path.join(BASE_DIR, 'status.json');
const PID_FILE = path.join(BASE_DIR, 'daemon.pid');
const LOG_FILE = path.join(BASE_DIR, 'daemon.log');
const HEARTBEAT_FILE = path.join(BASE_DIR, 'heartbeat.json');

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

// Log rotation settings
const MAX_LOG_SIZE_BYTES = 1 * 1024 * 1024; // 1MB
let logCallCount = 0;
const LOG_ROTATION_CHECK_INTERVAL = 100; // Check size every N log calls

// State management
let isRunning = false;
let watchInterval = null;
let countdownInterval = null;
let heartbeatInterval = null;
let selfWatchdogInterval = null;
let transcriptPollInterval = null;
let currentResetTime = null;
let lastStatusMtime = null;
let isBackgroundMode = false;  // Track if running detached (no stdout)
let dashboard = null;  // Dashboard integration instance
let currentQueueEntryId = null;

/**
 * Safe stdout write - handles EPIPE errors when running detached
 */
function safeStdoutWrite(text) {
  try {
    if (!isBackgroundMode && process.stdout && process.stdout.writable) {
      process.stdout.write(text);
    }
  } catch (err) {
    // If we get EPIPE, switch to background mode silently
    if (err.code === 'EPIPE') {
      isBackgroundMode = true;
    }
  }
}

/**
 * Rotate log file if it exceeds MAX_LOG_SIZE_BYTES.
 * Keeps one backup: daemon.log -> daemon.log.1
 */
function rotateLogIfNeeded() {
  try {
    if (!fs.existsSync(LOG_FILE)) return;
    const stats = fs.statSync(LOG_FILE);
    if (stats.size >= MAX_LOG_SIZE_BYTES) {
      const backupPath = LOG_FILE + '.1';
      try { fs.unlinkSync(backupPath); } catch (e) { /* no backup yet */ }
      fs.renameSync(LOG_FILE, backupPath);
    }
  } catch (err) {
    // Ignore rotation errors — don't break logging
  }
}

/**
 * Logging utility - handles background mode gracefully
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

  // Write to console (safely, handles EPIPE)
  if (!isBackgroundMode) {
    try {
      console.log(consoleMessage);
    } catch (err) {
      if (err.code === 'EPIPE') {
        isBackgroundMode = true;
      }
    }
  }

  // Rotate log file periodically to prevent unbounded growth
  logCallCount++;
  if (logCallCount % LOG_ROTATION_CHECK_INTERVAL === 0) {
    rotateLogIfNeeded();
  }

  // Always write to log file (critical for background operation)
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
 * Write heartbeat file with current timestamp and PID.
 * Called every 30 seconds so SessionStart hook can detect wedged daemons.
 */
function writeHeartbeat() {
  try {
    fs.writeFileSync(HEARTBEAT_FILE, JSON.stringify({
      timestamp: Date.now(),
      pid: process.pid
    }), 'utf8');
  } catch (err) {
    // Non-fatal — log but don't crash
    log('debug', `Failed to write heartbeat: ${err.message}`);
  }
}

/**
 * Start periodic heartbeat writes (every 30 seconds)
 */
function startHeartbeat() {
  writeHeartbeat(); // Write immediately on start
  heartbeatInterval = setInterval(writeHeartbeat, 30000);
  log('debug', `Heartbeat started (writing to ${HEARTBEAT_FILE} every 30s)`);
}

/**
 * Stop heartbeat interval
 */
function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  // Clean up heartbeat file on clean shutdown
  try {
    if (fs.existsSync(HEARTBEAT_FILE)) {
      fs.unlinkSync(HEARTBEAT_FILE);
    }
  } catch (err) {
    // Ignore
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

function sendNotification(title, message) {
  if (NotificationManager) {
    try {
      const notifier = new NotificationManager();
      notifier.init({ enabled: true, sound: true });
      notifier.notify(title, message).catch(() => {});
    } catch (e) {
      // Best effort
    }
  }
}

/**
 * Send keystrokes via xdotool (extracted from original Linux branch).
 * Used as Tier 3 fallback by the tiered delivery system.
 * @param {number|null} claudePid - Claude Code PID for targeted window finding
 * @returns {Promise<void>}
 */
function sendContinueViaXdotool(claudePid) {
  return new Promise((resolve, reject) => {
    // Use which to find xdotool (more reliable across environments than command -v)
    exec('which xdotool 2>/dev/null || command -v xdotool 2>/dev/null', (error, xdotoolPath) => {
      const xdotool = xdotoolPath ? xdotoolPath.trim() : null;
      if (error || !xdotool) {
        log('error', 'xdotool not found. Please install it:');
        log('info', '  Ubuntu/Debian: sudo apt-get install xdotool');
        log('info', '  RHEL/CentOS: sudo yum install xdotool');
        log('info', '  Arch: sudo pacman -S xdotool');
        reject(new Error('xdotool not found'));
        return;
      }

      log('debug', `Using xdotool at: ${xdotool}`);

      // Write shell script to temp file to avoid exec escaping/buffer issues
      const tempScript = path.join(os.tmpdir(), `claude-auto-resume-send-${process.pid}.sh`);
      const scriptLines = [
        '#!/bin/sh',
        'set +e',
        `XDOT="${xdotool}"`,
        'SENT=0',
        'STRATEGY=""',
        'WINDOW_IDS=""',
        '',
        '# Save current active window to restore focus later',
        'ORIG_WID=$($XDOT getactivewindow 2>/dev/null || true)',
      ];

      // Strategy 1: Find terminal window via saved Claude Code PID
      if (claudePid) {
        scriptLines.push(
          '',
          '# Strategy 1: Saved Claude PID process tree walk',
          `WALK_PID=${claudePid}`,
          'if kill -0 "$WALK_PID" 2>/dev/null; then',
          '  while [ -n "$WALK_PID" ] && [ "$WALK_PID" != "1" ] && [ "$WALK_PID" != "0" ]; do',
          '    WIDS=$($XDOT search --pid "$WALK_PID" 2>/dev/null)',
          '    if [ -n "$WIDS" ]; then',
          '      WINDOW_IDS="$WIDS"',
          '      STRATEGY="saved-pid"',
          '      break',
          '    fi',
          '    WALK_PID=$(ps -o ppid= -p "$WALK_PID" 2>/dev/null | tr -d " ")',
          '  done',
          'fi',
        );
      }

      // Strategy 2: Find live Claude Code processes
      scriptLines.push(
        '',
        '# Strategy 2: Live Claude process discovery',
        'if [ -z "$WINDOW_IDS" ]; then',
        `  DAEMON_PID=${process.pid}`,
        '  CLAUDE_PIDS=$(pgrep -f "claude-code|claude --" 2>/dev/null | grep -v "^$DAEMON_PID$" | grep -v "auto-resume-daemon" | head -10)',
        '  for cpid in $CLAUDE_PIDS; do',
        '    WALK_PID=$cpid',
        '    while [ -n "$WALK_PID" ] && [ "$WALK_PID" != "1" ] && [ "$WALK_PID" != "0" ]; do',
        '      WIDS=$($XDOT search --pid "$WALK_PID" 2>/dev/null)',
        '      if [ -n "$WIDS" ]; then',
        '        for wid in $WIDS; do',
        '          case " $WINDOW_IDS " in',
        '            *" $wid "*) ;;',
        '            *) WINDOW_IDS="$WINDOW_IDS $wid" ;;',
        '          esac',
        '        done',
        '        break',
        '      fi',
        '      WALK_PID=$(ps -o ppid= -p "$WALK_PID" 2>/dev/null | tr -d " ")',
        '    done',
        '  done',
        '  WINDOW_IDS=$(echo $WINDOW_IDS | xargs)',
        '  if [ -n "$WINDOW_IDS" ]; then',
        '    STRATEGY="live-pid"',
        '  fi',
        'fi',
      );

      // Strategy 3: All terminal windows (fallback)
      scriptLines.push(
        '',
        '# Strategy 3: All terminal windows (last resort)',
        'if [ -z "$WINDOW_IDS" ]; then',
        '  WINDOW_IDS=$($XDOT search --class "gnome-terminal|Gnome-terminal|konsole|Konsole|xterm|XTerm|terminator|Terminator|alacritty|Alacritty|kitty|Kitty|tilix|Tilix|foot|wezterm|WezTerm" 2>/dev/null)',
        '  if [ -z "$WINDOW_IDS" ]; then',
        '    WINDOW_IDS=$($XDOT search --name "Terminal|terminal|konsole|Konsole" 2>/dev/null)',
        '  fi',
        '  if [ -n "$WINDOW_IDS" ]; then',
        '    STRATEGY="all-terminals"',
        '  fi',
        'fi',
      );

      // Send keystrokes
      // IMPORTANT: Do NOT use --window flag with xdotool type/key.
      // --window uses XSendEvent which gnome-terminal (and many apps) silently ignore.
      // Without --window, xdotool uses XTEST extension which injects real keystrokes.
      scriptLines.push(
        '',
        'if [ -z "$WINDOW_IDS" ]; then',
        '  echo "ERROR: No terminal windows found"',
        '  exit 1',
        'fi',
        '',
        '# Filter to real terminal windows (must have WM_CLASS)',
        'VALID_WIDS=""',
        'for wid in $WINDOW_IDS; do',
        '  if xprop -id "$wid" WM_CLASS 2>/dev/null | grep -q "not found"; then',
        '    continue',
        '  fi',
        '  case " $VALID_WIDS " in',
        '    *" $wid "*) ;;',
        '    *) VALID_WIDS="$VALID_WIDS $wid" ;;',
        '  esac',
        'done',
        'VALID_WIDS=$(echo $VALID_WIDS | xargs)',
        '',
        'if [ -z "$VALID_WIDS" ]; then',
        '  echo "ERROR: No valid terminal windows found"',
        '  exit 1',
        'fi',
        '',
        '# Count terminal tabs: each bash child of gnome-terminal = one tab',
        'TAB_COUNT=1',
        'for wid in $VALID_WIDS; do',
        '  WM_CLASS=$(xprop -id "$wid" WM_CLASS 2>/dev/null || true)',
        '  case "$WM_CLASS" in',
        '    *gnome-terminal*|*Gnome-terminal*)',
        '      # Count bash children of gnome-terminal-server for tab count',
        '      GT_PID=$(xprop -id "$wid" _NET_WM_PID 2>/dev/null | grep -oP "\\d+" || true)',
        '      if [ -n "$GT_PID" ]; then',
        '        TC=$(ps --ppid "$GT_PID" -o comm= 2>/dev/null | grep -c bash || true)',
        '        if [ "$TC" -gt "$TAB_COUNT" ]; then TAB_COUNT=$TC; fi',
        '      fi',
        '      ;;',
        '  esac',
        'done',
        '',
        'for wid in $VALID_WIDS; do',
        '  # Activate window (raises and focuses it) with timeout to prevent hangs',
        '  timeout 2 $XDOT windowactivate --sync "$wid" 2>/dev/null || $XDOT windowfocus "$wid" 2>/dev/null',
        '  sleep 0.3',
        '',
        '  # Cycle through all tabs in this window and send keystrokes to each',
        '  TAB_IDX=0',
        '  while [ "$TAB_IDX" -lt "$TAB_COUNT" ]; do',
        '    if [ "$TAB_IDX" -gt 0 ]; then',
        '      # Switch to next tab',
        '      $XDOT key --clearmodifiers ctrl+Page_Down 2>/dev/null',
        '      sleep 0.5',
        '    fi',
        '    # Use XTEST (no --window flag) so keystrokes are not ignored by terminal',
        '    $XDOT key --clearmodifiers Escape 2>/dev/null',
        '    sleep 0.3',
        '    $XDOT key --clearmodifiers ctrl+u 2>/dev/null',
        '    sleep 0.3',
        '    $XDOT type --clearmodifiers --delay 50 "continue" 2>/dev/null',
        '    sleep 0.2',
        '    $XDOT key Return 2>/dev/null',
        '    sleep 0.3',
        '    SENT=$((SENT + 1))',
        '    TAB_IDX=$((TAB_IDX + 1))',
        '  done',
        'done',
        '',
        '# Restore original window focus',
        'if [ -n "$ORIG_WID" ]; then',
        '  timeout 2 $XDOT windowactivate --sync "$ORIG_WID" 2>/dev/null || $XDOT windowfocus "$ORIG_WID" 2>/dev/null || true',
        'fi',
        '',
        'echo "Sent to $SENT window(s) (strategy: $STRATEGY)"',
        'exit 0',
      );

      fs.writeFileSync(tempScript, scriptLines.join('\n'), { mode: 0o755 });

      exec(`/bin/sh "${tempScript}"`, { timeout: 30000 }, (err, stdout, stderr) => {
        // Clean up temp file
        try { fs.unlinkSync(tempScript); } catch (e) { /* ignore */ }

        if (err) {
          log('error', `Failed to send keystrokes: ${err.message}`);
          if (stderr) log('debug', `stderr: ${stderr}`);
          reject(err);
        } else {
          const output = stdout.trim();
          if (output.startsWith('ERROR:')) {
            log('error', output);
            reject(new Error(output));
          } else {
            log('success', 'Sent: Escape, Ctrl+U, then continue + Enter to terminal windows');
            if (output) log('info', output);
            resolve();
          }
        }
      });
    });
  });
}

/**
 * Send keystrokes to Claude Code terminals
 * Handles the rate limit recovery flow:
 * 1. Press Escape to dismiss any open interactive menu (rate-limit-options)
 * 2. Press Ctrl+U to clear any stale input on the command line
 * 3. Type "continue" + Enter to resume the conversation
 *
 * The interactive menu (rate-limit-options) uses arrow keys + Enter navigation,
 * NOT number key selection. Option 1 is selected by default, but we dismiss
 * the menu with Escape instead to avoid state ambiguity.
 */
async function sendContinueToTerminals() {
  const platform = os.platform();

  return new Promise((resolve, reject) => {
    if (platform === 'win32') {
      // Windows: Write script to temp file to avoid escaping issues
      const tempScript = path.join(os.tmpdir(), 'claude-auto-resume-send.ps1');
      const scriptContent = `
Add-Type -AssemblyName System.Windows.Forms

# Step 1: Press Escape to dismiss any open interactive menu
[System.Windows.Forms.SendKeys]::SendWait('{ESC}')
Start-Sleep -Milliseconds 500

# Step 2: Press Ctrl+U to clear any stale input
[System.Windows.Forms.SendKeys]::SendWait('^u')
Start-Sleep -Milliseconds 300

# Step 3: Type 'continue' + Enter to resume the conversation
[System.Windows.Forms.SendKeys]::SendWait('continue{ENTER}')
Write-Output "Sent Escape, Ctrl+U, then continue + Enter"
`;

      // Write script to temp file
      fs.writeFileSync(tempScript, scriptContent, 'utf8');

      // Execute the script file
      exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tempScript}"`, (error, stdout) => {
        // Clean up temp file
        try { fs.unlinkSync(tempScript); } catch (e) { /* ignore */ }

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
                -- Step 1: Press Escape to dismiss any open menu
                key code 53
                delay 0.5
                -- Step 2: Press Ctrl+U to clear input line
                keystroke "u" using control down
                delay 0.3
                -- Step 3: Type 'continue' + Return to resume
                keystroke "continue"
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
          log('success', `Sent: Escape, Ctrl+U, then continue + Enter to terminal windows`);
          resolve();
        }
      });
    } else {
      // Linux: Use tiered delivery (tmux > PTY > xdotool)
      // Read Claude PID from status file (supports both old format and queue format)
      let claudePid = null;
      try {
        if (fs.existsSync(STATUS_FILE)) {
          const statusData = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
          claudePid = statusData.claude_pid;
          if (!claudePid && statusData.queue) {
            const active = statusData.queue.find(e => e.claude_pid);
            if (active) claudePid = active.claude_pid;
          }
        }
      } catch (e) {
        log('debug', 'Could not read claude_pid from status file');
      }

      const resumeText = 'continue';
      deliverResume({
        claudePid,
        resumeText,
        log,
        xdotoolFallback: () => sendContinueViaXdotool(claudePid),
      }).then((result) => {
        if (result.success) {
          log('success', `Delivery succeeded via ${result.tier} (tried: ${result.tiersAttempted.join(', ')})`);
          resolve();
        } else {
          log('error', `All delivery tiers failed: ${result.error} (tried: ${result.tiersAttempted.join(', ')})`);
          reject(new Error(result.error || 'All delivery tiers failed'));
        }
      }).catch((err) => {
        log('error', `Tiered delivery error: ${err.message}`);
        reject(err);
      });
    }
  });
}

/**
 * Trigger manual resume from GUI or API
 * Sends keystrokes to terminal and clears status
 */
function triggerResume() {
  log('info', 'Manual resume triggered');
  sendContinueToTerminals()
    .then(() => {
      log('success', 'Manual resume completed!');
      clearStatus();
      currentResetTime = null;
      stopCountdown();
    })
    .catch((err) => {
      log('error', `Manual resume failed: ${err.message}`);
    });
}

/**
 * Clear status file
 */
function clearStatus() {
  try {
    if (currentQueueEntryId) {
      const queue = new RateLimitQueue(STATUS_FILE);
      queue.updateEntryStatus(currentQueueEntryId, 'completed');
      currentQueueEntryId = null;
    } else if (fs.existsSync(STATUS_FILE)) {
      fs.unlinkSync(STATUS_FILE);
    }
    log('debug', 'Status cleared');
  } catch (err) {
    log('error', `Failed to clear status: ${err.message}`);
  }
}

/**
 * Reset status - user-facing command to clear stale rate limit status
 */
function resetStatus() {
  ensureDirectories();

  if (!fs.existsSync(STATUS_FILE)) {
    log('info', 'No rate limit status found. Nothing to reset.');
    return true;
  }

  try {
    // Read current status for logging
    const content = fs.readFileSync(STATUS_FILE, 'utf8');
    const status = JSON.parse(content);

    if (status.detected && status.reset_time) {
      const resetTime = new Date(status.reset_time);
      const now = new Date();

      if (resetTime > now) {
        log('warning', `Active rate limit found (resets at ${resetTime.toLocaleString()})`);
      } else {
        log('info', `Stale rate limit found (was set to reset at ${resetTime.toLocaleString()})`);
      }
    }

    // Clear the status file
    fs.unlinkSync(STATUS_FILE);
    log('success', 'Rate limit status has been reset.');
    log('info', 'The daemon will now wait for new rate limit detection.');

    return true;
  } catch (err) {
    log('error', `Failed to reset status: ${err.message}`);
    return false;
  }
}

/**
 * Get a config value with fallback to default
 * @param {string} key - dot-notation config key
 * @param {*} defaultValue - fallback if config unavailable
 */
function getConfigValue(key, defaultValue) {
  if (!configManager) return defaultValue;
  try {
    const config = configManager.getConfig();
    const parts = key.split('.');
    let val = config;
    for (const part of parts) {
      if (val && typeof val === 'object' && part in val) {
        val = val[part];
      } else {
        return defaultValue;
      }
    }
    return val;
  } catch (e) {
    return defaultValue;
  }
}

/**
 * Send keystrokes with retry on failure.
 * @param {number} maxRetries - max retry attempts
 * @param {number} retryDelaySec - seconds between retries
 * @returns {Promise<boolean>} true if send succeeded
 */
async function sendWithRetry(maxRetries = 3, retryDelaySec = 10) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await sendContinueToTerminals();
      return true;
    } catch (err) {
      log('error', `Keystroke send failed (attempt ${attempt}/${maxRetries}): ${err.message}`);
      if (attempt < maxRetries) {
        log('info', `Retrying in ${retryDelaySec} seconds...`);
        await new Promise(resolve => setTimeout(resolve, retryDelaySec * 1000));
      }
    }
  }
  log('error', `All ${maxRetries} keystroke send attempts failed`);
  return false;
}

/**
 * Attempt resume with post-send verification.
 * After sending keystrokes, watches status.json for re-detection.
 * If rate limit re-appears, retries with exponential backoff.
 */
async function attemptResume() {
  const maxRetries = getConfigValue('resume.maxRetries', 4);
  const verificationWindowSec = getConfigValue('resume.verificationWindowSec', 90);
  const backoffDelays = [10, 20, 40, 60]; // seconds between resume retries

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = backoffDelays[Math.min(attempt - 1, backoffDelays.length - 1)];
      log('warning', `Resume attempt ${attempt + 1}/${maxRetries + 1} after ${delay}s backoff...`);
      await new Promise(resolve => setTimeout(resolve, delay * 1000));
    }

    log('info', 'Sending continue to terminals...');
    const sent = await sendWithRetry(3, 10);
    if (!sent) {
      log('error', 'Failed to send keystrokes, will retry resume cycle');
      continue;
    }

    // Record the timestamp right after sending
    const sentAt = Date.now();

    // Active verification: check for new transcript activity
    let transcriptPath = null;
    try {
      if (fs.existsSync(STATUS_FILE)) {
        const statusData = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
        transcriptPath = statusData.transcript_path;
        if (!transcriptPath && statusData.queue) {
          const active = statusData.queue.find(e => e.transcript_path);
          if (active) transcriptPath = active.transcript_path;
        }
      }
    } catch (e) { /* ignore */ }

    if (transcriptPath && fs.existsSync(transcriptPath)) {
      log('info', 'Verifying resume via transcript activity...');
      const baselineStats = fs.statSync(transcriptPath);
      const verification = await verifyResumeByTranscript({
        transcriptPath,
        baselineMtime: baselineStats.mtimeMs,
        baselineSize: baselineStats.size,
        timeoutMs: getConfigValue('resume.activeVerificationTimeoutMs', 15000),
        pollIntervalMs: getConfigValue('resume.activeVerificationPollMs', 1000),
      });

      if (verification.verified) {
        log('success', `Auto-resume CONFIRMED! Transcript activity detected (+${verification.newBytes} bytes in ${verification.elapsedMs}ms)`);
        sendNotification('Claude Code Resumed', 'Auto-resume successful after rate limit reset.');
        clearStatus();
        currentResetTime = null;
        return;
      } else {
        log('warning', 'No transcript activity detected - delivery may have failed');
        continue; // Try next attempt
      }
    }
    // If no transcript path, fall through to existing passive verification

    // Watch for re-detection within the verification window
    log('info', `Verifying resume for ${verificationWindowSec}s...`);
    const reDetected = await new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const elapsed = (Date.now() - sentAt) / 1000;
        if (elapsed >= verificationWindowSec) {
          clearInterval(checkInterval);
          resolve(false); // No re-detection — success!
        }

        try {
          if (fs.existsSync(STATUS_FILE)) {
            const status = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
            // Check if a NEW detection occurred after we sent keystrokes
            if (status.detected && status.last_detected) {
              const detectedAt = new Date(status.last_detected).getTime();
              if (detectedAt > sentAt) {
                clearInterval(checkInterval);
                resolve(true); // Re-detected — resume failed
              }
            }
          }
        } catch (e) {
          // Ignore read errors during verification
        }
      }, 10000); // Check every 10 seconds
    });

    if (!reDetected) {
      log('success', 'Auto-resume completed! No re-detection within verification window.');
      clearStatus();
      currentResetTime = null;
      return;
    }

    log('warning', 'Rate limit re-detected after resume attempt — API may not be ready yet');
  }

  // All attempts exhausted
  log('error', `Resume failed after ${maxRetries + 1} attempts`);
  if (NotificationManager) {
    try {
      const notifier = new NotificationManager();
      notifier.init({ enabled: true, sound: true });
      await notifier.notify('Auto-Resume Failed', `Failed to resume after ${maxRetries + 1} attempts. Manual intervention needed.`);
    } catch (e) {
      // Best effort
    }
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
  const postResetDelaySec = getConfigValue('resume.postResetDelaySec', 10);

  countdownInterval = setInterval(() => {
    const now = new Date();
    const remaining = currentResetTime - now;

    if (remaining <= 0) {
      clearInterval(countdownInterval);
      countdownInterval = null;
      safeStdoutWrite(
        `\r${colors.green}[READY] Reset time reached! Waiting ${postResetDelaySec}s for API to fully reset...${colors.reset}\n`
      );
      log('info', `Reset time reached! Waiting ${postResetDelaySec} seconds for API to fully reset...`);

      // Wait for configurable delay after reset time before attempting resume
      setTimeout(() => {
        attemptResume();
      }, postResetDelaySec * 1000);
    } else {
      const formatted = formatTimeRemaining(remaining);
      safeStdoutWrite(
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
    safeStdoutWrite('\n');
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
 * Check for existing rate limit status on daemon startup
 */
function initialStatusCheck() {
  const status = readStatus();

  if (!status) {
    log('debug', 'No existing rate limit status found on startup');
    return;
  }

  log('info', 'Found existing rate limit status on startup');

  try {
    const resetTime = new Date(status.reset_time);
    const now = new Date();

    if (resetTime > now) {
      // Reset time is in the future - start countdown
      const remaining = resetTime - now;
      const formatted = formatTimeRemaining(remaining);
      log('info', `Rate limit active. Resuming in ${formatted}...`);
      startCountdown(resetTime);
    } else {
      // Reset time has already passed - trigger resume immediately
      log('info', 'Reset time already passed, triggering resume immediately');
      sendContinueToTerminals()
        .then(() => {
          log('success', 'Auto-resume completed for past rate limit!');
          clearStatus();
        })
        .catch((err) => {
          log('error', `Auto-resume failed: ${err.message}`);
        });
    }
  } catch (err) {
    log('error', `Failed to process existing status: ${err.message}`);
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

      // Try queue-based reading first
      const queue = new RateLimitQueue(STATUS_FILE);
      const nextEntry = queue.getNextPending();

      if (nextEntry) {
        const resetTime = new Date(nextEntry.reset_time);
        if (isNaN(resetTime.getTime())) {
          log('error', `Invalid reset_time in queue: ${nextEntry.reset_time}`);
          return;
        }
        if (!currentResetTime || currentResetTime.getTime() !== resetTime.getTime()) {
          log('warning', '');
          log('warning', 'Rate limit detected!');
          log('info', `Reset time: ${resetTime.toLocaleString()}`);
          log('info', `Message: ${nextEntry.message || 'N/A'}`);
          currentQueueEntryId = nextEntry.id;

          if (dashboard) {
            dashboard.updateDaemonStatus({
              detected: true,
              reset_time: nextEntry.reset_time,
              message: nextEntry.message || 'Rate limit detected'
            });
          }

          startCountdown(resetTime);
        }
        return; // Queue handled it, skip old-format reading
      }

      // Read and parse status (old format fallback)
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

          // Update dashboard with rate limit status
          if (dashboard) {
            dashboard.updateDaemonStatus({
              detected: true,
              reset_time: status.reset_time,
              message: status.message || 'Rate limit detected'
            });
          }

          startCountdown(resetTime);
        }
      } else if (!status.detected && currentResetTime) {
        // Rate limit cleared manually
        log('info', 'Rate limit cleared, stopping countdown');

        // Update dashboard with cleared status
        if (dashboard) {
          dashboard.updateDaemonStatus({
            detected: false,
            message: 'Rate limit cleared'
          });
        }

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
 * Self-watchdog: verify daemon's own health every 60 seconds.
 * Checks that watch interval is active, directories are writable,
 * and memory usage is within limits.
 */
function startSelfWatchdog() {
  selfWatchdogInterval = setInterval(() => {
    try {
      // Check 1: watch interval is still active
      if (isRunning && !watchInterval) {
        log('warning', '[WATCHDOG] Watch interval lost, restarting...');
        watchStatusFile();
      }

      // Check 2: base directory is writable
      try {
        fs.accessSync(BASE_DIR, fs.constants.W_OK);
      } catch (e) {
        log('error', `[WATCHDOG] Base directory not writable: ${BASE_DIR}`);
        // Attempt to recreate
        try { fs.mkdirSync(BASE_DIR, { recursive: true }); } catch (e2) { /* give up */ }
      }

      // Check 3: memory usage < 200MB
      const memUsage = process.memoryUsage();
      const heapMB = Math.round(memUsage.heapUsed / 1024 / 1024);
      if (heapMB > 200) {
        log('error', `[WATCHDOG] Memory usage too high: ${heapMB}MB. Exiting for restart.`);
        process.exit(1); // SessionStart hook will restart us
      }
    } catch (err) {
      log('error', `[WATCHDOG] Self-check failed: ${err.message}`);
    }
  }, 60000);

  log('debug', 'Self-watchdog started (checking every 60s)');
}

/**
 * Redundant transcript polling — scans recent transcripts for rate limit
 * patterns as a fallback when the Stop hook doesn't fire.
 */
function startTranscriptPolling() {
  const enabled = getConfigValue('daemon.transcriptPolling', true);
  if (!enabled) {
    log('debug', 'Transcript polling disabled by config');
    return;
  }

  // Try to import the rate-limit-hook's analyzeTranscript function
  let analyzeTranscript = null;
  let parseResetTime = null;
  try {
    // Try plugin root first, then manual install location
    const hookPaths = [
      path.join(__dirname, 'hooks', 'rate-limit-hook.js'),
      path.join(HOME_DIR, '.claude', 'hooks', 'rate-limit-hook.js'),
    ];
    for (const hookPath of hookPaths) {
      if (fs.existsSync(hookPath)) {
        const hookModule = require(hookPath);
        analyzeTranscript = hookModule.analyzeTranscript;
        parseResetTime = hookModule.parseResetTime;
        break;
      }
    }
  } catch (e) {
    log('debug', `Could not import rate-limit-hook module: ${e.message}`);
  }

  if (!analyzeTranscript) {
    log('debug', 'Transcript polling unavailable (hook module not found)');
    return;
  }

  transcriptPollInterval = setInterval(async () => {
    try {
      // Skip if we already have an active detection
      const currentStatus = readStatus();
      if (currentStatus && currentStatus.detected) {
        return; // Already tracking a rate limit
      }

      // Find the most recent transcript file
      const projectsDir = path.join(HOME_DIR, '.claude', 'projects');
      if (!fs.existsSync(projectsDir)) return;

      let latestFile = null;
      let latestMtime = 0;

      // Walk project directories to find most recent .jsonl
      const scanDir = (dir, depth = 0) => {
        if (depth > 3) return; // Don't go too deep
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              scanDir(fullPath, depth + 1);
            } else if (entry.name.endsWith('.jsonl')) {
              try {
                const stats = fs.statSync(fullPath);
                if (stats.mtimeMs > latestMtime) {
                  latestMtime = stats.mtimeMs;
                  latestFile = fullPath;
                }
              } catch (e) { /* skip unreadable */ }
            }
          }
        } catch (e) { /* skip unreadable dirs */ }
      };
      scanDir(projectsDir);

      if (!latestFile) return;

      // Only scan transcripts modified in the last 10 minutes
      if (Date.now() - latestMtime > 10 * 60 * 1000) return;

      const result = await analyzeTranscript(latestFile);
      if (result && result.detected) {
        log('warning', '[POLL] Rate limit detected via transcript polling (Stop hook may have missed it)');
        // Write to status file so the normal countdown flow picks it up
        const statusData = {
          detected: true,
          reset_time: result.reset_time,
          timezone: result.timezone,
          last_detected: new Date().toISOString(),
          message: result.message,
          detection_source: 'transcript_poll'
        };
        fs.writeFileSync(STATUS_FILE, JSON.stringify(statusData, null, 2), 'utf8');
      }
    } catch (err) {
      log('debug', `[POLL] Transcript scan error: ${err.message}`);
    }
  }, 30000); // Every 30 seconds

  log('debug', 'Transcript polling started (scanning every 30s)');
}

/**
 * Start daemon
 */
function startDaemon() {
  // Dry-run mode for CLI tests: validate command routing without starting daemon
  if (process.env.DAEMON_DRY_RUN === '1') {
    log('info', 'Dry run mode — exiting cleanly');
    process.exit(0);
  }

  // Crash-loop self-protection: refuse to start if we crashed too recently
  // This prevents rapid restart loops even without systemd StartLimitBurst
  const crashLockFile = path.join(BASE_DIR, '.last-start');
  const MIN_RESTART_INTERVAL_SEC = 30;
  try {
    if (fs.existsSync(crashLockFile)) {
      const lastStart = parseInt(fs.readFileSync(crashLockFile, 'utf8').trim(), 10);
      const elapsed = Math.floor(Date.now() / 1000) - lastStart;
      if (elapsed < MIN_RESTART_INTERVAL_SEC) {
        const wait = MIN_RESTART_INTERVAL_SEC - elapsed;
        log('warning', `Started ${elapsed}s ago (min interval: ${MIN_RESTART_INTERVAL_SEC}s). Waiting ${wait}s...`);
        // Sleep instead of exiting — avoids triggering systemd restart
        const sleepMs = wait * 1000;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, sleepMs);
      }
    }
    fs.writeFileSync(crashLockFile, String(Math.floor(Date.now() / 1000)));
  } catch (e) {
    // Non-fatal — continue startup
  }

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

  // Start heartbeat (so SessionStart hook can detect wedged daemons)
  startHeartbeat();

  // Start self-watchdog (periodic health check)
  startSelfWatchdog();

  // Start dashboard servers if available
  if (DashboardIntegration) {
    startDashboard();
  }

  // Check for existing rate limit status before starting watcher
  initialStatusCheck();

  // Start transcript polling (redundant detection fallback)
  startTranscriptPolling();

  // Start watching
  isRunning = true;
  watchStatusFile();

  // Keep event loop alive when running as a service (no TTY / stdin closed).
  // Create a server on a random port as a guaranteed event loop anchor.
  // This is more reliable than setInterval alone in Node 25+.
  const net = require('net');
  const keepAlive = net.createServer();
  keepAlive.listen(0, '127.0.0.1', () => {
    log('debug', `Keep-alive server on port ${keepAlive.address().port}`);
  });
  keepAlive.on('error', () => {}); // Ignore port conflicts
}

/**
 * Start dashboard servers
 */
async function startDashboard() {
  try {
    // Create a simple config provider for the dashboard
    const dashboardConfig = {
      get: (key) => {
        const defaults = {
          'gui.enabled': true,
          'gui.port': 3737,
          'websocket.enabled': true,
          'websocket.port': 3847,
          'api.enabled': true,
          'api.port': 3848
        };
        return defaults[key];
      },
      getConfig: () => ({
        gui: { enabled: true, port: 3737 },
        websocket: { enabled: true, port: 3847 },
        api: { enabled: true, port: 3848 }
      })
    };

    dashboard = new DashboardIntegration({
      configManager: dashboardConfig,
      logger: {
        debug: (msg) => log('debug', msg),
        info: (msg) => log('info', msg),
        warn: (msg) => log('warning', msg),
        error: (msg) => log('error', msg)
      }
    });

    await dashboard.startServers();

    // Listen for action events from GUI
    dashboard.on('action:resume', (data) => {
      log('info', `Resume requested from GUI for session: ${data.sessionId}`);
      triggerResume();
    });

    dashboard.on('action:clear', (data) => {
      log('info', `Clear requested from GUI for session: ${data.sessionId}`);
      resetStatus();
    });

    dashboard.on('action:reset_status', () => {
      log('info', 'Reset status requested from GUI');
      resetStatus();
    });

    dashboard.on('action:config_update', (data) => {
      log('info', 'Config update received from GUI');
      // Config is stored in localStorage on client side
      // Could save to daemon config file here if needed
    });

    log('success', 'Dashboard servers started');
    log('info', '  GUI: http://localhost:3737');
    log('info', '  WebSocket: ws://localhost:3847');
    log('info', '  API: http://localhost:3848');
  } catch (error) {
    log('error', `Failed to start dashboard: ${error.message}`);
    // Continue daemon operation even if dashboard fails
  }
}

/**
 * Setup signal handlers for graceful shutdown
 */
function setupSignalHandlers() {
  const shutdown = async (signal) => {
    console.log('');
    log('info', `Received ${signal}, shutting down gracefully...`);

    // Stop watching
    if (watchInterval) {
      clearInterval(watchInterval);
      watchInterval = null;
    }

    // Stop countdown
    stopCountdown();

    // Stop heartbeat
    stopHeartbeat();

    // Stop self-watchdog
    if (selfWatchdogInterval) {
      clearInterval(selfWatchdogInterval);
      selfWatchdogInterval = null;
    }

    // Stop transcript polling
    if (transcriptPollInterval) {
      clearInterval(transcriptPollInterval);
      transcriptPollInterval = null;
    }

    // Stop dashboard servers
    if (dashboard) {
      try {
        await dashboard.stopServers();
        log('info', 'Dashboard servers stopped');
      } catch (error) {
        log('error', `Error stopping dashboard: ${error.message}`);
      }
    }

    // Send death notification if this is an error shutdown
    if (signal === 'ERROR' && NotificationManager) {
      try {
        const notifier = new NotificationManager();
        notifier.init({ enabled: true, sound: false });
        await notifier.notify('Auto-Resume Daemon Crashed', `Daemon exited due to: ${signal}`);
      } catch (e) {
        // Best effort — don't let notification failure prevent clean shutdown
      }
    }

    // Remove PID file
    removePidFile();

    log('success', 'Daemon stopped');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Handle uncaught errors - but NOT EPIPE (that's expected in background)
  process.on('uncaughtException', async (err) => {
    // EPIPE is expected when running detached - just switch to background mode
    if (err.code === 'EPIPE') {
      isBackgroundMode = true;
      return;  // Don't crash, just continue
    }

    log('error', `Uncaught exception: ${err.message}`);
    log('error', err.stack);

    // Last-gasp death notification
    if (NotificationManager) {
      try {
        const notifier = new NotificationManager();
        notifier.init({ enabled: true, sound: false });
        await notifier.notify('Auto-Resume Daemon Crashed',
          `Fatal error: ${err.message}. Daemon will restart on next Claude Code session.`);
      } catch (e) {
        // Best effort — don't let notification failure prevent shutdown
      }
    }

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
 * Run test mode - simulate countdown and send keystrokes
 * @param {number} seconds - Number of seconds to wait
 */
async function runTest(seconds) {
  showBanner();
  log('warning', `[TEST MODE] Simulating rate limit with ${seconds} second countdown`);
  log('warning', 'WARNING: This will send Escape + Ctrl+U + "continue" + Enter to terminal windows!');
  log('info', '');

  const resetTime = new Date(Date.now() + seconds * 1000);

  return new Promise((resolve) => {
    const testInterval = setInterval(() => {
      const now = new Date();
      const remaining = resetTime - now;

      if (remaining <= 0) {
        clearInterval(testInterval);
        safeStdoutWrite(
          `\r${colors.green}[TEST] Countdown complete! Sending keystrokes...${colors.reset}\n`
        );

        sendContinueToTerminals()
          .then(() => {
            log('success', '[TEST] Test completed successfully!');
            resolve();
          })
          .catch((err) => {
            log('error', `[TEST] Failed to send keystrokes: ${err.message}`);
            resolve();
          });
      } else {
        const formatted = formatTimeRemaining(remaining);
        safeStdoutWrite(
          `\r${colors.yellow}[TEST] Sending "continue" in ${formatted}...${colors.reset}`
        );
      }
    }, 1000);
  });
}

/**
 * Show current configuration
 */
function showConfig() {
  if (!configManager) {
    log('error', 'config-manager module not available');
    return false;
  }

  try {
    const config = configManager.getConfig();
    console.log(`${colors.cyan}Current Configuration:${colors.reset}`);
    console.log(JSON.stringify(config, null, 2));
    console.log(`\n${colors.blue}Config file:${colors.reset} ${configManager.getConfigPath()}`);
    return true;
  } catch (err) {
    log('error', `Failed to load config: ${err.message}`);
    return false;
  }
}

/**
 * Set a configuration value
 * @param {string} key - Configuration key (supports dot notation)
 * @param {string} value - Value to set
 */
function setConfigValue(key, value) {
  if (!configManager) {
    log('error', 'config-manager module not available');
    return false;
  }

  if (!key) {
    log('error', 'Usage: node auto-resume-daemon.js config set <key> <value>');
    log('info', 'Example: node auto-resume-daemon.js config set checkInterval 10000');
    log('info', 'Example: node auto-resume-daemon.js config set notifications.enabled true');
    return false;
  }

  try {
    // Parse value to appropriate type
    let parsedValue = value;
    if (value === 'true') parsedValue = true;
    else if (value === 'false') parsedValue = false;
    else if (!isNaN(value) && value !== '') parsedValue = Number(value);

    configManager.setConfigValue(key, parsedValue);
    log('success', `Set ${key} = ${JSON.stringify(parsedValue)}`);
    return true;
  } catch (err) {
    log('error', `Failed to set config value: ${err.message}`);
    return false;
  }
}

/**
 * Show analytics statistics
 */
function showAnalytics() {
  if (!AnalyticsCollector) {
    log('error', 'analytics-collector module not available');
    return false;
  }

  try {
    const analytics = new AnalyticsCollector();
    const stats = analytics.getStatistics();
    const prediction = analytics.getPrediction();

    console.log(`${colors.cyan}Analytics Summary:${colors.reset}\n`);

    console.log(`${colors.yellow}Last 7 Days:${colors.reset}`);
    console.log(`  Rate limits: ${stats.last7Days.rateLimitCount}`);
    console.log(`  Resumes: ${stats.last7Days.resumeCount} (${stats.last7Days.successfulResumes} successful)`);
    console.log(`  Avg wait time: ${stats.last7Days.avgWaitTimeMinutes} minutes`);

    console.log(`\n${colors.yellow}Last 30 Days:${colors.reset}`);
    console.log(`  Rate limits: ${stats.last30Days.rateLimitCount}`);
    console.log(`  Resumes: ${stats.last30Days.resumeCount} (${stats.last30Days.successfulResumes} successful)`);
    console.log(`  Daily average: ${stats.last30Days.dailyAverage.toFixed(1)} rate limits/day`);

    console.log(`\n${colors.yellow}All Time:${colors.reset}`);
    console.log(`  Total rate limits: ${stats.allTime.rateLimitCount}`);
    console.log(`  Total resumes: ${stats.allTime.resumeCount}`);

    console.log(`\n${colors.yellow}Prediction:${colors.reset}`);
    console.log(`  Confidence: ${prediction.confidence}`);
    console.log(`  ${prediction.message}`);

    return true;
  } catch (err) {
    log('error', `Failed to load analytics: ${err.message}`);
    return false;
  }
}

/**
 * Show daemon logs
 * @param {Object} options - Log options
 * @param {number} [options.lines=20] - Number of lines to show
 * @param {boolean} [options.follow=false] - Follow log file (not implemented for CLI)
 */
function showLogs(options = {}) {
  const lines = options.lines || 20;
  const logFile = path.join(BASE_DIR, 'daemon.log');

  if (!fs.existsSync(logFile)) {
    log('info', 'No log file found. The daemon may not have run yet.');
    console.log(`\n${colors.blue}Log file location:${colors.reset} ${logFile}`);
    return true;
  }

  try {
    const content = fs.readFileSync(logFile, 'utf8');
    const allLines = content.split('\n').filter(line => line.trim());

    if (allLines.length === 0) {
      log('info', 'Log file is empty');
      return true;
    }

    const displayLines = allLines.slice(-lines);

    console.log(`${colors.cyan}Daemon Logs${colors.reset} (last ${displayLines.length} of ${allLines.length} lines):`);
    console.log(`${colors.blue}Log file:${colors.reset} ${logFile}\n`);

    displayLines.forEach(line => {
      // Colorize log levels
      let coloredLine = line
        .replace(/\[ERROR\]/g, `${colors.red}[ERROR]${colors.reset}`)
        .replace(/\[WARNING\]/g, `${colors.yellow}[WARNING]${colors.reset}`)
        .replace(/\[INFO\]/g, `${colors.cyan}[INFO]${colors.reset}`)
        .replace(/\[SUCCESS\]/g, `${colors.green}[SUCCESS]${colors.reset}`)
        .replace(/\[DEBUG\]/g, `${colors.magenta}[DEBUG]${colors.reset}`);
      console.log(coloredLine);
    });

    return true;
  } catch (err) {
    log('error', `Failed to read log file: ${err.message}`);
    return false;
  }
}

/**
 * Test notification system
 * @param {Object} options - Notification options
 * @param {boolean} [options.preferMessageBox=false] - Use MessageBox instead of toast on Windows
 */
async function testNotification(options = {}) {
  if (!NotificationManager) {
    log('error', 'notification-manager module not available');
    return false;
  }

  try {
    // Read preferMessageBox from config if not explicitly passed
    let preferMessageBox = options.preferMessageBox || false;
    if (!options.preferMessageBox && configManager) {
      try {
        const config = configManager.getConfig();
        if (config.notifications && config.notifications.preferMessageBox) {
          preferMessageBox = true;
        }
      } catch (e) {
        // Ignore config errors, use default
      }
    }

    const notifier = new NotificationManager();
    notifier.init({
      enabled: true,
      sound: true,
      useFallback: true,
      preferMessageBox
    });

    log('info', 'Sending test notification...');
    const result = await notifier.notify(
      'Auto-Resume Test',
      'This is a test notification from Claude Code Auto-Resume daemon.'
    );

    if (result) {
      log('success', 'Test notification sent successfully');
    } else {
      log('warning', 'Notification may not have been delivered (check if notifications are enabled in system settings)');
    }
    return result;
  } catch (err) {
    log('error', `Failed to send notification: ${err.message}`);
    return false;
  }
}

/**
 * Open GUI dashboard
 */
async function openGui() {
  // If dashboard integration is available, use it
  if (DashboardIntegration) {
    // Create dashboard if it doesn't exist
    if (!dashboard) {
      const dashboardConfig = {
        get: (key) => {
          const defaults = {
            'gui.enabled': true,
            'gui.port': 3737,
            'websocket.enabled': true,
            'websocket.port': 3847,
            'api.enabled': true,
            'api.port': 3848
          };
          return defaults[key];
        },
        getConfig: () => ({
          gui: { enabled: true, port: 3737 },
          websocket: { enabled: true, port: 3847 },
          api: { enabled: true, port: 3848 }
        })
      };

      dashboard = new DashboardIntegration({
        configManager: dashboardConfig,
        logger: {
          debug: (msg) => log('debug', msg),
          info: (msg) => log('info', msg),
          warn: (msg) => log('warning', msg),
          error: (msg) => log('error', msg)
        }
      });
    }

    try {
      await dashboard.openGui();
      log('success', 'GUI dashboard opened at http://localhost:3737');
      return true;
    } catch (error) {
      log('error', `Failed to open GUI via dashboard: ${error.message}`);
      // Fall through to legacy file-based approach
    }
  }

  // Open HTTP URL instead of file (server should be running via daemon)
  const guiUrl = 'http://localhost:3737';
  const platform = os.platform();
  let command;

  if (platform === 'win32') {
    command = `start "" "${guiUrl}"`;
  } else if (platform === 'darwin') {
    command = `open "${guiUrl}"`;
  } else {
    command = `xdg-open "${guiUrl}"`;
  }

  log('info', `Opening GUI dashboard: ${guiUrl}`);

  exec(command, (error) => {
    if (error) {
      log('error', `Failed to open GUI: ${error.message}`);
      log('info', `You can manually open: ${guiUrl}`);
      // Fallback info for local file
      const guiPath = path.join(__dirname, 'gui', 'index.html');
      if (fs.existsSync(guiPath)) {
        log('info', `Or open local file: ${guiPath}`);
      }
    } else {
      log('success', 'GUI dashboard opened in default browser');
    }
  });

  return true;
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
    start       Start the daemon (foreground)
    monitor     Alias for start (used by systemd)
    stop        Stop the running daemon
    status      Check daemon status
    restart     Restart the daemon
    --reset     Clear stale rate limit status and recheck
    --test <s>  Test mode: countdown for <s> seconds then send keystrokes
    help        Show this help message

MODULE COMMANDS:
    config              Show current configuration
    config set <k> <v>  Set configuration value (e.g., config set checkInterval 10000)
    analytics           Show analytics and statistics
    notify              Send a test notification
    gui                 Open the GUI dashboard in browser

DAEMON BEHAVIOR:
    1. Watches: ${STATUS_FILE}
    2. When rate limit detected (status.detected = true):
       - Parses reset_time from status file
       - Shows countdown timer in console
       - When reset time arrives:
         - Finds all Claude Code terminal windows
         - Sends Escape + Ctrl+U + "continue" + Enter
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

    # Test with 10 second countdown
    node auto-resume-daemon.js --test 10

    # Reset stale rate limit status
    node auto-resume-daemon.js --reset

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
    case 'monitor':
    case '--monitor':
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

    case '--test':
    case '-t':
    case 'test':
      const testSeconds = parseInt(args[1], 10) || 30;
      runTest(testSeconds).then(() => {
        process.exit(0);
      });
      break;

    case '--reset':
    case '-r':
    case 'reset':
      resetStatus();
      process.exit(0);
      break;

    case '--config':
    case 'config':
      if (args[1] === 'set') {
        setConfigValue(args[2], args[3]);
      } else {
        showConfig();
      }
      process.exit(0);
      break;

    case '--analytics':
    case 'analytics':
      showAnalytics();
      process.exit(0);
      break;

    case '--logs':
    case 'logs':
      // Parse --lines option
      const linesIndex = args.indexOf('--lines');
      const logLines = linesIndex !== -1 ? parseInt(args[linesIndex + 1], 10) || 20 : 20;
      showLogs({ lines: logLines });
      process.exit(0);
      break;

    case '--notify-test':
    case '--notify':
    case 'notify':
      // Check for --prefer-messagebox or -m flag
      const preferMessageBox = args.includes('--prefer-messagebox') || args.includes('-m');
      testNotification({ preferMessageBox }).then(() => {
        process.exit(0);
      });
      break;

    case '--gui':
    case 'gui':
      openGui().then(() => {
        // Give a moment for the browser to launch before exiting
        setTimeout(() => process.exit(0), 500);
      }).catch((err) => {
        log('error', `Failed to open GUI: ${err.message}`);
        process.exit(1);
      });
      break;

    default:
      log('error', `Unknown command: ${command}`);
      log('info', 'Run "node auto-resume-daemon.js help" for usage');
      process.exit(1);
  }
}

// Run main if called directly, allow importing for tests
if (require.main === module) {
  main();
}

module.exports = { main };
