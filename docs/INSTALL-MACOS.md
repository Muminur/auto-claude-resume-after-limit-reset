# macOS Installation Guide

Complete guide for installing Auto Claude Resume on macOS (Monterey, Ventura, Sonoma, Sequoia, and later).

## Prerequisites

- macOS 12 (Monterey) or later
- Claude Code CLI installed
- Node.js 16+ ([Download](https://nodejs.org/) or use Homebrew)
- Terminal app or iTerm2

**Note:** macOS includes all required tools (`osascript`, `pbpaste`) by default.

## Core Dependencies

The following Node.js packages are automatically installed:

- **chokidar** - File system watcher for monitoring resume file changes
- **node-notifier** - Native macOS notifications (integrates with Notification Center)
- **ws** - WebSocket server for real-time dashboard updates

These are installed automatically during setup and do not require manual configuration.

---

## Installation

Clone the repository and run the installer:

```bash
git clone https://github.com/Muminur/auto-claude-resume-after-limit-reset.git
cd auto-claude-resume-after-limit-reset
chmod +x install.sh
./install.sh
```

**That's it!** The installer registers both hooks, installs dependencies, and the daemon will automatically start when you open a new Claude Code session.

### How It Works

The installer registers a **SessionStart hook** that:
1. Runs automatically when you open Claude Code
2. Checks if the daemon is already running
3. Starts the daemon in the background if it's not running

You don't need to configure launchd or any auto-start mechanism manually!

## Configuration and Setup

### Configuration File

The daemon stores its configuration at:
```
~/.claude/auto-resume/config.json
```

During installation, this file is created automatically with default settings. You can customize:

```json
{
  "checkInterval": 5000,
  "notificationsEnabled": true,
  "dashboardPort": 3848,
  "apiServerPort": 3847,
  "pluginDirectory": "~/.claude/auto-resume/plugins/",
  "logLevel": "info"
}
```

**Configuration Options:**
- `checkInterval` - How often to check for rate limit (milliseconds)
- `notificationsEnabled` - Enable macOS notifications
- `dashboardPort` - Web dashboard port (default: 3848)
- `apiServerPort` - REST API server port (default: 3847)
- `pluginDirectory` - Location for custom plugins
- `logLevel` - Logging verbosity (debug, info, warn, error)

### Plugin Directory Setup

The daemon supports custom plugins. Create the plugins directory:

```bash
mkdir -p ~/.claude/auto-resume/plugins/
```

Place custom plugin files (JavaScript) in this directory. The daemon will auto-load them on startup.

### Notification Setup (Native macOS Notifications)

The daemon integrates with macOS Notification Center via `node-notifier`. Notifications are enabled by default and include:

- **Rate limit detected** - Notifies when a rate limit is triggered
- **Resume successful** - Confirms successful resume action
- **Daemon started** - Indicates daemon is running

To configure notifications in macOS:

1. Open **System Settings** > **Notifications**
2. Find **Node.js** in the list
3. Ensure **Allow Notifications** is enabled
4. Choose your preferred notification style (banners or alerts)

If notifications are not appearing, verify Node.js accessibility permissions are granted (see below).

### API Server and Dashboard Access

The daemon runs two servers on fixed ports:

- **API Server:** `http://localhost:3847`
- **Dashboard:** `http://localhost:3848`

#### Web Dashboard

Access the GUI dashboard in your browser:
```
http://localhost:3848
```

The dashboard provides:
- Real-time daemon status
- Resume history and logs
- Configuration editing
- Plugin management
- Performance metrics

#### REST API

Interact with the daemon via REST API (port 3847):

```bash
# Check daemon status
curl http://localhost:3847/status

# Get resume history
curl http://localhost:3847/history

# View current config
curl http://localhost:3847/config
```

See [API Documentation](./API.md) for complete endpoint reference.

### Grant Accessibility Permissions (Required)

**Critical:** The daemon sends keystrokes using `osascript` and accesses the clipboard. You must grant accessibility permissions to **Node.js**.

#### Why Accessibility Permissions Are Needed

- `osascript` - Sends keystroke sequences to simulate "continue" + Enter
- Clipboard access - Reads/writes to pasteboard
- Event simulation - Requires system event access

#### Step-by-Step Instructions

1. Find your Node.js binary path:
   ```bash
   which node
   # Usually: /usr/local/bin/node or /opt/homebrew/bin/node

   # If it's a symlink, get the real path:
   realpath $(which node)
   # Example: /usr/local/Cellar/node/20.0.0/bin/node
   ```

2. Open **System Settings** > **Privacy & Security** > **Accessibility**

3. Click the **lock icon** to make changes (enter password)

4. Click the **+** button

5. Press **Cmd+Shift+G** and paste the Node.js path (e.g., `/usr/local/Cellar/node/20.0.0/bin/`)

6. Select **node** and click **Open**

7. Ensure the **checkbox is enabled** next to node

#### Verify Accessibility Permissions

```bash
# List applications with accessibility permissions
system_profiler SPConfigurationProfileDataType | grep -A 5 "Accessibility"

# Or check Terminal for accessibility status
cat ~/Library/Preferences/com.apple.universalaccessAuthWarning.plist
```

### Verify Installation (Optional)

```bash
# Check if hooks are registered
cat ~/.claude/settings.json | grep -A5 "SessionStart"

# Check daemon status
node ~/.claude/auto-resume/auto-resume-daemon.js status

# Check configuration file exists
cat ~/.claude/auto-resume/config.json

# Verify plugin directory
ls -la ~/.claude/auto-resume/plugins/

# Check WebSocket and API servers are running
netstat -an | grep -E '3847|3848'

# View logs
tail -20 ~/.claude/auto-resume/daemon.log
```

### Test the Installation

```bash
# Run a 10-second test countdown
# WARNING: This will type "continue" + Enter after 10 seconds!
node ~/.claude/auto-resume/auto-resume-daemon.js --test 10
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
```

---

## Troubleshooting

### Keystrokes Not Being Sent

**Error:** `osascript is not allowed to send keystrokes (1002)` or similar

**Solution:** Grant accessibility permissions to Node.js (not Terminal):

1. Find the real Node.js path:
   ```bash
   realpath $(which node)
   ```

2. Go to **System Settings** > **Privacy & Security** > **Accessibility**

3. Add the Node.js binary (e.g., `/usr/local/Cellar/node/20.0.0/bin/node`)

4. Restart the daemon:
   ```bash
   node ~/.claude/auto-resume/auto-resume-daemon.js restart
   ```

### Node.js Not Found

**Install via Homebrew:**
```bash
brew install node
```

**Or download from:** https://nodejs.org/

**Verify installation:**
```bash
node --version  # Must be 16+
```

### For Apple Silicon (M1/M2/M3/M4) Macs

Ensure you have native ARM64 Node.js:

```bash
# Install native Node.js for ARM64 via Homebrew
arch -arm64 brew install node

# Verify architecture
file $(which node)
# Should show: Mach-O 64-bit executable arm64
```

### Daemon Not Auto-Starting

Check if the SessionStart hook is registered:
```bash
cat ~/.claude/settings.json | grep -A5 "SessionStart"
```

If not present, re-run `./install.sh` from the repo directory.

### Dashboard or API Server Not Accessible

**Error:** Cannot connect to `http://localhost:3847` or `http://localhost:3848`

**Solution:**

1. Verify daemon is running:
   ```bash
   node ~/.claude/auto-resume/auto-resume-daemon.js status
   ```

2. Check ports are not in use:
   ```bash
   lsof -i :3847
   lsof -i :3848
   ```

3. If ports are occupied, modify `config.json`:
   ```bash
   nano ~/.claude/auto-resume/config.json
   # Change dashboardPort and apiServerPort to available ports
   ```

4. Restart daemon:
   ```bash
   node ~/.claude/auto-resume/auto-resume-daemon.js restart
   ```

### Notifications Not Appearing

**Solution:**

1. Verify `notificationsEnabled` is `true` in config:
   ```bash
   cat ~/.claude/auto-resume/config.json | grep notificationsEnabled
   ```

2. Check Node.js notification permissions:
   - **System Settings** > **Notifications**
   - Find **Node.js** in the list
   - Ensure **Allow Notifications** is enabled

3. Grant accessibility permissions (see "Grant Accessibility Permissions" section)

4. Restart daemon:
   ```bash
   node ~/.claude/auto-resume/auto-resume-daemon.js restart
   ```

### Permission Denied

```bash
chmod +x ~/.claude/hooks/rate-limit-hook.js
chmod +x ~/.claude/auto-resume/auto-resume-daemon.js
```

### Hook Not Detecting Rate Limits

```bash
# Verify hook is configured
cat ~/.claude/settings.json | grep rate-limit-hook

# Check hook exists
ls -la ~/.claude/hooks/rate-limit-hook.js
```

---

## Uninstallation

```bash
./install.sh --uninstall
```

### Complete Cleanup

```bash
# Stop daemon
node ~/.claude/auto-resume/auto-resume-daemon.js stop

# Remove all installation files and data
rm -rf ~/.claude/auto-resume
rm -f ~/.claude/hooks/rate-limit-hook.js

# Remove Node.js from Accessibility (System Settings)
# Go to System Settings > Privacy & Security > Accessibility
# Find Node.js and click the remove (-) button
```

---

## Next Steps

After successful installation:

1. **Access the Dashboard** - Open `http://localhost:3848` in your browser
2. **Review Configuration** - Check `~/.claude/auto-resume/config.json`
3. **Set Up Custom Plugins** (optional) - Add scripts to `~/.claude/auto-resume/plugins/`
4. **Read the API Documentation** - See [API.md](./API.md) for available endpoints

For additional support, see the [Troubleshooting Guide](#troubleshooting) or open an issue on GitHub.
