/**
 * Config Hot-Reload
 *
 * Watches config.json for changes using fs.watch() and reloads
 * configuration in-memory when the file is modified.
 * Falls back to polling if fs.watch is unavailable.
 *
 * @module ConfigHotReload
 */

const fs = require('fs');

/**
 * Create a config file watcher that calls onReload with new config on changes.
 *
 * @param {string} configPath - Path to config.json
 * @param {Function} onReload - Callback with parsed config object
 * @param {Object} [options]
 * @param {number} [options.pollInterval=5000] - Fallback poll interval
 * @returns {{ mode: string, close: Function }}
 */
function createConfigWatcher(configPath, onReload, options = {}) {
  const pollInterval = options.pollInterval || 5000;
  let fsWatcher = null;
  let pollHandle = null;
  let lastMtime = null;

  function reloadConfig() {
    try {
      if (!fs.existsSync(configPath)) return;
      const content = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(content);
      onReload(config);
    } catch {
      // Invalid JSON or read error - skip reload
    }
  }

  // Try fs.watch first
  try {
    fsWatcher = fs.watch(configPath, (eventType) => {
      if (eventType === 'change' || eventType === 'rename') {
        reloadConfig();
      }
    });

    fsWatcher.on('error', () => {
      // Switch to polling on error
      if (fsWatcher) {
        try { fsWatcher.close(); } catch (e) { /* ignore */ }
        fsWatcher = null;
      }
      if (!pollHandle) startPolling();
    });

    return {
      mode: 'watch',
      close() {
        if (fsWatcher) {
          fsWatcher.close();
          fsWatcher = null;
        }
      }
    };
  } catch {
    // fs.watch not supported, fall back to polling
  }

  function startPolling() {
    pollHandle = setInterval(() => {
      try {
        if (!fs.existsSync(configPath)) return;
        const stats = fs.statSync(configPath);
        if (lastMtime !== null && stats.mtimeMs !== lastMtime) {
          reloadConfig();
        }
        lastMtime = stats.mtimeMs;
      } catch {
        // Ignore transient errors
      }
    }, pollInterval);
  }

  startPolling();

  return {
    mode: 'poll',
    close() {
      if (pollHandle) {
        clearInterval(pollHandle);
        pollHandle = null;
      }
    }
  };
}

module.exports = { createConfigWatcher };
