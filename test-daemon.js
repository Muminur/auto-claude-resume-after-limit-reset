#!/usr/bin/env node

/**
 * Test script for auto-resume-daemon.js
 *
 * This script helps test the daemon by:
 * 1. Creating a test status file with a rate limit
 * 2. Starting the daemon
 * 3. Watching the daemon behavior
 * 4. Cleaning up after test
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, exec } = require('child_process');

const HOME_DIR = os.homedir();
const BASE_DIR = path.join(HOME_DIR, '.claude', 'auto-resume');
const STATUS_FILE = path.join(BASE_DIR, 'status.json');
const LOG_FILE = path.join(BASE_DIR, 'daemon.log');

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function log(level, message) {
  const prefix = {
    info: `${colors.cyan}[TEST-INFO]${colors.reset}`,
    success: `${colors.green}[TEST-SUCCESS]${colors.reset}`,
    warning: `${colors.yellow}[TEST-WARNING]${colors.reset}`,
    error: `${colors.red}[TEST-ERROR]${colors.reset}`,
  };
  console.log(`${prefix[level] || ''} ${message}`);
}

function showBanner() {
  console.log('');
  console.log(
    `${colors.magenta}  ╔═══════════════════════════════════════════════════════════════╗${colors.reset}`
  );
  console.log(
    `${colors.magenta}  ║           Auto-Resume Daemon Test Suite                       ║${colors.reset}`
  );
  console.log(
    `${colors.magenta}  ╚═══════════════════════════════════════════════════════════════╝${colors.reset}`
  );
  console.log('');
}

/**
 * Ensure test directories exist
 */
function ensureDirectories() {
  if (!fs.existsSync(BASE_DIR)) {
    fs.mkdirSync(BASE_DIR, { recursive: true });
    log('info', `Created directory: ${BASE_DIR}`);
  }
}

/**
 * Create a test status file with specified wait seconds
 */
function createTestStatus(waitSeconds) {
  const resetTime = new Date(Date.now() + waitSeconds * 1000);

  const status = {
    detected: true,
    reset_time: resetTime.toISOString(),
    message: `Test rate limit · resets in ${waitSeconds} seconds`,
    timezone: 'UTC',
    test: true,
    created_at: new Date().toISOString(),
  };

  fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2));
  log('success', `Created test status file: ${STATUS_FILE}`);
  log('info', `Reset time: ${resetTime.toLocaleString()}`);
  log('info', `Wait time: ${waitSeconds} seconds`);
}

/**
 * Clear test status file
 */
function clearTestStatus() {
  try {
    if (fs.existsSync(STATUS_FILE)) {
      fs.unlinkSync(STATUS_FILE);
      log('success', 'Cleared test status file');
    }
  } catch (err) {
    log('error', `Failed to clear status file: ${err.message}`);
  }
}

/**
 * Watch log file for changes
 */
function watchLogFile(callback) {
  if (!fs.existsSync(LOG_FILE)) {
    log('warning', 'Log file does not exist yet');
    return null;
  }

  log('info', `Watching log file: ${LOG_FILE}`);

  let lastSize = fs.statSync(LOG_FILE).size;

  const watcher = fs.watch(LOG_FILE, (eventType) => {
    if (eventType === 'change') {
      try {
        const currentSize = fs.statSync(LOG_FILE).size;
        if (currentSize > lastSize) {
          const fd = fs.openSync(LOG_FILE, 'r');
          const buffer = Buffer.alloc(currentSize - lastSize);
          fs.readSync(fd, buffer, 0, buffer.length, lastSize);
          fs.closeSync(fd);

          const newContent = buffer.toString('utf8');
          if (callback) callback(newContent);

          lastSize = currentSize;
        }
      } catch (err) {
        log('error', `Error reading log file: ${err.message}`);
      }
    }
  });

  return watcher;
}

/**
 * Run test scenario
 */
async function runTest(waitSeconds) {
  showBanner();

  log('info', `Starting test with ${waitSeconds} second countdown...`);
  console.log('');

  // Ensure directories
  ensureDirectories();

  // Create test status
  log('info', 'Step 1: Creating test status file...');
  createTestStatus(waitSeconds);
  console.log('');

  // Check if daemon is already running
  log('info', 'Step 2: Checking daemon status...');
  const daemonPath = path.join(__dirname, 'auto-resume-daemon.js');

  return new Promise((resolve) => {
    exec(`node "${daemonPath}" status`, (error, stdout) => {
      const isRunning = stdout.includes('is running');

      if (isRunning) {
        log('warning', 'Daemon is already running');
        log('info', 'Test will use the existing daemon instance');
        console.log('');
        log('info', 'Step 3: Watching for daemon response...');
        startWatching(waitSeconds, resolve);
      } else {
        log('success', 'Daemon is not running');
        console.log('');
        log('info', 'Step 3: Starting daemon...');
        startDaemon(daemonPath, waitSeconds, resolve);
      }
    });
  });
}

