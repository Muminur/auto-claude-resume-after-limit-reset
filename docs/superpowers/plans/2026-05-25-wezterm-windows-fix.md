# WezTerm Windows Delivery Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 3 confirmed bugs that prevent AutoClaudeResume from delivering resume keystrokes to WezTerm on Windows.

**Architecture:** Three independent patches applied in sequence: (1) fix the version-update script's regex to handle Windows backslash path separators, (2) rewrite the PowerShell keystroke script to send to ALL terminal ancestors rather than just the first, (3) consolidate WezTerm CLI's two `execFile` calls into one that validates stdout as a JSON array.

**Tech Stack:** Node.js, Jest 29, PowerShell (string generation only — no live PS execution in tests), `src/delivery/windows-delivery.js`, `scripts/update-command-versions.js`

**Baseline (must stay green):** `npx jest tests/delivery/wt-multi-tab.test.js tests/update-command-versions.test.js` — 30 tests pass.

---

## File Map

| File | Action | Why |
|------|--------|-----|
| `tests/update-command-versions-backslash.test.js` | Create | New test for backslash path fix |
| `scripts/update-command-versions.js` | Modify lines 26-40 | Fix regex + replacement callback |
| `tests/delivery/windows-delivery-multi-terminal.test.js` | Create | New tests for multi-terminal delivery |
| `src/delivery/windows-delivery.js` | Modify `buildWindowsKeystrokeScript` | Remove break-on-first, add deduplication |
| `tests/delivery/wezterm-cli-single-call.test.js` | Create | New tests for consolidated CLI check |
| `src/delivery/windows-delivery.js` | Modify `tryWeztermCli` | Merge cliCheck + listOut into one call |

---

## Task 1: Fix `update-command-versions.js` — Backslash path regex

**Files:**
- Create: `tests/update-command-versions-backslash.test.js`
- Modify: `scripts/update-command-versions.js` (lines 26–40)

### Step 1.1: Write the failing test

Create `tests/update-command-versions-backslash.test.js`:

```javascript
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const UPDATE_VERSIONS_SCRIPT = path.join(__dirname, '..', 'scripts', 'update-command-versions.js');

describe('update-command-versions.js — Windows backslash paths', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backslash-version-test-'));
    fs.mkdirSync(path.join(tmpDir, 'commands'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.claude-plugin'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'scripts'), { recursive: true });

    fs.writeFileSync(
      path.join(tmpDir, '.claude-plugin', 'marketplace.json'),
      JSON.stringify({ plugins: [{ id: 'p', version: '1.16.2', name: 'P' }] }, null, 2) + '\n'
    );
    fs.copyFileSync(UPDATE_VERSIONS_SCRIPT, path.join(tmpDir, 'scripts', 'update-command-versions.js'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('updates Windows PowerShell paths that use backslash separators', () => {
    const content = [
      '# Status',
      '',
      '**Windows (PowerShell):**',
      'node "$env:USERPROFILE\\.claude\\plugins\\cache\\auto-claude-resume\\auto-resume\\1.4.13\\auto-resume-daemon.js" status',
      '',
      '**Windows (CMD/Git Bash):**',
      'node "%USERPROFILE%\\.claude\\plugins\\cache\\auto-claude-resume\\auto-resume\\1.4.13\\auto-resume-daemon.js" status',
      '',
      '**macOS/Linux:**',
      'node ~/.claude/plugins/cache/auto-claude-resume/auto-resume/1.4.13/auto-resume-daemon.js status',
    ].join('\n');

    fs.writeFileSync(path.join(tmpDir, 'commands', 'status.md'), content);

    execSync(`node "${path.join(tmpDir, 'scripts', 'update-command-versions.js')}"`, {
      cwd: tmpDir,
      encoding: 'utf8',
    });

    const updated = fs.readFileSync(path.join(tmpDir, 'commands', 'status.md'), 'utf8');

    // All three path styles must be updated to 1.16.2
    expect(updated).not.toContain('\\1.4.13\\');
    expect(updated).not.toContain('/1.4.13/');
    expect((updated.match(/1\.16\.2/g) || []).length).toBe(3);

    // Separators must be preserved (backslash stays backslash, slash stays slash)
    expect(updated).toContain('\\1.16.2\\');
    expect(updated).toContain('/1.16.2/');
  });

  test('--check flag detects backslash version mismatch', () => {
    const content = 'node "$env:USERPROFILE\\.claude\\plugins\\cache\\p\\1.4.13\\daemon.js"\n';
    fs.writeFileSync(path.join(tmpDir, 'commands', 'start.md'), content);

    expect(() => {
      execSync(`node "${path.join(tmpDir, 'scripts', 'update-command-versions.js')}" --check`, {
        cwd: tmpDir,
        encoding: 'utf8',
      });
    }).toThrow(); // exit 1 because backslash mismatch was invisible before
  });

  test('forward-slash paths still updated correctly after regex change', () => {
    const content = 'node ~/.claude/plugins/cache/auto-claude-resume/auto-resume/1.4.13/auto-resume-daemon.js\n';
    fs.writeFileSync(path.join(tmpDir, 'commands', 'start.md'), content);

    execSync(`node "${path.join(tmpDir, 'scripts', 'update-command-versions.js')}"`, {
      cwd: tmpDir,
      encoding: 'utf8',
    });

    const updated = fs.readFileSync(path.join(tmpDir, 'commands', 'start.md'), 'utf8');
    expect(updated).toContain('/1.16.2/');
    expect(updated).not.toContain('/1.4.13/');
  });
});
```

