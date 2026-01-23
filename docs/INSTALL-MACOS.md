# macOS Installation Guide

Complete guide for installing Auto Claude Resume on macOS (Monterey, Ventura, Sonoma, and later).

## Prerequisites

- macOS 12 (Monterey) or later
- Terminal app or iTerm2
- Node.js 16+ (required for daemon mode)

**Note:** macOS includes all required tools (`osascript`, `pbpaste`) by default.

## Quick Install (Recommended)

The automated installer handles everything for you:

```bash
# Clone the repository
git clone https://github.com/Muminur/auto-claude-resume-after-limit-reset.git
cd auto-claude-resume-after-limit-reset

# Run the installer
./install.sh
```

The installer automatically:
- Creates `~/.claude/hooks/` and `~/.claude/auto-resume/` directories
- Deploys the rate limit detection hook
- Deploys the auto-resume daemon
- Installs npm dependencies
- Updates `~/.claude/settings.json` with hook configuration
- Sets up launchd for auto-start on login

### After Installation: Grant Accessibility Permissions

**Critical:** The daemon runs as a Node.js process, so you must grant accessibility permissions to **Node.js** (not Terminal).

1. Find your Node.js binary path:
   ```bash
   which node
   # Usually: /usr/local/bin/node

   # If it's a symlink, get the real path:
   realpath $(which node)
   # Example: /usr/local/Cellar/node/24.5.0/bin/node
   ```

2. Open **System Settings** > **Privacy & Security** > **Accessibility**

3. Click the **lock icon** to make changes

4. Click the **+** button

5. Press **Cmd+Shift+G** and paste the Node.js path (e.g., `/usr/local/Cellar/node/24.5.0/bin/`)

6. Select **node** and click **Open**

7. Ensure the **checkbox is enabled** next to node

### Verify Installation

```bash
# Check daemon status
node ~/.claude/auto-resume/auto-resume-daemon.js status

# Test keystroke functionality (will type "continue" + Enter in ~15 seconds)
# Make sure you're ready - this will send keystrokes to Terminal!
RESET_TIME=$(date -u -v+15S +"%Y-%m-%dT%H:%M:%S.000Z")
echo "{\"detected\": true, \"reset_time\": \"$RESET_TIME\", \"message\": \"TEST\", \"timezone\": \"UTC\"}" > ~/.claude/auto-resume/status.json

# Watch the log
tail -f ~/.claude/auto-resume/daemon.log
```

If you see `[SUCCESS] Sent: 'continue' + Enter to terminal windows`, the installation is complete.

---

## Manual Installation (Alternative)

If you prefer manual setup or the automated installer doesn't work:

### Step 1: Download the Plugin

#### Option A: Clone with Git
```bash
git clone https://github.com/Muminur/auto-claude-resume-after-limit-reset.git
cd auto-claude-resume-after-limit-reset
```

#### Option B: Download with curl
```bash
curl -L https://github.com/Muminur/auto-claude-resume-after-limit-reset/archive/main.zip -o auto-resume.zip
unzip auto-resume.zip
cd auto-claude-resume-after-limit-reset-main
```

#### Option C: Download from Browser
1. Go to https://github.com/Muminur/auto-claude-resume-after-limit-reset
2. Click "Code" > "Download ZIP"
3. Extract and open Terminal in that folder

### Step 2: Create Directory Structure

```bash
mkdir -p ~/.claude/hooks
mkdir -p ~/.claude/auto-resume
```

### Step 3: Copy Files

```bash
cp src/hooks/rate-limit-hook.js ~/.claude/hooks/
cp src/daemon/auto-resume-daemon.js ~/.claude/auto-resume/
cp src/daemon/package.json ~/.claude/auto-resume/
chmod +x ~/.claude/hooks/rate-limit-hook.js
chmod +x ~/.claude/auto-resume/auto-resume-daemon.js
```

### Step 4: Install Dependencies

```bash
cd ~/.claude/auto-resume
npm install --production
```

### Step 5: Configure Claude Code Hook

Edit `~/.claude/settings.json` to add the Stop hook:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.claude/hooks/rate-limit-hook.js",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

### Step 6: Set Up launchd for Auto-Start

