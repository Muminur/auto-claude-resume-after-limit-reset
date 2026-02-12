# Auto Claude Resume After Limit Reset

Automatically resumes Claude Code terminal sessions when rate limits reset. No manual intervention needed — install once, forget about it.

## How It Works

```
Claude Code hits rate limit
        ↓
Stop hook detects "You've hit your limit · resets 8pm (Asia/Dhaka)"
        ↓
Writes reset time to ~/.claude/auto-resume/status.json
        ↓
Background daemon counts down to reset time
        ↓
After reset + 10s safety delay:
  → Finds terminal windows via xdotool (Linux) / osascript (macOS) / SendKeys (Windows)
  → Cycles through ALL terminal tabs (Ctrl+PageDown)
  → Sends: Escape → Ctrl+U → "continue" → Enter
        ↓
Claude Code resumes automatically
```

## Features

- **Automatic Detection** — Stop hook parses rate limit messages from transcripts
- **Auto-Resume** — Sends "continue" to ALL terminal tabs when limits reset
- **Tab Cycling** — Handles multiple Claude Code sessions in gnome-terminal tabs
- **Background Daemon** — Runs as systemd service (Linux) or background process
- **Crash-Loop Protection** — `StartLimitBurst=3`, `RestartSec=60`, 30s self-protection
- **Cross-Platform** — Linux (xdotool), macOS (osascript), Windows (PowerShell)
- **Zero Configuration** — Just install and forget
- **Self-Watchdog** — Memory monitoring (exits at 200MB), log rotation (1MB max)
- **Retry with Backoff** — 4 retries with exponential backoff if resume fails
- **Transcript Polling** — Redundant fallback detection from JSONL transcripts

## Quick Install (Linux)

```bash
# 1. Clone
git clone https://github.com/Muminur/auto-claude-resume-after-limit-reset.git
cd auto-claude-resume-after-limit-reset

# 2. Install dependencies
npm install

# 3. Install xdotool (required for Linux keystroke injection)
sudo apt-get install -y xdotool

# 4. Copy files to Claude's directories
mkdir -p ~/.claude/auto-resume ~/.claude/hooks
cp auto-resume-daemon.js ~/.claude/auto-resume/
cp systemd-wrapper.js ~/.claude/auto-resume/
cp config.json ~/.claude/auto-resume/
cp hooks/rate-limit-hook.js ~/.claude/hooks/
cp scripts/ensure-daemon-running.js ~/.claude/auto-resume/
cp -r node_modules ~/.claude/auto-resume/

# 5. Register hooks in Claude Code settings
# See INSTALL.md for detailed hook registration

# 6. Install systemd service (recommended for Linux)
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

### Window Finding Strategies

The daemon tries 3 strategies in order:

1. **Saved PID** — Walks the process tree from the Claude PID saved in `status.json` to find the terminal window
2. **Live PID** — Discovers running `claude` processes via `pgrep` and walks their process trees
3. **All Terminals** — Falls back to finding all terminal windows by WM_CLASS

## Configuration

Edit `~/.claude/auto-resume/config.json`:

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

## Testing

### Systemd Service Tests (24 tests)

```bash
bash tests/test-systemd-service.sh
```

Tests cover: daemon script integrity, systemd service configuration, runtime behavior, and daemon self-protection.

### Simulate a Rate Limit

```bash
# Write a fake rate limit (resets in 15 seconds)
RESET_TIME=$(date -u -d "+15 seconds" +"%Y-%m-%dT%H:%M:%S.000Z")
cat > ~/.claude/auto-resume/status.json <<EOF
{
  "detected": true,
  "reset_time": "$RESET_TIME",
  "message": "Test rate limit",
  "timezone": "Asia/Dhaka"
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

### Daemon exits immediately under systemd

**Cause:** A module loaded via `require()` calls `process.exit()` unconditionally.

**Fix:** Ensure all hook modules have `if (require.main === module) { main(); }` guard before auto-executing. Check with:
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

**Cause:** Old version without tab cycling support.

**Fix:** Update `auto-resume-daemon.js` to the latest version with tab cycling (counts bash children of gnome-terminal-server, uses Ctrl+PageDown to cycle).

### Crash-loop (many restarts)

**Cause:** Missing StartLimitBurst in service file.

**Fix:** Ensure service file has:
```ini
StartLimitBurst=3
StartLimitIntervalSec=300
RestartSec=60
```

## Dependencies

- **Node.js** >= 16.0.0
- **xdotool** (Linux only) — `sudo apt-get install xdotool`
- **chokidar** — File watching
- **ws** — WebSocket server
- **node-notifier** — Desktop notifications

## License

MIT
