#!/usr/bin/env node

/**
 * Ensure Daemon Running Script
 *
 * This script runs on Claude Code SessionStart to ensure the auto-resume daemon
 * is running. If not running, it starts the daemon automatically.
 *
 * Cross-platform: Windows, macOS, Linux
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Required dependencies for dashboard functionality
const REQUIRED_DEPS = ['ws', 'node-notifier'];

// Getter functions for paths to make testing easier
function getHomeDir() {
  return os.homedir();
}

function getAutoResumeDir() {
  return path.join(getHomeDir(), '.claude', 'auto-resume');
}

function getPidFile() {
  return path.join(getAutoResumeDir(), 'daemon.pid');
}

/**
 * Check if required dependencies are installed in a directory
 * @param {string} dir - Directory to check for node_modules
 * @returns {string[]} - Array of missing dependency names
 */
function getMissingDeps(dir) {
  const missing = [];
  for (const dep of REQUIRED_DEPS) {
    const depPath = path.join(dir, 'node_modules', dep);
    if (!fs.existsSync(depPath)) {
      missing.push(dep);
    }
  }
  return missing;
}

/**
 * Install missing dependencies in the specified directory
 * @param {string} dir - Directory containing package.json
 * @param {string[]} deps - Dependencies to install
 * @returns {boolean} - True if installation succeeded
 */
function installMissingDeps(dir, deps) {
  if (deps.length === 0) return true;

  try {
    // Check if package.json exists
    const packageJsonPath = path.join(dir, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      return false;
    }

    // Run npm install for missing deps
    const depsStr = deps.join(' ');
    execSync(`npm install ${depsStr} --save --legacy-peer-deps`, {
      cwd: dir,
      stdio: 'pipe',
      encoding: 'utf8',
      timeout: 60000 // 60 second timeout
    });

    return true;
  } catch (e) {
    // Installation failed, but don't block daemon start
    return false;
  }
}

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
  const manualDaemon = path.join(getAutoResumeDir(), 'auto-resume-daemon.js');
  if (fs.existsSync(manualDaemon)) {
    return manualDaemon;
  }

  // Search in plugin cache
  const pluginCache = path.join(getHomeDir(), '.claude', 'plugins', 'cache');
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

// Check if daemon is running by checking PID file and process
function isDaemonRunning() {
  if (!fs.existsSync(getPidFile())) {
    return false;
  }

  try {
    const pid = parseInt(fs.readFileSync(getPidFile(), 'utf8').trim(), 10);
    if (isNaN(pid)) {
      return false;
    }

    // Check if process is running
    if (process.platform === 'win32') {
      try {
        execSync(`tasklist /FI "PID eq ${pid}" /NH`, { encoding: 'utf8', stdio: 'pipe' });
        const output = execSync(`tasklist /FI "PID eq ${pid}" /NH`, { encoding: 'utf8', stdio: 'pipe' });
        return output.includes(pid.toString());
      } catch (e) {
        return false;
      }
    } else {
      try {
        process.kill(pid, 0);
        return true;
      } catch (e) {
        return false;
      }
    }
  } catch (e) {
    return false;
  }
}

// Start the daemon
function startDaemon(daemonPath) {
  const autoResumeDir = getAutoResumeDir();
  // Ensure auto-resume directory exists
  if (!fs.existsSync(autoResumeDir)) {
    fs.mkdirSync(autoResumeDir, { recursive: true });
  }

  const logFile = path.join(autoResumeDir, 'daemon.log');
  const out = fs.openSync(logFile, 'a');
  const err = fs.openSync(logFile, 'a');

  const child = spawn('node', [daemonPath, 'start'], {
    detached: true,
    stdio: ['ignore', out, err],
    cwd: autoResumeDir,
    env: { ...process.env, DAEMON_AUTOSTART: 'true' }
  });

  child.unref();

  return child.pid;
}

/**
 * Format hook output for Claude Code
 * Uses hookSpecificOutput for proper integration
 */
function formatHookOutput(status, message, extra = {}) {
  return {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: message
    },
    status,
    ...extra
  };
}

/**
 * Ensure the Stop hook (rate-limit-hook.js) is registered in settings.json.
 * This self-heals for ALL users (plugin and manual install) on every session start.
 * If the Stop hook is missing, it adds it. Never throws - session start must not fail.
 */
