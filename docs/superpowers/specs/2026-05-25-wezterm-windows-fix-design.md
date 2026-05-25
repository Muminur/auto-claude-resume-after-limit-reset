# WezTerm Windows Delivery Fix — Design Spec

**Date:** 2026-05-25  
**Scope:** Approach A — Three targeted bug fixes in auto-resume Windows delivery  
**Files affected:**
- `scripts/update-command-versions.js`
- `src/delivery/windows-delivery.js`

---

## Problem Summary

AutoClaudeResume fails to deliver the resume signal to WezTerm on Windows. Three root-cause bugs:

### Bug 1 — Version update script ignores Windows paths

`scripts/update-command-versions.js` uses regex `/\/(\d+\.\d+\.\d+)\//g` which only matches version numbers surrounded by forward slashes. All Windows paths in `commands/*.md` use backslashes (`\1.4.13\`), so the script never updates them. Result: all Windows command examples still reference `1.4.13` while macOS/Linux examples correctly show the current version (`1.16.2`).

**Confirmed by:** All 8 `commands/*.md` files show `1.4.13` on Windows paths and `1.16.2` on macOS/Linux paths.

### Bug 2 — PowerShell keystroke script breaks on first terminal found

`buildWindowsKeystrokeScript()` Strategy 1 walks the process tree from all `node`/`claude` processes to find ancestor terminal windows. After activating and sending keystrokes to the first terminal found, it sets `$sent = $true` and breaks out of all three loops. When the auto-resume daemon (itself a `node.exe`) is running inside Windows Terminal, Strategy 1 finds Windows Terminal first and breaks — WezTerm's Claude session never receives the resume signal.

**Confirmed by:** Live test `node test-windows-delivery.js powershell` showed "Sent resume keystrokes to: WindowsTerminal (PID 17372)" and stopped. WezTerm (PID 17104, running a Claude Code session) was ignored.

**User requirement:** Send to ALL terminals hosting Claude processes. Cannot rely on window titles to distinguish which terminal is running Claude Code since titles vary.

### Bug 3 — `tryWeztermCli` makes two `execFile` calls and uses exit-code-only check

`tryWeztermCli` runs `wezterm cli list --format json` twice: once as a "CLI accessible?" guard (checking only exit code), and again to get the pane list. This wastes a round-trip. More importantly, in MSYS2/Git Bash environments `wezterm cli list --format json` exits 0 even when it cannot connect to WezTerm's socket, making the guard pass when the CLI is actually broken. The correct signal is whether stdout is a valid JSON array.

---

## Design

### Fix 1 — `scripts/update-command-versions.js`

**Change:** Extend the version pattern and replacement to preserve the separator character.

Before:
```javascript
const versionPattern = /\/(\d+\.\d+\.\d+)\//g;
content = content.replace(versionPattern, `/${newVersion}/`);
```

After:
```javascript
const versionPattern = /([/\\])(\d+\.\d+\.\d+)([/\\])/g;
content = content.replace(versionPattern, (_, before, _ver, after) => `${before}${newVersion}${after}`);
```

The capture groups `before` and `after` hold the separator characters from the original path (`/` or `\`). The replacement emits them unchanged, so `/1.4.13/` → `/1.16.2/` and `\1.4.13\` → `\1.16.2\`.

After this fix, running `node scripts/update-command-versions.js` will update all 8 command files.

### Fix 2 — `buildWindowsKeystrokeScript` in `src/delivery/windows-delivery.js`

**Change:** Replace the break-on-first-success pattern in Strategy 1 with a deduplicated "send to all" pattern.

Introduce a `$targetedPids` hashtable. For each `node`/`claude` process, walk up two ancestor levels. If the ancestor has a visible window and has not already been targeted, activate it and call `Send-ResumeKeys`. Continue iterating — never break early. Strategies 2, 3, and 4 remain as fallbacks for when Strategy 1 finds no terminals at all.

Key structural changes to the generated PowerShell:
- Remove `if ($sent) { break }` from the innermost, middle, and outer loops of Strategy 1
- Add `$targetedPids = @{}` before the loops
- Add `if ($targetedPids.ContainsKey([int]$ancestorId)) { continue }` guard
- After a successful `AppActivate` + `Send-ResumeKeys`, record `$targetedPids[[int]$ancestor.Id] = $true`

No changes to `buildResumeKeystrokeBlock`, `Send-ResumeKeys`, or `Get-ParentPid` helper functions.

### Fix 3 — `tryWeztermCli` in `src/delivery/windows-delivery.js`

**Change:** Merge the two `execFile('wezterm cli list --format json')` calls into one. Validate by checking that stdout parses as a JSON array.

Before (two calls):
```javascript
// call 1: gate check (exit-code only)
const cliCheck = await new Promise((resolve) => {
    execFile(weztermExe, ['cli', 'list', '--format', 'json'], { timeout: 3000 }, (err) => {
        resolve(!err);
    });
});
if (!cliCheck) { return false; }

// call 2: pane enumeration
const listOut = await new Promise((resolve) => {
    execFile(weztermExe, ['cli', 'list', '--format', 'json'], { timeout: 3000 }, (err, stdout) => {
        resolve(err ? null : stdout);
    });
});
```

After (one call):
```javascript
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
```

`allPanes` is then used directly for Claude pane filtering (replacing `listOut`).

---

## Error Handling

- Fix 1: The `replace` callback is pure string manipulation — no new failure modes.
- Fix 2: `$targetedPids` is initialized before the loop; even if `Get-ParentPid` throws, the `catch {}` block prevents script termination. Deduplication guard runs before any activation attempt.
- Fix 3: `JSON.parse` is wrapped in try/catch; any parse failure → `available: false` → graceful fallback to PowerShell SendKeys.

---

## Testing

After implementation:
1. Run `node scripts/update-command-versions.js --check` — should report no mismatches.
2. Run `node test-windows-delivery.js powershell` — should show delivery to BOTH Windows Terminal and WezTerm PIDs.
3. Run `node test-windows-delivery.js wezterm` — should correctly fail when WezTerm mux is down, or succeed with pane list when healthy.

---

## Out of scope

- WezTerm socket path discovery for crashed mux-server recovery (Approach B)
- Multi-window Windows Terminal targeting (Approach C)
- Fixing WezTerm's own mux server crash state (WezTerm bug)
