/**
 * Proactive Usage Warning
 *
 * Tracks tool usage per session and warns when approaching the historical
 * average rate limit threshold (at 80%).
 *
 * @module UsageWarning
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const WARNING_THRESHOLD = 0.8; // 80% of average

function getBasePath() {
  return path.join(os.homedir(), '.claude', 'auto-resume');
}

function getAnalyticsPath() {
  return path.join(getBasePath(), 'analytics.json');
}

function getSessionUsagePath() {
  return path.join(getBasePath(), 'session-usage.json');
}

/**
 * Read JSON file safely.
 * @param {string} filePath
 * @returns {Object|null}
 */
function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Write JSON file safely.
 * @param {string} filePath
 * @param {Object} data
 */
function writeJsonSafe(filePath, data) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch {
    // Ignore write errors
  }
}

/**
 * Check if a session should receive a usage warning.
 *
 * @param {string} sessionId - Current session identifier
 * @returns {{ warning: boolean, message?: string, current?: number, threshold?: number }}
 */
function checkUsageWarning(sessionId) {
  const analytics = readJsonSafe(getAnalyticsPath());
  if (!analytics || !analytics.avgToolsBeforeRateLimit) {
    return { warning: false };
  }

  const avg = analytics.avgToolsBeforeRateLimit;
  const threshold = Math.floor(avg * WARNING_THRESHOLD);

  const sessionData = readJsonSafe(getSessionUsagePath());
  if (!sessionData || !sessionData[sessionId]) {
    return { warning: false };
  }

  const current = sessionData[sessionId].count || 0;

  if (current >= threshold) {
    return {
      warning: true,
      message: `\u26a0\ufe0f Rate limit likely in ~15 min based on usage patterns.`,
      current,
      threshold
    };
  }

  return { warning: false, current, threshold };
}

/**
 * Increment the tool call counter for a session.
 *
 * @param {string} sessionId - Current session identifier
 */
function incrementSessionUsage(sessionId) {
  const usagePath = getSessionUsagePath();
  let sessionData = readJsonSafe(usagePath) || {};

  if (!sessionData[sessionId]) {
    sessionData[sessionId] = { count: 0 };
  }

  sessionData[sessionId].count += 1;

  writeJsonSafe(usagePath, sessionData);
}

module.exports = { checkUsageWarning, incrementSessionUsage };
