/**
 * Tests that buildWindowsKeystrokeScript sends to ALL ancestor terminals, not just the first.
 */

const fs = require('fs');
const path = require('path');

describe('buildWindowsKeystrokeScript — multi-terminal delivery', () => {
  let src;

  beforeAll(() => {
    src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'delivery', 'windows-delivery.js'),
      'utf8'
    );
  });

  function extractStrategy1(script) {
    // Extract the Strategy 1 block from a generated PowerShell script
    const start = script.indexOf('# Strategy 1:');
    const end = script.indexOf('# Strategy 2:');
    return start !== -1 && end !== -1 ? script.slice(start, end) : '';
  }

  function getScript() {
    // Load the module fresh each test to pick up any changes
    delete require.cache[require.resolve('../../src/delivery/windows-delivery')];
    const mod = require('../../src/delivery/windows-delivery');
    return mod.buildWindowsKeystrokeScript('continue');
  }

  test('Strategy 1 uses $targetedPids hashtable for deduplication', () => {
    const script = getScript();
    const s1 = extractStrategy1(script);
    expect(s1).toContain('$targetedPids = @{}');
  });

  test('Strategy 1 skips already-targeted ancestor PIDs', () => {
    const script = getScript();
    const s1 = extractStrategy1(script);
    expect(s1).toContain('$targetedPids.ContainsKey');
  });

  test('Strategy 1 records targeted PIDs after successful send', () => {
    const script = getScript();
    const s1 = extractStrategy1(script);
    expect(s1).toContain('$targetedPids[[int]$ancestor');
  });

  test('Strategy 1 does NOT break after first successful terminal', () => {
    const script = getScript();
    const s1 = extractStrategy1(script);
    // The triple-break pattern (break inside ancestor loop) must be gone
    // Count break statements — there should be zero inner breaks after AppActivate
    const breakAfterAppActivate = /AppActivate[\s\S]*?break/;
    expect(breakAfterAppActivate.test(s1)).toBe(false);
  });

  test('Strategy 1 still sets $sent = $true on success', () => {
    const script = getScript();
    const s1 = extractStrategy1(script);
    expect(s1).toContain('$sent = $true');
  });

  test('Strategy 2 fallback is still present', () => {
    const script = getScript();
    expect(script).toContain('# Strategy 2:');
    expect(script).toContain('if (-not $sent)');
  });

  test('Strategy 3 fallback is still present', () => {
    const script = getScript();
    expect(script).toContain('# Strategy 3:');
  });

  test('Strategy 4 last-resort is still present', () => {
    const script = getScript();
    expect(script).toContain('# Strategy 4:');
  });

  test('Strategy 1 only targets known terminal process names (not explorer, notepad, etc.)', () => {
    const script = getScript();
    const s1 = extractStrategy1(script);
    expect(s1).toContain('$knownTerminals');
    expect(s1).toContain('WindowsTerminal');
    expect(s1).toContain('wezterm-gui');
    expect(s1).toContain('$knownTerminals -contains $ancestor.Name');
  });
});
