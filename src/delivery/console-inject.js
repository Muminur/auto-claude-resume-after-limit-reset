const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Windows console-input resume delivery.
 *
 * Delivers the resume keystroke sequence straight into each Claude session's
 * console input buffer via the Win32 console API (AttachConsole + CONIN$ +
 * WriteConsoleInput) instead of GUI focus + SendKeys. This is the only delivery
 * path that actually works from the detached daemon, because:
 *
 *   - No window focus / foreground is needed. A background process cannot steal
 *     foreground (Windows foreground-lock), so SendKeys-based delivery is denied
 *     whether the workstation is locked OR unlocked. Console input bypasses the
 *     GUI entirely.
 *   - It is lock-independent BY CONSTRUCTION: the console API never touches the
 *     secure desktop, so injection works while the workstation is locked.
 *   - It reaches Windows Terminal ConPTY sessions: each tab/window has its own
 *     pseudoconsole, so looping over Claude PIDs naturally covers every session.
 *   - It is AMSI-clean (unlike SetForegroundWindow + AttachThreadInput + SendKeys,
 *     which Windows Defender blocks as an injector).
 *
 * The Claude Code TUI reads raw-mode stdin (libuv → ReadConsoleInput), so the
 * injected key events are received exactly as if typed.
 */

/**
 * Discover the PIDs of running Claude Code sessions whose console should receive
 * the resume sequence. Targets `claude.exe` (native install) and `node`-hosted
 * Claude CLIs, while excluding this daemon and unrelated Node processes.
 *
 * Each result is a process that shares its session's console; injecting into one
 * PID per session delivers to that session. Returns `[{ pid, name, hosted }]`.
 *
 * @param {Function} log
 * @returns {Promise<Array<{pid:number,name:string,cmd:string}>>}
 */
