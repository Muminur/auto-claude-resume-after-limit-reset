# Auto Claude Resume After Limit Reset

Automatically resumes Claude Code terminal sessions when rate limits reset. No manual intervention needed — install once, forget about it.

## How It Works

```
Claude Code hits rate limit
        ↓
Stop hook detects rate limit message:
  "You've hit your limit · resets 8pm (Asia/Dhaka)"
  "You're out of extra usage · resets 10:50pm (Asia/Dhaka)"
  "You've hit your org's monthly usage limit"
        ↓
Writes reset time to ~/.claude/auto-resume/status.json
        ↓
Background daemon counts down to reset time
        ↓
After reset + 10s safety delay:
  Linux/macOS:
    → Tier 1: tmux send-keys (works when screen is locked)
    → Tier 2: PTY write to /dev/pts/N (works when screen is locked)
    → Tier 3: xdotool (Linux) / PTY+osascript (macOS)
  Windows:
    → WezTerm CLI — injects bytes directly into every Claude pane (no focus needed)
    → Windows Terminal multi-tab — wt.exe focus-tab to every WT tab (run independently)
    → PowerShell fallback — walks process tree (only if both above found nothing)
  → Verifies via transcript activity
        ↓
Claude Code resumes automatically
```

## Features

- **Automatic Detection** — Stop hook parses rate limit messages from transcripts
- **Auto-Resume** — Sends "continue" to ALL terminal tabs when limits reset
- **Tiered Delivery** — tmux > PTY > xdotool, auto-detects best method
- **Screen-Lock Safe** — Tier 1 and 2 work when screen is locked
- **Active Verification** — transcript-based confirmation of resume
- **Rate Limit Queue** — multiple detections tracked, no overwrite
- **Desktop Notifications** — success/failure via node-notifier
- **Tab Cycling** — Handles multiple Claude Code sessions in gnome-terminal tabs
- **Background Daemon** — Runs as systemd service (Linux) or background process
- **Crash-Loop Protection** — `StartLimitBurst=3`, `RestartSec=60`, 30s self-protection
- **Cross-Platform** — Linux (tmux/PTY/xdotool/ydotool), macOS (tmux/PTY/osascript), Windows (WezTerm CLI / PowerShell window targeting)
- **Zero Configuration** — Just install and forget
- **Self-Watchdog** — Memory monitoring (exits at 200MB), log rotation (1MB max)
- **Retry with Backoff** — 4 retries with exponential backoff if resume fails
- **Transcript Polling** — Redundant fallback detection from JSONL transcripts
- **Event-Driven Watching** — Uses `fs.watch()` for instant status file detection, falls back to polling on network drives
- **Context-Aware Resume** — Extracts last user task from transcript and generates contextual resume prompt
- **Resume Verification** — Verifies transcript activity after resume, retries 3x with 10s/20s/40s backoff
- **Stale PID Validation** — Validates daemon PID with `process.kill(pid, 0)`, Windows `tasklist` fallback
- **Windows Terminal Multi-Tab** — Uses `wt.exe -w 0 focus-tab --target N` to deliver to every tab in Windows Terminal; probes `wt.exe` via `execFile --version` to correctly detect App Execution Alias install paths
- **Proactive Usage Warning** — Warns at 80% of historical rate limit threshold via PostToolUse hook
- **Hot-Reload Config** — Watches the config directory (not the file inode) so atomic saves (tmp→rename) are detected correctly; reloads in-memory without restart
- **Pattern Versioning** — Configurable rate limit detection patterns with version tracking
- **HMAC Integrity** — Signs `status.json` with HMAC-SHA256 and verifies before processing to prevent tampering
- **Simulate Command** — `/auto-resume:simulate` creates test rate limit with 30s countdown
- **Status Line** — `GET /status-line` endpoint returns daemon health as single-line string
- **O_NOCTTY + O_NONBLOCK PTY Write** — PTY/TTY writes use `O_NOCTTY` (no controlling terminal) and `O_NONBLOCK` (full-buffer writes throw `EAGAIN` immediately instead of blocking the event loop)
- **PTY Write Timeout** — PTY delivery times out after 5 seconds to prevent the daemon from blocking on a hung terminal
- **Atomic File Writes** — All `status.json` writers use write-to-tmp-then-rename to prevent corruption from concurrent access
- **Graceful Shutdown Timeout** — Daemon force-exits after 5 seconds if async shutdown hangs
- **Wayland Support** — Detects Wayland sessions and prefers `ydotool` over `xdotool` for keystroke injection
- **Windows Minimize Restore** — Uses P/Invoke `ShowWindow(SW_RESTORE)` before `AppActivate` so minimized terminals receive keystrokes
- **Queue Auto-Cleanup** — Completed rate limit entries older than 30 days are automatically pruned
- **Watcher Resource Limits** — File watcher count capped at 50 with automatic cleanup of stale entries
- **Path Traversal Guard** — Transcript scanner validates real paths to prevent symlink-based directory escape
- **Org Monthly Limit Detection** — Detects "You've hit your org's monthly usage limit" message
- **Hook Module Exports** — `rate-limit-hook.js` exports `analyzeTranscriptTail`, `parseResetTime`, and `isRealRateLimit` so the daemon can import them directly without spawning a subprocess
- **Hook Execution Watchdog** — Daemon warns if the Stop hook hasn't fired in 2+ hours while Claude processes are running, catching silent hook deregistration
- **Multi-Instance Lock Guard** — O_EXCL lockfile prevents two daemon instances from processing the same `status.json` simultaneously
- **Retry Tier Escalation** — On resume retry #2+, escalates to the next delivery tier (e.g., skips tmux/PTY and goes to xdotool)
- **Version Mismatch Detection** — Watchdog checks disk version every 5 minutes and warns if running code is outdated after a plugin update
- **Prometheus Metrics** — Optional metrics endpoint on port 9199 with rate limit counters, resume stats, memory usage, and heartbeat age
- **Per-Project Resume Prompts** — Configure different resume text per project path via `config.projectOverrides`
- **Pattern Externalization** — Rate limit detection patterns configurable in `config.json` without code changes
- **Startup Diagnostics** — Daemon logs platform, Node.js version, delivery tier, and loaded modules on start
- **macOS LaunchAgent** — `install.sh` generates a LaunchAgent plist for auto-start on macOS login
- **Windows Uninstall** — `install.ps1 -Uninstall` cleanly removes the daemon, scheduled tasks, and hooks

