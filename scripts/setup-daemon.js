#!/usr/bin/env node

/**
 * Auto-Resume Plugin - Post-install Setup Script
 *
 * This script runs after plugin installation to:
 * 1. Display setup instructions
 * 2. Create necessary directories
 * 3. Provide daemon start commands
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME_DIR = os.homedir();
const AUTO_RESUME_DIR = path.join(HOME_DIR, '.claude', 'auto-resume');

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m'
};

function log(msg, color = 'reset') {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

function main() {
  // Create auto-resume directory
  if (!fs.existsSync(AUTO_RESUME_DIR)) {
    fs.mkdirSync(AUTO_RESUME_DIR, { recursive: true });
  }

  // Get plugin root (parent of scripts directory)
  const pluginRoot = path.dirname(__dirname);
  const daemonPath = path.join(pluginRoot, 'auto-resume-daemon.js');

  console.log('');
  log('═══════════════════════════════════════════════════════════════', 'cyan');
  log('  Auto-Resume Plugin Installed Successfully!', 'green');
  log('═══════════════════════════════════════════════════════════════', 'cyan');
  console.log('');
  log('The plugin hook is now active - rate limits will be detected automatically.', 'reset');
  console.log('');
  log('To enable automatic session resumption, start the background daemon:', 'yellow');
  console.log('');

  if (process.platform === 'win32') {
    log(`  node "${daemonPath}" start`, 'bold');
  } else {
    log(`  node "${daemonPath}" start`, 'bold');
  }

  console.log('');
  log('Other daemon commands:', 'yellow');
  log(`  status  - Check daemon status`, 'reset');
  log(`  stop    - Stop the daemon`, 'reset');
  log(`  restart - Restart the daemon`, 'reset');
  console.log('');
  log('For automatic startup on boot, see the documentation:', 'cyan');
  log('  https://github.com/Muminur/auto-claude-resume-after-limit-reset#daemon-auto-start', 'cyan');
  console.log('');
}

main();
