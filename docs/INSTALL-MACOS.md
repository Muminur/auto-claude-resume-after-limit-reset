# macOS Installation Guide

Complete guide for installing Auto Claude Resume on macOS (Monterey, Ventura, Sonoma, and later).

## Prerequisites

- macOS 12 (Monterey) or later
- Terminal app or iTerm2
- Node.js 16+ (optional, for Node.js version)

**Note:** macOS includes all required tools (`osascript`, `pbpaste`) by default.

## Step 1: Download the Plugin

### Option A: Clone with Git
```bash
git clone https://github.com/Muminur/auto-claude-resume-after-limit-reset.git
cd auto-claude-resume-after-limit-reset
```

### Option B: Download with curl
```bash
curl -L https://github.com/Muminur/auto-claude-resume-after-limit-reset/archive/main.zip -o auto-resume.zip
unzip auto-resume.zip
cd auto-claude-resume-after-limit-reset-main
```

### Option C: Download from Browser
1. Go to https://github.com/Muminur/auto-claude-resume-after-limit-reset
2. Click "Code" > "Download ZIP"
3. Extract and open Terminal in that folder

## Step 2: Make Script Executable

```bash
chmod +x claude-auto-resume.sh
```

## Step 3: Grant Accessibility Permissions

**Important:** For the script to send keystrokes, you need to grant Terminal accessibility permissions.

1. Open **System Preferences** (or **System Settings** on Ventura+)
2. Go to **Privacy & Security** > **Accessibility**
3. Click the lock icon to make changes
4. Add **Terminal** (or **iTerm2**) to the list
5. Ensure it's checked/enabled

## Step 4: Run the Script

```bash
./claude-auto-resume.sh
```

When prompted, select:
1. **Interactive Mode** - Paste messages directly
2. **Clipboard Monitor** - Monitors clipboard for rate limit messages
3. **Test Mode** - Test with 30-second countdown

## Usage Examples

### Basic Usage
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

### Node.js Usage (Alternative)
```bash
# Install Node.js via Homebrew
brew install node

# Or download from nodejs.org

# Run with Node.js
node index.js -i
```

## Claude Code Plugin Setup

### Step 1: Create Plugin Directory

```bash
mkdir -p ~/.claude/plugins/auto-resume
```

### Step 2: Copy Files

```bash
cp -r ./* ~/.claude/plugins/auto-resume/
chmod +x ~/.claude/plugins/auto-resume/claude-auto-resume.sh
```

### Step 3: Add to PATH (Optional)

Add to your `~/.zshrc` (or `~/.bash_profile` for older macOS):
```bash
export PATH="$PATH:$HOME/.claude/plugins/auto-resume"
alias claude-resume="~/.claude/plugins/auto-resume/claude-auto-resume.sh"
```

Then reload:
```bash
source ~/.zshrc
```

### Step 4: Create Claude Code Hook

Create or edit `~/.claude/settings.json`:
```json
{
  "hooks": {
    "on_rate_limit": {
      "command": "~/.claude/plugins/auto-resume/claude-auto-resume.sh -m"
    }
  }
}
```

## Running Alongside Claude Code

### Option 1: Separate Terminal Tab

1. Open Terminal
2. Press Cmd+T for new tab
3. Run auto-resume in the new tab:
   ```bash
   ./claude-auto-resume.sh -m
   ```
4. Switch tabs with Cmd+Shift+[ or Cmd+Shift+]
5. When Claude Code hits rate limit, copy the message

### Option 2: Split Terminal (iTerm2)

1. Open iTerm2
2. Split horizontally: Cmd+D
3. Run Claude Code in one pane
4. Run auto-resume in the other:
   ```bash
   ./claude-auto-resume.sh -m
   ```
5. Switch panes with Cmd+[ or Cmd+]

### Option 3: tmux (Advanced)

```bash
# Install tmux if needed
brew install tmux

# Start tmux
tmux

# Split horizontally
Ctrl+b %

# Run Claude Code in left pane
# In right pane:
./claude-auto-resume.sh -m

# Switch panes with Ctrl+b arrow keys
```

## Creating an App (Optional)

### Using Automator

1. Open **Automator**
2. Create new **Application**
3. Add "Run Shell Script" action
4. Enter:
   ```bash
   ~/.claude/plugins/auto-resume/claude-auto-resume.sh -m
   ```
5. Save as "Claude Auto Resume.app" to Applications

### Using AppleScript

Create `~/Applications/Claude Auto Resume.app`:

1. Open **Script Editor**
2. Enter:
   ```applescript
   tell application "Terminal"
       activate
       do script "~/.claude/plugins/auto-resume/claude-auto-resume.sh -m"
   end tell
   ```
3. Export as Application

## Troubleshooting

### "Permission Denied"
```bash
chmod +x claude-auto-resume.sh
```

### Keystrokes Not Being Sent

1. **Grant Accessibility Permissions:**
   - System Settings > Privacy & Security > Accessibility
   - Add and enable Terminal/iTerm2

2. **Check System Events:**
   - System Settings > Privacy & Security > Automation
   - Enable Terminal to control System Events

### "Operation not permitted"

This is a security feature. You need to:
1. Open System Settings
2. Go to Privacy & Security > Accessibility
3. Add your Terminal app
4. Toggle it ON

### Script Not Responding to Clipboard

Check that clipboard tools work:
```bash
# Test clipboard
echo "test" | pbcopy
pbpaste
```

### For Apple Silicon (M1/M2/M3) Macs

The script is compatible with Apple Silicon. If using Node.js:
```bash
# Install native Node.js for ARM64
arch -arm64 brew install node
```

### Testing the Installation

```bash
# Verify script runs
./claude-auto-resume.sh -h

# Quick countdown test
./claude-auto-resume.sh -t 5
```

## Launch at Login (Optional)

### Using Login Items

1. Open System Settings > General > Login Items
2. Click + under "Open at Login"
3. Navigate to your Automator app (if created)
4. Add it

### Using launchd

Create `~/Library/LaunchAgents/com.claude.autoresume.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.claude.autoresume</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>-c</string>
        <string>~/.claude/plugins/auto-resume/claude-auto-resume.sh -m</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
</dict>
</plist>
```

Load with:
```bash
launchctl load ~/Library/LaunchAgents/com.claude.autoresume.plist
```

## Uninstallation

```bash
# Remove plugin files
rm -rf ~/.claude/plugins/auto-resume

# Remove from PATH (edit ~/.zshrc)
# Remove the export and alias lines

# Remove launchd service (if created)
launchctl unload ~/Library/LaunchAgents/com.claude.autoresume.plist
rm ~/Library/LaunchAgents/com.claude.autoresume.plist

# Remove Automator app (if created)
rm -rf ~/Applications/Claude\ Auto\ Resume.app
```
