# Auto-Resume Daemon Usage Guide

The auto-resume daemon is a background service that watches for Claude Code rate limits and automatically resumes sessions when limits reset.

## Daemon Location

After installation, the daemon lives at:
```
~/.claude/auto-resume/auto-resume-daemon.js
```

## Quick Start

```bash
# Start the daemon
node ~/.claude/auto-resume/auto-resume-daemon.js start

# Check status
node ~/.claude/auto-resume/auto-resume-daemon.js status

# Stop the daemon
node ~/.claude/auto-resume/auto-resume-daemon.js stop
```

Or use npm scripts from the repo directory:
```bash
npm run daemon:start
npm run daemon:stop
npm run daemon:status
npm run daemon:restart
```

## How It Works

### 1. Daemon Startup
When you start the daemon, it:
- Creates necessary directories (`~/.claude/auto-resume/`)
- Writes a PID file for process management
- Begins watching the status file
- Logs all activity to `daemon.log`

### 2. Rate Limit Detection
The daemon watches `~/.claude/auto-resume/status.json` for changes. When a rate limit is detected:
- Reads the `reset_time` from the status file
- Displays a live countdown timer
- Logs the detection event

Detection happens via two methods:
1. **File watching** — Polls `status.json` for changes (primary)
2. **Transcript polling** — Scans JSONL transcripts for rate limit messages (fallback)

### 3. Automatic Resume
When the reset time arrives (+ 10s safety delay):
- Finds all Claude Code terminal windows (cross-platform)
- Cycles through all gnome-terminal tabs (Linux)
- Sends Escape + Ctrl+U + "continue" + Enter to each tab
- Clears the status file
- Logs the completion

### 4. Cross-Platform Support

#### Windows
- Uses PowerShell to find windows with "Claude" in title
- Uses `System.Windows.Forms.SendKeys` for keystroke injection
- No additional dependencies required

#### macOS
- Uses osascript to find Terminal/iTerm/iTerm2 windows
- Uses AppleScript `keystroke` commands
- Requires Accessibility permission

#### Linux
- Uses xdotool to find terminal windows
- Searches for common terminal emulators (gnome-terminal, konsole, xterm, etc.)
- Cycles through gnome-terminal tabs via `Ctrl+PageDown`
- **Requires xdotool:**
  ```bash
  sudo apt-get install xdotool  # Ubuntu/Debian
  sudo dnf install xdotool      # Fedora
  sudo pacman -S xdotool        # Arch
  ```

## Status File Format

The daemon expects a JSON status file at `~/.claude/auto-resume/status.json`:

```json
{
  "detected": true,
  "reset_time": "2026-01-21T20:00:00.000Z",
  "message": "You've hit your limit · resets 8pm (Asia/Dhaka)",
  "timezone": "Asia/Dhaka"
}
```

### Required Fields
- `detected` (boolean): Must be `true` to trigger countdown
- `reset_time` (ISO 8601 string): When the rate limit resets

### Optional Fields
- `message` (string): The original rate limit message
- `timezone` (string): The timezone name
- `timestamp` (string): When the status was written

## All Commands

```bash
node auto-resume-daemon.js start       # Start daemon
node auto-resume-daemon.js stop        # Stop daemon (graceful SIGTERM)
node auto-resume-daemon.js status      # Check if running + current status
node auto-resume-daemon.js restart     # Stop then start
node auto-resume-daemon.js monitor     # Run in foreground (for systemd)
node auto-resume-daemon.js test        # Test with 10s countdown
node auto-resume-daemon.js help        # Show all commands
node auto-resume-daemon.js logs        # View daemon log
node auto-resume-daemon.js analytics   # View rate limit statistics
node auto-resume-daemon.js reset       # Clear rate limit status
```

## Process Management

### PID File
Location: `~/.claude/auto-resume/daemon.pid`

Contains the process ID of the running daemon. Used to:
- Check if daemon is already running
- Send signals to the daemon
- Prevent multiple instances

### Log File
Location: `~/.claude/auto-resume/daemon.log`