Create `~/Library/LaunchAgents/com.claude.auto-resume.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.claude.auto-resume</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/Users/YOUR_USERNAME/.claude/auto-resume/auto-resume-daemon.js</string>
        <string>start</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Users/YOUR_USERNAME/.claude/auto-resume/daemon.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/YOUR_USERNAME/.claude/auto-resume/daemon-error.log</string>
    <key>WorkingDirectory</key>
    <string>/Users/YOUR_USERNAME/.claude/auto-resume</string>
</dict>
</plist>
```

**Important:** Replace `YOUR_USERNAME` with your actual username, and update the node path if different.

Load the service:
```bash
launchctl load ~/Library/LaunchAgents/com.claude.auto-resume.plist
```

### Step 7: Grant Accessibility Permissions to Node.js

See the "Grant Accessibility Permissions" section above.

---

## Shell Script Usage (Standalone)

For manual/interactive use without the daemon:

### Make Script Executable

```bash
chmod +x claude-auto-resume.sh
```

### Run the Script

```bash
./claude-auto-resume.sh
```

When prompted, select:
1. **Interactive Mode** - Paste messages directly
2. **Clipboard Monitor** - Monitors clipboard for rate limit messages
3. **Test Mode** - Test with 30-second countdown

### Usage Examples

```bash
# Interactive menu
./claude-auto-resume.sh

# Interactive mode directly
./claude-auto-resume.sh -i

# Clipboard monitoring
./claude-auto-resume.sh -m

# Test with 10-second countdown
./claude-auto-resume.sh -t 10

# Custom prompt
./claude-auto-resume.sh -i -p "please continue with the task"
```

---

## Daemon Management

### Commands

```bash
# Check status
node ~/.claude/auto-resume/auto-resume-daemon.js status

# Stop daemon
node ~/.claude/auto-resume/auto-resume-daemon.js stop

# Restart daemon
node ~/.claude/auto-resume/auto-resume-daemon.js restart

# View logs
tail -f ~/.claude/auto-resume/daemon.log
```

### How It Works

1. **Hook Detection:** When Claude Code stops, the `rate-limit-hook.js` analyzes the session
2. **Status File:** If a rate limit is detected, it writes to `~/.claude/auto-resume/status.json`
3. **Daemon Monitoring:** The daemon watches the status file for changes
4. **Countdown:** When a rate limit is detected, the daemon shows a countdown timer
5. **Auto-Resume:** When the reset time arrives, the daemon sends "continue" + Enter keystrokes

---

## Troubleshooting

### Keystrokes Not Being Sent (Daemon)

**Error:** `osascript is not allowed to send keystrokes (1002)`

**Solution:** Grant accessibility permissions to Node.js, not Terminal:

1. Find Node.js path: `realpath $(which node)`
2. System Settings > Privacy & Security > Accessibility
3. Add the Node.js binary (e.g., `/usr/local/Cellar/node/24.5.0/bin/node`)
4. Restart the daemon: `node ~/.claude/auto-resume/auto-resume-daemon.js restart`

### Daemon Not Starting

```bash
# Check if launchd service is loaded
launchctl list | grep claude

# Check daemon log for errors
cat ~/.claude/auto-resume/daemon.log

# Verify Node.js version
node --version  # Requires v16+
```

### "Permission Denied"

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

### For Apple Silicon (M1/M2/M3) Macs

The daemon is compatible with Apple Silicon. Ensure you have native ARM64 Node.js:

```bash
# Install native Node.js for ARM64
arch -arm64 brew install node

# Verify architecture
file $(which node)
# Should show: Mach-O 64-bit executable arm64
```

---

## Uninstallation

### Using the Installer

```bash
./install.sh --uninstall
```

### Manual Uninstallation

```bash
# Stop and remove launchd service
launchctl unload ~/Library/LaunchAgents/com.claude.auto-resume.plist
rm ~/Library/LaunchAgents/com.claude.auto-resume.plist

# Remove plugin files
rm -rf ~/.claude/auto-resume
rm ~/.claude/hooks/rate-limit-hook.js

# Remove hook from settings.json (edit manually)
# Remove the "Stop" hook entry from ~/.claude/settings.json
```
