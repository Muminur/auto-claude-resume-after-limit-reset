#!/usr/bin/env node

/**
 * Claude Code Rate Limit Detection Hook
 *
 * Detects when Claude Code hits rate limits by analyzing transcript files.
 * Writes detection results to ~/.claude/auto-resume/status.json
 *
 * Hook Event: Stop
 *
 * Usage: Called automatically by Claude Code when a session stops
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

// Cross-platform home directory resolution
const HOME_DIR = os.homedir();
const STATUS_DIR = path.join(HOME_DIR, '.claude', 'auto-resume');
const STATUS_FILE = path.join(STATUS_DIR, 'status.json');

// Rate limit detection patterns - must be SPECIFIC to avoid false positives
// These patterns should only match actual rate limit error messages, not conversation text
const RATE_LIMIT_PATTERNS = [
  /You've hit your (?:usage )?limit/i,                    // Claude's actual message
  /resets\s+\d{1,2}(?:am|pm)\s*\([^)]+\)/i,              // "resets 7pm (America/New_York)" - very specific format
  /"type"\s*:\s*"rate_limit_error"/i,                    // API error JSON
  /exceeded your current quota/i,                         // API quota error
  /Request was throttled/i,                               // Throttling message
  /Too many requests.*retry after/i,                      // Retry-after pattern
];

// Time parsing patterns
const TIME_PATTERNS = {
  // "resets 7pm (America/New_York)"
  resetTime: /resets\s+(\d+)(am|pm)\s*\(([^)]+)\)/i,
  // "try again in X minutes/hours"
  tryAgainIn: /try again in\s+(\d+)\s*(minutes?|hours?|seconds?)/i,
  // ISO timestamp in error messages
  isoTimestamp: /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)/i
};

/**
 * Parse reset time from rate limit message
 * @param {string} message - The message containing reset time info
 * @returns {Object|null} - { reset_time: ISO string, timezone: string } or null
 */
function parseResetTime(message) {
  // Try "resets Xpm (Timezone)" pattern
  const resetMatch = message.match(TIME_PATTERNS.resetTime);
  if (resetMatch) {
    const [, hour, ampm, timezone] = resetMatch;
    const now = new Date();
    let resetHour = parseInt(hour, 10);

    // Convert to 24-hour format
    if (ampm.toLowerCase() === 'pm' && resetHour !== 12) {
      resetHour += 12;
    } else if (ampm.toLowerCase() === 'am' && resetHour === 12) {
      resetHour = 0;
    }

    // Create reset time for today
    const resetDate = new Date(now);
    resetDate.setHours(resetHour, 0, 0, 0);

    // If reset time is in the past, assume it's tomorrow
    if (resetDate <= now) {
      resetDate.setDate(resetDate.getDate() + 1);
    }

    return {
      reset_time: resetDate.toISOString(),
      timezone: timezone.trim()
    };
  }

  // Try "try again in X minutes/hours" pattern
  const tryAgainMatch = message.match(TIME_PATTERNS.tryAgainIn);
  if (tryAgainMatch) {
    const [, amount, unit] = tryAgainMatch;
    const now = new Date();
    const resetDate = new Date(now);

    const amountNum = parseInt(amount, 10);
    if (unit.toLowerCase().startsWith('hour')) {
      resetDate.setHours(resetDate.getHours() + amountNum);
    } else if (unit.toLowerCase().startsWith('minute')) {
      resetDate.setMinutes(resetDate.getMinutes() + amountNum);
    } else if (unit.toLowerCase().startsWith('second')) {
      resetDate.setSeconds(resetDate.getSeconds() + amountNum);
    }

    return {
      reset_time: resetDate.toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Dhaka'
    };
  }

  // Try ISO timestamp pattern
  const isoMatch = message.match(TIME_PATTERNS.isoTimestamp);
  if (isoMatch) {
    return {
      reset_time: isoMatch[1],
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Dhaka'
    };
  }

  // Default: assume 1 hour from now
  const defaultReset = new Date();
  defaultReset.setHours(defaultReset.getHours() + 1);

  return {
    reset_time: defaultReset.toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Dhaka'
  };
}

/**
 * Check if a message contains rate limit indicators
 * @param {string} message - The message to check
 * @returns {boolean}
 */
function isRateLimitMessage(message) {
  if (!message || typeof message !== 'string') return false;
  return RATE_LIMIT_PATTERNS.some(pattern => pattern.test(message));
}

/**
 * Read and analyze transcript file for rate limit messages
 * @param {string} transcriptPath - Path to the transcript JSONL file
 * @returns {Promise<Object|null>} - Rate limit info or null
 */