## Architecture: Tiered Delivery

The daemon attempts delivery using the most reliable method first, falling back through tiers:

| Tier | Method | Works Locked? | Platform |
|------|--------|--------------|----------|
| 1 | tmux send-keys | Yes | Linux/macOS |
| 2 | PTY write | Yes | Linux |
| W1 | WezTerm CLI | Yes (no focus needed) | Windows — always attempted |
| W2 | Windows Terminal multi-tab | No | Windows — always attempted |
| W3 | PowerShell window targeting | No | Windows — fallback only |

### Cross-Platform Support

| Platform | Tier 1 | Tier 2 | Tier 3 | Tier 4 |
|----------|--------|--------|--------|--------|
| Linux (X11) | tmux send-keys | PTY write (`/dev/pts/N`) | xdotool | — |
| Linux (Wayland) | tmux send-keys | PTY write (`/dev/pts/N`) | ydotool (auto-detected) | xdotool (XWayland) |
| macOS | tmux send-keys | PTY write | osascript | — |
| Windows | WezTerm CLI (pane injection) | Windows Terminal multi-tab (`wt.exe`) | PowerShell process-tree targeting | title-based window search |

## Quick Install (Linux)

```bash
# 1. Clone
git clone https://github.com/Muminur/auto-claude-resume-after-limit-reset.git
cd auto-claude-resume-after-limit-reset

# 2. Install dependencies
npm install

# 3. Install xdotool (required for Linux keystroke injection)
sudo apt-get install -y xdotool

# 4. (Optional, recommended) Install tmux for screen-lock-safe Tier 1 delivery
sudo apt-get install -y tmux

# 5. Copy files to Claude's directories
mkdir -p ~/.claude/auto-resume ~/.claude/hooks
cp auto-resume-daemon.js ~/.claude/auto-resume/
cp systemd-wrapper.js ~/.claude/auto-resume/
cp config.json ~/.claude/auto-resume/
cp hooks/rate-limit-hook.js ~/.claude/hooks/
cp scripts/ensure-daemon-running.js ~/.claude/auto-resume/
cp -r node_modules ~/.claude/auto-resume/

# 6. Register hooks in Claude Code settings
# See INSTALL.md for detailed hook registration

# 7. Install systemd service (recommended for Linux)
cp claude-auto-resume.service ~/.config/systemd/user/
# Edit the service file to match your DISPLAY and XAUTHORITY:
#   Environment="DISPLAY=:1"              # Check with: echo $DISPLAY
#   Environment="XAUTHORITY=/run/user/1000/gdm/Xauthority"  # Check with: echo $XAUTHORITY
systemctl --user daemon-reload
systemctl --user enable --now claude-auto-resume.service
```

See [INSTALL.md](INSTALL.md) for the complete step-by-step guide.

## Quick Install (macOS / Windows)

```bash
# macOS
git clone https://github.com/Muminur/auto-claude-resume-after-limit-reset.git
cd auto-claude-resume-after-limit-reset
bash install.sh

# Windows (PowerShell as Admin)
git clone https://github.com/Muminur/auto-claude-resume-after-limit-reset.git
cd auto-claude-resume-after-limit-reset
.\install.ps1
```

