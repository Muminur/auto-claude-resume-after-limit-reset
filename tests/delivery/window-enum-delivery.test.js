/**
 * Tests for HWND/UI-Automation multi-window resume delivery.
 *
 * Background: multiple Claude Code sessions commonly run in separate Windows
 * Terminal windows that are ALL owned by one WindowsTerminal.exe process. The
 * old process-walk + `wt -w 0 focus-tab` strategies could physically reach only
 * one of N windows. buildWindowEnumScript enumerates every window via UI
 * Automation and targets each by its NativeWindowHandle.
 */

const {
  buildWindowEnumScript,
  DEFAULT_CLAUDE_TITLE_REGEX,
  TERMINAL_PROCESS_NAMES,
} = require('../../src/delivery/windows-delivery');

// Translate the .NET regex (uses an inline (?i) flag) into a JS RegExp so we can
// assert its matching semantics directly.
function asJsRegex(netRegex) {
  return new RegExp(netRegex.replace(/^\(\?i\)/, ''), 'i');
}

describe('buildWindowEnumScript — AMSI-clean UI Automation delivery', () => {
  test('uses managed UI Automation, never Win32 P/Invoke (avoids AMSI injector block)', () => {
    const script = buildWindowEnumScript('continue');
    // DllImport + SetForegroundWindow + AttachThreadInput + SendKeys is flagged by
    // Defender AMSI as malicious. The managed path must contain no P/Invoke at all.
    expect(script).not.toMatch(/DllImport/);
    expect(script).not.toMatch(/AttachThreadInput/);
    expect(script).not.toMatch(/SetForegroundWindow/);
    expect(script).toContain('UIAutomationClient');
    expect(script).toContain('AutomationElement');
    expect(script).toContain('.SetFocus()');
  });

  test('enumerates top-level windows and dedups by NativeWindowHandle (not PID)', () => {
    const script = buildWindowEnumScript('continue');
    expect(script).toContain('NativeWindowHandle');
    expect(script).toContain('FindAll');
    // dedup keyed on the handle, because one WindowsTerminal.exe owns many windows
    expect(script).toContain('$seen');
  });

  test('restricts delivery to terminal processes (excludes explorer/browser false positives)', () => {
    const script = buildWindowEnumScript('continue');
    expect(script).toContain('$termProcs');
    expect(script).toContain('WindowsTerminal');
    expect(script).toContain("$termProcs -notcontains $pname");
    // wezterm-gui is handled by the WezTerm CLI strategy and must not be here
    expect(TERMINAL_PROCESS_NAMES).not.toContain('wezterm-gui');
    expect(TERMINAL_PROCESS_NAMES).not.toContain('explorer');
  });

  test('verifies focus before sending keystrokes (foreground-lock guard)', () => {
    const script = buildWindowEnumScript('continue');
    expect(script).toContain('FocusedElement');
    expect(script).toContain('Focus-Verified');
    // a focus that cannot be confirmed is skipped + logged, never sent blindly
    expect(script).toContain('RESUME-SKIPPED');
    expect(script).toContain('focus-denied');
  });

  test('dry-run sets $dryRun=$true and emits RESUME-TARGET candidates only', () => {
    const dry = buildWindowEnumScript('continue', { dryRun: true });
    expect(dry).toContain('$dryRun = $true');
    expect(dry).toContain('RESUME-TARGET:');
    const live = buildWindowEnumScript('continue', { dryRun: false });
    expect(live).toContain('$dryRun = $false');
  });

  test('embeds the resume text into the keystroke block', () => {
    const script = buildWindowEnumScript('please continue now');
    expect(script).toContain('please continue now');
  });

  test('escapes single quotes in resume text', () => {
    const script = buildWindowEnumScript("don't stop");
    expect(script).toContain("don''t stop");
  });

  test('a custom titlePattern overrides the default heuristic', () => {
    const script = buildWindowEnumScript('continue', { titlePattern: 'MYCUSTOMTAG' });
    expect(script).toContain("$claudeRegex = 'MYCUSTOMTAG'");
  });
});

describe('DEFAULT_CLAUDE_TITLE_REGEX — Claude window detection', () => {
  const re = asJsRegex(DEFAULT_CLAUDE_TITLE_REGEX);

  test('matches the working Braille-spinner titles', () => {
    expect(re.test('⠐ codebase-audit-parallel-fixes')).toBe(true); // ⠐
    expect(re.test('⠂ Execute first milestone with team agents')).toBe(true); // ⠂
  });

  test('matches the IDLE / rate-limited asterisk-glyph title (the daemon-time state)', () => {
    // ✳ U+2733 — shown when a session is paused at the rate limit, no spinner.
    expect(re.test('✳ Schedule something')).toBe(true);
  });

  test('matches the default "Claude Code" title', () => {
    expect(re.test('⠐ Claude Code')).toBe(true);
  });

  test('does NOT match plain shell window titles', () => {
    expect(re.test('Windows PowerShell')).toBe(false);
    expect(re.test('Grafana')).toBe(false);
    expect(re.test('C:\\WINDOWS\\system32\\cmd.exe')).toBe(false);
  });

  test('the explorer/browser "claude" false positive is left to the process allowlist, not the regex', () => {
    // The regex intentionally matches "claude" anywhere; the terminal-process
    // allowlist is what prevents firing keystrokes into a File Explorer window.
    expect(re.test('AutoClaudeResume - File Explorer')).toBe(true);
    expect(TERMINAL_PROCESS_NAMES).not.toContain('explorer');
  });
});
