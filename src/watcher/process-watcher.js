/**
 * Process Watcher — monitors Claude Code transcript files for rate limit messages.
 *
 * Watches ~/.claude/projects/\*\/\*.jsonl files for changes and scans new entries
 * for rate limit / extra usage messages. When detected, writes status.json
 * so the daemon can start the countdown timer.
 *
 * This is a fallback for when the Stop hook doesn't fire (which happens
 * with "You're out of extra usage" messages).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME_DIR = os.homedir();
const CLAUDE_PROJECTS_DIR = path.join(HOME_DIR, '.claude', 'projects');
const STATUS_DIR = path.join(HOME_DIR, '.claude', 'auto-resume');
const STATUS_FILE = path.join(STATUS_DIR, 'status.json');

// Same patterns as the hook
const RATE_LIMIT_PATTERNS = [
  /You've hit your limit/i,
  /You're out of extra usage/i,
  /out of extra usage/i,
  /out of.*usage.*resets/i,
  /exceeded your current quota/i,
  /Rate limit exceeded/i,
  /"type"\s*:\s*"rate_limit_error"/,
  /try again in\s+(\d+)\s*(minutes?|hours?|seconds?)/i,
  /resets\s+(\d+)(am|pm)\s*\(([^)]+)\)/i,
  /too many requests/i,
  /usage limit/i,
];

const FALSE_POSITIVE_PATTERNS = [
  /remove.*rate.*limit/i,
  /rate.*limit.*hook/i,
  /rate.*limit.*detection/i,
  /false.*alarm/i,
  /stale.*rate/i,
  /fix.*rate.*limit/i,
  /fix.*auto.*resume/i,
  /rate_limit_hook/i,
  /RATE_LIMIT_PATTERNS/,
  /isRealRateLimit/,
  /make sure.*plugin.*detect/i,
  /plugin.*missed/i,
  /process.watcher/i,
];

const TIME_PATTERNS = {
  resetTime: /resets\s+(\d+)(am|pm)\s*\(([^)]+)\)/i,
  tryAgainIn: /try again in\s+(\d+)\s*(minutes?|hours?|seconds?)/i,
};

function isRealRateLimit(text) {
  if (!text || typeof text !== 'string') return false;
  if (FALSE_POSITIVE_PATTERNS.some(p => p.test(text))) return false;
  return RATE_LIMIT_PATTERNS.some(p => p.test(text));
}

function parseResetTime(message) {
  const resetMatch = message.match(TIME_PATTERNS.resetTime);
  if (resetMatch) {
    const [, hour, ampm, timezone] = resetMatch;
    const now = new Date();
    let resetHour = parseInt(hour, 10);
    if (ampm.toLowerCase() === 'pm' && resetHour !== 12) resetHour += 12;
    else if (ampm.toLowerCase() === 'am' && resetHour === 12) resetHour = 0;
    const resetDate = new Date(now);
    resetDate.setHours(resetHour, 0, 0, 0);
    if (resetDate <= now) resetDate.setDate(resetDate.getDate() + 1);
    return { reset_time: resetDate.toISOString(), timezone: timezone.trim() };
  }

  const tryAgainMatch = message.match(TIME_PATTERNS.tryAgainIn);
  if (tryAgainMatch) {
    const [, amount, unit] = tryAgainMatch;
    const resetDate = new Date();
    const n = parseInt(amount, 10);
    if (unit.toLowerCase().startsWith('hour')) resetDate.setHours(resetDate.getHours() + n);
    else if (unit.toLowerCase().startsWith('minute')) resetDate.setMinutes(resetDate.getMinutes() + n);
    else if (unit.toLowerCase().startsWith('second')) resetDate.setSeconds(resetDate.getSeconds() + n);
    return { reset_time: resetDate.toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' };
  }

  // Default: 1 hour from now
  const defaultReset = new Date();
  defaultReset.setHours(defaultReset.getHours() + 1);
  return { reset_time: defaultReset.toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' };
}

/**
 * Scan the tail of a JSONL file for rate limit messages.
 * Reads the last `tailBytes` bytes to avoid reading the entire file.
 *
 * @param {string} filePath - Path to the JSONL file
 * @param {number} tailBytes - Number of bytes to read from the end (default 16KB)
 * @returns {{ message: string, resetTime: object } | null}
 */
function scanFileTail(filePath, tailBytes = 16384) {
  let content;
  try {
    const stat = fs.statSync(filePath);
    if (stat.size === 0) return null;

    const readSize = Math.min(stat.size, tailBytes);
    const buffer = Buffer.alloc(readSize);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buffer, 0, readSize, stat.size - readSize);
    fs.closeSync(fd);
    content = buffer.toString('utf8');
  } catch {
    return null;
  }

  // Split into lines and parse each as JSON
  const lines = content.split('\n').filter(l => l.trim());

  // Check lines in reverse (newest first)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];

    // Quick string check before JSON parse (performance optimization)
    const lowerLine = line.toLowerCase();
    if (!lowerLine.includes('usage') && !lowerLine.includes('limit') &&
        !lowerLine.includes('resets') && !lowerLine.includes('quota') &&
        !lowerLine.includes('too many')) {
      continue;
    }

    // Stringify the entire line and check for rate limit patterns
    if (isRealRateLimit(line)) {
      return {
        message: line.substring(0, 500),
        ...parseResetTime(line),
      };
    }

    // Parse as JSON and check specific fields
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    // Check all string fields at any depth by stringifying
    const entryStr = JSON.stringify(entry);
    if (isRealRateLimit(entryStr)) {
      // Extract cleaner message from known fields
      const candidates = [
        entry.error,
        entry.errorMessage,
        typeof entry.message === 'string' ? entry.message : null,
        typeof entry.data === 'string' ? entry.data : null,
        entry.content,
        entry.text,
      ].filter(Boolean);

      for (const c of candidates) {
        if (isRealRateLimit(String(c))) {
          return {
            message: String(c).substring(0, 500),
            ...parseResetTime(String(c)),
          };
        }
      }

      // Fall back to the stringified entry
      return {
        message: entryStr.substring(0, 500),
        ...parseResetTime(entryStr),
      };
    }
  }

  return null;
}