Or use the one-liner:
```bash
curl -fsSL https://raw.githubusercontent.com/Muminur/auto-claude-resume-after-limit-reset/main/quick-install.sh | bash
```

## Architecture

### Key Files

| File | Location | Purpose |
|------|----------|---------|
| `auto-resume-daemon.js` | `~/.claude/auto-resume/` | Main daemon (60KB) — monitoring, countdown, keystroke injection |
| `systemd-wrapper.js` | `~/.claude/auto-resume/` | Systemd wrapper — TCP anchor + explicit main() call |
| `rate-limit-hook.js` | `~/.claude/hooks/` | Stop hook — detects rate limits in transcripts |
| `ensure-daemon-running.js` | `~/.claude/auto-resume/` | SessionStart hook — auto-starts daemon |
| `config.json` | `~/.claude/auto-resume/` | Daemon configuration |
| `claude-auto-resume.service` | `~/.config/systemd/user/` | Systemd service file (Linux) |
| `src/delivery/` | `~/.claude/auto-resume/` | Tiered delivery modules (tmux, PTY, xdotool) |
| `src/verification/` | `~/.claude/auto-resume/` | Active transcript verification |
| `src/queue/` | `~/.claude/auto-resume/` | Rate limit queue manager |
| `scripts/setup-tmux-alias.sh` | project root | Optional tmux wrapper setup |

### Daemon Commands

```bash
node ~/.claude/auto-resume/auto-resume-daemon.js help      # Show all commands
node ~/.claude/auto-resume/auto-resume-daemon.js status     # Check daemon status
node ~/.claude/auto-resume/auto-resume-daemon.js start      # Start daemon
node ~/.claude/auto-resume/auto-resume-daemon.js stop       # Stop daemon
node ~/.claude/auto-resume/auto-resume-daemon.js restart    # Restart daemon
node ~/.claude/auto-resume/auto-resume-daemon.js test       # Test with 10s countdown
node ~/.claude/auto-resume/auto-resume-daemon.js logs       # View daemon logs
node ~/.claude/auto-resume/auto-resume-daemon.js analytics  # View rate limit stats
node ~/.claude/auto-resume/auto-resume-daemon.js reset      # Clear rate limit status
node ~/.claude/auto-resume/auto-resume-daemon.js health     # Full system health check
node ~/.claude/auto-resume/auto-resume-daemon.js dry-run    # Monitor without sending keystrokes
```

### Systemd Service (Linux)

The daemon runs as a systemd user service with crash-loop protection:

```ini
[Unit]
Description=Claude Code Auto-Resume Daemon
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/node ~/.claude/auto-resume/systemd-wrapper.js monitor
Restart=on-failure
RestartSec=60
StartLimitBurst=3
StartLimitIntervalSec=300
MemoryMax=512M

[Install]
WantedBy=default.target
```

```bash
# Service management
systemctl --user status claude-auto-resume.service   # Check status
systemctl --user restart claude-auto-resume.service  # Restart
journalctl --user -u claude-auto-resume.service -f   # Follow logs
```

### The systemd-wrapper.js

Running Node.js daemons under systemd (`Type=simple`, no TTY) has two gotchas:

1. **Event loop drain** — Without a TTY/stdin, Node's event loop can exit with code 0 before async handles register. The wrapper creates a `net.createServer().listen()` TCP anchor *before* loading the daemon.

2. **require.main guard** — When loaded via `require()`, the daemon's `if (require.main === module)` check skips `main()`. The wrapper calls `daemon.main()` explicitly.

### Terminal Tab Cycling (Linux)

For gnome-terminal with multiple tabs, the daemon:

1. Detects tab count by counting bash children of `gnome-terminal-server`
2. Sends keystrokes to the active tab
3. Presses `Ctrl+PageDown` to switch to the next tab
4. Repeats for all tabs

This ensures ALL Claude Code sessions receive the "continue" command, not just the active tab.

### Window Finding Strategies (Linux/macOS)

The daemon tries 3 strategies in order:

1. **Saved PID** — Walks the process tree from the Claude PID saved in `status.json` to find the terminal window
2. **Live PID** — Discovers running `claude` processes via `pgrep` and walks their process trees
3. **All Terminals** — Falls back to finding all terminal windows by WM_CLASS

### Window Finding Strategies (Windows)

On Windows, the daemon uses a dedicated delivery module (`src/delivery/windows-delivery.js`) with four strategies in priority order:

