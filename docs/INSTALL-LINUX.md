# Linux Installation Guide

Complete guide for installing Auto Claude Resume on Linux (Ubuntu, Debian, Fedora, Arch, etc.).

## Prerequisites

- Linux with Bash shell
- Claude Code CLI installed
- Node.js 16+ ([Installation guide](https://nodejs.org/en/download/package-manager))
- `xdotool` (for sending keystrokes)

---

## Method 1: Claude Code Plugin (Recommended)

This is the easiest and recommended installation method.

### Step 1: Install xdotool

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install xdotool
```

**Fedora/RHEL/CentOS:**
```bash
sudo dnf install xdotool
```

**Arch Linux:**
```bash
sudo pacman -S xdotool
```

**openSUSE:**
```bash
sudo zypper install xdotool
```

### Step 2: Add the Marketplace

Open Claude Code and run:
```
/plugin marketplace add https://github.com/Muminur/auto-claude-resume-after-limit-reset
```

### Step 3: Install the Plugin

```
/plugin install auto-resume
```

### Step 4: Start the Daemon

Open terminal and run:

```bash
# Find the daemon path
daemon_path=$(find ~/.claude/plugins/cache -name "auto-resume-daemon.js" -path "*auto-claude-resume*" 2>/dev/null | head -1)

# Verify it was found
echo "Daemon path: $daemon_path"

# Start the daemon
node "$daemon_path" start
```

### Step 5: Verify Installation

```bash
# Check daemon status
node "$daemon_path" status

# Check if hooks are registered
cat ~/.claude/settings.json | grep -A5 "Stop"

# View logs
tail -20 ~/.claude/auto-resume/daemon.log
```

### Step 6: Test the Installation

```bash
# Run a 10-second test countdown
node "$daemon_path" --test 10
```

---

## Setting Up Auto-Start on Login (systemd)

To have the daemon start automatically when you log in:

### Create systemd User Service

```bash
# Create the service directory
mkdir -p ~/.config/systemd/user

# Create the service file
cat > ~/.config/systemd/user/claude-auto-resume.service << 'EOF'
[Unit]
Description=Claude Auto Resume Daemon
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/node %h/.claude/auto-resume/auto-resume-daemon.js start
Restart=on-failure
RestartSec=10
Environment=DISPLAY=:0

[Install]
WantedBy=default.target
EOF
```

**Note:** If you installed Node.js via nvm or another method, update the `ExecStart` path:
```bash
# Find your node path
which node
# Then update the service file accordingly
```

### Enable and Start

```bash
# Reload systemd
systemctl --user daemon-reload

# Enable auto-start on login
systemctl --user enable claude-auto-resume

# Start now
systemctl --user start claude-auto-resume

# Check status
systemctl --user status claude-auto-resume
```

### Manage the Service

```bash
# Stop
systemctl --user stop claude-auto-resume

# Restart
systemctl --user restart claude-auto-resume

# View logs
journalctl --user -u claude-auto-resume -f
```

---

## Method 2: Manual Installation (Alternative)

If the plugin method doesn't work, use manual installation.

### Step 1: Install Dependencies

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install xdotool nodejs npm

# Fedora
sudo dnf install xdotool nodejs npm

# Arch
sudo pacman -S xdotool nodejs npm
```

### Step 2: Clone Repository

```bash
git clone https://github.com/Muminur/auto-claude-resume-after-limit-reset.git
cd auto-claude-resume-after-limit-reset
```

### Step 3: Run Installer

```bash
chmod +x install.sh
./install.sh
```

### Step 4: Start Daemon

```bash
node ~/.claude/auto-resume/auto-resume-daemon.js start
```

---

## Daemon Management

```bash
# Store daemon path for convenience
daemon=~/.claude/auto-resume/auto-resume-daemon.js

# Check status
node $daemon status

# Stop daemon
node $daemon stop

# Restart daemon
node $daemon restart

# View logs
tail -f ~/.claude/auto-resume/daemon.log

# View last 50 lines
tail -50 ~/.claude/auto-resume/daemon.log
```

---

## Troubleshooting

### Plugin Not Showing in /plugin

Ensure you've added the marketplace first:
```
/plugin marketplace add https://github.com/Muminur/auto-claude-resume-after-limit-reset
```

### "xdotool: command not found"

Install xdotool for your distribution:
```bash
# Ubuntu/Debian
sudo apt install xdotool

# Fedora
sudo dnf install xdotool

# Arch
sudo pacman -S xdotool
```

### Node.js Not Found or Wrong Version

```bash
# Check version (must be 16+)
node --version

# Install via NodeSource (Ubuntu/Debian)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Or use nvm (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 20
```

### Daemon Not Starting

```bash
# Check if already running
pgrep -f "auto-resume-daemon"

# Check Node.js version
node --version

# Check logs for errors
cat ~/.claude/auto-resume/daemon.log
```

### Keystrokes Not Being Sent

The daemon uses `xdotool` to send keystrokes. Common issues:

1. **xdotool not installed:** See installation section above

2. **Running on Wayland:** xdotool requires X11. Try:
   ```bash
   # Run under XWayland
   GDK_BACKEND=x11 node "$daemon_path" start
   ```
   Or switch to an X11 session at login.

3. **No DISPLAY variable:**
   ```bash
   export DISPLAY=:0
   node "$daemon_path" start
   ```

### Wayland Compatibility

If using Wayland (default on newer Ubuntu/Fedora), xdotool may not work. Options:

1. **Switch to X11 session** at login screen
2. **Use XWayland:**
   ```bash
   GDK_BACKEND=x11 node "$daemon_path" start
   ```
3. **Install ydotool** (Wayland alternative - requires additional setup)

### Permission Denied

```bash
chmod +x ~/.claude/hooks/rate-limit-hook.js
chmod +x ~/.claude/auto-resume/auto-resume-daemon.js
```

### Test the Installation

```bash
# Verify dependencies
which node xdotool

# Quick test with 5-second countdown
node "$daemon_path" --test 5
```

---

## Uninstallation

### Plugin Method
```
/plugin uninstall auto-resume
```

### Manual Method
```bash
./install.sh --uninstall
```

### Complete Cleanup

```bash
# Stop daemon
node ~/.claude/auto-resume/auto-resume-daemon.js stop

# Stop and remove systemd service
systemctl --user stop claude-auto-resume
systemctl --user disable claude-auto-resume
rm ~/.config/systemd/user/claude-auto-resume.service
systemctl --user daemon-reload

# Remove files
rm -rf ~/.claude/auto-resume
rm -f ~/.claude/hooks/rate-limit-hook.js
```
