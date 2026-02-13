#!/usr/bin/env node

/**
 * Update Command Versions
 *
 * Updates all version references in commands/*.md files to match
 * the current version in marketplace.json.
 *
 * Usage:
 *   node scripts/update-command-versions.js
 *   node scripts/update-command-versions.js --check  (verify only, exit 1 if mismatch)
 */

const fs = require('fs');
const path = require('path');

const COMMANDS_DIR = path.join(__dirname, '..', 'commands');
const MARKETPLACE_JSON = path.join(__dirname, '..', '.claude-plugin', 'marketplace.json');

// Get current version from marketplace.json
const marketplace = JSON.parse(fs.readFileSync(MARKETPLACE_JSON, 'utf8'));
const newVersion = marketplace.plugins[0].version;

const checkOnly = process.argv.includes('--check');

// Version pattern: matches X.Y.Z in path context (e.g., /1.4.11/)
const versionPattern = /\/(\d+\.\d+\.\d+)\//g;

const commandFiles = fs.readdirSync(COMMANDS_DIR)
  .filter(f => f.endsWith('.md'))
  .map(f => path.join(COMMANDS_DIR, f));

let updatedCount = 0;
let mismatchFound = false;

commandFiles.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  const originalContent = content;

  content = content.replace(versionPattern, `/${newVersion}/`);

  if (content !== originalContent) {
    if (checkOnly) {
      console.log(`MISMATCH: ${path.basename(file)} has outdated version references`);
      mismatchFound = true;
    } else {
      fs.writeFileSync(file, content);
      console.log(`Updated: ${path.basename(file)}`);
      updatedCount++;
    }
  }
});

if (checkOnly) {
  if (mismatchFound) {
    console.error(`\nVersion mismatch detected! Run: node scripts/update-command-versions.js`);
    process.exit(1);
  } else {
    console.log(`All command files match version ${newVersion}`);
  }
} else {
  console.log(`\nUpdated ${updatedCount} command file(s) to version ${newVersion}`);
}