1. **WezTerm CLI** — Calls `wezterm cli send-text` to inject keystrokes directly into **every** Claude pane. Panes are detected by three signals: title or cwd containing "claude", or title containing Claude Code's Braille activity-spinner characters (U+2800–U+28FF). Bytes are piped via stdin so control characters (ESC, Ctrl+U, CR) reach WezTerm unmodified. No window focus required — works even when another app is active.
2. **Windows Terminal multi-tab** — Uses `wt.exe -w 0 focus-tab --target N` to switch to each tab in the Windows Terminal window, then sends the canonical resume keystroke sequence to each one. Tab count is estimated by counting `claude.exe` process descendants of the `WindowsTerminal.exe` process tree, capped at 20. The `wt.exe` path is probed via `execFile --version` to correctly handle the Windows App Execution Alias install location (`%LOCALAPPDATA%\Microsoft\WindowsApps\wt.exe`), which `fs.existsSync()` falsely reports as absent.
3. **Process-tree targeting** — Walks from `node.exe`/`claude.exe` up the process tree to find the parent terminal (Windows Terminal, WezTerm, PowerShell). Uses `AppActivate(PID)` to bring that specific window to focus before sending keys — avoids sending to the wrong PowerShell window.
4. **Title-based search** — Tries common terminal window titles (`WezTerm`, `Claude`, `Windows PowerShell`, `Terminal`).

## Configuration

Edit `~/.claude/auto-resume/config.json`:

```json
{
  "resumePrompt": "continue",
  "checkInterval": 5000,
  "logLevel": "info",
  "notifications": {
    "enabled": true,
    "sound": false,
    "onSuccess": true,
    "onFailure": true
  },
  "resume": {
    "postResetDelaySec": 10,
    "maxRetries": 4,
    "verificationWindowSec": 90,
    "activeVerificationTimeoutMs": 30000,
    "activeVerificationPollMs": 2000
  },
  "daemon": {
    "transcriptPolling": true,
    "maxLogSizeMB": 1
  },
  "detection": {
    "patternVersion": "1.0.0",
    "patterns": [
      "You['\\u2019]ve hit your (?:usage )?limit.*?resets\\s+\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)\\s*\\([^)]+\\)"
    ]
  }
}
```

## Testing

### Systemd Service Tests (30 tests, 8 suites)

```bash
bash tests/test-systemd-service.sh
```

Tests cover: daemon script integrity, systemd service configuration, runtime behavior, and daemon self-protection.

### Simulate a Rate Limit

Use the `/auto-resume:simulate` command or run the script directly:

```bash
# Simulate via script (creates status.json with 30s countdown)
node scripts/simulate.js

# Or manually write a fake rate limit (resets in 15 seconds)
RESET_TIME=$(date -u -d "+15 seconds" +"%Y-%m-%dT%H:%M:%S.000Z")
cat > ~/.claude/auto-resume/status.json <<EOF
{
  "detected": true,
  "reset_time": "$RESET_TIME",
  "message": "Test rate limit",
  "timezone": "Asia/Dhaka",
  "last_task_context": "Test task context",
  "resume_prompt": "Continue with: Test task context"
}
EOF

# Watch the daemon log
tail -f ~/.claude/auto-resume/daemon.log
```

### Jest Unit Tests

```bash
cd ~/.claude/auto-resume && npx jest
```

## Troubleshooting

### Daemon exits immediately (systemd or background)

**Cause:** A module loaded via `require()` calls `process.exit()` unconditionally. The most common culprit is `rate-limit-hook.js` — when the daemon requires it for transcript polling, the hook reads empty stdin (`/dev/null`) and calls `process.exit(0)`, killing the daemon silently within seconds.

**Fix:** All hook modules must guard their entry point:
```js
if (require.main === module) {
  main();
}
```
This is already in place for `rate-limit-hook.js` as of v1.10.1. For systemd, check logs with:
```bash
journalctl --user -u claude-auto-resume.service --since "5 min ago" --no-pager
```

### xdotool "Can't open display"

**Cause:** Wrong DISPLAY or missing XAUTHORITY in systemd service.

**Fix:** Check your actual values and update the service file:
```bash
echo "DISPLAY=$DISPLAY"
echo "XAUTHORITY=$XAUTHORITY"
# Edit ~/.config/systemd/user/claude-auto-resume.service
# Then: systemctl --user daemon-reload && systemctl --user restart claude-auto-resume.service
```

### Keystrokes only go to one tab

**Cause (Linux/macOS):** Old version without tab cycling support.

**Fix (Linux/macOS):** Update to the latest version with tab cycling (counts bash children of gnome-terminal-server, uses Ctrl+PageDown to cycle).

**Cause (Windows / WezTerm):** Pre-v1.10.4 only sent to the first matching pane. Pre-v1.10.5 could miss panes whose project name has no "claude" in the path (e.g. `carteltrading/`).

**Fix (Windows / WezTerm):** v1.10.5+ delivers to every Claude Code pane. Detection uses three signals: title/cwd contains "claude", or title contains Claude Code's Braille spinner characters. If your pane is still missed, check that `wezterm cli list` shows it and that its title or cwd matches one of those signals.

### Crash-loop (many restarts)

