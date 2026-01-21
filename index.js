#!/usr/bin/env node

/**
 * Claude Code Auto-Resume Plugin
 *
 * Automatically resumes Claude Code terminal sessions when rate limits reset.
 * Cross-platform support for Windows, Linux, and macOS.
 *
 * Rate limit message pattern: "You've hit your limit · resets Xpm (Timezone)"
 *
 * @version 1.0.0
 */

const readline = require('readline');
const { exec, spawn } = require('child_process');
const os = require('os');

const VERSION = '1.0.0';

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

// Timezone offsets (hours from UTC)
const timezoneOffsets = {
  // Asia
  'Asia/Dhaka': 6,
  'Asia/Kolkata': 5.5,
  'Asia/Tokyo': 9,
  'Asia/Shanghai': 8,
  'Asia/Singapore': 8,
  'Asia/Seoul': 9,
  'Asia/Dubai': 4,
  'Asia/Jakarta': 7,
  'Asia/Manila': 8,
  'Asia/Bangkok': 7,
  'Asia/Hong_Kong': 8,
  // Americas
  'America/New_York': -5,
  'America/Los_Angeles': -8,
  'America/Chicago': -6,
  'America/Denver': -7,
  'America/Toronto': -5,
  'America/Vancouver': -8,
  'America/Sao_Paulo': -3,
  // Europe
  'Europe/London': 0,
  'Europe/Paris': 1,
  'Europe/Berlin': 1,
  'Europe/Moscow': 3,
  'Europe/Amsterdam': 1,
  // Australia
  'Australia/Sydney': 11,
  'Australia/Melbourne': 11,
  'Australia/Perth': 8,
  // Pacific
  'Pacific/Auckland': 13,
  'Pacific/Honolulu': -10,
  // Default
  UTC: 0,
  GMT: 0,
};

// Logging utilities
function log(level, message) {
  const prefix = {
    info: `${colors.cyan}[INFO]${colors.reset}`,
    success: `${colors.green}[SUCCESS]${colors.reset}`,
    warning: `${colors.yellow}[WARNING]${colors.reset}`,
    error: `${colors.red}[ERROR]${colors.reset}`,
    debug: `${colors.blue}[DEBUG]${colors.reset}`,
  };
  console.log(`${prefix[level] || ''} ${message}`);
}

function showBanner() {
  console.log('');
  console.log(
    `${colors.magenta}  ╔═══════════════════════════════════════════════════════════════╗${colors.reset}`
  );
  console.log(
    `${colors.magenta}  ║         Claude Code Auto-Resume Plugin v${VERSION}              ║${colors.reset}`
  );
  console.log(
    `${colors.magenta}  ║     Automatically resume when rate limits reset               ║${colors.reset}`
  );
  console.log(
    `${colors.magenta}  ╚═══════════════════════════════════════════════════════════════╝${colors.reset}`
  );
  console.log('');
}

function showHelp() {
  showBanner();
  console.log(`
USAGE:
    node index.js [OPTIONS]

OPTIONS:
    --monitor, -m       Run in clipboard monitor mode
    --interactive, -i   Run in interactive mode (paste message)
    --test <seconds>    Test mode with simulated wait time
    --prompt <text>     Custom prompt to send (default: "continue")
    --help, -h          Show this help message
    --version, -v       Show version information

EXAMPLES:
    # Interactive mode - paste rate limit message
    node index.js -i

    # With custom prompt
    node index.js -i --prompt "please continue with the task"

    # Test mode with 30 second wait
    node index.js --test 30

    # Monitor clipboard
    node index.js -m

HOW IT WORKS:
    1. You paste the rate limit message
    2. Script parses the reset time from messages like:
       "You've hit your limit · resets 8pm (Asia/Dhaka)"
    3. Calculates wait time until reset
    4. Automatically sends "continue" when limit resets

RATE LIMIT PATTERN:
    The script detects: "You've hit your limit · resets <time> (<timezone>)"

CROSS-PLATFORM:
    Windows: Uses PowerShell for sending keystrokes
    Linux: Uses xdotool (requires installation)
    macOS: Uses osascript

`);
}

function showVersion() {
  console.log(`claude-auto-resume v${VERSION}`);
  console.log(`Platform: ${os.platform()}`);
  console.log(`Node.js: ${process.version}`);
}

/**
 * Get timezone offset in hours
 */
function getTimezoneOffset(timezoneName) {
  if (timezoneOffsets[timezoneName] !== undefined) {
    return timezoneOffsets[timezoneName];
  }

  // Try to get from system
  try {
    const now = new Date();
    const localOffset = -now.getTimezoneOffset() / 60;
    return localOffset;
  } catch {
    return 0;
  }
}

/**
 * Parse reset time from rate limit message
 * @param {string} message - The rate limit message
 * @returns {Date|null} - The reset time or null if parsing failed
 */