- [ ] Save the file as written above.

### Step 1.2: Run the test to confirm it fails

```
npx jest tests/update-command-versions-backslash.test.js --no-coverage
```

Expected: **FAIL** — `updates Windows PowerShell paths` fails because backslash paths aren't updated.

### Step 1.3: Fix `scripts/update-command-versions.js`

Open `scripts/update-command-versions.js`. Replace lines 26–40 (the pattern + replace call):

**Before (lines 26–40 approximately):**
```javascript
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
```

**After:**
```javascript
// Version pattern: matches X.Y.Z in path context — handles both / and \ separators
// e.g. /1.4.13/ (macOS/Linux) and \1.4.13\ (Windows paths in .md files)
const versionPattern = /([/\\])(\d+\.\d+\.\d+)([/\\])/g;

const commandFiles = fs.readdirSync(COMMANDS_DIR)
  .filter(f => f.endsWith('.md'))
  .map(f => path.join(COMMANDS_DIR, f));

let updatedCount = 0;
let mismatchFound = false;

commandFiles.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  const originalContent = content;

  // Preserve separator character on both sides (/ stays /, \ stays \)
  content = content.replace(versionPattern, (_, before, _ver, after) => `${before}${newVersion}${after}`);
```

- [ ] Apply the edit above to `scripts/update-command-versions.js`.

### Step 1.4: Run the test to confirm it passes

```
npx jest tests/update-command-versions-backslash.test.js --no-coverage
```

Expected: **PASS** — all 3 new tests green.

### Step 1.5: Confirm existing version tests still pass (regression check)

```
npx jest tests/update-command-versions.test.js --no-coverage
```

Expected: **PASS** — all 16 existing tests still green.

### Step 1.6: Run the script on the real commands directory to fix stale Windows paths

```
node scripts/update-command-versions.js
```

Expected output: lists updated `.md` files (analytics, config, gui, notify, reset, start, status, stop, test). All Windows `\1.4.13\` paths become `\1.16.2\`.

Verify:
```
node scripts/update-command-versions.js --check
```
Expected: `All command files match version 1.16.2`

### Step 1.7: Commit

```
git add scripts/update-command-versions.js tests/update-command-versions-backslash.test.js commands/
git commit -m "fix(version-script): update regex to handle Windows backslash path separators"
```

---

## Task 2: Fix PowerShell keystroke script — multi-terminal delivery

**Files:**
- Create: `tests/delivery/windows-delivery-multi-terminal.test.js`
- Modify: `src/delivery/windows-delivery.js` — `buildWindowsKeystrokeScript` function

### Step 2.1: Write the failing tests

Create `tests/delivery/windows-delivery-multi-terminal.test.js`:

```javascript
const { buildWindowsKeystrokeScript } = require('../../src/delivery/windows-delivery');

