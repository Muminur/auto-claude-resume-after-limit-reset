#!/usr/bin/env node

/**
 * Run Daemon Command - Universal wrapper for daemon CLI commands
 *
 * This script finds the auto-resume daemon regardless of context (plugin or manual install)
 * and forwards all arguments to it. Use this when CLAUDE_PLUGIN_ROOT may not be set.
 *
 * Usage: node run-daemon-command.js [daemon-args...]
 *
 * Examples:
 *   node run-daemon-command.js --notify-test
 *   node run-daemon-command.js status
 *   node run-daemon-command.js --analytics
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME_DIR = os.homedir();
const AUTO_RESUME_DIR = path.join(HOME_DIR, '.claude', 'auto-resume');

// Find daemon path - check plugin location first, then manual install location
function findDaemonPath() {
  // Check if running from plugin (CLAUDE_PLUGIN_ROOT is set)
  if (process.env.CLAUDE_PLUGIN_ROOT) {
    const pluginDaemon = path.join(process.env.CLAUDE_PLUGIN_ROOT, 'auto-resume-daemon.js');
    if (fs.existsSync(pluginDaemon)) {
      return pluginDaemon;
    }
  }

  // Check manual install location
  const manualDaemon = path.join(AUTO_RESUME_DIR, 'auto-resume-daemon.js');
  if (fs.existsSync(manualDaemon)) {
    return manualDaemon;
  }

  // Search in plugin cache
  const pluginCache = path.join(HOME_DIR, '.claude', 'plugins', 'cache');
  if (fs.existsSync(pluginCache)) {
    try {
      const findDaemon = (dir) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            const result = findDaemon(fullPath);
            if (result) return result;
          } else if (entry.name === 'auto-resume-daemon.js') {
            return fullPath;
          }
        }
        return null;
      };
      const found = findDaemon(pluginCache);
      if (found) return found;
    } catch (e) {
      // Ignore search errors
    }
  }

  return null;
}

// Main function
function main() {
  const daemonPath = findDaemonPath();

  if (!daemonPath) {
    console.error('[ERROR] Could not find auto-resume-daemon.js');
    console.error('Searched locations:');
    console.error('  - $CLAUDE_PLUGIN_ROOT/auto-resume-daemon.js');
    console.error(`  - ${path.join(AUTO_RESUME_DIR, 'auto-resume-daemon.js')}`);
    console.error(`  - ${path.join(HOME_DIR, '.claude', 'plugins', 'cache', '**', 'auto-resume-daemon.js')}`);
    process.exit(1);
  }

  // Forward all arguments to the daemon
  const args = process.argv.slice(2);

  const child = spawn('node', [daemonPath, ...args], {
    stdio: 'inherit',
    cwd: process.cwd()
  });

  child.on('close', (code) => {
    process.exit(code || 0);
  });

  child.on('error', (err) => {
    console.error(`[ERROR] Failed to run daemon: ${err.message}`);
    process.exit(1);
  });
}

main();