/**
 * Start watching for daemon response
 */
function startWatching(waitSeconds, resolve) {
  let testComplete = false;

  // Watch log file
  const logWatcher = watchLogFile((content) => {
    console.log(`${colors.blue}[DAEMON-LOG]${colors.reset} ${content.trim()}`);

    if (content.includes('Auto-resume completed')) {
      testComplete = true;
      log('success', 'Test completed successfully!');
      if (logWatcher) logWatcher.close();
      resolve(true);
    }
  });

  // Timeout after wait time + 10 seconds
  setTimeout(() => {
    if (!testComplete) {
      log('error', 'Test timeout - daemon did not complete auto-resume');
      if (logWatcher) logWatcher.close();
      resolve(false);
    }
  }, (waitSeconds + 10) * 1000);

  log('info', 'Test is running. Waiting for daemon to send "continue"...');
  log('info', `Expected completion in ~${waitSeconds} seconds`);
  console.log('');
}

/**
 * Start daemon process
 */
function startDaemon(daemonPath, waitSeconds, resolve) {
  const daemon = spawn('node', [daemonPath, 'start'], {
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  let testComplete = false;

  daemon.stdout.on('data', (data) => {
    const text = data.toString();
    output += text;
    process.stdout.write(`${colors.blue}[DAEMON]${colors.reset} ${text}`);

    if (text.includes('Auto-resume completed')) {
      testComplete = true;
      log('success', 'Test completed successfully!');
      daemon.kill('SIGTERM');
      setTimeout(() => {
        clearTestStatus();
        resolve(true);
      }, 1000);
    }
  });

  daemon.stderr.on('data', (data) => {
    process.stderr.write(`${colors.red}[DAEMON-ERR]${colors.reset} ${data}`);
  });

  daemon.on('error', (err) => {
    log('error', `Failed to start daemon: ${err.message}`);
    resolve(false);
  });

  daemon.on('exit', (code) => {
    if (!testComplete) {
      log('warning', `Daemon exited with code ${code}`);
      clearTestStatus();
      resolve(code === 0);
    }
  });

  // Timeout
  setTimeout(() => {
    if (!testComplete) {
      log('error', 'Test timeout - daemon did not complete auto-resume');
      daemon.kill('SIGTERM');
      clearTestStatus();
      resolve(false);
    }
  }, (waitSeconds + 10) * 1000);

  log('info', 'Daemon started. Waiting for countdown to complete...');
  log('info', `Expected completion in ~${waitSeconds} seconds`);
  console.log('');
}

/**
 * Show help
 */
function showHelp() {
  showBanner();
  console.log(`
USAGE:
    node test-daemon.js [options]

OPTIONS:
    --wait <seconds>    Wait time for test countdown (default: 10)
    --clean             Clean up test files and exit
    --help, -h          Show this help

DESCRIPTION:
    This script tests the auto-resume daemon by:
    1. Creating a test status file with a future reset time
    2. Starting the daemon (if not running) or using existing instance
    3. Watching for the daemon to detect the rate limit
    4. Verifying the daemon sends "continue" when countdown completes
    5. Cleaning up test files

EXAMPLES:
    # Run test with 10 second countdown (default)
    node test-daemon.js

    # Run test with 30 second countdown
    node test-daemon.js --wait 30

    # Clean up test files
    node test-daemon.js --clean

FILES CREATED:
    ${STATUS_FILE}
    ${LOG_FILE}

NOTE:
    - The daemon will send "continue" to all terminal windows when test completes
    - Make sure you're ready to receive the keystroke before running the test
    - Use a short wait time (5-10 seconds) for quick testing

`);
}

/**
 * Clean up test files
 */
function cleanUp() {
  log('info', 'Cleaning up test files...');

  try {
    if (fs.existsSync(STATUS_FILE)) {
      fs.unlinkSync(STATUS_FILE);
      log('success', `Removed: ${STATUS_FILE}`);
    }

    log('info', 'Clean up complete');
    log('info', 'Note: Log file preserved for debugging');
  } catch (err) {
    log('error', `Clean up failed: ${err.message}`);
  }
}

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    wait: 10,
    clean: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--wait':
        options.wait = parseInt(args[++i], 10) || 10;
        break;
      case '--clean':
        options.clean = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
    }
  }

  return options;
}

/**
 * Main entry point
 */
async function main() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    return;
  }

  if (options.clean) {
    showBanner();
    cleanUp();
    return;
  }

  // Run test
  const success = await runTest(options.wait);

  console.log('');
  if (success) {
    log('success', 'All tests passed!');
    process.exit(0);
  } else {
    log('error', 'Tests failed');
    process.exit(1);
  }
}

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('');
  log('info', 'Test interrupted by user');
  clearTestStatus();
  process.exit(0);
});

main().catch((error) => {
  log('error', error.message);
  clearTestStatus();
  process.exit(1);
});
