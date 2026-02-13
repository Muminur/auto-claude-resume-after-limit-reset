# Linux Installation Guide

Complete guide for installing Auto Claude Resume on Linux (Ubuntu, Debian, Fedora, Arch, etc.).

> **Important:** `xdotool` is the **only required system dependency** on Linux. Without it, the daemon will start but **silently fail to resume sessions** when the countdown ends.

## Resume Tier Advantages on Linux

Linux supports **all three resume tiers**, giving you the most reliable screen-locked resume experience:

| Tier | Method | Screen-Locked Resume | Linux Support |
|------|--------|---------------------|---------------|
| **Tier 1** | tmux (send-keys) | Yes | Full support |
| **Tier 2** | PTY (direct write) | Yes | Full support (Linux-only) |
| **Tier 3** | xdotool (keystroke injection) | No (requires active X11 session) | Full support |

Tier 1 (tmux) and Tier 2 (PTY) are **Linux advantages** for screen-locked resume -- they work even when your screen is locked, SSH sessions are disconnected, or no graphical display is available.

## Prerequisites

- Linux with X11 display (Wayland has limited support) -- only needed for Tier 3
- Claude Code CLI installed
- Node.js 16+ ([Installation guide](https://nodejs.org/en/download/package-manager))
- `xdotool` (for sending keystrokes -- Tier 3 fallback)
- `tmux` (recommended for Tier 1 resume)

---

## Installation

### One-Line Install (Recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/Muminur/auto-claude-resume-after-limit-reset/main/quick-install.sh | bash
```

The script will:
1. Check for Node.js and git
2. Auto-install `xdotool` if missing (prompts for sudo/pkexec)
3. Clone the repo, run the installer, and clean up
4. Verify all hooks are registered

### Manual Installation

#### Step 1a: Install xdotool (Tier 3 fallback)

```bash
# Ubuntu/Debian
sudo apt-get install -y xdotool

# Fedora/RHEL/CentOS
sudo dnf install -y xdotool

# Arch Linux
sudo pacman -S xdotool

# openSUSE
sudo zypper install xdotool

# If sudo can't prompt (e.g. inside Claude Code CLI), use pkexec:
pkexec apt-get install -y xdotool
```

Verify:
```bash
which xdotool && xdotool search --class "gnome-terminal" && echo "OK"
```

#### Step 1b: Install tmux (Recommended -- Tier 1)

tmux enables Tier 1 resume, which works even when the screen is locked or no display is available.

```bash
# Ubuntu/Debian
sudo apt install tmux

# Fedora/RHEL/CentOS
sudo dnf install tmux

# Arch Linux
sudo pacman -S tmux
```

Verify:
```bash
tmux -V
```

#### Step 2: Clone, Install, and Copy Files

```bash
git clone https://github.com/Muminur/auto-claude-resume-after-limit-reset.git
cd auto-claude-resume-after-limit-reset
npm install

# Create directories
mkdir -p ~/.claude/auto-resume ~/.claude/hooks

# Copy daemon files
cp auto-resume-daemon.js ~/.claude/auto-resume/
cp systemd-wrapper.js ~/.claude/auto-resume/
cp config.json ~/.claude/auto-resume/

# Copy hooks
cp hooks/rate-limit-hook.js ~/.claude/hooks/
cp scripts/ensure-daemon-running.js ~/.claude/auto-resume/

# Copy dependencies
cp -r node_modules ~/.claude/auto-resume/

# Copy src/ modules (delivery, verification, queue)
cp -r src/{delivery,verification,queue} ~/.claude/auto-resume/src/
```

#### Step 2b: Set Up tmux Alias (Optional)

```bash
bash scripts/setup-tmux-alias.sh
```

This creates a shell alias for launching Claude Code inside a tmux session, enabling Tier 1 resume automatically.

#### Step 3: Register Hooks

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.claude/hooks/rate-limit-hook.js"
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
            "command": "node ~/.claude/auto-resume/ensure-daemon-running.js"
          }
        ]
      }
    ]
  }
}
```

#### Step 4: Install systemd Service (Recommended)

```bash
mkdir -p ~/.config/systemd/user
cp claude-auto-resume.service ~/.config/systemd/user/
```

**Edit the service file** to match your system:

```bash
# Check your actual DISPLAY and XAUTHORITY values
echo "DISPLAY=$DISPLAY"
echo "XAUTHORITY=$XAUTHORITY"

# Edit the service file
nano ~/.config/systemd/user/claude-auto-resume.service
```

Key lines to customize:
```ini
ExecStart=/usr/bin/node /home/YOUR_USER/.claude/auto-resume/systemd-wrapper.js monitor
Environment=HOME=/home/YOUR_USER
Environment="DISPLAY=:1"          # YOUR actual display (check with echo $DISPLAY)
Environment="XAUTHORITY=/run/user/1000/gdm/Xauthority"  # YOUR actual path
```

Enable and start:
```bash
systemctl --user daemon-reload
systemctl --user enable --now claude-auto-resume.service
systemctl --user status claude-auto-resume.service
```

---

## Verify Installation

```bash
# Check daemon status
node ~/.claude/auto-resume/auto-resume-daemon.js status

# Check systemd service (if installed)
systemctl --user status claude-auto-resume.service

# Run a test (10s countdown + keystroke injection)
node ~/.claude/auto-resume/auto-resume-daemon.js test

# Check logs
tail -20 ~/.claude/auto-resume/daemon.log
```

---

## How Auto-Start Works

| Mechanism | What it does |
|-----------|--------------|
| **SessionStart hook** | Runs `ensure-daemon-running.js` every time Claude Code starts. Checks if daemon is running, starts it if not. |
| **systemd service** | Keeps daemon running persistently. Auto-restarts on crash. Starts on boot. |

Both mechanisms work together. The systemd service is recommended for Linux because the daemon survives terminal window closing and starts on boot without needing Claude Code open first.

---

## Daemon Management

```bash
daemon=~/.claude/auto-resume/auto-resume-daemon.js

node $daemon status      # Check if running
node $daemon stop        # Stop daemon
node $daemon restart     # Restart daemon
node $daemon logs        # View log file
node $daemon test        # Test with 10s countdown
```

### systemd Service Commands

```bash
systemctl --user status claude-auto-resume.service    # Status
systemctl --user restart claude-auto-resume.service   # Restart
systemctl --user stop claude-auto-resume.service      # Stop
journalctl --user -u claude-auto-resume.service -f    # Follow logs
```

---

## Troubleshooting

### "xdotool: command not found" / Sessions Not Resuming

The daemon log shows:
```
ERROR: xdotool not found. Please install it
```

Fix:
```bash
sudo apt-get install -y xdotool
# Restart daemon to pick up new binary
node ~/.claude/auto-resume/auto-resume-daemon.js restart
```

### Daemon Exits Immediately Under systemd

Check journal:
```bash
journalctl --user -u claude-auto-resume.service --since "5 min ago" --no-pager
```

Common cause: A required module calls `process.exit()` without `if (require.main === module)` guard. All modules in this repo include this guard.

### xdotool "Can't open display"

Systemd services don't inherit DISPLAY from your session. Fix:
```bash
echo "DISPLAY=$DISPLAY"
echo "XAUTHORITY=$XAUTHORITY"
# Update these values in ~/.config/systemd/user/claude-auto-resume.service
systemctl --user daemon-reload
systemctl --user restart claude-auto-resume.service
```

### Keystrokes Only Go to One Tab

Update to the latest `auto-resume-daemon.js` which includes tab cycling. The daemon counts bash children of `gnome-terminal-server` and uses `Ctrl+PageDown` to cycle through all tabs.

### Running on Wayland

xdotool requires X11. Options:
1. **Switch to X11 session** at login screen
2. **Use XWayland:** `GDK_BACKEND=x11 gnome-terminal`
3. **Use ydotool** (Wayland alternative — requires root or uinput group)

### Node.js Not Found

```bash
node --version  # Must be 16+

# Install via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Or use nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 20
```

### Permission Denied

```bash
chmod +x ~/.claude/hooks/rate-limit-hook.js
chmod +x ~/.claude/auto-resume/auto-resume-daemon.js
```

---

## Persistence

| Scenario | Works? | How |
|----------|--------|-----|
| Close Claude Code, reopen | Yes | SessionStart hook auto-starts daemon |
| Reboot | Yes | systemd service auto-starts; SessionStart hook as fallback |
| Close terminal | Yes | Daemon runs in its own process (systemd-managed) |
| Wayland session | Partial | Daemon starts fine, but xdotool may not send keystrokes |

---

## Uninstallation

```bash
# Stop and disable systemd service
systemctl --user stop claude-auto-resume.service
systemctl --user disable claude-auto-resume.service
rm ~/.config/systemd/user/claude-auto-resume.service
systemctl --user daemon-reload

# Remove files
rm -rf ~/.claude/auto-resume
rm -f ~/.claude/hooks/rate-limit-hook.js

# Remove hooks from settings.json
nano ~/.claude/settings.json
# Delete the Stop and SessionStart hook entries
```
