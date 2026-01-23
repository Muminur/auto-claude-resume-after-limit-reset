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

This is the easiest installation method. Just two steps!

### Step 1: Add the Marketplace

Open Claude Code and run:
```
/plugin marketplace add https://github.com/Muminur/auto-claude-resume-after-limit-reset
```

### Step 2: Install the Plugin

```
/plugin install auto-resume
```

**That's it!** The daemon will automatically start when you open a new Claude Code session.

### How It Works

The plugin registers a **SessionStart hook** that:
1. Runs automatically when you open Claude Code
2. Checks if the daemon is already running
3. Starts the daemon in the background if it's not running

You don't need to configure launchd or any auto-start mechanism - the plugin handles everything!

### Grant Accessibility Permissions (Required)

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

### Verify Installation (Optional)

```bash
# Check if hooks are registered
cat ~/.claude/settings.json | grep -A5 "SessionStart"

# Check daemon status
node ~/.claude/auto-resume/auto-resume-daemon.js status

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

The manual installer will set up hooks and optionally configure launchd for you.

### Step 4: Grant Accessibility Permissions

See the "Grant Accessibility Permissions" section above.

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

### Daemon Not Auto-Starting

Check if the SessionStart hook is registered:
```bash
cat ~/.claude/settings.json | grep -A5 "SessionStart"
```

If not present, try reinstalling the plugin.

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

# Optionally remove Node.js from Accessibility (System Settings)
```
