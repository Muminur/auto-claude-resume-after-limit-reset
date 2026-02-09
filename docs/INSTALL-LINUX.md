# Linux Installation Guide

Complete guide for installing Auto Claude Resume on Linux (Ubuntu, Debian, Fedora, Arch, etc.).

> **Important:** `xdotool` is the **only required system dependency** on Linux. Without it, the plugin will install and the daemon will start, but it will **silently fail to resume your sessions** when the rate limit countdown ends. Install it before anything else.

## Prerequisites

- Linux with Bash shell
- Claude Code CLI installed
- Node.js 16+ ([Installation guide](https://nodejs.org/en/download/package-manager))
- `xdotool` (for sending keystrokes)

### Required npm Packages

The following packages are automatically installed by the plugin but listed here for reference:

- `chokidar` - File system monitoring for plugin directory changes
- `node-notifier` - Desktop notifications (Linux, macOS, Windows)
- `ws` - WebSocket server for GUI dashboard communication

---

## Installation

### Step 1: Install xdotool (One-Time Requirement)

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

**Alternative (GUI password prompt):**

If `sudo` can't prompt for a password (e.g., when running inside Claude Code CLI), use `pkexec` to trigger a graphical authentication dialog:
```bash
pkexec apt-get install -y xdotool    # Ubuntu/Debian
pkexec dnf install -y xdotool        # Fedora
```

**Verify installation:**
```bash
# Confirm xdotool is installed
which xdotool

# Confirm it can find terminal windows (requires X11 display)
xdotool search --class "gnome-terminal"
# Should output one or more window IDs like: 44040193
```

### Step 2: Create Configuration Directory

```bash
mkdir -p ~/.claude/auto-resume
mkdir -p ~/.claude/auto-resume/plugins
```

### Step 3: Clone and Run the Installer

```bash
git clone https://github.com/Muminur/auto-claude-resume-after-limit-reset.git
cd auto-claude-resume-after-limit-reset
chmod +x install.sh
./install.sh
```

**That's it!** The installer registers both hooks, installs dependencies, and optionally sets up a systemd service. The daemon will automatically start when you open a new Claude Code session.

### How It Works

The installer registers a **SessionStart hook** that:
1. Runs automatically when you open Claude Code
2. Checks if the daemon is already running
3. Starts the daemon in the background if it's not running

You don't need to configure systemd or any auto-start mechanism manually!

### Configuration Setup

The plugin uses a configuration file for customization. Create `~/.claude/auto-resume/config.json`:

```json
{
  "notificationSystem": "notify-send",
  "websocketPort": 3847,
  "apiPort": 3848,
  "dashboardUrl": "http://localhost:3847",
  "pluginDirectory": "~/.claude/auto-resume/plugins",
  "enableNotifications": true,
  "logLevel": "info"
}
```

**Key settings:**
- `notificationSystem`: Use `notify-send` on Linux (installed with: `sudo apt install libnotify-bin`)
- `websocketPort`: WebSocket server port for dashboard real-time updates
- `apiPort`: REST API server port for daemon communication
- `dashboardUrl`: GUI dashboard access URL (local browser)
- `pluginDirectory`: Location for custom plugins and extensions
- `enableNotifications`: Set to `false` to disable desktop notifications

### Enable Desktop Notifications

Desktop notifications require `notify-send` on Linux:

```bash
# Ubuntu/Debian
sudo apt install libnotify-bin

# Fedora
sudo dnf install libnotify

# Arch
sudo pacman -S libnotify
```

### Access the GUI Dashboard

Once the daemon is running, access the web interface:

```bash
# Open in browser automatically
xdg-open http://localhost:3847

# Or manually visit in your browser
# http://localhost:3847
```

The dashboard provides:
- Real-time daemon status and monitoring
- Session history and resume logs
- Configuration management UI
- Plugin management interface
- Performance metrics and statistics

### Plugin Directory Setup

Custom plugins are loaded from `~/.claude/auto-resume/plugins/`:

```bash
# Create plugin structure
mkdir -p ~/.claude/auto-resume/plugins/{hooks,extensions}

# Place custom plugins here
# Example: ~/.claude/auto-resume/plugins/hooks/custom-hook.js
```

Plugins are automatically discovered and loaded by the daemon. Changes are monitored via `chokidar` file watcher.

### Verify Installation (Optional)

```bash
# Check if hooks are registered
cat ~/.claude/settings.json | grep -A5 "SessionStart"

# Check daemon status
node ~/.claude/auto-resume/auto-resume-daemon.js status

# View logs
tail -20 ~/.claude/auto-resume/daemon.log

# Check API server status
curl http://localhost:3848/health

# Check WebSocket connection
curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" http://localhost:3847
```

### Test the Installation

```bash
# Run a 10-second test countdown
node ~/.claude/auto-resume/auto-resume-daemon.js --test 10
```

---

## Server Ports

The daemon runs two servers for communication and monitoring:

| Port | Service | Purpose |
|------|---------|---------|
| `3847` | WebSocket Server | Real-time updates for GUI dashboard |
| `3848` | REST API Server | Daemon control and status endpoints |

Both servers bind to `127.0.0.1` (localhost only) for security.

### Check Server Status

```bash
# Check if servers are listening
netstat -tlnp | grep -E '3847|3848'

# Alternative (on systems without netstat)
ss -tlnp | grep -E '3847|3848'
```

---

## Daemon Management

The daemon auto-starts with Claude Code, but you can manage it manually:

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

# Check API health endpoint
curl http://localhost:3848/health
```

---

## Troubleshooting

### Dashboard Not Accessible

If the GUI dashboard at `http://localhost:3847` is not accessible:

```bash
# Check if WebSocket server is running
curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" http://localhost:3847

# Check firewall (should be localhost-only, but verify)
sudo ufw status | grep 3847
sudo ufw status | grep 3848

# Restart daemon to ensure servers start
node ~/.claude/auto-resume/auto-resume-daemon.js restart

# Check daemon logs for server startup errors
tail -20 ~/.claude/auto-resume/daemon.log | grep -i "server\|port\|listen"
```

### Notifications Not Showing

If desktop notifications are not appearing:

```bash
# Verify notify-send is installed
which notify-send

# Test notification manually
notify-send "Test" "Notification from Auto Resume"

# Check daemon notification config
cat ~/.claude/auto-resume/config.json | grep -i notification

# Ensure notifications are enabled
# Edit ~/.claude/auto-resume/config.json and set "enableNotifications": true
```

### Plugin Directory Issues

If plugins are not loading:

```bash
# Verify plugin directory exists
ls -la ~/.claude/auto-resume/plugins/

# Check file permissions
stat ~/.claude/auto-resume/plugins/

# View daemon logs for plugin loading errors
grep -i "plugin\|chokidar" ~/.claude/auto-resume/daemon.log

# Manually restart daemon to reload plugins
node ~/.claude/auto-resume/auto-resume-daemon.js restart
```

### "xdotool: command not found" / Sessions Not Resuming

**Symptom:** The daemon starts and counts down correctly, but when the countdown ends, nothing happens. Your session is not resumed. The daemon log (`~/.claude/auto-resume/daemon.log`) shows:

```
ERROR: xdotool not found. Please install it:
ERROR: [TEST] Failed to send keystrokes: xdotool not found
```

**Fix:**

```bash
# Install xdotool
sudo apt-get install -y xdotool          # Ubuntu/Debian
sudo dnf install -y xdotool              # Fedora
sudo pacman -S --noconfirm xdotool       # Arch

# If sudo can't prompt for password, use GUI prompt:
pkexec apt-get install -y xdotool

# IMPORTANT: Restart the daemon after installing xdotool
# The running daemon won't detect the new binary automatically
node ~/.claude/auto-resume/auto-resume-daemon.js stop
node ~/.claude/auto-resume/auto-resume-daemon.js start
```

**Verify the fix:**
```bash
# 1. Confirm xdotool is installed
which xdotool

# 2. Confirm it can find your terminal windows
xdotool search --class "gnome-terminal"

# 3. Run the built-in test (sends keystrokes after countdown)
node ~/.claude/auto-resume/auto-resume-daemon.js --test 10

# 4. Check daemon log for success message
tail -5 ~/.claude/auto-resume/daemon.log
# Should show: [TEST] Test completed successfully!
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

### Daemon Not Auto-Starting

Check if the SessionStart hook is registered:
```bash
cat ~/.claude/settings.json | grep -A5 "SessionStart"
```

If not present, re-run `./install.sh` from the repo directory.

### Keystrokes Not Being Sent

The daemon uses `xdotool` to send keystrokes. Common issues:

1. **xdotool not installed:** See installation section above

2. **Running on Wayland:** xdotool requires X11. Try:
   ```bash
   # Run under XWayland
   GDK_BACKEND=x11 node ~/.claude/auto-resume/auto-resume-daemon.js start
   ```
   Or switch to an X11 session at login.

3. **No DISPLAY variable:**
   ```bash
   # Check current DISPLAY
   echo $DISPLAY    # Should be :0 or :1

   # Set DISPLAY if not set
   export DISPLAY=:0
   node ~/.claude/auto-resume/auto-resume-daemon.js start
   ```

   For systemd services, add `Environment=DISPLAY=:1` to the `[Service]` section of the unit file.

### Wayland Compatibility

If using Wayland (default on newer Ubuntu/Fedora), xdotool may not work. Options:

1. **Switch to X11 session** at login screen
2. **Use XWayland:**
   ```bash
   GDK_BACKEND=x11 node ~/.claude/auto-resume/auto-resume-daemon.js start
   ```
3. **Install ydotool** (Wayland alternative - requires additional setup)

### Permission Denied

```bash
chmod +x ~/.claude/hooks/rate-limit-hook.js
chmod +x ~/.claude/auto-resume/auto-resume-daemon.js
```

---

## Uninstallation

```bash
./install.sh --uninstall
```

### Complete Manual Cleanup

```bash
# Stop daemon
node ~/.claude/auto-resume/auto-resume-daemon.js stop

# Remove files
rm -rf ~/.claude/auto-resume
rm -f ~/.claude/hooks/rate-limit-hook.js
```