/**
 * Write status.json for the daemon to pick up.
 */
function writeStatus(rateLimitInfo, logFn) {
  try {
    fs.mkdirSync(STATUS_DIR, { recursive: true });
  } catch {}

  // Don't overwrite if a countdown is already active
  if (fs.existsSync(STATUS_FILE)) {
    try {
      const existing = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
      if (existing.detected) {
        if (logFn) logFn('debug', 'Process watcher: status.json already exists with active detection — skipping');
        return false;
      }
    } catch {}
  }

  const status = {
    detected: true,
    sessions: [],
    reset_time: rateLimitInfo.reset_time,
    timezone: rateLimitInfo.timezone,
    last_detected: new Date().toISOString(),
    message: rateLimitInfo.message,
    detected_by: 'process_watcher',
  };

  fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2), 'utf8');
  if (logFn) logFn('success', `Process watcher: Rate limit detected! Reset: ${rateLimitInfo.reset_time}`);
  return true;
}

class ProcessWatcher {
  /**
   * @param {object} options
   * @param {Function} [options.logFn] - Logging function(level, message)
   * @param {number} [options.debounceMs=2000] - Debounce interval for file changes
   * @param {number} [options.tailBytes=16384] - Bytes to read from file tail
   */
  constructor(options = {}) {
    this._logFn = options.logFn || null;
    this._debounceMs = options.debounceMs || 2000;
    this._tailBytes = options.tailBytes || 16384;
    this._watchers = [];
    this._debounceTimers = {};
    this._fileSizes = {};  // Track file sizes to detect appends
    this._running = false;
  }

  _log(level, msg) {
    if (this._logFn) this._logFn(level, msg);
  }

  /**
   * Start watching all Claude Code project directories.
   */
  start() {
    if (this._running) return;
    this._running = true;

    if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) {
      this._log('warning', `Process watcher: projects dir not found: ${CLAUDE_PROJECTS_DIR}`);
      return;
    }

    // Watch each project subdirectory
    try {
      const projects = fs.readdirSync(CLAUDE_PROJECTS_DIR);
      for (const project of projects) {
        const projectDir = path.join(CLAUDE_PROJECTS_DIR, project);
        try {
          const stat = fs.statSync(projectDir);
          if (!stat.isDirectory()) continue;
        } catch {
          continue;
        }
        this._watchDir(projectDir);
      }
    } catch (err) {
      this._log('error', `Process watcher: failed to read projects dir: ${err.message}`);
    }

    // Also watch the projects dir itself for new project directories
    try {
      const rootWatcher = fs.watch(CLAUDE_PROJECTS_DIR, (eventType, filename) => {
        if (eventType === 'rename' && filename) {
          const newDir = path.join(CLAUDE_PROJECTS_DIR, filename);
          try {
            if (fs.statSync(newDir).isDirectory()) {
              this._watchDir(newDir);
            }
          } catch {}
        }
      });
      this._watchers.push(rootWatcher);
    } catch {}

    this._log('info', `Process watcher: monitoring ${this._watchers.length - 1} project directories`);
  }

  _watchDir(dirPath) {
    try {
      const watcher = fs.watch(dirPath, (eventType, filename) => {
        if (!filename || !filename.endsWith('.jsonl')) return;

        const filePath = path.join(dirPath, filename);

        // Debounce: don't scan the same file more than once per debounceMs
        if (this._debounceTimers[filePath]) return;
        this._debounceTimers[filePath] = setTimeout(() => {
          delete this._debounceTimers[filePath];
        }, this._debounceMs);

        // Only scan if file grew (new content appended)
        try {
          const currentSize = fs.statSync(filePath).size;
          const lastSize = this._fileSizes[filePath] || 0;
          if (currentSize <= lastSize) {
            this._fileSizes[filePath] = currentSize;
            return;
          }
          this._fileSizes[filePath] = currentSize;
        } catch {
          return;
        }

        // Scan the tail for rate limit messages
        const result = scanFileTail(filePath, this._tailBytes);
        if (result) {
          this._log('warning', `Process watcher: rate limit found in ${filename}`);
          writeStatus(result, this._logFn);
        }
      });
      this._watchers.push(watcher);
    } catch (err) {
      this._log('debug', `Process watcher: cannot watch ${dirPath}: ${err.message}`);
    }
  }

  /**
   * Stop all file watchers.
   */
  stop() {
    this._running = false;
    for (const watcher of this._watchers) {
      try { watcher.close(); } catch {}
    }
    this._watchers = [];
    for (const timer of Object.values(this._debounceTimers)) {
      clearTimeout(timer);
    }
    this._debounceTimers = {};
    this._log('info', 'Process watcher: stopped');
  }
}

module.exports = { ProcessWatcher, scanFileTail, isRealRateLimit, parseResetTime, writeStatus };
