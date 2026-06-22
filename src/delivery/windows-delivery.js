const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { deliverResumeViaConsole, discoverClaudeConsolePids } = require('./console-inject');

/**
 * Locate the wezterm executable on Windows.
 * @returns {string|null} path to wezterm.exe or null
 */
function findWeztermExe() {
  const candidates = [
    path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Links', 'wezterm.exe'),
    'C:\\Program Files\\WezTerm\\wezterm.exe',
    'C:\\Program Files (x86)\\WezTerm\\wezterm.exe',
    path.join(os.homedir(), 'AppData', 'Local', 'WezTerm', 'wezterm.exe'),
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch (_) { /* fs.existsSync threw — candidate inaccessible, continue */ }
  }
  return null;
}

/**
 * Try sending resume keystrokes via WezTerm CLI.
 * wezterm cli send-text injects bytes directly into the active pane's input —
 * no window focus required. This is the most reliable method for WezTerm users.
 *
 * @param {string} resumeText - text to type (e.g. "continue")
 * @param {Function} log - log(level, msg)
 * @returns {Promise<boolean>} true if sent successfully
 */
async function tryWeztermCli(resumeText, log) {
  let weztermExe = findWeztermExe();

  if (!weztermExe) {
    // Try PATH
    try {
      const which = await new Promise((resolve) => {
        execFile('where', ['wezterm'], (err, stdout) => {
          resolve(err ? null : stdout.trim().split('\n')[0].trim());
        });
      });
      if (which && fs.existsSync(which)) weztermExe = which;
    } catch (_) { log('debug', 'Failed to locate wezterm via PATH lookup'); }
  }

  if (!weztermExe) {
    log('debug', 'WezTerm not found, skipping WezTerm CLI strategy');
    return false;
  }

  log('debug', `Found WezTerm at: ${weztermExe}`);

  // Single call: verify CLI accessibility AND enumerate panes.
  // Validate by parsing stdout as JSON array — exit-code alone is unreliable
  // in MSYS2/Git Bash where wezterm cli list exits 0 even on socket failure.
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
  try {
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
  } catch (_) { log('debug', `Failed to enumerate WezTerm panes, falling back to active pane: ${_ && _.message || _}`); }

  let anySuccess = false;
  for (const target of targets) {
    const args = ['cli', 'send-text', '--no-paste'];
    if (target && target.pane_id != null) args.push('--pane-id', String(target.pane_id));

    // Pipe bytes via stdin — more reliable than a binary CLI arg on Windows
    // (Windows command-line parsing can strip \r (0x0D) when passed as a string arg)
    const ok = await new Promise((resolve) => {
      const child = execFile(weztermExe, args, { timeout: 5000 }, (err) => resolve(!err));
      child.stdin.write(keyBytes);
      child.stdin.end();
    });

    const label = target
      ? `pane ${target.pane_id} ("${truncate(target.title, 60)}")`
      : 'active pane';
    if (ok) {
      anySuccess = true;
      log('success', `Delivered resume via WezTerm CLI to ${label}`);
    } else {
      log('debug', `WezTerm CLI send-text failed for ${label}`);
    }
  }
  return anySuccess;
}

function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/**
 * Build the canonical resume keystroke block as PowerShell SendKeys lines.
 * Mirrors tmux-delivery's buildResumeSequence:
 *   ESC, ESC, <menuSelection>, ESC, ESC, C-u, <text>, Enter
 *
 * The leading menu selection handles the case where the rate-limit options
 * dialog (`/rate-limit-options`) is showing — pressing "1" selects the
 * highlighted "Stop and wait" option. Subsequent ESC + C-u + text covers
 * the case where no dialog is open and we need to type the prompt.
 *
 * @param {string} escapedText - resume text already PS-escaped
 * @param {string} menuSelection - menu key (default '1')
 * @returns {string} PowerShell statements
 */
