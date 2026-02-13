#!/usr/bin/env node

/**
 * Test script for example plugins
 *
 * This script loads the example plugins and tests their hooks.
 * Run from the repository root: node examples/plugins/test-plugins.js
 */

const path = require('path');

async function testPlugin(pluginPath, pluginName) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${pluginName}`);
  console.log('='.repeat(60));

  try {
    // Load the plugin
    const plugin = require(pluginPath);
    console.log(`✓ Plugin loaded successfully`);
    console.log(`  Name: ${plugin.name}`);
    console.log(`  Version: ${plugin.version}`);
    console.log(`  Description: ${plugin.description}`);

    // Test hooks exist
    console.log(`\nHooks available:`);
    const hooks = Object.keys(plugin.hooks || {});
    if (hooks.length === 0) {
      console.log(`  (none)`);
    } else {
      hooks.forEach(hook => {
        console.log(`  - ${hook}`);
      });
    }

    // Test onPluginEnabled hook if it exists
    if (plugin.hooks.onPluginEnabled) {
      console.log(`\nTesting onPluginEnabled hook...`);
      await plugin.hooks.onPluginEnabled({
        timestamp: new Date().toISOString()
      });
      console.log(`✓ onPluginEnabled hook executed`);
    }

    // Test onRateLimitDetected hook
    if (plugin.hooks.onRateLimitDetected) {
      console.log(`\nTesting onRateLimitDetected hook...`);
      const resetTime = Math.floor(Date.now() / 1000) + 300; // 5 minutes from now
      await plugin.hooks.onRateLimitDetected({
        timestamp: new Date().toISOString(),
        resetTime: resetTime,
        conversationId: 'test_conv_123'
      });
      console.log(`✓ onRateLimitDetected hook executed`);
    }

    // Test onResumeSent hook
    if (plugin.hooks.onResumeSent) {
      console.log(`\nTesting onResumeSent hook...`);
      await plugin.hooks.onResumeSent({
        timestamp: new Date().toISOString(),
        conversationId: 'test_conv_123',
        message: 'continue'
      });
      console.log(`✓ onResumeSent hook executed`);
    }

    // Test onPluginDisabled hook if it exists
    if (plugin.hooks.onPluginDisabled) {
      console.log(`\nTesting onPluginDisabled hook...`);
      await plugin.hooks.onPluginDisabled({
        timestamp: new Date().toISOString()
      });
      console.log(`✓ onPluginDisabled hook executed`);
    }

    console.log(`\n✓ All tests passed for ${pluginName}`);
    return true;
  } catch (error) {
    console.error(`\n✗ Error testing ${pluginName}:`, error.message);
    console.error(error.stack);
    return false;
  }
}

async function main() {
  console.log('Auto-Resume Plugin Test Suite');
  console.log('==============================\n');

  const pluginsDir = path.join(__dirname);
  const plugins = [
    { path: path.join(pluginsDir, 'console-logger', 'index.js'), name: 'console-logger' },
    { path: path.join(pluginsDir, 'log-to-file', 'index.js'), name: 'log-to-file' },
    { path: path.join(pluginsDir, 'slack-notify', 'index.js'), name: 'slack-notify' }
  ];

  const results = [];

  for (const plugin of plugins) {
    const success = await testPlugin(plugin.path, plugin.name);
    results.push({ name: plugin.name, success });
  }

  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log('Test Summary');
  console.log('='.repeat(60));

  results.forEach(result => {
    const status = result.success ? '✓ PASS' : '✗ FAIL';
    console.log(`${status}: ${result.name}`);
  });

  const allPassed = results.every(r => r.success);
  console.log(`\n${allPassed ? '✓ All tests passed!' : '✗ Some tests failed'}`);

  process.exit(allPassed ? 0 : 1);
}

// Run tests
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
