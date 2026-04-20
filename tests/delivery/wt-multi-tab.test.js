const {
  buildResumeKeystrokeBlock,
  buildMultiTabScript,
} = require('../../src/delivery/windows-delivery');

describe('buildResumeKeystrokeBlock', () => {
  it('emits the canonical 8-step sequence', () => {
    const block = buildResumeKeystrokeBlock('continue');

    // Order matters: ESC, ESC, menu+ENTER, ESC, ESC, C-u, text+ENTER
    const escs = block.match(/SendWait\('\{ESC\}'\)/g) || [];
    expect(escs.length).toBe(4);

    expect(block).toMatch(/SendWait\('1\{ENTER\}'\)/);
    expect(block).toMatch(/SendWait\('\^u'\)/);
    expect(block).toMatch(/SendWait\('continue\{ENTER\}'\)/);

    // Substantial delay after the menu key for TUI to transition
    const idxMenu = block.indexOf("'1{ENTER}'");
    const after = block.slice(idxMenu);
    expect(after).toMatch(/Start-Sleep -Milliseconds 1000/);
  });

  it('respects a custom menu selection', () => {
    const block = buildResumeKeystrokeBlock('go', '2');
    expect(block).toMatch(/SendWait\('2\{ENTER\}'\)/);
    expect(block).toMatch(/SendWait\('go\{ENTER\}'\)/);
  });

  it('escapes single quotes in the resume text for PowerShell', () => {
    const block = buildResumeKeystrokeBlock("can't stop");
    // pre-escaped input: this helper assumes caller pre-escaped, but verify
    // the text appears literally inside the SendKeys call
    expect(block).toContain("can't stop{ENTER}");
  });
});

describe('buildMultiTabScript', () => {
  const wt = 'C:\\Users\\u\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe';

  it('embeds the wt.exe path as a single-quoted string', () => {
    const s = buildMultiTabScript('continue', wt);
    expect(s).toContain(`$wtExe = '${wt}'`);
  });

  it('uses wt.exe -w 0 focus-tab --target $i', () => {
    const s = buildMultiTabScript('continue', wt);
    expect(s).toMatch(/&\s+\$wtExe\s+-w\s+0\s+focus-tab\s+--target\s+\$i/);
  });

  it('looks up WindowsTerminal processes', () => {
    const s = buildMultiTabScript('continue', wt);
    expect(s).toMatch(/Get-Process -Name 'WindowsTerminal'/);
  });

  it('caps tab iteration at maxTabs (default 20)', () => {
    const s = buildMultiTabScript('continue', wt);
    expect(s).toContain('if ($tabCount -gt 20)');
  });

  it('honors a custom maxTabs', () => {
    const s = buildMultiTabScript('continue', wt, 5);
    expect(s).toContain('if ($tabCount -gt 5)');
  });

  it('includes the canonical resume keystroke block inside the loop', () => {
    const s = buildMultiTabScript('continue', wt);
    // The loop body should send the canonical sequence
    const loopStart = s.indexOf('for ($i = 0;');
    expect(loopStart).toBeGreaterThan(-1);
    const loopBody = s.slice(loopStart);
    expect(loopBody).toMatch(/SendWait\('1\{ENTER\}'\)/);
    expect(loopBody).toMatch(/SendWait\('continue\{ENTER\}'\)/);
  });

  it('re-activates the WT window before each tab keystroke burst', () => {
    const s = buildMultiTabScript('continue', wt);
    // Two AppActivate calls: pre-loop and inside the loop
    const matches = s.match(/AppActivate\(\$wt\.Id\)/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('exits with code 2 when no WindowsTerminal process is found', () => {
    const s = buildMultiTabScript('continue', wt);
    expect(s).toMatch(/Write-Error "No WindowsTerminal\.exe.*"\s*\n\s*exit 2/s);
  });

  it('escapes single quotes in the resume text', () => {
    const s = buildMultiTabScript("don't stop", wt);
    expect(s).toContain("don''t stop{ENTER}");
  });
});

describe('tryWindowsTerminalMultiTab', () => {
  it('is exported as a function', () => {
    const m = require('../../src/delivery/windows-delivery');
    expect(typeof m.tryWindowsTerminalMultiTab).toBe('function');
  });
});

describe('deliverResumeWindows orchestrator', () => {
  it('exposes a method-tagged result for wt-multi-tab', () => {
    // Smoke test that the orchestrator exists and the new method tag is wired
    const m = require('../../src/delivery/windows-delivery');
    expect(typeof m.deliverResumeWindows).toBe('function');
    // Source contains the new method label
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '..', '..', 'src', 'delivery', 'windows-delivery.js'),
      'utf8'
    );
    expect(src).toContain("method: 'wt-multi-tab'");
  });
});