**Cause:** Missing StartLimitBurst in service file.

**Fix:** Ensure service file has:
```ini
StartLimitBurst=3
StartLimitIntervalSec=300
RestartSec=60
```

### Windows: keystrokes go to wrong window / "continue" not typed

**Cause (pre-fix):** The Windows delivery used `SendKeys` without targeting a specific window — keystrokes went to whatever had focus when the daemon fired.

**Fix (v1.5.0+):** The daemon now uses a two-tier approach:
1. **WezTerm CLI** — if you use WezTerm, keystrokes are injected directly into the Claude pane (no focus needed). Install WezTerm from https://wezfurlong.org/wezterm/
2. **Process-tree targeting** — walks from the `node.exe`/`claude.exe` process up to the parent terminal and activates it by PID before sending keys.

**If it still fails:**
- Ensure `node auto-resume-daemon.js status` shows the daemon is running
- Run `node auto-resume-daemon.js --test 5` to trigger a test delivery and watch which window receives the keystrokes
- For WezTerm: verify `wezterm cli list` works in your terminal (WezTerm GUI must be running)
- For plain PowerShell: ensure the PowerShell window hosting Claude Code is visible (not minimized) — `AppActivate` cannot restore minimized windows

### Rate limit not detected (hook runs but doesn't trigger daemon)

**Cause (v1.8.0 and earlier):** Two bugs prevented detection:

1. **Unicode apostrophe mismatch** — Claude Code outputs curly quotes (`You\u2019ve`) but the regex only matched ASCII apostrophes. Fixed by using explicit Unicode escapes in the character class.

2. **Node.js v18+ stream iteration bug** — `ReadStream` gained `Symbol.asyncIterator` in Node v10+, which yields Buffer chunks (not lines). The hook iterated raw chunks instead of using `readline`, causing `JSON.parse` to fail silently on multi-line transcripts.

**Fix:** Update to v1.8.1+ which resolves both issues. If you're on an older version:
```bash
cd auto-claude-resume-after-limit-reset && git pull && ./install.sh
```

### Duplicate Stop hook in settings.json

**Cause:** The hook may have been registered twice in `~/.claude/settings.json`, causing race conditions where two hook instances write to `status.json` simultaneously, producing corrupted JSON.

**Fix:** Ensure only ONE Stop hook entry exists:
```json
"Stop": [
  {
    "matcher": "",
    "hooks": [
      {
        "type": "command",
        "command": "node ~/.claude/hooks/rate-limit-hook.js",
        "timeout": 15
      }
    ]
  }
]
```

## Security

- **HMAC-SHA256 Integrity** — `status.json` is signed on write and verified on read. Tampered files are rejected.
- **No Shell Interpolation** — All child process calls use `execFile()` with argument arrays, never `exec()` with template strings. macOS `osascript` invocations escape the keystroke text and use `execFile` to prevent AppleScript/shell injection.
- **Atomic Writes** — All `status.json` writers use tmp-file-then-rename to prevent corruption from concurrent access.
- **Path Traversal Guard** — Transcript scanner validates `realpathSync` to prevent symlink escape from `~/.claude/projects/`.
- **O_NOCTTY + O_NONBLOCK Flags** — PTY/TTY writes use `O_NOCTTY` (daemon never acquires a controlling terminal) and `O_NONBLOCK` (blocked writes fail with `EAGAIN` instead of hanging the event loop).

## API Reference

The daemon exposes a REST API on port **3848** (default) when running.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/status` | All sessions status |
| GET | `/api/status/:session` | Single session status |
| GET | `/api/config` | Current configuration (sanitized) |
| POST | `/api/resume/:session` | Force resume a session |
| GET | `/api/analytics` | Analytics data |

### Example curl commands

```bash
# Health check
curl http://localhost:3848/api/health

# All sessions
curl http://localhost:3848/api/status

# Single session
curl http://localhost:3848/api/status/default

# Current configuration
curl http://localhost:3848/api/config

# Force resume a session
curl -X POST http://localhost:3848/api/resume/default

# Analytics
curl http://localhost:3848/api/analytics
```

Optional API key authentication via `Authorization: Bearer <key>` or `X-API-Key: <key>` headers.

## WebSocket Events

The daemon broadcasts real-time events over WebSocket on port **3847** (default).

**Connection:** `ws://localhost:3847`

### Inbound message types (client → server)

| Type | Description | Example payload |
|------|-------------|-----------------|
| `status` | Request current session status | `{"type":"status"}` |
| `config` | Request current configuration | `{"type":"config"}` |
| `analytics` | Request analytics data | `{"type":"analytics"}` |
| `resume` | Trigger resume for a session | `{"type":"resume","session_id":"default"}` |
| `clear` | Clear session status | `{"type":"clear","session_id":"default"}` |
| `reset_status` | Reset all status | `{"type":"reset_status"}` |
| `config_update` | Update configuration | `{"type":"config_update","config":{"resumePrompt":"continue"}}` |
| `get_logs` | Fetch recent log lines | `{"type":"get_logs"}` |
| `subscribe` | Subscribe to specific sessions | `{"type":"subscribe","data":{"sessions":["default"]}}` |