describe('buildWindowsKeystrokeScript — multi-terminal delivery', () => {
  let script;

  beforeEach(() => {
    script = buildWindowsKeystrokeScript('continue');
  });

  test('initializes $targetedPids hashtable before Strategy 1 loop', () => {
    expect(script).toMatch(/\$targetedPids\s*=\s*@\{\}/);
    // Must appear before the foreach loop over $claudeProcessNames
    const pidIdx = script.indexOf('$targetedPids = @{}');
    const loopIdx = script.indexOf('foreach ($name in $claudeProcessNames)');
    expect(pidIdx).toBeGreaterThan(-1);
    expect(loopIdx).toBeGreaterThan(-1);
    expect(pidIdx).toBeLessThan(loopIdx);
  });

  test('checks $targetedPids before activating a terminal (deduplication guard)', () => {
    // The guard must be inside the inner foreach loop
    expect(script).toMatch(/\$targetedPids\.ContainsKey/);
    // Guard must short-circuit before AppActivate
    const guardIdx = script.indexOf('$targetedPids.ContainsKey');
    const activateIdx = script.indexOf('AppActivate($ancestor.Id)');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(activateIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(activateIdx);
  });

  test('records activated terminal PID in $targetedPids after sending', () => {
    // After a successful AppActivate + Send-ResumeKeys, the PID is recorded
    expect(script).toMatch(/\$targetedPids\[\[int\]\$ancestor\.Id\]\s*=\s*\$true/);
  });

  test('does NOT break out of Strategy 1 loop after first terminal is sent to', () => {
    // Old pattern: if ($sent) { break } — must be gone from Strategy 1
    // Strategy 1 ends at # Strategy 2 comment; extract that section
    const strat1End = script.indexOf('# Strategy 2:');
    const strat1 = script.slice(0, strat1End);

    // No early break on $sent inside Strategy 1 — each break must be
    // replaced by a $targetedPids.ContainsKey guard and continue
    expect(strat1).not.toMatch(/if\s*\(\s*-not\s+\$sent\s*\)/);
    // The triple break pattern is gone
    const breakOnSentMatches = (strat1.match(/if\s*\(\$sent\)\s*\{\s*break\s*\}/g) || []);
    expect(breakOnSentMatches.length).toBe(0);
  });

  test('Strategy 2 still exists as fallback when Strategy 1 finds nothing', () => {
    expect(script).toContain('# Strategy 2:');
    expect(script).toMatch(/\$terminalNames\s*=\s*@\('WindowsTerminal'/);
  });

  test('Strategy 2 still breaks on first success (it is a fallback)', () => {
    const strat2Start = script.indexOf('# Strategy 2:');
    const strat3Start = script.indexOf('# Strategy 3:');
    const strat2 = script.slice(strat2Start, strat3Start);
    // Strategy 2 keeps its break for simplicity — it's the fallback path
    expect(strat2).toContain('if ($sent) { break }');
  });

  test('still sets $sent = $true when at least one terminal is activated', () => {
    expect(script).toContain('$sent = $true');
  });

  test('Strategy 4 last-resort block is still present', () => {
    expect(script).toContain('# Strategy 4:');
    expect(script).toMatch(/Sent resume keystrokes to foreground window \(last resort\)/);
  });

  test('includes wezterm-gui in the terminal name list for Strategy 2', () => {
    expect(script).toContain("'wezterm-gui'");
  });
});
```

- [ ] Save the file as written above.

### Step 2.2: Run the tests to confirm they fail

```
npx jest tests/delivery/windows-delivery-multi-terminal.test.js --no-coverage
```

Expected: **FAIL** — at minimum `initializes $targetedPids`, `checks $targetedPids`, `records activated terminal PID`, and `does NOT break` will fail.

### Step 2.3: Fix `buildWindowsKeystrokeScript` in `src/delivery/windows-delivery.js`

Find `buildWindowsKeystrokeScript` (around line 174). Replace the body of the returned template string's Strategy 1 section only. The `Get-ParentPid` helper, `Send-ResumeKeys` function, and Strategies 2–4 are unchanged except removing Strategy 1's early breaks.

The full replacement for `buildWindowsKeystrokeScript` return value (template string content):

```javascript
function buildWindowsKeystrokeScript(resumeText) {
  const escapedText = resumeText.replace(/'/g, "''");
  const keystrokeBlock = buildResumeKeystrokeBlock(escapedText);

  return `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -Name NativeWin -Namespace AutoResume -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);'
$shell = New-Object -ComObject WScript.Shell
$sent = $false
$myPid = $PID

function Send-ResumeKeys {
    param([string]$Source)
    Start-Sleep -Milliseconds 600
${keystrokeBlock}
    Write-Output "Sent resume keystrokes to: $Source"
}

function Get-ParentPid {
    param([int]$Pid)
    try {
        return (Get-CimInstance Win32_Process -Filter "ProcessId=$Pid" -ErrorAction SilentlyContinue).ParentProcessId
    } catch { return $null }
}

# Strategy 1: Walk process tree from node.exe / claude.exe to find ALL hosting terminals.
# Sends to every unique terminal ancestor — deduplicates by PID so each window
# receives exactly one keystroke burst even if multiple Claude processes share it.
$claudeProcessNames = @('node', 'claude')
$targetedPids = @{}
foreach ($name in $claudeProcessNames) {
    $procs = Get-Process -Name $name -ErrorAction SilentlyContinue
    foreach ($proc in $procs) {
        # Walk up two levels: node -> shell (pwsh/cmd) -> terminal (WindowsTerminal/wezterm-gui)
        $parentId = Get-ParentPid -Pid $proc.Id
        $grandParentId = if ($parentId) { Get-ParentPid -Pid $parentId } else { $null }

        foreach ($ancestorId in @($parentId, $grandParentId)) {
            if (-not $ancestorId) { continue }
            if ($targetedPids.ContainsKey([int]$ancestorId)) { continue }
            try {
                $ancestor = Get-Process -Id $ancestorId -ErrorAction SilentlyContinue
                if ($ancestor -and $ancestor.MainWindowHandle -ne 0 -and $ancestor.Id -ne $myPid) {
                    try { [AutoResume.NativeWin]::ShowWindow($ancestor.MainWindowHandle, 9) } catch {}
                    if ($shell.AppActivate($ancestor.Id)) {
                        Send-ResumeKeys "$($ancestor.Name) (PID $($ancestor.Id), ancestor of $name PID $($proc.Id))"
                        $targetedPids[[int]$ancestor.Id] = $true
                        $sent = $true
                    }
                }
            } catch {}
        }
    }
}

# Strategy 2: Find terminal window by process name, excluding this script's own process.
# Handles cases where Claude runs inside Windows Terminal or a standalone PowerShell window.
if (-not $sent) {
    $terminalNames = @('WindowsTerminal', 'wezterm-gui', 'pwsh', 'powershell', 'cmd')
    foreach ($name in $terminalNames) {
        try {
            $procs = Get-Process -Name $name -ErrorAction SilentlyContinue |
                     Where-Object { $_.Id -ne $myPid -and $_.MainWindowHandle -ne 0 }
            foreach ($proc in $procs) {
                try { [AutoResume.NativeWin]::ShowWindow($proc.MainWindowHandle, 9) } catch {}
                if ($shell.AppActivate($proc.Id)) {
                    Send-ResumeKeys "$name (PID $($proc.Id))"
                    $sent = $true
                    break
                }
            }
        } catch {}
        if ($sent) { break }
    }
}

# Strategy 3: Activate by window title keywords
if (-not $sent) {
    $titles = @('WezTerm', 'Claude', 'Windows PowerShell', 'PowerShell', 'Terminal', 'Command Prompt')
    foreach ($title in $titles) {
        try {
            if ($shell.AppActivate($title)) {
                Send-ResumeKeys "window title '$title'"
                $sent = $true
                break
            }
        } catch {}
    }
}

# Strategy 4: Last resort — send to current foreground window
if (-not $sent) {
${keystrokeBlock}
    Write-Output "Sent resume keystrokes to foreground window (last resort)"
}
`.trim();
}
```

- [ ] Replace the entire `buildWindowsKeystrokeScript` function body in `src/delivery/windows-delivery.js` with the code above.

### Step 2.4: Run the new tests to confirm they pass

```
npx jest tests/delivery/windows-delivery-multi-terminal.test.js --no-coverage
```

Expected: **PASS** — all 8 tests green.

### Step 2.5: Confirm existing wt-multi-tab tests still pass

```
npx jest tests/delivery/wt-multi-tab.test.js --no-coverage
```

Expected: **PASS** — all 14 tests still green.

### Step 2.6: Commit

```
git add src/delivery/windows-delivery.js tests/delivery/windows-delivery-multi-terminal.test.js
git commit -m "fix(windows-delivery): send resume to ALL terminal ancestors, not just first"
```

---

## Task 3: Consolidate `tryWeztermCli` double execFile call

**Files:**
- Create: `tests/delivery/wezterm-cli-single-call.test.js`
- Modify: `src/delivery/windows-delivery.js` — `tryWeztermCli` function

### Step 3.1: Write the failing tests

Create `tests/delivery/wezterm-cli-single-call.test.js`:

```javascript
const path = require('path');

// Read source to verify structural patterns (no live execFile in unit tests)
const fs = require('fs');
const src = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'delivery', 'windows-delivery.js'),
  'utf8'
);

describe('tryWeztermCli — single consolidated CLI call', () => {
  test('only calls wezterm cli list once (not twice)', () => {
    // Extract the tryWeztermCli function body
    const fnStart = src.indexOf('async function tryWeztermCli(');
    const fnEnd = src.indexOf('\nasync function ', fnStart + 1);
    const fnBody = fnEnd > fnStart ? src.slice(fnStart, fnEnd) : src.slice(fnStart);

    // Count occurrences of 'cli', 'list', '--format', 'json' in the function
    const listCalls = (fnBody.match(/'cli',\s*'list'/g) || []).length;
    expect(listCalls).toBe(1);
  });

  test('validates stdout is a JSON array (not exit-code only check)', () => {
    const fnStart = src.indexOf('async function tryWeztermCli(');
    const fnEnd = src.indexOf('\nasync function ', fnStart + 1);
    const fnBody = fnEnd > fnStart ? src.slice(fnStart, fnEnd) : src.slice(fnStart);

    // Must attempt JSON.parse on stdout
    expect(fnBody).toContain('JSON.parse');
    // Must check Array.isArray on the parsed result
    expect(fnBody).toContain('Array.isArray');
  });

  test('returns false (not partially proceeds) when stdout is not a JSON array', () => {
    const fnStart = src.indexOf('async function tryWeztermCli(');
    const fnEnd = src.indexOf('\nasync function ', fnStart + 1);
    const fnBody = fnEnd > fnStart ? src.slice(fnStart, fnEnd) : src.slice(fnStart);

    // When available is false, must log and return false
    expect(fnBody).toContain('available: false');
    expect(fnBody).toMatch(/if\s*\(!\s*available\)/);
  });

  test('uses the panes returned by the single call (not a separate listOut variable)', () => {
    const fnStart = src.indexOf('async function tryWeztermCli(');
    const fnEnd = src.indexOf('\nasync function ', fnStart + 1);
    const fnBody = fnEnd > fnStart ? src.slice(fnStart, fnEnd) : src.slice(fnStart);

    // Old pattern: separate `listOut` variable populated by a second execFile call
    // New pattern: `allPanes` (or similar) destructured from the single call result
    expect(fnBody).not.toMatch(/const listOut\s*=/);
    // Should destructure `available` from the promise result
    expect(fnBody).toMatch(/\{\s*available[^}]*\}/);
  });

  test('exports tryWeztermCli as a function', () => {
    const { tryWeztermCli } = require('../../src/delivery/windows-delivery');
    expect(typeof tryWeztermCli).toBe('function');
  });
});
```

- [ ] Save the file as written above.

### Step 3.2: Run the tests to confirm they fail

```
npx jest tests/delivery/wezterm-cli-single-call.test.js --no-coverage
```

Expected: **FAIL** — at minimum `only calls wezterm cli list once` and `uses the panes returned` will fail (currently two calls + `listOut` variable).

### Step 3.3: Fix `tryWeztermCli` in `src/delivery/windows-delivery.js`

Find `tryWeztermCli` (around line 34). Replace the section from after `log('debug', `Found WezTerm at: ${weztermExe}`);` through the closing of the pane-enumeration block with:

**Remove these two separate blocks:**
```javascript
// Verify wezterm CLI is accessible (daemon must be running)
const cliCheck = await new Promise((resolve) => {
    execFile(weztermExe, ['cli', 'list', '--format', 'json'], { timeout: 3000 }, (err) => {
        resolve(!err);
    });
});
if (!cliCheck) {
    log('debug', 'WezTerm CLI not accessible (GUI may not be running)');
    return false;
}

