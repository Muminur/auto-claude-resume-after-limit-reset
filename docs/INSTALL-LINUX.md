# Linux Installation Guide

Complete guide for installing Auto Claude Resume on Linux (Ubuntu, Debian, Fedora, Arch, etc.).

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

## Method 1: Claude Code Plugin (Recommended)

This is the easiest installation method. Just two steps!

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

### Step 2: Create Configuration Directory

```bash
mkdir -p ~/.claude/auto-resume
mkdir -p ~/.claude/auto-resume/plugins
```

### Step 3: Add the Marketplace

Open Claude Code and run:
```
/plugin marketplace add https://github.com/Muminur/auto-claude-resume-after-limit-reset
```

### Step 4: Install the Plugin

```
/plugin install auto-resume
```

**That's it!** The daemon will automatically start when you open a new Claude Code session.

### How It Works

The plugin registers a **SessionStart hook** that:
1. Runs automatically when you open Claude Code
2. Checks if the daemon is already running
3. Starts the daemon in the background if it's not running

You don't need to configure systemd or any auto-start mechanism - the plugin handles everything!

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

The manual installer will set up hooks and optionally configure systemd for you.

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

### Daemon Not Auto-Starting

Check if the SessionStart hook is registered:
```bash
cat ~/.claude/settings.json | grep -A5 "SessionStart"
```

If not present, try reinstalling the plugin.

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
   export DISPLAY=:0
   node ~/.claude/auto-resume/auto-resume-daemon.js start
   ```

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

# Remove files
rm -rf ~/.claude/auto-resume
rm -f ~/.claude/hooks/rate-limit-hook.js
```