### Outbound message types (server → client)

| Type | Description |
|------|-------------|
| `welcome` | Sent on connect with `clientId` |
| `status` | Session status array with daemon stats |
| `event` | Application events (rate limit detected, resumed, etc.) |
| `config` | Configuration object |
| `analytics` | Analytics chart data |
| `logs` | Recent log lines array |
| `action_response` | Acknowledgment for resume/clear/reset/config_update |
| `subscribed` | Confirmation of session subscription |

### Quick connect example

```js
const ws = new WebSocket('ws://localhost:3847');
ws.onopen = () => ws.send(JSON.stringify({ type: 'status' }));
ws.onmessage = (e) => console.log(JSON.parse(e.data));
```

### Health Check command

Runs a full-chain health check without starting the daemon:

```bash
node auto-resume-daemon.js health
```

Reports:
- Stop hook presence in `~/.claude/settings.json`
- Daemon running status and PID
- Heartbeat freshness (seconds since last daemon heartbeat)
- Status directory writability
- HMAC verification module availability
- Active delivery tier (tmux / PTY / WezTerm / PowerShell)
- Loaded optional modules (config, analytics, notifications, dashboard, hmac)

### Dry-Run mode

Start the daemon in monitoring mode without sending any keystrokes. Useful for verifying detection logic before going live:

```bash
node auto-resume-daemon.js dry-run
```

Rate limits are detected and logged normally. All delivery calls are skipped and replaced with log lines indicating what would have been sent.

## Prometheus Metrics

Enable the metrics endpoint in `~/.claude/auto-resume/config.json`:

```json
{
  "metrics": { "enabled": true, "port": 9199 }
}
```

Scrape `http://127.0.0.1:9199/metrics` to get:

| Metric | Type | Description |
|--------|------|-------------|
| `autoresume_daemon_uptime_seconds` | gauge | Daemon uptime |
| `autoresume_rate_limits_detected_total` | counter | Total rate limits detected |
| `autoresume_resumes_attempted_total` | counter | Total resume attempts |
| `autoresume_resumes_succeeded_total` | counter | Successful resumes |
| `autoresume_resumes_failed_total` | counter | Failed resumes |
| `autoresume_hook_fires_total` | counter | Total hook invocations |
| `autoresume_heap_used_bytes` | gauge | Heap memory used |
| `autoresume_rss_bytes` | gauge | Resident set size |
| `autoresume_rate_limited` | gauge | Currently rate limited (0/1) |
| `autoresume_reset_time_remaining_seconds` | gauge | Seconds until reset |
| `autoresume_heartbeat_age_seconds` | gauge | Seconds since last heartbeat |

## Advanced Configuration

Configuration file: `~/.claude/auto-resume/config.json`

### Per-Project Resume Prompts

Override the resume text for specific project directories:

```json
{
  "resumePrompt": "continue",
  "projectOverrides": {
    "/home/user/my-project": { "resumePrompt": "resume the current task" },
    "C:\\Users\\me\\work": { "resumePrompt": "keep going" }
  }
}
```

### Custom Rate Limit Patterns

Add or modify detection patterns without editing code:

```json
{
  "patterns": {
    "rateLimitPatterns": [
      "You've hit your limit",
      "You're out of extra usage",
      "Rate limit exceeded",
      "your custom pattern here"
    ],
    "falsePositivePatterns": [
      "remove.*rate.*limit",
      "rate.*limit.*hook"
    ]
  }
}
```

Patterns are compiled as case-insensitive RegExp. Max length 200 chars. Nested quantifiers rejected to prevent ReDoS.

### Daemon Tuning

```json
{
  "daemon": {
    "transcriptPolling": true,
    "maxLogSizeMB": 1,
    "staleThresholdHours": 2,
    "hookWatchdogThresholdHours": 2
  },
  "resume": {
    "postResetDelaySec": 10,
    "maxRetries": 4,
    "verificationWindowSec": 90,
    "activeVerificationTimeoutMs": 15000,
    "activeVerificationPollMs": 1000
  }
}
```

## Changelog

### v1.20.0 — Fix: stale daemon version shadowed all updates (2026-06-22)

**The real reason earlier fixes appeared to do nothing: the daemon kept running an old cached version.**

The plugin cache can hold several extracted versions side by side (e.g. `1.16.3` and
`1.19.0`). The daemon/hook resolver (`ensure-daemon-running.js`) did a depth-first
search and returned the **first** `auto-resume-daemon.js` it found — and because
directory listings are alphabetical, `1.16.3` sorts before `1.19.0`, so the launcher
always started the **oldest** cached build. New versions installed fine but never ran.

