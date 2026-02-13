# Auto-Resume Daemon — Technical Summary

## Overview

A background daemon that watches for Claude Code rate limits and automatically resumes sessions when limits reset. Runs as a systemd service (Linux) or background process (macOS/Windows).

## Key Files

| File | Location | Purpose |
|------|----------|---------|
| `auto-resume-daemon.js` | `~/.claude/auto-resume/` | Main daemon (~60KB) — monitoring, countdown, keystroke injection |
| `systemd-wrapper.js` | `~/.claude/auto-resume/` | Systemd wrapper — TCP anchor + explicit `main()` call |
| `rate-limit-hook.js` | `~/.claude/hooks/` | Stop hook — detects rate limits in transcripts |
| `ensure-daemon-running.js` | `~/.claude/auto-resume/` | SessionStart hook — auto-starts daemon |
| `config.json` | `~/.claude/auto-resume/` | Daemon configuration |
| `claude-auto-resume.service` | `~/.config/systemd/user/` | Systemd service file (Linux) |
| `status.json` | `~/.claude/auto-resume/` | Rate limit status (watched by daemon) |
| `daemon.pid` | `~/.claude/auto-resume/` | Process ID file |
| `daemon.log` | `~/.claude/auto-resume/` | Activity log (auto-rotated at 1MB) |

## Architecture

```
Claude Code hits rate limit
        |
Stop hook detects "You've hit your limit · resets 8pm (Asia/Dhaka)"
        |
Writes reset time to ~/.claude/auto-resume/status.json
        |
Background daemon counts down to reset time
        |
After reset + 10s safety delay:
  -> Finds terminal windows via xdotool (Linux) / osascript (macOS) / SendKeys (Windows)
  -> Cycles through ALL terminal tabs (Ctrl+PageDown)
  -> Sends: Escape -> Ctrl+U -> "continue" -> Enter
        |
Claude Code resumes automatically
```

## Status File Format

```json
{
  "detected": true,
  "reset_time": "2026-01-21T20:00:00.000Z",
  "message": "You've hit your limit · resets 8pm (Asia/Dhaka)",
  "timezone": "Asia/Dhaka",
  "timestamp": "2026-01-21T14:30:00.000Z"
}
```

**Required:** `detected` (boolean), `reset_time` (ISO 8601 string)
**Optional:** `message`, `timezone`, `timestamp`

## Daemon Features

### Process Management
- PID file prevents multiple instances
- Graceful shutdown on SIGINT/SIGTERM
- Memory watchdog (exits at 200MB)
- Log rotation (auto-rotate at 1MB)

### Detection Methods
1. **File watching** — Polls `status.json` every 5 seconds for changes
2. **Transcript polling** — Redundant fallback: scans JSONL transcripts for rate limit messages

### Window Finding Strategies (Linux)
The daemon tries 3 strategies in order:
1. **Saved PID** — Walks the process tree from the Claude PID saved in `status.json` to find the terminal window
2. **Live PID** — Discovers running `claude` processes via `pgrep` and walks their process trees
3. **All Terminals** — Falls back to finding all terminal windows by WM_CLASS

### Terminal Tab Cycling (Linux)
For gnome-terminal with multiple tabs:
1. Detects tab count by counting bash children of `gnome-terminal-server`
2. Sends keystrokes to the active tab (Esc, Ctrl+U, "continue", Enter)
3. Presses `Ctrl+PageDown` to switch to next tab
4. Repeats for all tabs

### Resume with Retry
- 4 retries with exponential backoff if keystroke injection fails
- 90-second verification window to confirm resume worked

### Crash-Loop Protection
- Systemd: `StartLimitBurst=3`, `RestartSec=60` (max 3 starts in 5 minutes)
- Daemon-level: `.last-start` file with 30s minimum restart interval

## systemd Wrapper

Running Node.js under systemd (`Type=simple`, no TTY) has two gotchas:

