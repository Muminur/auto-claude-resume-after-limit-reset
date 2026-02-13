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
  -> Tiered delivery: tmux send-keys > PTY write > xdotool (auto-detected)
  -> Sends: Escape -> Ctrl+U -> "continue" -> Enter
        |
Active verification: reads transcript to confirm resume succeeded
        |
Claude Code resumes automatically
```

## Status File Format

```json
{
  "detected": true,
  "queue": [
    {
      "reset_time": "2026-01-21T20:00:00.000Z",
      "message": "You've hit your limit · resets 8pm (Asia/Dhaka)",
      "timezone": "Asia/Dhaka",
      "timestamp": "2026-01-21T14:30:00.000Z"
    }
  ],
  "sessions": ["session-abc123"]
}
```

**Required:** `detected` (boolean), `queue` (array of pending rate limit events)
**Each queue entry:** `reset_time` (ISO 8601 string), plus optional `message`, `timezone`, `timestamp`
**Optional top-level:** `sessions` (array of session IDs that triggered detection)

The daemon processes the earliest `reset_time` from the queue. When a queued event is handled, it is shifted off. New detections append to the array instead of overwriting, ensuring no rate limit event is lost.

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

### Tiered Delivery Architecture

The daemon uses a 3-tier delivery system to send keystrokes to the terminal. Tiers are auto-detected at startup; the daemon uses the highest-priority tier available:

| Tier | Method | How it works | When used |
|------|--------|-------------|-----------|
| 1 (best) | **tmux** | `tmux send-keys` to the target pane | Session is inside a tmux pane (detected via `$TMUX` env / tmux process ancestry) |
| 2 | **PTY** | Direct write to the pseudo-terminal device (`/dev/pts/N`) | TTY device is known from the Claude process (falls back here when tmux is unavailable) |
| 3 (fallback) | **xdotool** | X11 `xdotool type` / `xdotool key` to the terminal window | No tmux, no accessible PTY; requires an X11 display |

Auto-detection order: the daemon checks for tmux first, then resolves the PTY from the Claude process, and falls back to xdotool window search only if both are unavailable. This eliminates the need for per-machine configuration.

### Active Verification

After sending the resume keystrokes, the daemon does not assume success. Instead it performs transcript-based verification:

1. Waits a configurable window (default 90 seconds) after sending keystrokes.
2. Reads the most recent JSONL transcript file for the session.
3. Looks for evidence that Claude Code accepted input and produced new output after the resume timestamp.
4. If verification fails (no new transcript activity), the daemon retries delivery using the retry/backoff logic.

This closes the gap where keystrokes could be sent to the wrong window or swallowed by a prompt, leaving the session stalled without anyone noticing.

### Rate Limit Queue

When multiple rate limit detections arrive (e.g., several sessions hit limits in quick succession, or the hook fires twice for the same event), they are queued rather than overwriting each other:

- Each detection appends an entry to the `queue` array in `status.json`.
- The daemon always processes the entry with the **earliest** `reset_time` first.
- After a successful resume (confirmed by active verification), the processed entry is shifted off the queue.
- If the queue still has entries, the daemon immediately begins counting down to the next reset time.

This prevents the race condition where a second hook invocation could overwrite an earlier, still-pending reset time.

### Resume with Retry
- 4 retries with exponential backoff if keystroke injection fails
- 90-second verification window to confirm resume worked (see Active Verification above)

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
| Linux | Tiered: tmux > PTY > xdotool (auto-detected) | systemd service + SessionStart hook |
| macOS | osascript (AppleScript) | SessionStart hook |
| Windows | PowerShell SendKeys | SessionStart hook |

## Testing

- **Bash tests:** `bash tests/test-systemd-service.sh` (24 tests)
- **Jest tests:** `npx jest` (30 tests across 8 suites — delivery tiers, verification, queue, etc.)
- **Live test:** `node auto-resume-daemon.js test` (10s countdown + keystroke injection)
- **Simulate rate limit:** Write to `status.json` with a future `reset_time`

## Version History

### v1.3.0 — Tiered Delivery, Active Verification, Rate Limit Queue

- **Tiered delivery:** tmux > PTY > xdotool with auto-detection (see Tiered Delivery Architecture)
- **Active verification:** transcript-based confirmation that resume actually worked (see Active Verification)
- **Rate limit queue:** multiple detections are queued, not overwritten (see Rate Limit Queue)
- **Updated install scripts** for tmux support and `src/` module layout
- **30 tests across 8 suites**

### v1.8.1 — Bug Fixes

**Fixed: Rate limit detection completely broken on Node.js v10+**

Three bugs in `rate-limit-hook.js` prevented rate limit detection:

1. **Unicode apostrophe mismatch** — Claude Code outputs `You\u2019ve` (RIGHT SINGLE QUOTATION MARK, U+2019) but the regex character class `[''']` contained only ASCII apostrophes (U+0027). The pattern never matched the actual rate limit message. Fixed by using explicit Unicode escapes: `[\u0027\u2018\u2019]`.

2. **ReadStream vs readline** — `analyzeTranscript()` checked `fileStream[Symbol.asyncIterator]` to decide whether to use `readline`. In Node.js v10+, `ReadStream` has `Symbol.asyncIterator`, so the code iterated over raw Buffer chunks instead of individual lines. The entire JSONL transcript arrived as one blob, `JSON.parse` failed, and the error was silently caught. Fixed by always using `readline.createInterface()`.

3. **Missing sessions array guard** — When `status.json` lacked a `sessions` array (e.g., only had `last_hook_run`), `updateStatusFile()` crashed on `status.sessions.includes()`. Fixed by initializing `sessions` to `[]` if missing.

**Also fixed:** Documented that duplicate Stop hook registration in `settings.json` causes race conditions (two hook instances writing `status.json` simultaneously, producing corrupted JSON).