async function analyzeTranscript(transcriptPath) {
  if (!fs.existsSync(transcriptPath)) {
    return null;
  }

  const fileStream = fs.createReadStream(transcriptPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let rateLimitDetected = false;
  let rateLimitMessage = '';
  let sessionId = null;

  for await (const line of rl) {
    if (!line.trim()) continue;

    try {
      const entry = JSON.parse(line);

      // Extract session ID if available
      if (entry.session_id) {
        sessionId = entry.session_id;
      }

      // Check various fields for rate limit messages
      const fields = [
        entry.content,
        entry.text,
        entry.message,
        entry.error,
        entry.errorMessage,
        JSON.stringify(entry.error_data || {}),
        JSON.stringify(entry)
      ];

      for (const field of fields) {
        if (field && isRateLimitMessage(field)) {
          rateLimitDetected = true;
          rateLimitMessage = field;
          break;
        }
      }

      if (rateLimitDetected) break;

    } catch (err) {
      // Skip malformed JSON lines
      continue;
    }
  }

  if (!rateLimitDetected) {
    return null;
  }

  const timeInfo = parseResetTime(rateLimitMessage);

  return {
    detected: true,
    message: rateLimitMessage.substring(0, 500), // Limit message length
    session_id: sessionId,
    ...timeInfo
  };
}

/**
 * Update or create status file with rate limit information
 * @param {Object} rateLimitInfo - Rate limit detection results
 * @param {string} sessionId - Session ID from input
 */
function updateStatusFile(rateLimitInfo, sessionId) {
  // Ensure status directory exists
  if (!fs.existsSync(STATUS_DIR)) {
    fs.mkdirSync(STATUS_DIR, { recursive: true });
  }

  // Read existing status or create new
  let status = {
    detected: false,
    sessions: []
  };

  if (fs.existsSync(STATUS_FILE)) {
    try {
      const existing = fs.readFileSync(STATUS_FILE, 'utf8');
      status = JSON.parse(existing);
    } catch (err) {
      // Use default status on parse error
    }
  }

  // Update status with new detection
  status.detected = true;
  status.reset_time = rateLimitInfo.reset_time;
  status.timezone = rateLimitInfo.timezone;
  status.last_detected = new Date().toISOString();
  status.message = rateLimitInfo.message;

  // Add session to sessions array if not already present
  const trackSessionId = rateLimitInfo.session_id || sessionId;
  if (trackSessionId && !status.sessions.includes(trackSessionId)) {
    status.sessions.push(trackSessionId);
  }

  // Write updated status
  fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2), 'utf8');
}

/**
 * Format reset time for display
 * @param {string} resetTime - ISO timestamp
 * @param {string} timezone - Timezone string
 * @returns {string}
 */
function formatResetTime(resetTime, timezone) {
  try {
    const date = new Date(resetTime);
    const options = {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    };
    const timeStr = date.toLocaleTimeString('en-US', options);
    return `${timeStr} (${timezone})`;
  } catch (err) {
    return resetTime;
  }
}

/**
 * Main hook execution
 */
async function main() {
  try {
    // Read stdin for hook input
    let stdinData = '';

    if (process.stdin.isTTY) {
      // No piped input - exit silently
      process.exit(0);
      return;
    }

    // Read from stdin
    for await (const chunk of process.stdin) {
      stdinData += chunk;
    }

    if (!stdinData.trim()) {
      // No input data
      process.exit(0);
      return;
    }

    // Parse input JSON
    let input;
    try {
      input = JSON.parse(stdinData);
    } catch (err) {
      console.error(JSON.stringify({
        error: 'Failed to parse input JSON',
        details: err.message
      }));
      process.exit(1);
      return;
    }

    // Extract transcript path
    const transcriptPath = input.transcript_path;
    if (!transcriptPath) {
      // No transcript path - exit silently
      process.exit(0);
      return;
    }

    // Analyze transcript for rate limits
    const rateLimitInfo = await analyzeTranscript(transcriptPath);

    if (!rateLimitInfo) {
      // No rate limit detected - exit silently
      process.exit(0);
      return;
    }

    // Update status file
    updateStatusFile(rateLimitInfo, input.session_id);

    // Output result with user message
    const resetTimeFormatted = formatResetTime(
      rateLimitInfo.reset_time,
      rateLimitInfo.timezone
    );

    const output = {
      systemMessage: `⚠️  Rate limit detected! Auto-resume will retry at ${resetTimeFormatted}`,
      status: {
        rate_limit_detected: true,
        reset_time: rateLimitInfo.reset_time,
        timezone: rateLimitInfo.timezone,
        status_file: STATUS_FILE
      }
    };

    console.log(JSON.stringify(output, null, 2));

    process.exit(0);

  } catch (err) {
    console.error(JSON.stringify({
      error: 'Hook execution failed',
      details: err.message,
      stack: err.stack
    }));
    process.exit(1);
  }
}

// Execute main function
main();
