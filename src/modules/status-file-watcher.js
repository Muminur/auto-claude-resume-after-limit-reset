/**
 * Event-Driven Status File Watcher
 *
 * Uses fs.watch() for instant file change detection.
 * Falls back to polling (setInterval) when fs.watch is unavailable
 * (e.g., network drives, unsupported filesystems).
 *
 * @module StatusFileWatcher
 */

const fs = require('fs');
const path = require('path');

/**
 * Create a status file watcher that prefers fs.watch over polling.
 *
 * @param {string} filePath - Path to status.json
 * @param {Function} onChange - Callback invoked when file changes
 * @param {Object} [options] - Options
 * @param {number} [options.pollInterval=5000] - Fallback poll interval in ms
 * @param {number} [options.debounceMs=150] - Debounce window for rapid fs.watch events
 * @returns {{ mode: string, close: Function, interval?: any, pollInterval?: number }}
 */
function createStatusFileWatcher(filePath, onChange, options = {}) {
  const pollInterval = options.pollInterval || 5000;
  const debounceMs = options.debounceMs || 150;

  let debounceTimer = null;
  let fsWatcher = null;
  let pollHandle = null;
  let lastMtime = null;
  let mode = 'watch';

  function debouncedOnChange() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      onChange();
    }, debounceMs);
  }

  // Try fs.watch first
  try {
    fsWatcher = fs.watch(filePath, (eventType) => {
      if (eventType === 'change' || eventType === 'rename') {
        debouncedOnChange();
      }
    });

    fsWatcher.on('error', () => {
      // If fs.watch errors after creation, switch to polling
      if (fsWatcher) {
        try { fsWatcher.close(); } catch (e) { /* ignore */ }
        fsWatcher = null;
      }
      if (!pollHandle) {
        mode = 'poll';
        startPolling();
      }
    });

    return {
      mode: 'watch',
      close() {
        if (debounceTimer) clearTimeout(debounceTimer);
        if (fsWatcher) {
          fsWatcher.close();
          fsWatcher = null;
        }
      }
    };
  } catch (err) {
    // fs.watch not supported, fall back to polling
    mode = 'poll';
  }

  function startPolling() {
    pollHandle = setInterval(() => {
      try {
        if (!fs.existsSync(filePath)) return;
        const stats = fs.statSync(filePath);
        if (lastMtime !== null && stats.mtimeMs !== lastMtime) {
          onChange();
        }
        lastMtime = stats.mtimeMs;
      } catch (e) {
        // Ignore transient read errors
      }
    }, pollInterval);
  }

  startPolling();

  return {
    mode: 'poll',
    interval: pollHandle,
    pollInterval,
    close() {
      if (debounceTimer) clearTimeout(debounceTimer);
      if (pollHandle) {
        clearInterval(pollHandle);
        pollHandle = null;
      }
    }
  };
}

module.exports = { createStatusFileWatcher };
