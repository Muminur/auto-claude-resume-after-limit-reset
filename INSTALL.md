# Installation Guide

Complete step-by-step guide for installing Auto Claude Resume on Linux, macOS, and Windows.

---

## Quick Install (One-Liner)

**Linux / macOS:**
```bash
curl -fsSL https://raw.githubusercontent.com/Muminur/auto-claude-resume-after-limit-reset/main/quick-install.sh | bash
```

**Windows (PowerShell as Admin):**
```powershell
irm https://raw.githubusercontent.com/Muminur/auto-claude-resume-after-limit-reset/main/install.ps1 | iex
```

---

## Manual Install — Linux (Recommended)

### Prerequisites

- **Node.js** >= 16.0.0 (`node --version`)
- **xdotool** — required for keystroke injection
- **Claude Code** CLI installed and working
- **tmux** (optional, recommended) — provides reliable resume even when the screen is locked, since tmux sessions persist independently of the graphical display

### Step 1: Install System Dependencies

```bash
# Ubuntu/Debian
sudo apt-get install -y xdotool

# Fedora/RHEL/CentOS
sudo dnf install -y xdotool

# Arch Linux
sudo pacman -S xdotool

# Verify
which xdotool && echo "OK"
```

### Step 2: Clone and Install

```bash
git clone https://github.com/Muminur/auto-claude-resume-after-limit-reset.git
cd auto-claude-resume-after-limit-reset
npm install
```

### Step 3: Copy Files to Claude's Directories

```bash
# Create directories
mkdir -p ~/.claude/auto-resume ~/.claude/hooks

# Copy daemon files
cp auto-resume-daemon.js ~/.claude/auto-resume/
cp systemd-wrapper.js ~/.claude/auto-resume/
cp config.json ~/.claude/auto-resume/

# Copy src/ modules (delivery, verification, queue)
cp -r src/{delivery,verification,queue} ~/.claude/auto-resume/src/

# Copy the stop hook (detects rate limits in transcripts)
cp hooks/rate-limit-hook.js ~/.claude/hooks/

# Copy the session-start hook (auto-starts daemon)
cp scripts/ensure-daemon-running.js ~/.claude/auto-resume/

# Copy node_modules
cp -r node_modules ~/.claude/auto-resume/
```

#### Optional: Set Up tmux Alias

If you installed tmux, run the alias setup script to create a `claude-tmux` convenience command:

```bash
bash scripts/setup-tmux-alias.sh
```

### Step 4: Register Hooks in Claude Code

Add these hooks to `~/.claude/settings.json`:

```json
{
  "hooks": {
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
    ],
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.claude/auto-resume/ensure-daemon-running.js",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

> **Important:** Register each hook exactly **once**. Duplicate Stop hooks cause race conditions on `status.json`. If you already have hooks in `settings.json`, merge the entries into your existing `hooks` object.

### Step 5: Install systemd Service (Recommended)

The systemd service keeps the daemon running persistently, even when Claude Code is closed.

```bash
# Create systemd user directory
mkdir -p ~/.config/systemd/user

# Copy the service file
cp claude-auto-resume.service ~/.config/systemd/user/

# IMPORTANT: Update DISPLAY and XAUTHORITY to match YOUR system
# Check your values:
echo "DISPLAY=$DISPLAY"
echo "XAUTHORITY=$XAUTHORITY"

# Edit the service file with your actual values:
# nano ~/.config/systemd/user/claude-auto-resume.service
#   Environment="DISPLAY=:1"          # or :0 — use YOUR value
#   Environment="XAUTHORITY=/run/user/1000/gdm/Xauthority"  # use YOUR value

# Enable and start
systemctl --user daemon-reload
systemctl --user enable --now claude-auto-resume.service

# Verify it's running
systemctl --user status claude-auto-resume.service
```

#### systemd Service File Details

The service file (`claude-auto-resume.service`) runs the daemon via `systemd-wrapper.js`:

```ini
[Unit]
Description=Claude Code Auto-Resume Daemon
After=network.target
StartLimitBurst=3
StartLimitIntervalSec=300

[Service]
Type=simple
ExecStart=/usr/bin/node /home/YOUR_USER/.claude/auto-resume/systemd-wrapper.js monitor
Restart=on-failure
RestartSec=60
KillMode=process
MemoryMax=512M
Environment=HOME=/home/YOUR_USER
Environment="PATH=/home/YOUR_USER/.local/bin:/usr/local/bin:/usr/bin:/bin"
Environment="DISPLAY=:1"
Environment="XAUTHORITY=/run/user/1000/gdm/Xauthority"
Environment="XDG_RUNTIME_DIR=/run/user/1000"