function discoverClaudeConsolePids(log = () => {}) {
  // PowerShell enumerates candidate processes and emits TSV the JS side parses.
  // Targets ONLY Claude session roots (the TUI process reading console input):
  //   - claude.exe                               → native-install session root
  //   - node.exe running the Claude Code CLI main → node-install session root
  // and EXCLUDES:
  //   - the auto-resume daemon itself
  //   - plugin / MCP node children (.claude/plugins/cache/...) — they share the
  //     session's console, so injecting into them would double-deliver and spam
  //     non-TUI processes. Any process with a claude.exe ANCESTOR is dropped.
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$all = Get-CimInstance Win32_Process
$byId = @{}
foreach ($p in $all) { $byId[[int]$p.ProcessId] = $p }

$claudeExeIds = @{}
foreach ($p in $all) { if ($p.Name -eq 'claude.exe') { $claudeExeIds[[int]$p.ProcessId] = $true } }

function Has-ClaudeAncestor {
    param([int]$Id)
    $cur = $Id
    for ($d = 0; $d -lt 12; $d++) {
        $proc = $byId[$cur]
        if (-not $proc) { return $false }
        $par = [int]$proc.ParentProcessId
        if ($par -eq 0 -or -not $byId.ContainsKey($par)) { return $false }
        if ($claudeExeIds.ContainsKey($par)) { return $true }
        $cur = $par
    }
    return $false
}

foreach ($p in $all) {
    $name = $p.Name
    if ($name -ne 'claude.exe' -and $name -ne 'node.exe') { continue }
    $cmd = $p.CommandLine
    if (-not $cmd) { $cmd = '' }

    $isRoot = $false
    if ($name -eq 'claude.exe') {
        # native session root (its node/plugin children are excluded below)
        $isRoot = $true
    } elseif ($name -eq 'node.exe') {
        # node-based Claude Code TUI: the CLI main, NOT a plugin/MCP child
        $looksClaudeCli = $cmd -match '(?i)(@anthropic-ai[\\\\/]claude-code|[\\\\/]\.claude[\\\\/]local[\\\\/]|claude-code[\\\\/]cli\.js|[\\\\/]\.claude[\\\\/]cli\.js)'
        $isPlugin = $cmd -match '(?i)([\\\\/]plugins[\\\\/]|[\\\\/]mcp[\\\\/]|modelcontextprotocol)'
        $isDaemon = $cmd -match '(?i)(auto-resume|auto-claude-resume|console-inject|windows-delivery)'
        if ($looksClaudeCli -and -not $isPlugin -and -not $isDaemon -and -not (Has-ClaudeAncestor -Id ([int]$p.ProcessId))) {
            $isRoot = $true
        }
    }

    # Never target a process that descends from a claude.exe (plugin/MCP/tool child)
    if ($isRoot -and $name -eq 'node.exe' -and (Has-ClaudeAncestor -Id ([int]$p.ProcessId))) { $isRoot = $false }

    if ($isRoot) {
        $short = if ($cmd.Length -gt 100) { $cmd.Substring(0,100) } else { $cmd }
        Write-Output ("CLAUDE-PID\`t" + $p.ProcessId + "\`t" + $name + "\`t" + ($short -replace "\`t",' '))
    }
}
`;
  return runPowerShell(script, 15000).then(({ stdout }) => {
    const out = [];
    for (const line of (stdout || '').split(/\r?\n/)) {
      const t = line.trim();
      if (!t.startsWith('CLAUDE-PID\t')) continue;
      const [, pid, name, cmd] = t.split('\t');
      const n = parseInt(pid, 10);
      if (Number.isInteger(n)) out.push({ pid: n, name, cmd: cmd || '' });
    }
    log('debug', `Discovered ${out.length} Claude console PID(s): ${out.map((p) => p.pid).join(', ') || 'none'}`);
    return out;
  }).catch((err) => {
    log('debug', `Claude PID discovery failed: ${err.message}`);
    return [];
  });
}

/**
 * Build the PowerShell script that attaches to each target console and injects
 * the canonical resume sequence with the same timing as the SendKeys path:
 *   ESC, ESC, <menu>+CR, ESC, ESC, Ctrl+U, <text>+CR
 *
 * @param {string} resumeText
 * @param {string} menuSelection
 * @returns {string} PowerShell script (reads -TargetPids "a,b,c")
 */
function buildConsoleInjectScript(resumeText, menuSelection = '1') {
  // PowerShell-escape for a single-quoted string literal.
  const esc = (s) => String(s).replace(/'/g, "''");
  const textEsc = esc(resumeText);
  const menuEsc = esc(menuSelection);

  return `
param([string]$TargetPids)
$ErrorActionPreference = 'Continue'
$sig = @"
using System;
using System.Runtime.InteropServices;
public class ARConsoleInject {
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AttachConsole(uint dwProcessId);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool FreeConsole();
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] public static extern IntPtr CreateFileW(string lpFileName, uint dwDesiredAccess, uint dwShareMode, IntPtr lpSecurityAttributes, uint dwCreationDisposition, uint dwFlagsAndAttributes, IntPtr hTemplateFile);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool CloseHandle(IntPtr h);
  [StructLayout(LayoutKind.Explicit)] public struct INPUT_RECORD {
    [FieldOffset(0)] public ushort EventType;
    [FieldOffset(4)] public KEY_EVENT_RECORD KeyEvent;
  }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct KEY_EVENT_RECORD {
    public int bKeyDown; public ushort wRepeatCount; public ushort wVirtualKeyCode; public ushort wVirtualScanCode; public char UnicodeChar; public uint dwControlKeyState;
  }
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool WriteConsoleInputW(IntPtr hConsoleInput, INPUT_RECORD[] lpBuffer, uint nLength, out uint lpNumberOfEventsWritten);
}
"@
Add-Type -TypeDefinition $sig

$GENERIC_RW   = [uint32]3221225472   # GENERIC_READ | GENERIC_WRITE (0xC0000000)
$FILE_SHARE_RW = [uint32]3
$OPEN_EXISTING = [uint32]3

function Send-Chars {
    param([IntPtr]$Handle, [char[]]$Chars)
    if ($Chars.Length -eq 0) { return }
    $records = New-Object 'ARConsoleInject+INPUT_RECORD[]' ($Chars.Length)
    for ($i = 0; $i -lt $Chars.Length; $i++) {
        $rec = New-Object ARConsoleInject+INPUT_RECORD
        $rec.EventType = 1
        $ke = New-Object ARConsoleInject+KEY_EVENT_RECORD
        $ke.bKeyDown = 1
        $ke.wRepeatCount = 1
        $ke.UnicodeChar = $Chars[$i]
        $rec.KeyEvent = $ke
        $records[$i] = $rec
    }
    $written = 0
    [void][ARConsoleInject]::WriteConsoleInputW($Handle, $records, [uint32]$records.Length, [ref]$written)
}

$ESC = [char]27
$CTRLU = [char]21
$CR = [char]13
$menu = '${menuEsc}'
$text = '${textEsc}'

$pids = @()
foreach ($x in ($TargetPids -split ',')) { $t = $x.Trim(); if ($t -ne '') { $pids += [uint32]$t } }

