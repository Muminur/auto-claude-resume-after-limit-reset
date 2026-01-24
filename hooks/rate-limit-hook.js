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

// Rate limit detection patterns - ULTRA SPECIFIC to avoid false positives
// Must match the EXACT format of Claude Code's rate limit UI message
// Pattern: "You've hit your limit · resets Xpm (Timezone)"
// Note: ['''] matches curly quotes and standard apostrophe
const RATE_LIMIT_COMBINED_PATTERN = /You[''']ve hit your (?:usage )?limit.*?resets\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)\s*\([^)]+\)/i;

// Secondary patterns for API errors (not from file contents)
const API_ERROR_PATTERNS = [
  /"type"\s*:\s*"rate_limit_error"/i,                    // API error JSON
  /exceeded your current quota/i,                         // API quota error
];

// Patterns that indicate content is from a file read (FALSE POSITIVE indicators)
const FALSE_POSITIVE_INDICATORS = [
  /tool_result/i,                                         // Tool result wrapper
  /tool_use_id/i,                                         // Tool use indicator
  /toolu_/i,                                              // Tool ID prefix
  /^\s*\d+→/m,                                           // Line number prefix from Read tool
  /\\n\s+\d+→/,                                          // Escaped line numbers
  /["']content["']\s*:\s*["']\s*\d+→/,                   // Content field with line numbers
  /\/\*\*[\s\S]*?\*\//,                                  // JSDoc comments (code being read)
  /function\s+\w+\s*\(/,                                 // Function definitions (code)
  /const\s+\w+\s*=/,                                     // Const declarations (code)
  /RATE_LIMIT_PATTERNS/,                                 // Our own pattern variable name
  /parentUuid/i,                                          // Transcript metadata
  /sessionId/i,                                           // Session metadata
  /isSidechain/i,                                         // Sidechain indicator
];

// Maximum length for a valid rate limit message (real messages are short)
const MAX_RATE_LIMIT_MESSAGE_LENGTH = 200;

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
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    };
  }

  // Try ISO timestamp pattern
  const isoMatch = message.match(TIME_PATTERNS.isoTimestamp);
  if (isoMatch) {
    return {
      reset_time: isoMatch[1],
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    };
  }

  // Default: assume 1 hour from now
  const defaultReset = new Date();
  defaultReset.setHours(defaultReset.getHours() + 1);

  return {
    reset_time: defaultReset.toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  };
}

/**
 * Check if content appears to be from a file read (false positive)
 * @param {string} content - The content to check
 * @returns {boolean}
 */
function isFalsePositive(content) {
  if (!content || typeof content !== 'string') return false;
  return FALSE_POSITIVE_INDICATORS.some(pattern => pattern.test(content));
}

/**
 * Check if a message contains REAL rate limit indicators (not false positives)
 * @param {string} message - The message to check
 * @returns {boolean}
 */
function isRateLimitMessage(message) {
  if (!message || typeof message !== 'string') return false;

  // CRITICAL: Length check first - real rate limit messages are SHORT
  // The actual UI message is: "You've hit your limit · resets 8pm (Asia/Dhaka)"
  // This is about 50-100 chars, never thousands
  if (message.length > MAX_RATE_LIMIT_MESSAGE_LENGTH) {
    return false;
  }

  // Check for false positives - if this looks like file/tool content, reject it
  if (isFalsePositive(message)) {
    return false;
  }

  // Primary check: Must have BOTH "hit your limit" AND "resets Xpm" together
  // This is the exact format Claude Code displays to users
  if (RATE_LIMIT_COMBINED_PATTERN.test(message)) {
    return true;
  }

  // Secondary check: API error patterns (only if very short)
  if (message.length < 100) {
    return API_ERROR_PATTERNS.some(pattern => pattern.test(message));
  }

  return false;
}

/**
 * Read and analyze transcript file for rate limit messages
 * @param {string} transcriptPath - Path to the transcript JSONL file
 * @returns {Promise<Object|null>} - Rate limit info or null
 */
async function analyzeTranscript(transcriptPath) {
  let fileStream;
  try {
    fileStream = fs.createReadStream(transcriptPath);
  } catch (err) {
    // Failed to open file (file doesn't exist, permission denied, etc.)
    return null;
  }

  // For testing: check if stream has async iterator (mock streams)
  // For production: use readline interface
  let lineIterator;
  if (fileStream[Symbol.asyncIterator]) {
    // Mock stream with async iterator - iterate directly
    lineIterator = fileStream;
  } else {
    // Real file stream - use readline
    lineIterator = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });
  }

  let rateLimitDetected = false;
  let rateLimitMessage = '';
  let sessionId = null;

  for await (const line of lineIterator) {
    if (!line.trim()) continue;

    try {
      const entry = JSON.parse(line);

      // Extract session ID if available
      if (entry.session_id || entry.sessionId) {
        sessionId = entry.session_id || entry.sessionId;
      }

      // PRIORITY CHECK: Assistant messages with error: "rate_limit" or isApiErrorMessage: true
      // This is the primary way Claude Code reports rate limits in transcripts
      // Check this BEFORE any skip filters to ensure we don't miss rate limits
      if ((entry.error === 'rate_limit' || entry.isApiErrorMessage === true) &&
          entry.type === 'assistant' &&
          entry.message &&
          entry.message.content &&
          Array.isArray(entry.message.content)) {
        for (const contentItem of entry.message.content) {
          if (contentItem.type === 'text' &&
              typeof contentItem.text === 'string' &&
              contentItem.text.length < MAX_RATE_LIMIT_MESSAGE_LENGTH &&
              isRateLimitMessage(contentItem.text)) {
            rateLimitDetected = true;
            rateLimitMessage = contentItem.text;
            break;
          }
        }
        if (rateLimitDetected) break;
      }

      // CRITICAL: Skip entries that are tool results (file contents, command outputs)
      if (entry.type === 'tool_result' || entry.type === 'tool_use') {
        continue;
      }

      // Skip user messages entirely - they often contain tool results
      if (entry.message && entry.message.role === 'user') {
        continue;
      }

      // Skip if entry type is 'user' (another format for user messages)
      if (entry.type === 'user') {
        continue;
      }

      // Only check specific SMALL fields that would contain actual rate limit messages
      const fieldsToCheck = [];

      // Check error fields (must be short strings) - fallback for other formats
      if (typeof entry.error === 'string' && entry.error.length < MAX_RATE_LIMIT_MESSAGE_LENGTH) {
        fieldsToCheck.push(entry.error);
      }
      if (typeof entry.errorMessage === 'string' && entry.errorMessage.length < MAX_RATE_LIMIT_MESSAGE_LENGTH) {
        fieldsToCheck.push(entry.errorMessage);
      }
      if (typeof entry.systemMessage === 'string' && entry.systemMessage.length < MAX_RATE_LIMIT_MESSAGE_LENGTH) {
        fieldsToCheck.push(entry.systemMessage);
      }

      for (const field of fieldsToCheck) {
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
 * Analyze transcript with subagent scanning
 * First checks main transcript, then scans subagent transcripts if no rate limit found
 * @param {string} transcriptPath - Path to the main transcript JSONL file
 * @returns {Promise<Object|null>} - Rate limit info or null
 */
async function analyzeTranscriptWithSubagents(transcriptPath) {
  // Check if main transcript exists
  if (!fs.existsSync(transcriptPath)) {
    return null;
  }

  // First analyze the main transcript
  const mainResult = await analyzeTranscript(transcriptPath);

  // If rate limit found in main transcript, return immediately
  if (mainResult) {
    return mainResult;
  }

  // Derive subagents directory from transcript path
  // For /path/to/session-id.jsonl → /path/to/session-id/subagents/
  const transcriptDir = path.dirname(transcriptPath);
  const transcriptFile = path.basename(transcriptPath);
  const sessionId = transcriptFile.replace(/\.jsonl$/, '');
  const subagentsDir = path.join(transcriptDir, sessionId, 'subagents');

  // Check if subagents directory exists
  if (!fs.existsSync(subagentsDir)) {
    return null;
  }

  // Read all files in subagents directory
  let subagentFiles;
  try {
    subagentFiles = fs.readdirSync(subagentsDir);
  } catch (err) {
    // Error reading directory, return null
    return null;
  }

  // Return early if no files found
  if (!subagentFiles || subagentFiles.length === 0) {
    return null;
  }

  // Filter to only agent-*.jsonl files
  const agentFiles = subagentFiles.filter(file =>
    file.startsWith('agent-') && file.endsWith('.jsonl')
  );

  // Scan each subagent file
  for (const agentFile of agentFiles) {
    const agentPath = path.join(subagentsDir, agentFile);

    try {
      const subagentResult = await analyzeTranscript(agentPath);

      // Return first rate limit found
      if (subagentResult) {
        return subagentResult;
      }
    } catch (err) {
      // Skip files that cause errors (permission denied, file read errors, etc.)
      // Continue to next file
      continue;
    }
  }

  // No rate limit found in any transcript
  return null;
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

    // Analyze transcript for rate limits (including subagents)
    const rateLimitInfo = await analyzeTranscriptWithSubagents(transcriptPath);

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

// Export functions for testing
module.exports = {
  analyzeTranscript,
  analyzeTranscriptWithSubagents,
  isRateLimitMessage,
  isFalsePositive,
  parseResetTime
};