// ... key bytes setup ...

// Find ALL panes running Claude; fall back to active pane if none match.
let targets = [null];
try {
    const listOut = await new Promise((resolve) => {
        execFile(weztermExe, ['cli', 'list', '--format', 'json'], { timeout: 3000 }, (err, stdout) => {
            resolve(err ? null : stdout);
        });
    });

    if (listOut) {
        const panes = JSON.parse(listOut);
        const claudePanes = panes.filter(
            (p) => /claude/i.test(p.title || '')
                || /claude/i.test(p.cwd || '')
                || /[⠀-⣿]/.test(p.title || '')
        );
        if (claudePanes.length) {
            targets = claudePanes;
            log('debug', `Found ${claudePanes.length} Claude pane(s): ${
                claudePanes.map((p) => `pane ${p.pane_id}`).join(', ')
            }`);
        }
    }
} catch (_) { log('debug', `Failed to enumerate WezTerm panes, falling back to active pane: ${_ && _.message || _}`); }
```

**Replace with:**
```javascript
  // Single call: verify CLI accessibility AND enumerate panes.
  // Validates stdout is a JSON array — more reliable than exit-code alone
  // (some WezTerm versions exit 0 even when the socket is unreachable).
  const { available, allPanes } = await new Promise((resolve) => {
    execFile(weztermExe, ['cli', 'list', '--format', 'json'], { timeout: 3000 }, (err, stdout) => {
      if (err) { resolve({ available: false, allPanes: null }); return; }
      try {
        const parsed = JSON.parse(stdout || '');
        if (Array.isArray(parsed)) {
          resolve({ available: true, allPanes: parsed });
        } else {
          resolve({ available: false, allPanes: null });
        }
      } catch {
        resolve({ available: false, allPanes: null });
      }
    });
  });

  if (!available) {
    log('debug', 'WezTerm CLI not accessible (GUI may not be running or socket unavailable)');
    return false;
  }

  // Build keystroke sequence as raw bytes:
  // ESC ESC Ctrl+U <text> CR
  const keyBytes = Buffer.concat([
    Buffer.from([0x1B, 0x1B]),  // ESC ESC — dismiss any open dialog
    Buffer.from([0x15]),         // Ctrl+U — clear current line
    Buffer.from(resumeText, 'utf8'),
    Buffer.from([0x0D]),         // CR (Enter)
  ]);

  // Find ALL panes running Claude; fall back to active pane if none match.
  // Rate limits are account-level — every Claude session needs the resume signal.
  let targets = [null]; // null = active pane (no --pane-id flag)
  if (allPanes.length) {
    const claudePanes = allPanes.filter(
      (p) => /claude/i.test(p.title || '')
          || /claude/i.test(p.cwd || '')
          || /[⠀-⣿]/.test(p.title || '')  // Claude Code Braille spinner
    );
    if (claudePanes.length) {
      targets = claudePanes;
      log('debug', `Found ${claudePanes.length} Claude pane(s): ${
        claudePanes.map((p) => `pane ${p.pane_id}`).join(', ')
      }`);
    }
  }