[Install]
WantedBy=default.target
```

**Key settings to customize:**
- Replace `/home/YOUR_USER` with your actual home directory
- Set `DISPLAY` to match your X11 display (check with `echo $DISPLAY`)
- Set `XAUTHORITY` to your X authority file (check with `echo $XAUTHORITY`)
- `StartLimitBurst=3` + `RestartSec=60` prevent crash-loops (max 3 starts in 5 minutes)

#### Why systemd-wrapper.js?

Running Node.js daemons under systemd has two gotchas:

1. **Event loop drain** — Without a TTY or stdin, Node's event loop can exit before async handles register. The wrapper creates a `net.createServer().listen()` TCP anchor *before* loading the daemon.

2. **require.main guard** — When loaded via `require()`, the daemon's `if (require.main === module)` check skips `main()`. The wrapper calls `daemon.main()` explicitly.

### Step 6: Verify Installation

```bash
# Check daemon status
node ~/.claude/auto-resume/auto-resume-daemon.js status

# Check systemd service
systemctl --user status claude-auto-resume.service

# Run a test (sends "continue" to terminal after 10s countdown)
node ~/.claude/auto-resume/auto-resume-daemon.js test
```

---

## Manual Install — macOS

### Prerequisites

- **Node.js** >= 16.0.0
- **Accessibility permission** for Terminal/iTerm2 (System Preferences > Privacy > Accessibility)

### Install

```bash
git clone https://github.com/Muminur/auto-claude-resume-after-limit-reset.git
cd auto-claude-resume-after-limit-reset
chmod +x install.sh
./install.sh
```

The installer handles everything: copies files, registers hooks, and sets up auto-start via the SessionStart hook.

### Grant Accessibility Permission

The daemon uses `osascript` to send keystrokes. macOS requires Accessibility permission:

1. Open **System Preferences** > **Privacy & Security** > **Accessibility**
2. Add your terminal app (Terminal, iTerm2, etc.)
3. Restart the daemon

---

## Manual Install — Windows

### Prerequisites

- **Node.js** >= 16.0.0
- **PowerShell** 5.1+

### Install

```powershell
git clone https://github.com/Muminur/auto-claude-resume-after-limit-reset.git
cd auto-claude-resume-after-limit-reset
powershell -ExecutionPolicy Bypass -File install.ps1
```

---

## How Auto-Start Works

Two mechanisms ensure the daemon is always running:

| Mechanism | How | When |
|-----------|-----|------|
| **SessionStart Hook** | Claude Code runs `ensure-daemon-running.js` on every session start | Covers: reopening Claude Code after close, first launch after reboot |
| **systemd Service** (Linux) | systemd keeps daemon running and restarts on failure | Covers: persistent operation, survives terminal close, auto-start on boot |

For Linux, the systemd service is recommended because:
- The daemon survives terminal window closing
- Auto-restarts on crash (with crash-loop protection)
- Starts on boot without needing Claude Code open first
- Memory-capped at 512MB via systemd

---

## Terminal Tab Cycling (Linux)

If you have multiple Claude Code sessions in gnome-terminal tabs, the daemon handles them all:

1. Detects tab count by counting bash children of `gnome-terminal-server`
2. Sends keystrokes to the active tab
3. Presses `Ctrl+PageDown` to switch to the next tab
4. Repeats for all tabs

This ensures ALL Claude Code sessions receive the "continue" command, not just the active tab.

---

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

| Option | Default | Description |
|--------|---------|-------------|
| `resumePrompt` | `"continue"` | Text sent to terminal after rate limit resets |
| `checkInterval` | `5000` | Status file poll interval (ms) |
| `logLevel` | `"info"` | Log verbosity: debug, info, warn, error |
| `resume.postResetDelaySec` | `10` | Safety delay after reset time before sending keystrokes |
| `resume.maxRetries` | `4` | Retry count with exponential backoff if resume fails |
| `daemon.transcriptPolling` | `true` | Redundant fallback: poll JSONL transcripts for rate limits |
| `daemon.maxLogSizeMB` | `1` | Auto-rotate daemon.log at this size |
| `activeVerificationTimeoutMs` | `30000` | Timeout (ms) for active verification of resume delivery |
| `activeVerificationPollMs` | `2000` | Poll interval (ms) during active verification |
| `notifications.onSuccess` | `true` | Send desktop notification on successful resume |
| `notifications.onFailure` | `true` | Send desktop notification on failed resume |

---

## Testing

### Quick Test (10-second countdown)

```bash
node ~/.claude/auto-resume/auto-resume-daemon.js test
```

### Simulate a Rate Limit

```bash
# Write a fake rate limit status (resets in 15 seconds)
RESET_TIME=$(date -u -d "+15 seconds" +"%Y-%m-%dT%H:%M:%S.000Z")
cat > ~/.claude/auto-resume/status.json <<EOF
{
  "detected": true,
  "reset_time": "$RESET_TIME",
  "message": "Test rate limit",
  "timezone": "UTC"
}
EOF

