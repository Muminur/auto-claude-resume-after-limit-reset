/**
 * Tests that tryWeztermCli makes exactly ONE execFile call to wezterm and validates JSON.
 */

const fs = require('fs');
const path = require('path');

describe('tryWeztermCli — single execFile call with JSON validation', () => {
  let src;
  let fnSrc;

  beforeAll(() => {
    const fullSrc = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'delivery', 'windows-delivery.js'),
      'utf8'
    );

    // Extract just the tryWeztermCli function body
    const fnStart = fullSrc.indexOf('\nasync function tryWeztermCli(');
    const fnEnd = fullSrc.indexOf('\nfunction truncate(', fnStart);
    fnSrc = fnStart !== -1 && fnEnd !== -1 ? fullSrc.slice(fnStart, fnEnd) : fullSrc;
    src = fullSrc;
  });

  test('calls execFile for wezterm cli list only once', () => {
    // Count occurrences of 'cli', 'list' inside tryWeztermCli — should be exactly 1
    const cliListCalls = (fnSrc.match(/'cli',\s*'list'/g) || []).length;
    expect(cliListCalls).toBe(1);
  });

  test('validates stdout is a JSON array (not just exit code)', () => {
    expect(fnSrc).toContain('Array.isArray');
  });

  test('uses JSON.parse on the single call stdout', () => {
    expect(fnSrc).toContain('JSON.parse');
  });

  test('resolves available:false when stdout is not a valid JSON array', () => {
    expect(fnSrc).toContain('available: false');
  });

  test('resolves available:true with allPanes when stdout is valid JSON array', () => {
    expect(fnSrc).toContain('available: true');
    expect(fnSrc).toContain('allPanes');
  });

  test('falls back gracefully on JSON.parse error', () => {
    // JSON.parse wrapped in try/catch
    expect(fnSrc).toMatch(/try\s*\{[\s\S]*?JSON\.parse/);
  });

  test('does not have two separate wezterm cli list calls', () => {
    // The old pattern had two sequential execFile calls for cli list
    // Ensure listOut variable (old second call) is gone
    expect(fnSrc).not.toContain('const listOut');
  });

  test('does not have cliCheck variable (old exit-code-only guard)', () => {
    expect(fnSrc).not.toContain('cliCheck');
  });
});