function parseResetTime(message) {
  // Pattern: resets Xam/pm (Timezone) or resets X:XXam/pm (Timezone)
  const pattern =
    /resets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*\(([^)]+)\)/i;
  const match = message.match(pattern);

  if (!match) {
    return null;
  }

  let hour = parseInt(match[1], 10);
  const minute = match[2] ? parseInt(match[2], 10) : 0;
  const period = match[3].toLowerCase();
  const timezone = match[4];

  log('debug', `Parsed: Hour=${hour}, Minute=${minute}, Period=${period}, Timezone=${timezone}`);

  // Convert to 24-hour format
  if (period === 'am') {
    if (hour === 12) hour = 0;
  } else {
    if (hour !== 12) hour += 12;
  }

  // Get timezone offsets
  const tzOffset = getTimezoneOffset(timezone);
  const localOffset = -new Date().getTimezoneOffset() / 60;
  const offsetDiff = localOffset - tzOffset;

  // Build reset time
  const now = new Date();
  const resetTime = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    hour,
    minute,
    0,
    0
  );

  // Adjust for timezone difference
  resetTime.setTime(resetTime.getTime() + offsetDiff * 60 * 60 * 1000);

  // If reset time has passed, add a day
  if (resetTime < now) {
    resetTime.setDate(resetTime.getDate() + 1);
  }

  return resetTime;
}

/**
 * Check if message contains rate limit pattern
 */
function isRateLimitMessage(message) {
  return (
    message.includes("hit your limit") ||
    message.includes("You've hit your limit")
  );
}

/**
 * Parse rate limit message and return reset time
 */
function parseRateLimitMessage(message) {
  if (!isRateLimitMessage(message)) {
    return null;
  }
  return parseResetTime(message);
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
 * Send keystrokes to the active window
 */
async function sendKeystrokes(text) {
  const platform = os.platform();

  return new Promise((resolve, reject) => {
    if (platform === 'win32') {
      // Windows: Use PowerShell
      const script = `
        Add-Type -AssemblyName System.Windows.Forms
        Start-Sleep -Milliseconds 500
        [System.Windows.Forms.SendKeys]::SendWait('${text.replace(/'/g, "''")}')
        Start-Sleep -Milliseconds 100
        [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
      `;

      exec(`powershell -Command "${script.replace(/"/g, '\\"')}"`, (error) => {
        if (error) {
          log('error', `Failed to send keystrokes: ${error.message}`);
          reject(error);
        } else {
          log('success', `Sent: '${text}' + Enter`);
          resolve();
        }
      });
    } else if (platform === 'darwin') {
      // macOS: Use osascript
      const script = `
        tell application "System Events"
          keystroke "${text}"
          keystroke return
        end tell
      `;

      exec(`osascript -e '${script}'`, (error) => {
        if (error) {
          log('error', `Failed to send keystrokes: ${error.message}`);
          reject(error);
        } else {
          log('success', `Sent: '${text}' + Enter`);
          resolve();
        }
      });
    } else {
      // Linux: Use xdotool
      exec(`which xdotool`, (error) => {
        if (error) {
          log('error', 'xdotool not found. Please install it:');
          log('info', '  Ubuntu/Debian: sudo apt-get install xdotool');
          log('info', '  RHEL/CentOS: sudo yum install xdotool');
          log('info', '  Arch: sudo pacman -S xdotool');
          reject(new Error('xdotool not found'));
          return;
        }

        exec(`xdotool type "${text}" && xdotool key Return`, (err) => {
          if (err) {
            log('error', `Failed to send keystrokes: ${err.message}`);
            reject(err);
          } else {
            log('success', `Sent: '${text}' + Enter`);
            resolve();
          }
        });
      });
    }
  });
}

/**
 * Get clipboard content
 */
async function getClipboard() {
  const platform = os.platform();

  return new Promise((resolve, reject) => {
    if (platform === 'win32') {
      exec('powershell -command "Get-Clipboard"', (error, stdout) => {
        if (error) {
          resolve('');
        } else {
          resolve(stdout.trim());
        }
      });
    } else if (platform === 'darwin') {
      exec('pbpaste', (error, stdout) => {
        if (error) {
          resolve('');
        } else {
          resolve(stdout.trim());
        }
      });
    } else {
      // Try xclip first, then xsel
      exec('xclip -selection clipboard -o', (error, stdout) => {
        if (error) {
          exec('xsel --clipboard --output', (err, out) => {
            if (err) {
              resolve('');
            } else {
              resolve(out.trim());
            }
          });
        } else {
          resolve(stdout.trim());
        }
      });
    }
  });
}

/**
 * Wait for reset time with countdown
 */
async function waitForReset(resetTime, prompt) {
  log('warning', '');
  log('warning', 'Rate limit detected!');
  log('info', `Reset time: ${resetTime.toLocaleString()}`);

  const waitUntilReset = () => {
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        const now = new Date();
        const remaining = resetTime - now;

        if (remaining <= 0) {
          clearInterval(interval);
          process.stdout.write(
            `\r${colors.green}[READY] Reset time reached!                    ${colors.reset}\n`
          );
          resolve();
        } else {
          const formatted = formatTimeRemaining(remaining);
          process.stdout.write(
            `\r${colors.yellow}[WAITING] Resuming in ${formatted}... ${colors.reset}`
          );
        }
      }, 1000);
    });
  };

  await waitUntilReset();
  console.log('');

  // Add a small buffer after reset
  await new Promise((r) => setTimeout(r, 5000));

  // Send the continue prompt
  log('info', 'Sending resume prompt...');
  await sendKeystrokes(prompt);

  log('success', 'Auto-resume completed!');
}

