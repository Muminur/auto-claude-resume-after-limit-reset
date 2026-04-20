const { execFile, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

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
    } catch (_) {}
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
    } catch (_) {}
  }

  if (!weztermExe) {
    log('debug', 'WezTerm not found, skipping WezTerm CLI strategy');
    return false;
  }

  log('debug', `Found WezTerm at: ${weztermExe}`);

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

  // Build keystroke sequence as raw bytes:
  // ESC ESC Ctrl+U <text> CR
  const keyBytes = Buffer.concat([
    Buffer.from([0x1B, 0x1B]),  // ESC ESC — dismiss any open dialog
    Buffer.from([0x15]),         // Ctrl+U — clear current line
    Buffer.from(resumeText, 'utf8'),
    Buffer.from([0x0D]),         // CR (Enter)
  ]);

  // Try to find the pane running Claude first
  let paneId = null;
  try {
    const listOut = await new Promise((resolve) => {
      execFile(weztermExe, ['cli', 'list', '--format', 'json'], { timeout: 3000 }, (err, stdout) => {
        resolve(err ? null : stdout);
      });
    });

    if (listOut) {
      const panes = JSON.parse(listOut);
      // Look for a pane whose title or cwd suggests it's running Claude
      const claudePane = panes.find(
        (p) => /claude/i.test(p.title || '') || /claude/i.test(p.cwd || '')
      );
      if (claudePane) {
        paneId = claudePane.pane_id;
        log('debug', `Found Claude pane ID ${paneId}: ${claudePane.title}`);
      }
    }
  } catch (_) {}

  const args = ['cli', 'send-text', '--no-paste'];
  if (paneId !== null) args.push('--pane-id', String(paneId));
  args.push(keyBytes.toString('binary'));

  const sent = await new Promise((resolve) => {
    execFile(weztermExe, args, { timeout: 5000 }, (err) => {
      resolve(!err);
    });
  });

  if (sent) {
    log('success', `Delivered resume via WezTerm CLI${paneId !== null ? ` (pane ${paneId})` : ' (active pane)'}`);
  }
  return sent;
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
$claudeProcessNames = @('node', 'claude')
foreach ($name in $claudeProcessNames) {
    $procs = Get-Process -Name $name -ErrorAction SilentlyContinue
    foreach ($proc in $procs) {
        # Walk up two levels: node -> shell (pwsh/cmd) -> terminal (WindowsTerminal/wezterm-gui)
        $parentId = Get-ParentPid -Pid $proc.Id
        $grandParentId = if ($parentId) { Get-ParentPid -Pid $parentId } else { $null }

        foreach ($ancestorId in @($parentId, $grandParentId)) {
            if (-not $ancestorId) { continue }
            try {
                $ancestor = Get-Process -Id $ancestorId -ErrorAction SilentlyContinue
                if ($ancestor -and $ancestor.MainWindowHandle -ne 0 -and $ancestor.Id -ne $myPid) {
                    if ($shell.AppActivate($ancestor.Id)) {
                        Send-ResumeKeys "$($ancestor.Name) (PID $($ancestor.Id), ancestor of $name PID $($proc.Id))"
                        $sent = $true
                        break
                    }
                }
            } catch {}
        }
        if ($sent) { break }
    }
    if ($sent) { break }
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
  const candidates = [
    path.join(
      os.homedir(),
      'AppData', 'Local', 'Microsoft', 'WindowsApps', 'wt.exe'
    ),
    'C:\\Program Files\\WindowsApps\\Microsoft.WindowsTerminal_*\\wt.exe',
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch (_) {}
  }
  // Fall back to PATH lookup
  return new Promise((resolve) => {
    execFile('where', ['wt'], (err, stdout) => {
      if (err || !stdout) return resolve(null);
      const first = stdout.trim().split('\n')[0].trim();
      resolve(first && fs.existsSync(first) ? first : null);
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

# Activate the WT window so keystrokes land in it
$null = $shell.AppActivate($wt.Id)
Start-Sleep -Milliseconds 400

$delivered = 0
for ($i = 0; $i -lt $tabCount; $i++) {
    # focus-tab is 0-indexed and wraps silently if out of range
    & $wtExe -w 0 focus-tab --target $i 2>$null
    Start-Sleep -Milliseconds 700
    # Re-activate WT in case focus drifted
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
    exec(
      `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${tempScript}"`,
      { timeout: 60000 },
      (error, stdout, stderr) => {
        try { fs.unlinkSync(tempScript); } catch (_) {}

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
    exec(
      `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${tempScript}"`,
      { timeout: 15000 },
      (error, stdout, stderr) => {
        try { fs.unlinkSync(tempScript); } catch (_) {}

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
 * Deliver resume keystrokes to the Claude Code terminal on Windows.
 *
 * Tries in order:
 *   1. WezTerm CLI                — direct pane injection, no focus needed
 *   2. Windows Terminal multi-tab — wt.exe focus-tab + SendKeys per tab
 *   3. PowerShell SendKeys        — find + activate terminal window, send once
 *
 * @param {Object} opts
 * @param {string} [opts.resumeText='continue']
 * @param {Function} [opts.log]
 * @returns {Promise<{success: boolean, method: string|null, error: string|null}>}
 */
async function deliverResumeWindows(opts = {}) {
  const resumeText = opts.resumeText || 'continue';
  const log = opts.log || (() => {});

  // Strategy 1: WezTerm CLI
  try {
    const ok = await tryWeztermCli(resumeText, log);
    if (ok) return { success: true, method: 'wezterm-cli', error: null };
  } catch (err) {
    log('debug', `WezTerm CLI error: ${err.message}`);
  }

  // Strategy 2: Windows Terminal multi-tab via wt.exe focus-tab
  try {
    const ok = await tryWindowsTerminalMultiTab(resumeText, log);
    if (ok) return { success: true, method: 'wt-multi-tab', error: null };
  } catch (err) {
    log('debug', `WT multi-tab error: ${err.message}`);
  }

  // Strategy 3: PowerShell keystroke with window targeting (single tab)
  try {
    const ok = await tryPowerShellKeystroke(resumeText, log);
    if (ok) return { success: true, method: 'powershell-sendkeys', error: null };
  } catch (err) {
    log('debug', `PowerShell keystroke error: ${err.message}`);
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
  findWeztermExe,
  findWtExe,
  buildResumeKeystrokeBlock,
  buildMultiTabScript,
};
