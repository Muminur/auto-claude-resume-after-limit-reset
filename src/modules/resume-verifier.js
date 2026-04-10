/**
 * Resume Verification with Retry
 *
 * After sending resume keystrokes, verifies that the transcript shows
 * new assistant activity. Retries with exponential backoff if not.
 *
 * @module ResumeVerifier
 */

const fs = require('fs');

/**
 * Check if transcript has new assistant entries after a given timestamp.
 *
 * @param {string} transcriptPath - Path to the transcript JSONL file
 * @param {string} lastDetected - ISO timestamp of rate limit detection
 * @returns {boolean} True if new assistant entry found after lastDetected
 */
function hasNewAssistantEntry(transcriptPath, lastDetected) {
  try {
    if (!fs.existsSync(transcriptPath)) return false;

    const content = fs.readFileSync(transcriptPath, 'utf8');
    const lines = content.trim().split('\n');
    const cutoff = new Date(lastDetected).getTime();

    // Scan from the end for efficiency
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;

      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }

      if (entry.type === 'assistant' && entry.timestamp) {
        const entryTime = new Date(entry.timestamp).getTime();
        if (entryTime > cutoff) {
          return true;
        }
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Wait for a given number of seconds (returns a promise).
 * @param {number} seconds
 * @returns {Promise<void>}
 */
function delay(seconds) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

/**
 * Verify resume succeeded by checking transcript, with retry and backoff.
 *
 * @param {Object} options
 * @param {string} options.transcriptPath - Path to transcript JSONL
 * @param {string} options.lastDetected - ISO timestamp of rate limit detection
 * @param {number} [options.checkDelaySec=10] - Initial delay before first check
 * @param {number} [options.maxRetries=3] - Maximum number of retry attempts
 * @param {number[]} [options.backoffSeconds=[10,20,40]] - Backoff delays per retry
 * @param {Function} [options.log] - Logging function
 * @returns {Promise<{ verified: boolean, attempts: number }>}
 */
async function verifyResumeWithRetry(options) {
  const {
    transcriptPath,
    lastDetected,
    checkDelaySec = 10,
    maxRetries = 3,
    backoffSeconds = [10, 20, 40],
    log = () => {}
  } = options;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // Wait before checking
    const waitTime = attempt === 1 ? checkDelaySec : backoffSeconds[Math.min(attempt - 2, backoffSeconds.length - 1)];
    await delay(waitTime);

    // Check transcript for new assistant entry
    if (hasNewAssistantEntry(transcriptPath, lastDetected)) {
      log(`Resume verified after attempt ${attempt}`);
      return { verified: true, attempts: attempt };
    }

    if (attempt < maxRetries) {
      log(`Retry ${attempt}/${maxRetries}: no new assistant entry, retrying...`);
    } else {
      log(`Retry ${attempt}/${maxRetries}: verification failed after all retries`);
    }
  }

  return { verified: false, attempts: maxRetries };
}

module.exports = { verifyResumeWithRetry, hasNewAssistantEntry };