```

Note: also remove the old `// Build keystroke sequence` block that was between the two `execFile` calls (it moves to after the `available` check above, as shown).

- [ ] Apply the edit to `src/delivery/windows-delivery.js` as described.

### Step 3.4: Run the new tests to confirm they pass

```
npx jest tests/delivery/wezterm-cli-single-call.test.js --no-coverage
```

Expected: **PASS** — all 5 tests green.

### Step 3.5: Run all delivery tests to confirm no regression

```
npx jest tests/delivery/ --no-coverage
```

Expected: **PASS** — all tests in the delivery folder green.

### Step 3.6: Commit

```
git add src/delivery/windows-delivery.js tests/delivery/wezterm-cli-single-call.test.js
git commit -m "fix(wezterm-cli): consolidate pane-list call; validate stdout JSON instead of exit-code"
```

---

## Task 4: Bump version and update README

### Step 4.1: Bump patch version

```
node scripts/bump-version.js
```

Expected output: `Bumping version: 1.16.2 -> 1.16.3 (patch)` and command files updated.

### Step 4.2: Verify version consistency

```
node scripts/update-command-versions.js --check
```

Expected: `All command files match version 1.16.3`

### Step 4.3: Update README.md

Open `README.md`. In the Windows installation / usage section, confirm that any version numbers shown in example commands now reflect `1.16.3`. Also add a line to the Windows troubleshooting section or changelog noting the three fixes:

