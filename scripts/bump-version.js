#!/usr/bin/env node

/**
 * Version Bump Script
 *
 * Automatically bumps the patch version in plugin.json and marketplace.json
 *
 * Usage:
 *   node scripts/bump-version.js          # Bump patch (1.2.3 -> 1.2.4)
 *   node scripts/bump-version.js minor    # Bump minor (1.2.3 -> 1.3.0)
 *   node scripts/bump-version.js major    # Bump major (1.2.3 -> 2.0.0)
 */

const fs = require('fs');
const path = require('path');

const PLUGIN_JSON = path.join(__dirname, '..', '.claude-plugin', 'plugin.json');
const MARKETPLACE_JSON = path.join(__dirname, '..', '.claude-plugin', 'marketplace.json');

function bumpVersion(version, type = 'patch') {
  const parts = version.split('.').map(Number);

  switch (type) {
    case 'major':
      parts[0]++;
      parts[1] = 0;
      parts[2] = 0;
      break;
    case 'minor':
      parts[1]++;
      parts[2] = 0;
      break;
    case 'patch':
    default:
      parts[2]++;
      break;
  }

  return parts.join('.');
}

function updateJsonFile(filePath, newVersion, versionPath = null) {
  const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  if (versionPath) {
    // For marketplace.json, version is in plugins[0].version
    let obj = content;
    const pathParts = versionPath.split('.');
    for (let i = 0; i < pathParts.length - 1; i++) {
      const key = pathParts[i].match(/\[(\d+)\]/)
        ? parseInt(pathParts[i].match(/\[(\d+)\]/)[1])
        : pathParts[i];
      obj = obj[key];
    }
    const lastKey = pathParts[pathParts.length - 1];
    obj[lastKey] = newVersion;
  } else {
    content.version = newVersion;
  }

  fs.writeFileSync(filePath, JSON.stringify(content, null, 2) + '\n');
  return content;
}

function main() {
  const bumpType = process.argv[2] || 'patch';

  if (!['major', 'minor', 'patch'].includes(bumpType)) {
    console.error('Usage: node bump-version.js [major|minor|patch]');
    process.exit(1);
  }

  // Read current version from plugin.json
  const pluginJson = JSON.parse(fs.readFileSync(PLUGIN_JSON, 'utf8'));
  const currentVersion = pluginJson.version;
  const newVersion = bumpVersion(currentVersion, bumpType);

  console.log(`Bumping version: ${currentVersion} -> ${newVersion} (${bumpType})`);

  // Update plugin.json
  updateJsonFile(PLUGIN_JSON, newVersion);
  console.log(`  Updated: ${PLUGIN_JSON}`);

  // Update marketplace.json (version is in plugins[0].version)
  const marketplaceJson = JSON.parse(fs.readFileSync(MARKETPLACE_JSON, 'utf8'));
  marketplaceJson.plugins[0].version = newVersion;
  fs.writeFileSync(MARKETPLACE_JSON, JSON.stringify(marketplaceJson, null, 2) + '\n');
  console.log(`  Updated: ${MARKETPLACE_JSON}`);

  console.log(`\nVersion bumped to ${newVersion}`);
  console.log('\nNext steps:');
  console.log('  git add .claude-plugin/plugin.json .claude-plugin/marketplace.json');
  console.log(`  git commit -m "chore: Bump version to ${newVersion}"`);
  console.log('  git push origin main');

  return newVersion;
}

main();
