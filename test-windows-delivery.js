#!/usr/bin/env node
/**
 * Test script for Windows delivery module
 * Tests both WezTerm CLI and PowerShell keystroke paths
 */
const { tryWeztermCli, tryPowerShellKeystroke, deliverResumeWindows } = require('./src/delivery/windows-delivery');

const log = (level, msg) => console.log(`[${level.toUpperCase()}] ${msg}`);

async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || 'all';

  if (mode === 'wezterm' || mode === 'all') {
    console.log('\n--- Testing WezTerm CLI delivery ---');
    const ok = await tryWeztermCli('continue', log);
    console.log('WezTerm result:', ok ? 'SUCCESS' : 'NOT AVAILABLE/FAILED');
  }

  if (mode === 'powershell' || mode === 'all') {
    console.log('\n--- Testing PowerShell keystroke delivery ---');
    const ok = await tryPowerShellKeystroke('continue', log);
    console.log('PowerShell result:', ok ? 'SUCCESS' : 'FAILED');
  }

  if (mode === 'full' || mode === 'all') {
    console.log('\n--- Testing full deliverResumeWindows (tries WezTerm first, then PowerShell) ---');
    const result = await deliverResumeWindows({ resumeText: 'continue', log });
    console.log('Full delivery result:', result);
  }
}

main().catch(err => { console.error('Test error:', err); process.exit(1); });