In the relevant changelog/release section add:
```markdown
### v1.16.3
- Fixed: `update-command-versions.js` now updates Windows backslash-separated paths (previously only forward-slash paths were updated, leaving Windows command examples on stale version numbers)
- Fixed: Resume signal now delivered to ALL terminal windows hosting Claude processes (WezTerm + Windows Terminal simultaneously); previously only the first terminal found received keystrokes
- Fixed: WezTerm CLI accessibility check now validates stdout as a JSON array instead of relying on exit code alone, preventing false-positive "CLI accessible" results in some environments
```

- [ ] Make this README update.

### Step 4.4: Run full delivery + version test suite one final time

```
npx jest tests/delivery/ tests/update-command-versions.test.js tests/update-command-versions-backslash.test.js --no-coverage
```

Expected: **PASS** — all tests green.

### Step 4.5: Commit version bump and README

```
git add .claude-plugin/plugin.json .claude-plugin/marketplace.json commands/ README.md
git commit -m "chore(release): bump to v1.16.3"
```

---

## Task 5: Push to GitHub

### Step 5.1: Final pre-push check

```
git log --oneline -5
```

Confirm the last 4 commits are:
1. `fix(version-script): update regex to handle Windows backslash path separators`
2. `fix(windows-delivery): send resume to ALL terminal ancestors, not just first`
3. `fix(wezterm-cli): consolidate pane-list call; validate stdout JSON instead of exit-code`
4. `chore(release): bump to v1.16.3`

### Step 5.2: Push

```
git push origin main
```

Do NOT include `Co-Authored-By: Claude` in any commit message. Do NOT push `.claude/`, `CLAUDE.md`, `.serena/`, `.omc/`, `docs/superpowers/` (internal planning docs), or any credentials.

---

## Verification Checklist

After all tasks complete:

- [ ] `node scripts/update-command-versions.js --check` → `All command files match version 1.16.3`
- [ ] `grep -r "1\.4\.13" commands/` → no output (all stale refs gone)
- [ ] `npx jest tests/delivery/ tests/update-command-versions-backslash.test.js --no-coverage` → all PASS
- [ ] `node test-windows-delivery.js powershell` → shows delivery to BOTH Windows Terminal AND wezterm-gui PIDs (when both running)
- [ ] Git log shows 4 clean commits, none with "Claude" in author/co-author