- **fix(ensure-daemon):** `findDaemonPath` and the hook resolver now sort version
  directories with `sortEntriesPreferLatest()` and pick the **highest semver** version,
  so the newest installed build is the one that launches.

> If you were stuck on an old version: after updating, restart the daemon
> (`/auto-resume:stop` then `/auto-resume:start`) once so the fixed resolver takes over.

### v1.19.0 — Lock-Independent Resume on Windows via Console Injection (2026-06-22)

**Fixes: `continue` was never reliably delivered on Windows — including when the workstation is locked**

v1.18.0 targeted the right windows but delivered via GUI `SendKeys`, which requires
stealing window focus. A **background process — which the daemon is — cannot steal
foreground** on Windows (foreground-lock), *whether the workstation is locked or
unlocked*. So GUI delivery from the daemon was effectively never working; it only
appeared to when the caller already held foreground.

- **feat(console-inject):** New primary Windows delivery path that injects the resume
  sequence straight into each Claude session's **console input buffer** via the Win32
  console API (`AttachConsole` + `WriteConsoleInput`). This:
  - **works from the detached daemon** — no window focus / foreground required;
  - is **lock-independent by construction** — the console API never touches the
    secure desktop, so delivery works while the workstation is **locked**;
  - **reaches every Windows Terminal session** — each ConPTY tab/window is targeted
    by PID, so all sessions resume (verified end-to-end against a real `claude.exe`,
    whose injected prompt appeared in Claude's transcript);
  - is **AMSI-clean** — unlike `SetForegroundWindow`+`SendKeys`, which Defender blocks.
- **fix(windows-delivery):** Console injection is now the single primary path. WezTerm
  CLI and the v1.18.0 HWND window-enumeration run only as a fallback when injection
  delivers to zero sessions — preventing the double-delivery that would otherwise occur
  (WezTerm and Windows Terminal are also ConPTY-backed).
- **fix(console-inject):** Session targeting is restricted to Claude session roots
  (`claude.exe` and node-hosted Claude CLIs); plugin/MCP node children (which share the
  session console) and the daemon itself are excluded, so `continue` is delivered once
  per session and never into unrelated processes.

> Injection lands in whatever process currently owns the console input. At the
> rate-limit prompt Claude is idle and owns it, so production delivery is reliable.

### v1.18.0 — Multi-Window Resume on Windows (2026-06-22)

**Fixes: multiple Claude sessions in separate terminal windows were not resumed**

When several Claude Code sessions run in separate windows — most commonly multiple
Windows Terminal windows, which are all owned by a *single* `WindowsTerminal.exe`
process, each with its own title — only one (or none) received the resume keystrokes
after the rate limit lifted. Root cause was two-fold:

- **fix(windows-delivery):** The old `wt -w 0 focus-tab` strategy could only address
  the most-recently-used Windows Terminal window, then returned success and
  short-circuited the fallback — so sessions in every other window were never reached.
  `Get-Process` also exposes only one `MainWindowHandle` per PID, so process-walking
  could not see the other windows of the shared process.
- **fix(windows-delivery):** Added a **UI Automation** delivery strategy that enumerates
  *every* top-level window, keeps those whose owning process is a terminal and whose
  title identifies a Claude session, and focuses each by its `NativeWindowHandle`
  (dedup by handle, not PID). This targets all windows in one pass and also covers
  standalone PowerShell/cmd windows.
- **fix(windows-delivery, AMSI):** The first implementation used Win32
  `EnumWindows` + `SetForegroundWindow` + `AttachThreadInput` + `SendKeys`, which
  Windows Defender AMSI blocks as an injector ("malicious content … blocked by your
  antivirus software") so it never ran. Rewritten on the managed UI Automation client
  (`AutomationElement.SetFocus`), the accessibility-sanctioned focus path, which passes
  AMSI cleanly.
- **fix(windows-delivery):** Claude-window detection now recognizes the **idle /
  rate-limited** title glyph (`✳` U+2733), not just the Braille working-spinner
  (U+2800–U+28FF). A paused-at-the-limit session shows no spinner — the exact state the
  daemon runs in — so spinner-only detection missed it.
- **fix(windows-delivery):** A terminal-process allowlist prevents false positives — a
  File Explorer folder named `AutoClaudeResume` or a browser tab on claude.ai no longer
  receives keystrokes.
- **feat(windows-delivery):** Foreground-lock guard — after focusing a window, delivery
  verifies the window actually holds keyboard focus before sending; unfocusable windows
  are skipped and logged instead of firing keys blindly. A `dryRun` option enumerates
  and logs target windows without sending anything.

*Known limitation:* enumeration targets each window's focused tab; multiple Claude tabs
within a single window are not individually addressed (logged when it applies).

### v1.17.0 — Bug Fixes: Timezone, Data Loss, Reliability (2026-05-25)

**Timezone (high-impact — up to 12-hour error fixed)**
- **fix(timezone):** Replaced DST-unaware static timezone table in `index.js` with `Intl`-based `getTimezoneOffset()`. All IANA timezone names now return the correct offset including DST transitions. Previously `America/New_York` always returned −5 (EST); it now correctly returns −4 during EDT.
- **fix(hook):** `parseResetTime` in `rate-limit-hook.js` now applies the named timezone offset when computing the reset timestamp. Previously the hook always used the machine's local wall-clock, causing ±12-hour errors for users in different timezones.

**Data loss (silent bugs fixed)**
- **fix(daemon):** `transcriptPath` is now captured from `status.json` *before* `clearStatus()` deletes the file. Previously the read happened after deletion, so `transcriptPath` was always `null` and active transcript verification never ran.
- **fix(daemon):** Removed duplicate `clearStatus()` call in the verification success branch. The first call (after delivery) already removed the queue entry; the second call was deleting the entire queue file, destroying any remaining pending entries.

**Reliability**
- **fix(daemon):** `writeLockFile()` no longer calls itself recursively on `EEXIST`. Replaced with a single inline retry, eliminating a potential stack overflow under lock contention.
- **fix(daemon):** `verificationCheckInterval` promoted to module scope and cleared in `shutdown()`. Previously the passive verification `setInterval` leaked after SIGTERM, firing for up to 90 seconds post-shutdown.
- **fix(daemon):** `verifyResumeByTranscript` now accepts an optional `AbortSignal`. The daemon creates an `AbortController` and aborts it during shutdown, cancelling the recursive `setTimeout` chain.
- **fix(daemon, macOS):** TTY `openSync` now includes `O_NONBLOCK` so a full terminal input buffer throws `EAGAIN` instead of blocking the Node.js event loop indefinitely.
- **fix(daemon, macOS):** `ps` query extended from `pid,tty,comm` to `pid,tty,comm,args`. Claude Code running as `node /usr/local/bin/claude` (where `comm` is `node`) is now detected by matching `args`.
- **fix(pty-delivery):** PTY `openSync` now includes `O_NONBLOCK`, making the `Promise.race` timeout effective. Previously all I/O was synchronous so `setTimeout` inside the timeout promise could never fire.
- **fix(config-hot-reload):** `fs.watch` now watches the parent directory and filters by filename. Previously it watched the config file's inode directly; atomic saves (tmp → rename) replaced the inode, silently stopping hot-reload after the first config write.
- **fix(api-server):** `server.once('error', reject)` is now wired before `server.listen()`. Previously, port-in-use errors were emitted as unhandled `'error'` events and crashed the process.

**Correctness**
- **fix(daemon):** Success log now reads `Delivery succeeded (tried: tmux, pty)` instead of `Delivery succeeded via undefined` — `result.tier` (singular) was never set; the correct key is `result.tiersAttempted`.
- **fix(daemon):** `return true` inside the `stopDaemon` `setInterval` callback removed — it was a no-op that returned from the callback, not from `stopDaemon`.

**Security**
- **fix(macOS):** `sendKeystrokes` now uses `execFile('osascript', ['-e', script])` with the text escaped for AppleScript, replacing the old `exec(\`osascript -e '${script}'\`)` which broke on any input containing `"` or `'`.

---

### v1.16.3 — Windows WezTerm Delivery Fixes (2026-05-25)

- **fix(version-script):** `scripts/update-command-versions.js` now handles Windows backslash paths (`\1.4.13\`) in addition to forward-slash paths. All `commands/*.md` Windows examples were stuck on v1.4.13; they now correctly reflect the current version.
- **fix(windows-delivery):** `buildWindowsKeystrokeScript` Strategy 1 previously broke out of all loops after the first terminal found. Replaced with a `$targetedPids` deduplication hashtable so the resume signal is delivered to **every** terminal hosting a Claude process (e.g., both Windows Terminal and WezTerm simultaneously).
- **fix(wezterm-cli):** `tryWeztermCli` now makes a single `wezterm cli list --format json` call instead of two. The old exit-code-only guard was unreliable in MSYS2/Git Bash (exits 0 even on socket failure); the new code validates by checking that stdout is a parseable JSON array.

## Dependencies

- **Node.js** >= 16.0.0
- **tmux** (optional, recommended) — Tier 1 screen-lock-safe delivery
- **xdotool** (Linux X11 only) — Tier 3 fallback `sudo apt-get install xdotool`
- **ydotool** (Linux Wayland) — Tier 3 alternative `sudo apt-get install ydotool`
- **chokidar** — File watching
- **ws** — WebSocket server
- **node-notifier** — Desktop notifications

## License

MIT
