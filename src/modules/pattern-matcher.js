/**
 * Rate Limit Pattern Versioning
 *
 * Supports configurable rate limit detection patterns with versioning.
 * Falls back to hardcoded defaults when config is missing or invalid.
 *
 * @module PatternMatcher
 */

/**
 * Default hardcoded rate limit patterns.
 */
const DEFAULT_PATTERNS = [
  /You['\u2019]ve hit your (?:usage )?limit.*?(?:resets\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)\s*\([^)]+\))?/i,
  /exceeded your current quota/i,
  /Rate limit exceeded/i,
  /"type"\s*:\s*"rate_limit_error"/,
  /try again in\s+(\d+)\s*(minutes?|hours?|seconds?)/i,
  /resets\s+(\d+)(am|pm)\s*\(([^)]+)\)/i,
  /too many requests/i,
];

/**
 * Load detection patterns from config, falling back to defaults.
 *
 * @param {Object} config - Configuration object
 * @returns {RegExp[]} Array of compiled RegExp patterns
 */
function loadPatterns(config) {
  if (
    config &&
    config.detection &&
    Array.isArray(config.detection.patterns) &&
    config.detection.patterns.length > 0
  ) {
    try {
      const compiled = config.detection.patterns.map(p => new RegExp(p, 'i'));
      // Verify all compiled successfully
      if (compiled.every(r => r instanceof RegExp)) {
        return compiled;
      }
    } catch {
      // Invalid regex in config, fall back to defaults
    }
  }

  return [...DEFAULT_PATTERNS];
}

/**
 * Check if a message matches any rate limit pattern.
 *
 * @param {string} text - Text to check
 * @param {RegExp[]} patterns - Array of patterns to test against
 * @returns {boolean}
 */
function matchesRateLimitPattern(text, patterns) {
  if (!text || typeof text !== 'string') return false;
  return patterns.some(p => p.test(text));
}

module.exports = { loadPatterns, matchesRateLimitPattern, DEFAULT_PATTERNS };