1. **Event loop drain** — Without stdin, Node exits before async handles register. The wrapper creates a `net.createServer().listen()` TCP anchor *before* loading the daemon.

2. **require.main guard** — When loaded via `require()`, `require.main` points to the wrapper, not the daemon. So `if (require.main === module) { main(); }` in the daemon skips execution. The wrapper calls `daemon.main()` explicitly.

### rate-limit-hook.js require.main Guard

The hook file has a `main()` function that reads from stdin and calls `process.exit()`. Without a `if (require.main === module)` guard, `require()`-ing the hook (to import `analyzeTranscript`) would kill the parent process. The hook now has this guard:

```javascript
if (require.main === module) {
  main();
}
```

## Commands

```bash
node auto-resume-daemon.js start       # Start daemon
node auto-resume-daemon.js stop        # Stop daemon
node auto-resume-daemon.js status      # Check status
node auto-resume-daemon.js restart     # Restart daemon
node auto-resume-daemon.js test        # Test with 10s countdown
node auto-resume-daemon.js help        # Show help
node auto-resume-daemon.js logs        # View logs
node auto-resume-daemon.js analytics   # Rate limit stats
node auto-resume-daemon.js reset       # Clear status
node auto-resume-daemon.js monitor     # Run in foreground (for systemd)
```

## Configuration

`~/.claude/auto-resume/config.json`:

```json
{
  "resumePrompt": "continue",
  "checkInterval": 5000,
  "logLevel": "info",
  "notifications": { "enabled": true, "sound": false },
  "resume": {
    "postResetDelaySec": 10,
    "maxRetries": 4,
    "verificationWindowSec": 90
  },
  "daemon": {
    "transcriptPolling": true,
    "maxLogSizeMB": 1
  }
}
```

## Performance

| Metric | Value |
|--------|-------|
| CPU (idle) | <0.1% |
| Memory | 30-50 MB |
| Disk I/O | 1 stat call per 5 seconds |
| Network | None (local file watching only) |

## Cross-Platform Support

| Platform | Keystroke Method | Auto-Start |
|----------|-----------------|------------|
| Linux | xdotool (X11) | systemd service + SessionStart hook |
| macOS | osascript (AppleScript) | SessionStart hook |
| Windows | PowerShell SendKeys | SessionStart hook |

## Testing

- **Bash tests:** `bash tests/test-systemd-service.sh` (24 tests)
- **Jest tests:** `npx jest` (unit tests for daemon modules)
- **Live test:** `node auto-resume-daemon.js test` (10s countdown + keystroke injection)
- **Simulate rate limit:** Write to `status.json` with a future `reset_time`

## Version History

### v1.8.1 — Bug Fixes

**Fixed: Rate limit detection completely broken on Node.js v10+**

Three bugs in `rate-limit-hook.js` prevented rate limit detection:

1. **Unicode apostrophe mismatch** — Claude Code outputs `You\u2019ve` (RIGHT SINGLE QUOTATION MARK, U+2019) but the regex character class `[''']` contained only ASCII apostrophes (U+0027). The pattern never matched the actual rate limit message. Fixed by using explicit Unicode escapes: `[\u0027\u2018\u2019]`.

2. **ReadStream vs readline** — `analyzeTranscript()` checked `fileStream[Symbol.asyncIterator]` to decide whether to use `readline`. In Node.js v10+, `ReadStream` has `Symbol.asyncIterator`, so the code iterated over raw Buffer chunks instead of individual lines. The entire JSONL transcript arrived as one blob, `JSON.parse` failed, and the error was silently caught. Fixed by always using `readline.createInterface()`.

3. **Missing sessions array guard** — When `status.json` lacked a `sessions` array (e.g., only had `last_hook_run`), `updateStatusFile()` crashed on `status.sessions.includes()`. Fixed by initializing `sessions` to `[]` if missing.

**Also fixed:** Documented that duplicate Stop hook registration in `settings.json` causes race conditions (two hook instances writing `status.json` simultaneously, producing corrupted JSON).