$delivered = 0
foreach ($targetPid in $pids) {
    [void][ARConsoleInject]::FreeConsole()
    if (-not [ARConsoleInject]::AttachConsole($targetPid)) {
        Write-Output ("INJECT-SKIP\`t" + $targetPid + "\`tattach-failed-" + [Runtime.InteropServices.Marshal]::GetLastWin32Error())
        continue
    }
    $h = [ARConsoleInject]::CreateFileW("CONIN$", $GENERIC_RW, $FILE_SHARE_RW, [IntPtr]::Zero, $OPEN_EXISTING, 0, [IntPtr]::Zero)
    if ($h.ToInt64() -eq -1 -or $h -eq [IntPtr]::Zero) {
        Write-Output ("INJECT-SKIP\`t" + $targetPid + "\`tconin-failed-" + [Runtime.InteropServices.Marshal]::GetLastWin32Error())
        [void][ARConsoleInject]::FreeConsole()
        continue
    }
    # Canonical resume sequence with the same pacing as the GUI keystroke path.
    Send-Chars -Handle $h -Chars @($ESC); Start-Sleep -Milliseconds 500
    Send-Chars -Handle $h -Chars @($ESC); Start-Sleep -Milliseconds 300
    Send-Chars -Handle $h -Chars ($menu.ToCharArray() + $CR); Start-Sleep -Milliseconds 1000
    Send-Chars -Handle $h -Chars @($ESC); Start-Sleep -Milliseconds 500
    Send-Chars -Handle $h -Chars @($ESC); Start-Sleep -Milliseconds 300
    Send-Chars -Handle $h -Chars @($CTRLU); Start-Sleep -Milliseconds 200
    Send-Chars -Handle $h -Chars ($text.ToCharArray() + $CR)
    [void][ARConsoleInject]::CloseHandle($h)
    [void][ARConsoleInject]::FreeConsole()
    $delivered++
    Write-Output ("INJECT-OK\`t" + $targetPid)
    Start-Sleep -Milliseconds 150
}
Write-Output ("INJECT-SUMMARY\`tdelivered=" + $delivered + "\`ttotal=" + $pids.Length)
`.trim();
}

/**
 * Run a PowerShell script string via a temp file. Returns { error, stdout, stderr }.
 * @param {string} script
 * @param {number} timeout
 * @param {string[]} [extraArgs] - appended after -File <tmp>
 */
function runPowerShell(script, timeout = 60000, extraArgs = []) {
  const tmp = path.join(os.tmpdir(), `ar-console-inject-${process.pid}-${Date.now()}.ps1`);
  fs.writeFileSync(tmp, script, 'utf8');
  return new Promise((resolve, reject) => {
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', tmp, ...extraArgs],
      { timeout },
      (error, stdout, stderr) => {
        try { fs.unlinkSync(tmp); } catch (_) { /* best-effort cleanup */ }
        if (error && !stdout) return reject(error);
        resolve({ error, stdout, stderr });
      }
    );
  });
}

/**
 * Deliver the resume sequence to every running Claude session via console
 * injection. Works from the background daemon, locked or unlocked.
 *
 * @param {Object} opts
 * @param {string} [opts.resumeText='continue']
 * @param {string} [opts.menuSelection='1']
 * @param {Function} [opts.log]
 * @param {number[]} [opts.pids] - explicit target PIDs (skips discovery; for tests)
 * @returns {Promise<{success:boolean, delivered:number, total:number, pids:number[]}>}
 */
async function deliverResumeViaConsole(opts = {}) {
  const resumeText = opts.resumeText || 'continue';
  const menuSelection = opts.menuSelection || '1';
  const log = opts.log || (() => {});

  let targets = opts.pids;
  if (!targets) {
    targets = (await discoverClaudeConsolePids(log)).map((p) => p.pid);
  }
  if (!targets.length) {
    log('debug', 'No Claude console PIDs found for injection');
    return { success: false, delivered: 0, total: 0, pids: [] };
  }

  const script = buildConsoleInjectScript(resumeText, menuSelection);
  let delivered = 0;
  try {
    const { stdout } = await runPowerShell(script, 60000, ['-TargetPids', targets.join(',')]);
    for (const line of (stdout || '').split(/\r?\n/)) {
      const t = line.trim();
      if (t.startsWith('INJECT-OK\t')) {
        delivered++;
        log('success', `Injected resume into console of PID ${t.split('\t')[1]}`);
      } else if (t.startsWith('INJECT-SKIP\t')) {
        const [, pid, reason] = t.split('\t');
        log('warning', `Console injection skipped for PID ${pid}: ${reason}`);
      }
    }
  } catch (err) {
    log('warning', `Console injection failed: ${err.message}`);
    return { success: false, delivered: 0, total: targets.length, pids: targets };
  }

  log('info', `Console injection: delivered=${delivered}/${targets.length}`);
  return { success: delivered > 0, delivered, total: targets.length, pids: targets };
}

module.exports = {
  discoverClaudeConsolePids,
  buildConsoleInjectScript,
  deliverResumeViaConsole,
};
