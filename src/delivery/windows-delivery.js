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

  return `
Add-Type -AssemblyName System.Windows.Forms
$shell = New-Object -ComObject WScript.Shell
$sent = $false
$myPid = $PID

function Send-ResumeKeys {
    param([string]$Source)
    Start-Sleep -Milliseconds 600
    [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
    Start-Sleep -Milliseconds 300
    [System.Windows.Forms.SendKeys]::SendWait('^u')
    Start-Sleep -Milliseconds 200
    [System.Windows.Forms.SendKeys]::SendWait('${escapedText}{ENTER}')
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
    [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
    Start-Sleep -Milliseconds 300
    [System.Windows.Forms.SendKeys]::SendWait('^u')
    Start-Sleep -Milliseconds 200
    [System.Windows.Forms.SendKeys]::SendWait('${escapedText}{ENTER}')
    Write-Output "Sent resume keystrokes to foreground window (last resort)"
}
`.trim();
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
 *   1. WezTerm CLI  — direct pane injection, no focus needed (best)
 *   2. PowerShell   — find + activate terminal window, then SendKeys
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

  // Strategy 2: PowerShell keystroke with window targeting
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

module.exports = { deliverResumeWindows, tryWeztermCli, tryPowerShellKeystroke, findWeztermExe };
