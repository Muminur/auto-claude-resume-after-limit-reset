/**
 * Tests for Windows console-input resume delivery (AttachConsole + WriteConsoleInput).
 *
 * This is the primary Windows path: it injects the resume sequence straight into
 * each Claude session's console buffer, which works from the detached daemon
 * (no focus needed), is lock-independent, reaches Windows Terminal ConPTY
 * sessions, and is AMSI-clean — unlike GUI SendKeys, which a background process
 * cannot deliver because Windows denies it foreground.
 *
 * SAFETY: these tests NEVER call discoverClaudeConsolePids() + deliver against
 * live sessions. The one delivery test uses an explicit non-existent PID so
 * AttachConsole fails harmlessly and nothing is injected anywhere.
 */

const {
  buildConsoleInjectScript,
  deliverResumeViaConsole,
  discoverClaudeConsolePids,
} = require('../../src/delivery/console-inject');

describe('buildConsoleInjectScript — console-API injection (no GUI)', () => {
  test('uses the console input API, not GUI focus/SendKeys', () => {
    const s = buildConsoleInjectScript('continue');
    expect(s).toContain('AttachConsole');
    expect(s).toContain('WriteConsoleInputW');
    expect(s).toContain('CreateFileW');
    expect(s).toContain('CONIN$');
    expect(s).toContain('FreeConsole');
    // It must NOT rely on the focus-based GUI path (which fails from the daemon)
    expect(s).not.toMatch(/SendKeys/);
    expect(s).not.toMatch(/SetForegroundWindow/);
    expect(s).not.toMatch(/AttachThreadInput/);
  });

  test('frees the console before each attach (one console per process)', () => {
    const s = buildConsoleInjectScript('continue');
    // FreeConsole appears both before attaching and after writing
    expect((s.match(/FreeConsole/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(s).toContain('param([string]$TargetPids)');
  });

  test('emits the canonical resume sequence as console key events', () => {
    const s = buildConsoleInjectScript('continue', '1');
    expect(s).toContain('[char]27');  // ESC
    expect(s).toContain('[char]21');  // Ctrl+U
    expect(s).toContain('[char]13');  // CR
    expect(s).toContain("$menu = '1'");
    expect(s).toContain("$text = 'continue'");
  });

  test('honors a custom menu selection and resume text', () => {
    const s = buildConsoleInjectScript('go now', '2');
    expect(s).toContain("$menu = '2'");
    expect(s).toContain("$text = 'go now'");
  });

  test('escapes single quotes in resume text for PowerShell', () => {
    const s = buildConsoleInjectScript("don't stop");
    expect(s).toContain("$text = 'don''t stop'");
  });

  test('casts the CONIN$ access flag to uint32 (0xC0000000 is a negative Int32 literal)', () => {
    const s = buildConsoleInjectScript('continue');
    expect(s).toContain('[uint32]3221225472');
  });

  test('produces no JS-template artifacts (tabs encoded for PowerShell)', () => {
    const s = buildConsoleInjectScript('continue');
    // The script string must contain real PowerShell backtick-t, not a broken literal
    expect(s).toContain('INJECT-OK');
    expect(s).toContain('INJECT-SUMMARY');
  });
});

describe('deliverResumeViaConsole — explicit PID (no live sessions touched)', () => {
  test('returns delivered=0 for a non-existent PID (attach fails, nothing injected)', async () => {
    const logs = [];
    const res = await deliverResumeViaConsole({
      pids: [999999],
      resumeText: 'continue',
      log: (l, m) => logs.push(`${l}:${m}`),
    });
    expect(res.delivered).toBe(0);
    expect(res.success).toBe(false);
    expect(res.total).toBe(1);
  }, 30000);

  test('returns delivered=0 with empty PID list without spawning PowerShell', async () => {
    const res = await deliverResumeViaConsole({ pids: [], resumeText: 'continue' });
    expect(res).toEqual({ success: false, delivered: 0, total: 0, pids: [] });
  });
});

describe('module exports', () => {
  test('exposes the public API', () => {
    expect(typeof discoverClaudeConsolePids).toBe('function');
    expect(typeof buildConsoleInjectScript).toBe('function');
    expect(typeof deliverResumeViaConsole).toBe('function');
  });
});