/**
 * Interactive mode
 */
async function runInteractive(prompt) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  log('info', 'Interactive mode started');
  log('info', "Paste the rate limit message below (or type 'exit' to quit):");
  console.log('');

  const askQuestion = () => {
    rl.question(`${colors.magenta}Enter message: ${colors.reset}`, async (input) => {
      if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
        log('info', 'Exiting...');
        rl.close();
        process.exit(0);
        return;
      }

      const resetTime = parseRateLimitMessage(input);

      if (resetTime) {
        await waitForReset(resetTime, prompt);
        console.log('');
        log('info', "Ready for next rate limit message (or 'exit' to quit)");
        console.log('');
      } else {
        log('warning', 'Could not parse rate limit message. Expected format:');
        log('info', "         'You've hit your limit · resets 8pm (Asia/Dhaka)'");
      }

      askQuestion();
    });
  };

  askQuestion();
}

/**
 * Clipboard monitor mode
 */
async function runMonitor(prompt) {
  log('info', 'Starting clipboard monitor...');
  log('info', 'Copy the rate limit message to clipboard to trigger auto-resume');
  log('info', 'Press Ctrl+C to stop monitoring');
  console.log('');

  let lastClipboard = '';

  const checkClipboard = async () => {
    try {
      const currentClipboard = await getClipboard();

      if (currentClipboard && currentClipboard !== lastClipboard) {
        lastClipboard = currentClipboard;

        const resetTime = parseRateLimitMessage(currentClipboard);

        if (resetTime) {
          await waitForReset(resetTime, prompt);
          console.log('');
          log('info', 'Continuing to monitor...');
        }
      }
    } catch (error) {
      // Ignore clipboard errors
    }

    setTimeout(checkClipboard, 500);
  };

  checkClipboard();
}

/**
 * Test mode
 */
async function runTest(waitSeconds, prompt) {
  log('warning', `[TEST MODE] Simulating rate limit with ${waitSeconds} seconds wait`);

  const resetTime = new Date(Date.now() + waitSeconds * 1000);
  await waitForReset(resetTime, prompt);
}

/**
 * Main menu
 */
async function showMenu(prompt) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(`${colors.magenta}Select operation mode:${colors.reset}`);
  log('info', '  1. Interactive Mode (paste message directly)');
  log('info', '  2. Clipboard Monitor (copy rate limit message to trigger)');
  log('info', '  3. Test Mode (simulate with 30 second wait)');
  console.log('');

  rl.question(`${colors.magenta}Enter choice (1-3): ${colors.reset}`, async (choice) => {
    rl.close();

    switch (choice) {
      case '1':
        await runInteractive(prompt);
        break;
      case '2':
        await runMonitor(prompt);
        break;
      case '3':
        await runTest(30, prompt);
        break;
      default:
        log('info', 'Defaulting to Interactive mode');
        await runInteractive(prompt);
    }
  });
}

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    monitor: false,
    interactive: false,
    test: 0,
    prompt: 'continue',
    help: false,
    version: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--monitor':
      case '-m':
        options.monitor = true;
        break;
      case '--interactive':
      case '-i':
        options.interactive = true;
        break;
      case '--test':
        options.test = parseInt(args[++i], 10) || 30;
        break;
      case '--prompt':
        options.prompt = args[++i] || 'continue';
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--version':
      case '-v':
        options.version = true;
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

  if (options.version) {
    showVersion();
    return;
  }

  showBanner();

  if (options.test > 0) {
    await runTest(options.test, options.prompt);
    return;
  }

  if (options.monitor) {
    await runMonitor(options.prompt);
    return;
  }

  if (options.interactive) {
    await runInteractive(options.prompt);
    return;
  }

  // Default: show menu
  await showMenu(options.prompt);
}

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('');
  log('info', 'Interrupted by user');
  process.exit(0);
});

main().catch((error) => {
  log('error', error.message);
  process.exit(1);
});
