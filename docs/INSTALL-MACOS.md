# macOS Installation Guide

Complete guide for installing Auto Claude Resume on macOS (Monterey, Ventura, Sonoma, Sequoia, and later).

## Prerequisites

- macOS 12 (Monterey) or later
- Claude Code CLI installed
- Node.js 16+ ([Download](https://nodejs.org/) or use Homebrew)
- Terminal app or iTerm2

**Note:** macOS includes all required tools (`osascript`, `pbpaste`) by default.

---

## Method 1: Claude Code Plugin (Recommended)

This is the easiest and recommended installation method.

### Step 1: Add the Marketplace

Open Claude Code and run:
```
/plugin marketplace add https://github.com/Muminur/auto-claude-resume-after-limit-reset
```

### Step 2: Install the Plugin

```
/plugin install auto-resume
```

### Step 3: Start the Daemon

Open Terminal and run:

```bash
# Find the daemon path
daemon_path=$(find ~/.claude/plugins/cache -name "auto-resume-daemon.js" -path "*auto-claude-resume*" 2>/dev/null | head -1)

# Verify it was found
echo "Daemon path: $daemon_path"

# Start the daemon
node "$daemon_path" start
```

### Step 4: Grant Accessibility Permissions

**Critical:** The daemon sends keystrokes using `osascript`. You must grant accessibility permissions to **Node.js**.

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
# WARNING: This will type "continue" + Enter after 10 seconds!
node "$daemon_path" --test 10
```

---

## Setting Up Auto-Start on Login (launchd)

To have the daemon start automatically when you log in:

### Create launchd Service

```bash
# Find your Node.js path
NODE_PATH=$(which node)
echo "Node path: $NODE_PATH"

# Create the plist file
cat > ~/Library/LaunchAgents/com.claude.auto-resume.plist << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.claude.auto-resume</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NODE_PATH</string>
        <string>$HOME/.claude/auto-resume/auto-resume-daemon.js</string>
        <string>start</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$HOME/.claude/auto-resume/daemon.log</string>
    <key>StandardErrorPath</key>
    <string>$HOME/.claude/auto-resume/daemon-error.log</string>
    <key>WorkingDirectory</key>
    <string>$HOME/.claude/auto-resume</string>
</dict>
</plist>
EOF

# Load the service
launchctl load ~/Library/LaunchAgents/com.claude.auto-resume.plist
```

### Manage the Service

```bash
# Check if running
launchctl list | grep claude

# Stop
launchctl unload ~/Library/LaunchAgents/com.claude.auto-resume.plist

# Start
launchctl load ~/Library/LaunchAgents/com.claude.auto-resume.plist

# Restart (unload then load)
launchctl unload ~/Library/LaunchAgents/com.claude.auto-resume.plist
launchctl load ~/Library/LaunchAgents/com.claude.auto-resume.plist
```

---

## Method 2: Manual Installation (Alternative)

If the plugin method doesn't work, use manual installation.

### Step 1: Install Node.js

**Option A: Homebrew (Recommended)**
```bash
brew install node
```

**Option B: Official Installer**
Download from https://nodejs.org/

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

### Step 4: Grant Accessibility Permissions

See Step 4 in the plugin installation section above.

### Step 5: Start Daemon

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

### Daemon Not Starting

```bash
# Check if already running
pgrep -f "auto-resume-daemon"

# Check Node.js version
node --version

# Check logs for errors
cat ~/.claude/auto-resume/daemon.log
```

### launchd Service Not Working

```bash
# Check if loaded
launchctl list | grep claude

# Check for errors
cat ~/Library/LaunchAgents/com.claude.auto-resume.plist

# Verify plist syntax
plutil -lint ~/Library/LaunchAgents/com.claude.auto-resume.plist

# Check daemon error log
cat ~/.claude/auto-resume/daemon-error.log
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

### Test the Installation

```bash
# Verify Node.js
node --version

# Quick test with 5-second countdown
# WARNING: This will type in Terminal!
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
# Stop and remove launchd service
launchctl unload ~/Library/LaunchAgents/com.claude.auto-resume.plist
rm ~/Library/LaunchAgents/com.claude.auto-resume.plist

# Stop daemon
node ~/.claude/auto-resume/auto-resume-daemon.js stop

# Remove files
rm -rf ~/.claude/auto-resume
rm -f ~/.claude/hooks/rate-limit-hook.js

# Optionally remove Node.js from Accessibility (System Settings)
```