```
[2026-01-21T14:30:00.000Z] INFO: Daemon started (PID: 12345)
[2026-01-21T14:30:00.100Z] INFO: Watching status file for changes...
[2026-01-21T14:32:15.500Z] WARNING: Rate limit detected!
[2026-01-21T14:32:15.501Z] INFO: Reset time: 1/21/2026, 8:00:00 PM
[2026-01-21T20:00:05.000Z] SUCCESS: Sent to 4 window(s) (strategy: saved-pid)
[2026-01-21T20:00:05.001Z] SUCCESS: Auto-resume completed!
```

Log is auto-rotated at 1MB (configurable via `daemon.maxLogSizeMB`).

### Graceful Shutdown
The daemon handles:
- `SIGINT` (Ctrl+C): Graceful shutdown
- `SIGTERM`: Graceful shutdown
- `uncaughtException`: Logs error and shuts down

On shutdown:
1. Stops the file watcher
2. Stops any active countdown
3. Removes the PID file
4. Logs shutdown event
5. Exits cleanly

## Running as systemd Service (Linux)

The recommended way to run the daemon on Linux. See [INSTALL.md](../INSTALL.md#step-5-install-systemd-service-recommended) for setup.

### Service Commands
```bash
systemctl --user status claude-auto-resume.service    # Check status
systemctl --user restart claude-auto-resume.service   # Restart
systemctl --user stop claude-auto-resume.service      # Stop
journalctl --user -u claude-auto-resume.service -f    # Follow logs
```

### systemd-wrapper.js

The service uses `systemd-wrapper.js` instead of running the daemon directly. This wrapper:

1. Creates a TCP server anchor to keep Node.js event loop alive (no TTY under systemd)
2. Calls `daemon.main()` explicitly (bypasses `require.main === module` guard)

### Key Service File Settings

```ini
Environment="DISPLAY=:1"                    # Must match your X11 display
Environment="XAUTHORITY=/run/user/1000/gdm/Xauthority"  # Must match your session
StartLimitBurst=3                           # Max 3 starts in 5 minutes
RestartSec=60                               # 60s between restarts
MemoryMax=512M                              # Hard memory cap
```

## Window Finding Strategies (Linux)

The daemon tries 3 strategies in order:

1. **Saved PID** — Walks the process tree from the Claude PID saved in `status.json`
2. **Live PID** — Discovers running `claude` processes via `pgrep`
3. **All Terminals** — Falls back to all terminal windows by WM_CLASS

### Terminal Tab Cycling

For gnome-terminal with multiple tabs:
1. Counts tabs by counting bash children of `gnome-terminal-server`
2. Sends keystrokes to the active tab
3. Presses `Ctrl+PageDown` to switch to next tab
4. Repeats for all tabs

## Troubleshooting

### Daemon Won't Start
```bash
# Check if already running
node auto-resume-daemon.js status

# If stale PID file, remove it
rm ~/.claude/auto-resume/daemon.pid

# Try starting again
node auto-resume-daemon.js start
```

### Daemon Exits Under systemd
Check for modules calling `process.exit()` without `require.main` guard:
```bash
journalctl --user -u claude-auto-resume.service --since "5 min ago" --no-pager
```

### Status File Not Detected
```bash
ls -la ~/.claude/auto-resume/status.json
cat ~/.claude/auto-resume/status.json
tail -f ~/.claude/auto-resume/daemon.log
```

### Keystrokes Not Sent (Linux)
```bash
# Check xdotool
which xdotool

# Check DISPLAY
echo $DISPLAY

# Test finding windows
xdotool search --class "gnome-terminal"
```

### xdotool on Wayland
xdotool requires X11. Options:
1. Switch to X11 session at login
2. Run under XWayland: `GDK_BACKEND=x11 gnome-terminal`
3. Use `ydotool` (requires additional setup)

## Security Considerations

1. **Status file** — No authentication. Anyone with write access can trigger a resume. Restrict permissions: `chmod 600 ~/.claude/auto-resume/status.json`
2. **Log file** — Contains rate limit messages. Restrict: `chmod 600 ~/.claude/auto-resume/daemon.log`
3. **Keystroke injection** — Sends to all matching terminal windows. Fixed prompt text only.
4. **No network** — Daemon is purely local, no network connections.

## Performance

| Metric | Value |
|--------|-------|
| CPU (idle) | <0.1% |
| Memory | 30-50 MB |
| Disk I/O | 1 stat call per 5 seconds |
| Network | None |
