#!/usr/bin/env node

/**
 * Claude Code Rate Limit Detection Hook (Robust v2)
 *
 * Detects REAL rate limits by:
 * 1. Only scanning the LAST 10 transcript entries (not entire history)
 * 2. Only checking system/error messages (not user/assistant conversation)
 * 3. Requiring specific API error structures (not just substring "rate limit")
 * 4. Checking the stop_reason from hook input
 *
 * Hook Event: Stop
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME_DIR = os.homedir();
const STATUS_DIR = path.join(HOME_DIR, '.claude', 'auto-resume');
const STATUS_FILE = path.join(STATUS_DIR, 'status.json');

// Only match ACTUAL API rate limit errors, not conversational mentions
const RATE_LIMIT_PATTERNS = [
  /You've hit your limit/i,
  /exceeded your current quota/i,
  /Rate limit exceeded/i,
  /"type"\s*:\s*"rate_limit_error"/,
  /try again in\s+(\d+)\s*(minutes?|hours?|seconds?)/i,
  /resets\s+(\d+)(am|pm)\s*\(([^)]+)\)/i,
  /too many requests/i,
];

// Patterns that indicate conversational mention, NOT a real rate limit
const FALSE_POSITIVE_PATTERNS = [
  /remove.*rate.*limit/i,
  /rate.*limit.*hook/i,
  /rate.*limit.*detection/i,
  /false.*alarm/i,
  /stale.*rate/i,
  /fix.*rate.*limit/i,
  /rate_limit_hook/i,
  /RATE_LIMIT_PATTERNS/,
  /isRateLimitMessage/,
];

const TIME_PATTERNS = {
  resetTime: /resets\s+(\d+)(am|pm)\s*\(([^)]+)\)/i,
  tryAgainIn: /try again in\s+(\d+)\s*(minutes?|hours?|seconds?)/i,
  isoTimestamp: /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)/i,
};

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

  const isoMatch = message.match(TIME_PATTERNS.isoTimestamp);
  if (isoMatch) {
    return { reset_time: isoMatch[1], timezone: 'UTC' };
  }

  const defaultReset = new Date();
  defaultReset.setHours(defaultReset.getHours() + 1);
  return { reset_time: defaultReset.toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' };
}

/**
 * Check if text is a REAL rate limit (not a conversational mention)
 */
function isRealRateLimit(text) {
  if (!text || typeof text !== 'string') return false;

  // If it matches a false-positive pattern, it's just conversation about rate limits
  if (FALSE_POSITIVE_PATTERNS.some(p => p.test(text))) return false;

  return RATE_LIMIT_PATTERNS.some(p => p.test(text));
}

/**
 * Read ONLY the last N lines of a file efficiently
 */
function readLastLines(filePath, maxLines = 10) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.trim().split('\n');
    return lines.slice(-maxLines);
  } catch {
    return [];
  }
}

/**
 * Analyze ONLY the tail of the transcript for rate limit errors.
 * Only checks system-level messages and error fields — ignores user/assistant content.
 */
function analyzeTranscriptTail(transcriptPath) {
  if (!fs.existsSync(transcriptPath)) return null;

  const lastLines = readLastLines(transcriptPath, 10);
  let rateLimitMessage = '';

  for (const line of lastLines) {
    if (!line.trim()) continue;

    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    // ONLY check error-specific fields — NOT full entry or assistant/user content
    const errorFields = [
      entry.error,
      entry.errorMessage,
      typeof entry.error_data === 'object' ? JSON.stringify(entry.error_data) : null,
    ].filter(Boolean);

    // Also check system-type messages (NOT user or assistant role)
    if (entry.type === 'system' || entry.type === 'error') {
      errorFields.push(entry.content, entry.text, entry.message);
    }

    // Check system-reminder type messages that might contain rate limit info
    if (entry.message && typeof entry.message === 'object' && entry.message.role === 'system') {
      const content = entry.message.content;
      if (typeof content === 'string') errorFields.push(content);
      if (Array.isArray(content)) {
        for (const part of content) {
          if (typeof part === 'string') errorFields.push(part);
          if (part && typeof part.text === 'string') errorFields.push(part.text);
        }
      }
    }

    for (const field of errorFields) {
      if (field && isRealRateLimit(String(field))) {
        rateLimitMessage = String(field).substring(0, 500);
        break;
      }
    }

    if (rateLimitMessage) break;
  }

  if (!rateLimitMessage) return null;

  return {
    detected: true,
    message: rateLimitMessage,
    ...parseResetTime(rateLimitMessage),
  };
}

function updateStatusFile(rateLimitInfo, sessionId) {
  if (!fs.existsSync(STATUS_DIR)) {
    fs.mkdirSync(STATUS_DIR, { recursive: true });
  }

  let status = { detected: false, sessions: [] };
  if (fs.existsSync(STATUS_FILE)) {
    try {
      status = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
    } catch { /* use default */ }
  }

  status.detected = true;
  status.reset_time = rateLimitInfo.reset_time;
  status.timezone = rateLimitInfo.timezone;
  status.last_detected = new Date().toISOString();
  status.message = rateLimitInfo.message;

  const trackId = rateLimitInfo.session_id || sessionId;
  if (trackId && !status.sessions.includes(trackId)) {
    status.sessions.push(trackId);
  }

  fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2), 'utf8');
}

function formatResetTime(resetTime, timezone) {
  try {
    const date = new Date(resetTime);
    return `${date.toLocaleTimeString('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12: true })} (${timezone})`;
  } catch {
    return resetTime;
  }
}

async function main() {
  try {
    if (process.stdin.isTTY) {
      process.exit(0);
      return;
    }

    let stdinData = '';
    for await (const chunk of process.stdin) {
      stdinData += chunk;
    }

    if (!stdinData.trim()) {
      process.exit(0);
      return;
    }

    let input;
    try {
      input = JSON.parse(stdinData);
    } catch {
      process.exit(0);
      return;
    }

    // Quick check: if stop_reason is provided and is NOT rate-limit related, skip
    const stopReason = input.stop_reason || '';
    if (stopReason && stopReason !== 'rate_limit' && stopReason !== 'error') {
      // Normal stop (user interrupt, end of turn, etc.) — not a rate limit
      process.exit(0);
      return;
    }

    const transcriptPath = input.transcript_path;
    if (!transcriptPath) {
      process.exit(0);
      return;
    }

    const rateLimitInfo = analyzeTranscriptTail(transcriptPath);

    if (!rateLimitInfo) {
      process.exit(0);
      return;
    }

    updateStatusFile(rateLimitInfo, input.session_id);

    const resetTimeFormatted = formatResetTime(rateLimitInfo.reset_time, rateLimitInfo.timezone);

    console.log(JSON.stringify({
      systemMessage: `Rate limit detected! Auto-resume will retry at ${resetTimeFormatted}`,
      status: {
        rate_limit_detected: true,
        reset_time: rateLimitInfo.reset_time,
        timezone: rateLimitInfo.timezone,
        status_file: STATUS_FILE,
      },
    }, null, 2));

    process.exit(0);

  } catch (err) {
    // Hook errors should NEVER block Claude Code — exit silently
    process.exit(0);
  }
}

main();
