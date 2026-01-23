# Auto Claude Resume

A Claude Code plugin that automatically resumes your sessions when rate limits reset.

## Features

- **Automatic Detection**: Detects rate limits without any user intervention
- **Auto-Resume**: Sends "continue" to your terminal when limits reset
- **Background Daemon**: Runs silently, always ready to resume your sessions
- **Cross-Platform**: Windows, Linux, macOS support
- **Zero Configuration**: Just install and forget

## Installation

### Method 1: Claude Code Plugin (Recommended)

**Step 1:** Add the marketplace (run in Claude Code):
```
/plugin marketplace add https://github.com/Muminur/auto-claude-resume-after-limit-reset
```

**Step 2:** Install the plugin:
```
/plugin install auto-resume
```

**Step 3:** Start the daemon (one-time):

<details>
<summary><b>Windows (PowerShell)</b></summary>

```powershell
$daemonPath = Get-ChildItem "$env:USERPROFILE\.claude\plugins\cache\*\auto-claude-resume-after-limit-reset\*\auto-resume-daemon.js" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
node $daemonPath start
```
</details>

<details>
<summary><b>macOS / Linux (Terminal)</b></summary>

```bash
daemon_path=$(find ~/.claude/plugins/cache -name "auto-resume-daemon.js" -path "*auto-claude-resume*" 2>/dev/null | head -1)
node "$daemon_path" start
```
</details>

### Method 2: Manual Installation

If you prefer manual installation, see the platform-specific guides:
- [Windows Installation](docs/INSTALL-WINDOWS.md)
- [Linux Installation](docs/INSTALL-LINUX.md)
- [macOS Installation](docs/INSTALL-MACOS.md)

## How It Works

```
┌─────────────────┐     writes      ┌──────────────────┐
│  Rate Limit     │ ───────────────►│  status.json     │
│  Detection Hook │                 │  (reset_time)    │
└─────────────────┘                 └────────┬─────────┘
                                             │ watches
                                             ▼
                                    ┌──────────────────┐
                                    │  Daemon Process  │
                                    │  (background)    │
                                    └────────┬─────────┘
                                             │ when reset_time arrives
                                             ▼
                                    ┌──────────────────┐
                                    │  Send Keystrokes │
                                    │  to Terminal     │
                                    └──────────────────┘
```

### Two Components

1. **Hook Script** (`hooks/rate-limit-hook.js`)
   - Runs automatically when Claude Code stops
   - Analyzes transcript for rate limit messages
   - Writes detection to `~/.claude/auto-resume/status.json`

2. **Daemon Service** (`auto-resume-daemon.js`)
   - Monitors for rate limit detections
   - Waits until reset time
   - Sends "continue" to terminal automatically

## Daemon Management

```bash
# Check status
node <daemon-path> status

# Stop daemon
node <daemon-path> stop

# Restart daemon
node <daemon-path> restart

# View logs
tail -f ~/.claude/auto-resume/daemon.log
```

## Daemon Auto-Start

### Windows

Add to Windows Startup:
1. Press `Win+R`, type `shell:startup`
2. Create a shortcut to the daemon start script

### Linux (systemd)

```bash
# Create user service
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/auto-resume.service << 'EOF'
[Unit]
Description=Claude Auto Resume Daemon
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/node %h/.claude/plugins/cache/Muminur/auto-claude-resume-after-limit-reset/latest/auto-resume-daemon.js start
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
EOF

# Enable and start
systemctl --user enable auto-resume
systemctl --user start auto-resume
```

### macOS (launchd)

```bash
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
        <string>~/.claude/plugins/cache/Muminur/auto-claude-resume-after-limit-reset/latest/auto-resume-daemon.js</string>
        <string>start</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
EOF

launchctl load ~/Library/LaunchAgents/com.claude.auto-resume.plist
```

## Rate Limit Detection

When Claude Code shows:
```
You've hit your limit · resets 8pm (Asia/Dhaka)
```

The plugin:
1. Detects this automatically via the Stop hook
2. Parses reset time (8pm in Asia/Dhaka timezone)
3. Daemon displays countdown
4. At reset time, sends "continue" to your terminal
5. Session resumes automatically

## Troubleshooting

### Plugin Not Showing in /plugin

Ensure you've added the marketplace first:
```
/plugin marketplace add https://github.com/Muminur/auto-claude-resume-after-limit-reset
```

Then install:
```
/plugin install auto-resume
```

### Daemon Not Starting

1. Check Node.js version (v16+ required):
   ```
   node --version
   ```

2. Check daemon status:
   ```
   node <daemon-path> status
   ```

3. Check logs:
   - **Windows:** `Get-Content "$env:USERPROFILE\.claude\auto-resume\daemon.log" -Tail 20`
   - **macOS/Linux:** `tail -20 ~/.claude/auto-resume/daemon.log`

### Hook Not Detecting Rate Limits

Verify the hook is registered in Claude Code settings:
- **Windows:** `Get-Content "$env:USERPROFILE\.claude\settings.json" | Select-String "rate-limit"`
- **macOS/Linux:** `cat ~/.claude/settings.json | grep rate-limit`

### Linux: xdotool Required

```bash
# Ubuntu/Debian
sudo apt-get install xdotool

# RHEL/CentOS
sudo yum install xdotool

# Arch
sudo pacman -S xdotool
```

## Uninstallation

```
/plugin uninstall auto-resume@Muminur/auto-claude-resume-after-limit-reset
```

Or use the manual uninstall scripts:

**Windows:**
```powershell
.\install.ps1 -Uninstall
```

**Linux/macOS:**
```bash
./install.sh --uninstall
```

## Requirements

- Claude Code CLI
- Node.js 16+
- Linux: xdotool (for keystroke sending)

## License

MIT License