function ensureStopHookRegistered() {
  try {
    const settingsPath = path.join(getHomeDir(), '.claude', 'settings.json');

    // Find the rate-limit-hook.js path
    let hookPath = null;
    if (process.env.CLAUDE_PLUGIN_ROOT) {
      const pluginHook = path.join(process.env.CLAUDE_PLUGIN_ROOT, 'hooks', 'rate-limit-hook.js');
      if (fs.existsSync(pluginHook)) {
        hookPath = pluginHook;
      }
    }
    if (!hookPath) {
      // Check manual install location
      const manualHook = path.join(getHomeDir(), '.claude', 'hooks', 'rate-limit-hook.js');
      if (fs.existsSync(manualHook)) {
        hookPath = manualHook;
      }
    }
    if (!hookPath) {
      // Search plugin cache
      const cacheDir = path.join(getHomeDir(), '.claude', 'plugins', 'cache');
      if (fs.existsSync(cacheDir)) {
        const findHook = (dir, depth = 0) => {
          if (depth > 5) return null;
          try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
              const fullPath = path.join(dir, entry.name);
              if (entry.isDirectory()) {
                const result = findHook(fullPath, depth + 1);
                if (result) return result;
              } else if (entry.name === 'rate-limit-hook.js') {
                return fullPath;
              }
            }
          } catch (e) { /* ignore */ }
          return null;
        };
        hookPath = findHook(cacheDir);
      }
    }

    // If hook script not found on disk, nothing to register
    if (!hookPath) return;

    // Read settings.json
    let settings = {};
    if (fs.existsSync(settingsPath)) {
      try {
        settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      } catch (e) {
        // Can't parse settings.json - don't risk corrupting it
        return;
      }
    } else {
      // No settings.json exists - don't create one just for this
      return;
    }

    // Check if Stop hook with rate-limit-hook.js already exists
    if (settings.hooks && settings.hooks.Stop) {
      const stopHooks = settings.hooks.Stop;
      for (const group of stopHooks) {
        if (group.hooks) {
          for (const hook of group.hooks) {
            if (hook.command && hook.command.includes('rate-limit-hook.js')) {
              // Already registered, nothing to do
              return;
            }
          }
        }
      }
    }

    // Stop hook is missing - add it
    if (!settings.hooks) {
      settings.hooks = {};
    }
    if (!settings.hooks.Stop) {
      settings.hooks.Stop = [];
    }

    // Normalize path for the command
    const normalizedPath = hookPath.replace(/\\/g, '\\\\');

    settings.hooks.Stop.push({
      matcher: "",
      hooks: [
        {
          type: "command",
          command: `node "${normalizedPath}"`,
          timeout: 15
        }
      ]
    });

    // Write back
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');

  } catch (e) {
    // Never fail session start - silently ignore errors
  }
}

// Main function
function main() {
  try {
    // Self-heal: ensure Stop hook is registered in settings.json
    ensureStopHookRegistered();

    // Check if already running
    if (isDaemonRunning()) {
      // Daemon is running, output success silently
      console.log(JSON.stringify(formatHookOutput('running', 'Auto-resume daemon is running')));
      process.exit(0);
      return;
    }

    // Find daemon path
    const daemonPath = findDaemonPath();
    if (!daemonPath) {
      // Daemon not found - this is okay, might not be fully installed
      console.log(JSON.stringify(formatHookOutput('not_found', 'Auto-resume daemon not installed')));
      process.exit(0);
      return;
    }

    // Check and install missing dependencies (for dashboard functionality)
    const daemonDir = path.dirname(daemonPath);
    const missingDeps = getMissingDeps(daemonDir);
    if (missingDeps.length > 0) {
      // Try to install missing dependencies silently
      installMissingDeps(daemonDir, missingDeps);
    }

    // Start the daemon
    const pid = startDaemon(daemonPath);

    console.log(JSON.stringify(formatHookOutput('started', 'Auto-resume daemon started', {
      pid,
      daemonPath
    })));

    process.exit(0);

  } catch (err) {
    // Don't fail the session start, just log the error
    console.log(JSON.stringify(formatHookOutput('error', `Auto-resume error: ${err.message}`)));
    process.exit(0);
  }
}

// Run main if called directly, but allow exporting for tests
if (require.main === module) {
  main();
}

// Export functions for testing
module.exports = {
  findDaemonPath,
  isDaemonRunning,
  startDaemon,
  main,
  formatHookOutput,
  getMissingDeps,
  installMissingDeps,
  ensureStopHookRegistered,
  REQUIRED_DEPS
};