# Watch the daemon log
tail -f ~/.claude/auto-resume/daemon.log
```

### Run Bash Tests (24 tests)

```bash
bash tests/test-systemd-service.sh
```

### Run Jest Tests

```bash
cd auto-claude-resume-after-limit-reset
npx jest
```

---

## Daemon Commands

```bash
node ~/.claude/auto-resume/auto-resume-daemon.js help       # Show all commands
node ~/.claude/auto-resume/auto-resume-daemon.js status      # Check daemon status
node ~/.claude/auto-resume/auto-resume-daemon.js start       # Start daemon
node ~/.claude/auto-resume/auto-resume-daemon.js stop        # Stop daemon
node ~/.claude/auto-resume/auto-resume-daemon.js restart     # Restart daemon
node ~/.claude/auto-resume/auto-resume-daemon.js test        # Test with 10s countdown
node ~/.claude/auto-resume/auto-resume-daemon.js logs        # View daemon logs
node ~/.claude/auto-resume/auto-resume-daemon.js analytics   # View rate limit stats
node ~/.claude/auto-resume/auto-resume-daemon.js reset       # Clear rate limit status
```

---

## Troubleshooting

### Daemon exits immediately under systemd

**Cause:** A module loaded via `require()` calls `process.exit()` unconditionally.

**Fix:** Ensure all hook modules have `if (require.main === module) { main(); }` guard before auto-executing. The `rate-limit-hook.js` included in this repo already has this guard. Check with:
```bash
journalctl --user -u claude-auto-resume.service --since "5 min ago" --no-pager
```

### xdotool "Can't open display"

**Cause:** Wrong `DISPLAY` or missing `XAUTHORITY` in systemd service.

**Fix:**
```bash
# Check your actual values
echo "DISPLAY=$DISPLAY"
echo "XAUTHORITY=$XAUTHORITY"

# Edit the service file to match
nano ~/.config/systemd/user/claude-auto-resume.service

# Reload and restart
systemctl --user daemon-reload
systemctl --user restart claude-auto-resume.service
```

### Keystrokes only go to one tab

**Cause:** Old version without tab cycling support.

**Fix:** Update to the latest `auto-resume-daemon.js` which includes gnome-terminal tab cycling (counts bash children, uses Ctrl+PageDown).

### Crash-loop (many restarts)

**Cause:** Missing `StartLimitBurst` in service file.

**Fix:** Ensure service file has:
```ini
StartLimitBurst=3
StartLimitIntervalSec=300
RestartSec=60
```

### Rate limit not detected (hook runs but daemon never triggers)

**Cause (v1.8.0 and earlier):** Two bugs in `rate-limit-hook.js` prevented detection:

1. **Unicode apostrophe mismatch** — Claude Code outputs `You\u2019ve` (curly quote U+2019) but the regex character class only contained ASCII apostrophes (U+0027). The pattern never matched the actual message.

2. **Node.js v18+ stream bug** — `fs.createReadStream()` has `Symbol.asyncIterator` in Node v10+, yielding raw Buffer chunks instead of lines. The hook iterated chunks instead of using `readline`, causing `JSON.parse` to fail silently on multi-line JSONL transcripts.

**Fix:** Update to v1.8.1+:
```bash
cd auto-claude-resume-after-limit-reset && git pull && ./install.sh
```

### Duplicate Stop hook causing corrupted status.json

**Symptom:** Daemon log shows `Failed to read status file: Unexpected end of JSON input`.

**Cause:** The Stop hook was registered twice in `~/.claude/settings.json`, creating a race condition where two instances write to `status.json` simultaneously.

**Fix:** Ensure only ONE Stop hook entry exists in `~/.claude/settings.json`:
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

### Running on Wayland

xdotool requires X11. Options:
1. Switch to X11 session at login screen
2. Run under XWayland: `GDK_BACKEND=x11 gnome-terminal`
3. Use `ydotool` (Wayland alternative — requires additional setup)

---

## Uninstallation

### Using the installer
```bash
./install.sh --uninstall    # Linux/macOS
install.ps1 -Uninstall      # Windows
```

### Manual cleanup (Linux)
```bash
# Stop and disable systemd service
systemctl --user stop claude-auto-resume.service
systemctl --user disable claude-auto-resume.service
rm ~/.config/systemd/user/claude-auto-resume.service
systemctl --user daemon-reload

# Remove files
rm -rf ~/.claude/auto-resume
rm -f ~/.claude/hooks/rate-limit-hook.js

# Remove hooks from settings.json (edit manually)
nano ~/.claude/settings.json
```

---

## Platform Requirements Summary

| Platform | Requirements | Keystroke Method |
|----------|--------------|------------------|
| **Linux** | Node.js 16+, xdotool | xdotool (X11) |
| **macOS** | Node.js 16+, Accessibility permission | osascript (AppleScript) |
| **Windows** | Node.js 16+, PowerShell 5.1+ | SendKeys (PowerShell) |