function buildResumeKeystrokeBlock(escapedText, menuSelection = '1') {
  const escMenu = String(menuSelection).replace(/'/g, "''");
  return `    [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
    Start-Sleep -Milliseconds 500
    [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
    Start-Sleep -Milliseconds 300
    [System.Windows.Forms.SendKeys]::SendWait('${escMenu}{ENTER}')
    Start-Sleep -Milliseconds 1000
    [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
    Start-Sleep -Milliseconds 500
    [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
    Start-Sleep -Milliseconds 300
    [System.Windows.Forms.SendKeys]::SendWait('^u')
    Start-Sleep -Milliseconds 200
    [System.Windows.Forms.SendKeys]::SendWait('${escapedText}{ENTER}')`;
}

/**
 * Build a PowerShell script that:
 * 1. Finds the terminal window hosting Claude Code (by process name / window title)
 * 2. Activates it via AppActivate(PID)
 * 3. Sends the resume keystroke sequence
 *
 * @param {string} resumeText
 * @returns {string} PowerShell script content
 */
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

# Strategy 1: Walk process tree from node.exe / claude.exe to find the hosting terminal.
# This is the most accurate method — targets the exact terminal running Claude Code.
$targetedPids = @{}
$claudeProcessNames = @('node', 'claude')
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
                $knownTerminals = @('WindowsTerminal', 'WindowsTerminalPreview', 'wezterm-gui', 'pwsh', 'powershell', 'cmd', 'bash', 'mintty', 'alacritty')
                if ($ancestor -and $ancestor.MainWindowHandle -ne 0 -and $ancestor.Id -ne $myPid -and $knownTerminals -contains $ancestor.Name) {
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

/**
 * Locate wt.exe (Windows Terminal CLI).
 *
 * @returns {Promise<string|null>}
 */
async function findWtExe() {
  // Check well-known install paths. Note: the AppData\Local\Microsoft\WindowsApps
  // path is a Windows App Execution Alias — a virtual shortcut that fs.existsSync
  // returns false for even when wt.exe is installed. So we skip existsSync there
  // and just run wt.exe directly; errors at launch time mean it wasn't installed.
  const knownPaths = [
    path.join(
      os.homedir(),
      'AppData', 'Local', 'Microsoft', 'WindowsApps', 'wt.exe'
    ),
  ];
  for (const c of knownPaths) {
    // Test by asking wt.exe to print its version; 0-exit = present
    const ok = await new Promise((resolve) => {
      execFile(c, ['--version'], { timeout: 3000 }, (err) => resolve(!err));
    });
    if (ok) return c;
  }
  // Fall back to PATH lookup — trust `where` output directly; don't existsSync
  // since App Execution Aliases won't pass that check
  return new Promise((resolve) => {
    execFile('where', ['wt'], { timeout: 3000 }, (err, stdout) => {
      if (err || !stdout) return resolve(null);
      const first = stdout.trim().split('\n')[0].trim();
      if (!first) return resolve(null);
      // Quick smoke-test that the binary actually responds
      execFile(first, ['--version'], { timeout: 3000 }, (e) => resolve(e ? null : first));
    });
  });
}

/**
 * Build the PowerShell script that iterates every tab in a Windows Terminal
 * window and sends the canonical resume keystroke sequence to each.
 *
 * Approach:
 *   1. Find the WindowsTerminal.exe process and AppActivate it.
 *   2. Estimate tab count from the count of distinct grandchild claude.exe
 *      processes (each Claude session lives in its own tab); cap at maxTabs.
 *   3. For each tab index 0..N-1:
 *        wt.exe -w 0 focus-tab --target <i>
 *        send canonical keystroke sequence (ESC,ESC,1,ESC,ESC,C-u,text,Enter)
 *
 * Why focus-tab over Ctrl+Tab keystrokes: Ctrl+Tab is intercepted by
 * Claude Code's TUI as in-pane navigation, so SendKeys-driven tab switching
 * lands all keystrokes on the originally-focused tab. wt.exe focus-tab is a
 * real Windows Terminal CLI command and switches tabs reliably.
 *
 * @param {string} resumeText
 * @param {string} wtExePath
 * @param {number} maxTabs
 * @returns {string}
 */
function buildMultiTabScript(resumeText, wtExePath, maxTabs = 20) {
  const escapedText = resumeText.replace(/'/g, "''");
  const keystrokeBlock = buildResumeKeystrokeBlock(escapedText);
  const escapedWt = wtExePath.replace(/'/g, "''");

  return `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -Name NativeWin -Namespace AutoResume -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);'
$shell = New-Object -ComObject WScript.Shell
$wtExe = '${escapedWt}'
$myPid = $PID

# Find Windows Terminal process (skip our own PowerShell host's tree)
$wtProcs = Get-Process -Name 'WindowsTerminal' -ErrorAction SilentlyContinue |
           Where-Object { $_.MainWindowHandle -ne 0 }
if (-not $wtProcs) {
    Write-Error "No WindowsTerminal.exe process with a window found"
    exit 2
}
$wt = $wtProcs | Select-Object -First 1

# Count claude.exe processes whose ancestry leads to this WT — each tab
# typically hosts one Claude session, so this gives a reasonable upper
# bound. Falls back to counting child shells.
function Get-AncestorWindowTerminalPid {
    param([int]$ProcessId)
    $current = $ProcessId
    for ($depth = 0; $depth -lt 6; $depth++) {
        try {
            $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$current" -ErrorAction SilentlyContinue
            if (-not $proc) { return $null }
            $parentId = $proc.ParentProcessId
            if (-not $parentId) { return $null }
            $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$parentId" -ErrorAction SilentlyContinue
            if (-not $parent) { return $null }
            if ($parent.Name -eq 'WindowsTerminal.exe') { return [int]$parent.ProcessId }
            $current = $parentId
        } catch { return $null }
    }
    return $null
}

$claudeProcs = Get-Process -Name 'claude' -ErrorAction SilentlyContinue
$tabCount = 0
if ($claudeProcs) {
    $tabCount = ($claudeProcs |
        Where-Object { (Get-AncestorWindowTerminalPid -ProcessId $_.Id) -eq $wt.Id } |
        Measure-Object).Count
}
if ($tabCount -lt 1) {
    # Fall back: count direct shell children of this WT
    $shellNames = @('powershell.exe', 'pwsh.exe', 'cmd.exe', 'bash.exe', 'wsl.exe')
    $tabCount = (Get-CimInstance Win32_Process -Filter "ParentProcessId=$($wt.Id)" -ErrorAction SilentlyContinue |
        Where-Object { $shellNames -contains $_.Name } |
        Measure-Object).Count
}
if ($tabCount -lt 1) { $tabCount = 1 }
if ($tabCount -gt ${maxTabs}) { $tabCount = ${maxTabs} }

Write-Output "Targeting $tabCount tab(s) in WindowsTerminal PID $($wt.Id)"

# Activate the WT window so keystrokes land in it (restore first if minimized)
try { [AutoResume.NativeWin]::ShowWindow($wt.MainWindowHandle, 9) } catch {}
$null = $shell.AppActivate($wt.Id)
Start-Sleep -Milliseconds 400

$delivered = 0
for ($i = 0; $i -lt $tabCount; $i++) {
    # focus-tab is 0-indexed and wraps silently if out of range
    & $wtExe -w 0 focus-tab --target $i 2>$null
    Start-Sleep -Milliseconds 700
    # Re-activate WT in case focus drifted
    try { [AutoResume.NativeWin]::ShowWindow($wt.MainWindowHandle, 9) } catch {}
    $null = $shell.AppActivate($wt.Id)
    Start-Sleep -Milliseconds 200
${keystrokeBlock}
    $delivered++
    Start-Sleep -Milliseconds 400
}

Write-Output "Delivered resume to $delivered tab(s) of WindowsTerminal PID $($wt.Id)"
`.trim();
}

/**
 * Try multi-tab Windows Terminal delivery.
 *
 * Detects WindowsTerminal.exe and uses `wt.exe focus-tab` to iterate every
 * tab, sending the canonical resume sequence to each one. This addresses
 * the multi-tab gap in tryPowerShellKeystroke, which only activates the WT
 * window and assumes a single tab.
 *
 * Skips silently when wt.exe isn't on PATH or no WindowsTerminal process
 * is detected — caller falls through to tryPowerShellKeystroke.
 *
 * Note on -w 0 semantics: from a detached daemon, `-w 0` resolves to the
 * most-recently-used WT window. Multi-window users will only have one WT
 * window targeted per call. Single-window users (the common case) get
 * full coverage.
 *
 * @param {string} resumeText
 * @param {Function} log
 * @returns {Promise<boolean>}
 */
async function tryWindowsTerminalMultiTab(resumeText, log) {
  const wtExe = await findWtExe();
  if (!wtExe) {
    log('debug', 'wt.exe not found, skipping Windows Terminal multi-tab strategy');
    return false;
  }
  log('debug', `Found wt.exe at: ${wtExe}`);

  const tempScript = path.join(
    os.tmpdir(),
    `claude-auto-resume-wt-multitab-${process.pid}.ps1`
  );

  try {
    fs.writeFileSync(tempScript, buildMultiTabScript(resumeText, wtExe), 'utf8');
  } catch (err) {
    log('error', `Failed to write multi-tab script: ${err.message}`);
    return false;
  }

  return new Promise((resolve) => {
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', tempScript],
      { timeout: 60000 },
      (error, stdout, stderr) => {
        try { fs.unlinkSync(tempScript); } catch (_) { log('debug', `Failed to remove temp script ${tempScript}: ${_ && _.message || _}`); }

        if (error) {
          // exit 2 = no WindowsTerminal process found — fall through quietly
          if (error.code === 2 || /No WindowsTerminal\.exe/i.test(stderr || '')) {
            log('debug', 'WindowsTerminal not running, skipping multi-tab strategy');
            return resolve(false);
          }
          log('warning', `WT multi-tab delivery failed: ${error.message}`);
          if (stderr) log('debug', `stderr: ${stderr.trim()}`);
          return resolve(false);
        }
        log('success', stdout.trim() || 'WT multi-tab delivery completed');
        resolve(true);
      }
    );
  });
}

/**
 * Default heuristic that marks a terminal window title as a Claude Code session.
 * Claude Code prefixes its terminal title with an animated status glyph + space:
 *   - Braille glyphs (U+2800–U+28FF) while working ("⠐ codebase-audit…")
 *   - Dingbat star glyphs (U+2700–U+27BF, e.g. ✳ U+2733) when idle / paused at
 *     the rate limit ("✳ Schedule something") — the exact state the daemon runs in
 *   - Math asterisk (U+2217) / middle dot (U+00B7) used by some spinner frames
 * plus the literal word "claude" for the default "⠐ Claude Code" title.
 *
 * A single WindowsTerminal.exe process owns one window per Claude session, all
 * sharing the same PID, so the window TITLE is the only per-window discriminator.
 * Plain shell windows ("Windows PowerShell", "C:\\WINDOWS\\system32\\cmd.exe",
 * "Grafana") start with ASCII and are excluded. Callers may override via
 * opts.titlePattern if Claude's title format changes.
 */
const DEFAULT_CLAUDE_TITLE_REGEX =
  '(?i)(^[\\u2800-\\u28FF\\u2700-\\u27BF\\u2217\\u00B7]|claude)';

/**
 * Terminal process names eligible for keystroke delivery. The process allowlist
 * is essential: "claude" appears in unrelated window titles too (a File Explorer
 * folder named AutoClaudeResume, a browser tab on claude.ai), and we must never
 * fire keystrokes into those. wezterm-gui is intentionally excluded — the WezTerm
 * CLI strategy handles WezTerm panes, so including it would double-deliver.
 */
const TERMINAL_PROCESS_NAMES = [
  'WindowsTerminal', 'WindowsTerminalPreview',
  'pwsh', 'powershell', 'cmd', 'conhost', 'mintty', 'alacritty',
];

/**
 * Build a PowerShell script that enumerates EVERY top-level window via the UI
 * Automation API, keeps the ones whose owning process is a terminal AND whose
 * title identifies a Claude Code session, and (unless dry-run) focuses each by
 * its window handle and sends the canonical resume sequence.
 *
 * Why UI Automation instead of Win32 EnumWindows + SetForegroundWindow:
 *   1. Multiple Claude sessions commonly live in separate Windows Terminal
 *      windows all owned by ONE WindowsTerminal.exe process. Get-Process exposes
 *      a single MainWindowHandle per PID and `wt -w 0 focus-tab` only addresses
 *      the most-recently-used window, so process-based strategies physically
 *      reach only one of N windows. UI Automation enumerates every window and
 *      dedup is keyed by NativeWindowHandle, not PID.
 *   2. A Win32 EnumWindows + SetForegroundWindow + AttachThreadInput + SendKeys
 *      script is flagged by Windows Defender AMSI as an injector ("malicious
 *      content … blocked by your antivirus software") and never runs. The
 *      managed UI Automation client (AutomationElement.SetFocus) is the
 *      accessibility-sanctioned focus path and passes AMSI cleanly.
 *
 * Foreground-lock safety: SendKeys lands in whatever window currently holds
 * keyboard focus. After SetFocus we VERIFY that FocusedElement's top-level
 * ancestor is our target window before sending; mismatches are skipped and
 * logged rather than firing keys blindly.
 *
 * Machine-readable output (one per line) parsed by the JS wrapper:
 *   RESUME-TARGET:<hwnd>\t<pid>\t<proc>\t<title>     (dry-run: candidate only)
 *   RESUME-DELIVERED:<hwnd>\t<title>                 (keys sent)
 *   RESUME-SKIPPED:<hwnd>\t<reason>\t<title>         (could not focus)
 *   RESUME-SUMMARY:delivered=<n> skipped=<n> total=<n>
 *
 * @param {string} resumeText
 * @param {Object} [opts]
 * @param {boolean} [opts.dryRun=false] - enumerate + log targets, send nothing
 * @param {string} [opts.titlePattern] - .NET regex overriding the Claude title heuristic
 * @returns {string} PowerShell script content
 */
function buildWindowEnumScript(resumeText, opts = {}) {
  const dryRun = !!opts.dryRun;
  const escapedText = resumeText.replace(/'/g, "''");
  const keystrokeBlock = buildResumeKeystrokeBlock(escapedText);
  const titleRegex = (opts.titlePattern || DEFAULT_CLAUDE_TITLE_REGEX).replace(/'/g, "''");
  const termList = TERMINAL_PROCESS_NAMES.map((n) => `'${n}'`).join(', ');

  return `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$claudeRegex = '${titleRegex}'
$termProcs = @(${termList})
$myPid = $PID
$dryRun = $${dryRun ? 'true' : 'false'}

$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window)
$wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)

$procName = @{}
function Get-PName {
    param([int]$Id)
    if ($procName.ContainsKey($Id)) { return $procName[$Id] }
    $n = (Get-Process -Id $Id -ErrorAction SilentlyContinue).Name
    if (-not $n) { $n = '' }
    $procName[$Id] = $n
    return $n
}

$targets = @()
$seen = @{}
foreach ($w in $wins) {
    try {
        $title = $w.Current.Name
        if ([string]::IsNullOrWhiteSpace($title)) { continue }
        $wpid = [int]$w.Current.ProcessId
        if ($wpid -eq $myPid) { continue }
        $h = [long]$w.Current.NativeWindowHandle
        if ($h -eq 0 -or $seen.ContainsKey($h)) { continue }
        $pname = Get-PName -Id $wpid
        if ($termProcs -notcontains $pname) { continue }
        if ($title -notmatch $claudeRegex) { continue }
        $seen[$h] = $true
        $targets += [PSCustomObject]@{ El = $w; Hwnd = $h; Pid = $wpid; Name = $pname; Title = $title }
    } catch {}
}

if ($targets.Count -eq 0) {
    Write-Output "RESUME-SUMMARY:delivered=0 skipped=0 total=0"
    exit 0
}

# Focus a window via the accessibility API, then confirm it actually holds focus
# before any keystroke is sent (foreground-lock guard).
function Focus-Verified {
    param($El, [long]$Hwnd)
    try { $El.SetFocus() } catch { return $false }
    Start-Sleep -Milliseconds 350
    try {
        $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
        $top = [System.Windows.Automation.AutomationElement]::FocusedElement
        while ($top -ne $null) {
            $parent = $walker.GetParent($top)
            if ($parent -eq $null -or $parent -eq $root) { break }
            $top = $parent
        }
        $fh = if ($top -ne $null) { [long]$top.Current.NativeWindowHandle } else { 0 }
        return ($fh -eq $Hwnd)
    } catch { return $false }
}

$delivered = 0
$skipped = 0
foreach ($t in $targets) {
    if ($dryRun) {
        Write-Output "RESUME-TARGET:$($t.Hwnd)\`t$($t.Pid)\`t$($t.Name)\`t$($t.Title)"
        continue
    }
    $ok = Focus-Verified -El $t.El -Hwnd $t.Hwnd
    if (-not $ok) {
        Start-Sleep -Milliseconds 200
        $ok = Focus-Verified -El $t.El -Hwnd $t.Hwnd
    }
    if (-not $ok) {
        $skipped++
        Write-Output "RESUME-SKIPPED:$($t.Hwnd)\`tfocus-denied\`t$($t.Title)"
        continue
    }
    Start-Sleep -Milliseconds 200
${keystrokeBlock}
    $delivered++
    Write-Output "RESUME-DELIVERED:$($t.Hwnd)\`t$($t.Title)"
    Start-Sleep -Milliseconds 300
}

Write-Output "RESUME-SUMMARY:delivered=$delivered skipped=$skipped total=$($targets.Count)"
`.trim();
}

/**
 * Try HWND-enumeration delivery: target every Claude Code window by its window
 * handle. Resolves the multi-window gap that process-based strategies cannot —
 * multiple Windows Terminal windows owned by a single WindowsTerminal.exe, plus
 * standalone PowerShell/cmd windows — in one pass.
 *
 * @param {string} resumeText
 * @param {Function} log
 * @param {Object} [opts]
 * @param {boolean} [opts.dryRun=false]
 * @param {string} [opts.titlePattern]
 * @returns {Promise<{delivered:number, skipped:number, total:number, targets:Array}>}
 */
async function tryWindowEnumeration(resumeText, log, opts = {}) {
  const dryRun = !!opts.dryRun;
  const tempScript = path.join(
    os.tmpdir(),
    `claude-auto-resume-winenum-${process.pid}.ps1`
  );

  try {
    fs.writeFileSync(tempScript, buildWindowEnumScript(resumeText, opts), 'utf8');
  } catch (err) {
    log('error', `Failed to write window-enum script: ${err.message}`);
    return { delivered: 0, skipped: 0, total: 0, targets: [] };
  }

  return new Promise((resolve) => {
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', tempScript],
      { timeout: 90000 },
      (error, stdout, stderr) => {
        try { fs.unlinkSync(tempScript); } catch (_) { log('debug', `Failed to remove temp script ${tempScript}: ${_ && _.message || _}`); }

        const out = stdout || '';
        const targets = [];
        let delivered = 0;
        let skipped = 0;
        let total = 0;

        for (const line of out.split(/\r?\n/)) {
          const t = line.trim();
          if (t.startsWith('RESUME-TARGET:')) {
            const [hwnd, pid, proc, ...titleParts] = t.slice('RESUME-TARGET:'.length).split('\t');
            targets.push({ hwnd, pid, proc, title: titleParts.join('\t') });
            log('info', `[dry-run] Claude window: "${truncate(titleParts.join('\t'), 60)}" (hwnd ${hwnd}, ${proc} PID ${pid})`);
          } else if (t.startsWith('RESUME-DELIVERED:')) {
            const [hwnd, ...titleParts] = t.slice('RESUME-DELIVERED:'.length).split('\t');
            log('success', `Delivered resume to window "${truncate(titleParts.join('\t'), 60)}" (hwnd ${hwnd})`);
          } else if (t.startsWith('RESUME-SKIPPED:')) {
            const [hwnd, reason, ...titleParts] = t.slice('RESUME-SKIPPED:'.length).split('\t');
            log('warning', `Skipped window "${truncate(titleParts.join('\t'), 60)}" (hwnd ${hwnd}): ${reason}`);
          } else if (t.startsWith('RESUME-SUMMARY:')) {
            const m = /delivered=(\d+) skipped=(\d+) total=(\d+)/.exec(t);
            if (m) { delivered = +m[1]; skipped = +m[2]; total = +m[3]; }
          }
        }

        if (error && !/RESUME-SUMMARY:/.test(out)) {
          log('warning', `Window-enum delivery failed: ${error.message}`);
          if (stderr) log('debug', `stderr: ${stderr.trim()}`);
          return resolve({ delivered: 0, skipped: 0, total: targets.length, targets });
        }

        if (dryRun) {
          log('info', `[dry-run] ${targets.length} Claude window(s) would be targeted`);
        } else if (total === 0) {
          log('debug', 'No Claude windows found via HWND enumeration');
        } else {
          log('info', `HWND enumeration: delivered=${delivered} skipped=${skipped} total=${total}`);
          if (skipped > 0) {
            log('warning', `${skipped} window(s) could not be focused (foreground lock). Note: HWND enumeration reaches each window's focused tab only — multiple Claude tabs within one window are not individually addressed.`);
          }
        }

        resolve({ delivered, skipped, total, targets });
      }
    );
  });
}

/**
 * Send resume keystrokes on Windows using a targeted PowerShell script.
 * Falls back through three strategies: process-PID, window-title, foreground.
 *
 * @param {string} resumeText
 * @param {Function} log
 * @returns {Promise<boolean>}
 */
async function tryPowerShellKeystroke(resumeText, log) {
  const tempScript = path.join(os.tmpdir(), `claude-auto-resume-win-${process.pid}.ps1`);

  try {
    fs.writeFileSync(tempScript, buildWindowsKeystrokeScript(resumeText), 'utf8');
  } catch (err) {
    log('error', `Failed to write temp script: ${err.message}`);
    return false;
  }

  return new Promise((resolve) => {
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', tempScript],
      { timeout: 15000 },
      (error, stdout, stderr) => {
        try { fs.unlinkSync(tempScript); } catch (_) { log('debug', `Failed to remove temp script ${tempScript}: ${_ && _.message || _}`); }

        if (error) {
          log('warning', `PowerShell keystroke delivery failed: ${error.message}`);
          if (stderr) log('debug', `stderr: ${stderr.trim()}`);
          resolve(false);
        } else {
          log('success', stdout.trim() || 'PowerShell keystroke delivery completed');
          resolve(true);
        }
      }
    );
  });
}

/**
 * Deliver the resume sequence to every Claude Code session on Windows.
 *
 * PRIMARY: console-input injection (AttachConsole + WriteConsoleInput) into each
 * Claude session's console buffer. This is the only path that works from the
 * detached daemon — it needs no window focus (a background process cannot steal
 * foreground, locked OR unlocked), it is lock-independent by construction (the
 * console API never touches the secure desktop), it reaches every Windows
 * Terminal ConPTY session, and it is AMSI-clean. See `console-inject.js`.
 *
 * FALLBACK (only when injection delivered to ZERO sessions — e.g. no Claude PID
 * found, or a terminal not backed by a Windows console): WezTerm CLI, then HWND
 * window enumeration, then the legacy process-walk SendKeys. These run only as a
 * fallback because WezTerm/WT are also ConPTY-backed, so running them alongside
 * console injection would deliver `continue` twice into the same session.
 *
 * @param {Object} opts
 * @param {string} [opts.resumeText='continue']
 * @param {string} [opts.menuSelection='1']
 * @param {Function} [opts.log]
 * @param {string[]} [opts.skipTiers=[]] - Tier names to skip (e.g. on retry escalation)
 * @param {boolean} [opts.dryRun=false] - discover + log target sessions, send nothing
 * @param {string} [opts.titlePattern] - override the Claude window-title heuristic (fallback path)
 * @returns {Promise<{success: boolean, method: string|null, error: string|null, targets?: Array}>}
 */
async function deliverResumeWindows(opts = {}) {
  const resumeText = opts.resumeText || 'continue';
  const menuSelection = opts.menuSelection || '1';
  const log = opts.log || (() => {});
  const skipTiers = opts.skipTiers || [];
  const dryRun = !!opts.dryRun;
  const titlePattern = opts.titlePattern;

  // Dry-run: report the Claude sessions that WOULD receive injection (plus the
  // windows the GUI fallback would target). Never sends anything — the safe way
  // to validate targeting without disturbing live sessions.
  if (dryRun) {
    const consoleTargets = await discoverClaudeConsolePids(log);
    const win = await tryWindowEnumeration(resumeText, log, { dryRun: true, titlePattern });
    consoleTargets.forEach((t) =>
      log('info', `[dry-run] Claude session: PID ${t.pid} (${t.name})`));
    const total = consoleTargets.length + win.targets.length;
    return {
      success: total > 0,
      method: 'dryrun',
      error: total > 0 ? null : 'No Claude sessions found',
      targets: consoleTargets.map((t) => ({ pid: t.pid, name: t.name, kind: 'console' }))
        .concat(win.targets.map((t) => ({ ...t, kind: 'window' }))),
    };
  }

  const methods = [];

  // PRIMARY: console-input injection into every Claude session.
  if (!skipTiers.includes('console-inject')) {
    try {
      const res = await deliverResumeViaConsole({ resumeText, menuSelection, log });
      if (res.delivered > 0) {
        return {
          success: true,
          method: `console-inject(${res.delivered}/${res.total})`,
          error: null,
        };
      }
      log('debug', 'Console injection delivered to 0 sessions; trying GUI fallback');
    } catch (err) {
      log('debug', `Console injection error: ${err.message}`);
    }
  } else {
    log('debug', 'Skipping console injection (tier escalation)');
  }

  // FALLBACK 1: WezTerm CLI (only reached if console injection delivered nothing).
  if (!skipTiers.includes('wezterm-cli')) {
    try {
      const ok = await tryWeztermCli(resumeText, log);
      if (ok) methods.push('wezterm-cli');
    } catch (err) {
      log('debug', `WezTerm CLI error: ${err.message}`);
    }
  }

  // FALLBACK 2: HWND window enumeration (focus-based; works only when the caller
  // already holds foreground — generally not the daemon, hence fallback-only).
  let reachedAnyWindow = false;
  if (!skipTiers.includes('window-enum')) {
    try {
      const res = await tryWindowEnumeration(resumeText, log, { titlePattern });
      if (res.total > 0) reachedAnyWindow = true;
      if (res.delivered > 0) methods.push('window-enum');
    } catch (err) {
      log('debug', `Window-enum error: ${err.message}`);
    }
  }

  // FALLBACK 3: legacy process-walk SendKeys — only when nothing else reached a window.
  if (!methods.length && !reachedAnyWindow) {
    try {
      const ok = await tryPowerShellKeystroke(resumeText, log);
      if (ok) methods.push('powershell-sendkeys');
    } catch (err) {
      log('debug', `PowerShell keystroke error: ${err.message}`);
    }
  }

  if (methods.length) {
    return { success: true, method: methods.join('+'), error: null };
  }

  return {
    success: false,
    method: null,
    error: 'All Windows delivery strategies failed',
  };
}

module.exports = {
  deliverResumeWindows,
  tryWeztermCli,
  tryPowerShellKeystroke,
  tryWindowsTerminalMultiTab,
  tryWindowEnumeration,
  findWeztermExe,
  findWtExe,
  buildResumeKeystrokeBlock,
  buildMultiTabScript,
  buildWindowsKeystrokeScript,
  buildWindowEnumScript,
  DEFAULT_CLAUDE_TITLE_REGEX,
  TERMINAL_PROCESS_NAMES,
};
