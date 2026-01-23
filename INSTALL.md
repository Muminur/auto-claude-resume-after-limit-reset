# Installation Guide

This guide covers all installation methods for the Auto Claude Resume plugin.

---

## Quick Install via Plugin (All Platforms)

Steps 1 and 2 are **identical** for Windows, macOS, and Linux.

### Step 1: Add the Marketplace

In Claude Code, run:
```
/plugin marketplace add https://github.com/Muminur/auto-claude-resume-after-limit-reset
```

### Step 2: Install the Plugin

```
/plugin install auto-resume
```

### Step 3: Start the Daemon

The plugin installs hooks automatically, but you need to start the background daemon.

#### Windows (PowerShell)

```powershell
# Find and start the daemon
$daemonPath = Get-ChildItem "$env:USERPROFILE\.claude\plugins\cache\*\auto-claude-resume-after-limit-reset\*\auto-resume-daemon.js" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
node $daemonPath start
```

#### macOS (Terminal)

```bash
# Find and start the daemon
daemon_path=$(find ~/.claude/plugins/cache -name "auto-resume-daemon.js" -path "*auto-claude-resume*" 2>/dev/null | head -1)
node "$daemon_path" start
```

#### Linux (Terminal)

```bash
# Find and start the daemon
daemon_path=$(find ~/.claude/plugins/cache -name "auto-resume-daemon.js" -path "*auto-claude-resume*" 2>/dev/null | head -1)
node "$daemon_path" start
```

### Step 4: Verify Installation

#### Windows (PowerShell)

```powershell
# Check if hooks are registered
Get-Content "$env:USERPROFILE\.claude\settings.json" | Select-String "rate-limit"

# Check daemon status (use the path from Step 3)
node $daemonPath status

# View logs
Get-Content "$env:USERPROFILE\.claude\auto-resume\daemon.log" -Tail 20
```

#### macOS / Linux (Terminal)

```bash
# Check if hooks are registered
cat ~/.claude/settings.json | grep -A5 "Stop"

# Check daemon status (use the path from Step 3)
node "$daemon_path" status

# View logs
tail -20 ~/.claude/auto-resume/daemon.log
```

---

## Manual Installation (Alternative)

If you prefer not to use the plugin system, use the platform-specific installers.

### Windows

```powershell
# Clone the repository
git clone https://github.com/Muminur/auto-claude-resume-after-limit-reset.git
cd auto-claude-resume-after-limit-reset

# Run the installer
powershell -ExecutionPolicy Bypass -File install.ps1
```

### macOS

```bash
# Clone the repository
git clone https://github.com/Muminur/auto-claude-resume-after-limit-reset.git
cd auto-claude-resume-after-limit-reset

# Make installer executable and run
chmod +x install.sh
./install.sh
```

### Linux

```bash
# Clone the repository
git clone https://github.com/Muminur/auto-claude-resume-after-limit-reset.git
cd auto-claude-resume-after-limit-reset

# Install xdotool (required for keystroke sending)
# Ubuntu/Debian:
sudo apt-get install xdotool
# RHEL/CentOS:
sudo yum install xdotool
# Arch:
sudo pacman -S xdotool

# Make installer executable and run
chmod +x install.sh
./install.sh
```

---

## Setting Up Auto-Start (Optional)

To have the daemon start automatically when you log in:

### Windows

**Option 1: Startup Folder**
1. Press `Win+R` and type `shell:startup`
2. Create a new shortcut with target:
   ```
   powershell.exe -WindowStyle Hidden -Command "node 'C:\Users\YOUR_USERNAME\.claude\auto-resume\auto-resume-daemon.js' start"
   ```
   (Replace `YOUR_USERNAME` with your actual username)

**Option 2: Use installer script**
The manual installer creates a startup script at:
```
%USERPROFILE%\.claude\auto-resume\start-daemon.ps1
```

### macOS (launchd)

```bash
# Create the plist file
cat > ~/Library/LaunchAgents/com.claude.auto-resume.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.claude.auto-resume</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>~/.claude/auto-resume/auto-resume-daemon.js</string>
        <string>start</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
EOF

# Load the service
launchctl load ~/Library/LaunchAgents/com.claude.auto-resume.plist
```

**Note:** Adjust the node path if using nvm or homebrew (`which node` to find your path).

### Linux (systemd)

```bash
# Create the systemd user service
mkdir -p ~/.config/systemd/user

cat > ~/.config/systemd/user/claude-auto-resume.service << 'EOF'
[Unit]
Description=Claude Auto Resume Daemon
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/node %h/.claude/auto-resume/auto-resume-daemon.js start
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
EOF

# Reload, enable, and start
systemctl --user daemon-reload
systemctl --user enable claude-auto-resume
systemctl --user start claude-auto-resume

# Check status
systemctl --user status claude-auto-resume
```

---

## Uninstallation

### Plugin Method (All Platforms)

```
/plugin uninstall auto-resume
```

### Manual Method

#### Windows
```powershell
powershell -ExecutionPolicy Bypass -File install.ps1 -Uninstall
```

#### macOS / Linux
```bash
./install.sh --uninstall
```

---

## Testing

After installation, verify everything works:

### Windows (PowerShell)
```powershell
# Test with 10-second countdown
node $daemonPath --test 10
```

### macOS / Linux (Terminal)
```bash
# Test with 10-second countdown
node "$daemon_path" --test 10
```

---

## Platform-Specific Requirements

| Platform | Requirements |
|----------|--------------|
| **Windows** | Node.js 16+, PowerShell 5.1+ |
| **macOS** | Node.js 16+, Terminal access |
| **Linux** | Node.js 16+, xdotool (for keystroke sending) |

---

## Detailed Platform Guides

For more detailed instructions:

- [Windows Detailed Guide](docs/INSTALL-WINDOWS.md)
- [Linux Detailed Guide](docs/INSTALL-LINUX.md)
- [macOS Detailed Guide](docs/INSTALL-MACOS.md)
