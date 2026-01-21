# Auto Claude Resume After Limit Reset

Automatically resume Claude Code terminal sessions when rate limits reset. This plugin detects rate limits without user intervention and automatically resumes your session when the limit lifts.

## Overview

This is an automatic plugin that seamlessly detects Claude Code rate limits and handles resume without requiring any manual action. When Claude Code hits a rate limit, the system automatically:

1. Detects the rate limit in the session transcript
2. Parses the reset time and timezone
3. Waits until the reset time arrives
4. Automatically sends "continue" to resume your session

No user intervention needed - it all happens automatically in the background.

## Features

- Automatic rate limit detection (no manual intervention)
- Hook-based detection that runs after every Claude Code session
- Background daemon service for always-on monitoring
- Countdown timer display while waiting for reset
- Parses reset time from various timezone formats (40+ timezones)
- Cross-platform: Windows, Linux, macOS
- Optional manual modes also available
- Can be installed as a Claude Code plugin
- Graceful shutdown and process management

## How It Works

The automatic system uses a two-part architecture:

### 1. Hook Script (rate-limit-hook.js)

A Claude Code hook that automatically runs after every session stops:
- Analyzes the session transcript for rate limit messages
- Extracts the reset time and timezone information
- Writes detection results to `~/.claude/auto-resume/status.json`
- No user interaction required - runs automatically

**Key detection patterns:**
- "You've hit your limit" messages
- "rate limit exceeded" errors
- "try again in X minutes/hours" messages
- ISO timestamp formats
- JSON error responses with rate_limit_error type

### 2. Daemon Service (auto-resume-daemon.js)

A background service that monitors for detected rate limits:
- Watches `~/.claude/auto-resume/status.json` for changes
- Displays countdown timer in the terminal
- When reset time arrives:
  - Finds all Claude Code terminal windows (cross-platform)
  - Sends "continue" keystroke automatically
  - Clears the status file
  - Logs all activity for debugging

**Platform-specific keystroke sending:**
- Windows: PowerShell window automation
- Linux: xdotool for terminal control
- macOS: osascript for Terminal/iTerm integration

## Rate Limit Detection Example

When Claude Code hits a rate limit:
```
You've hit your limit · resets 8pm (Asia/Dhaka)
```

Automatically:
1. Hook detects this in the transcript
2. Parses "8pm" as reset time in Asia/Dhaka timezone
3. Status file is updated with reset time
4. Daemon displays countdown: `[WAITING] Resuming in 02:45:30...`
5. When the time arrives: `[READY] Reset time reached! Sending continue...`
6. Session resumes automatically

## Quick Install

Installation automatically sets up both the hook script and daemon service.

### Windows
```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
```

### Linux/macOS
```bash
./install.sh
```

After installation, start the daemon (once per login or configure for auto-start):
```bash
node ~/.claude/auto-resume/auto-resume-daemon.js start
```

**That's it!** The system is now active and will automatically detect rate limits and resume your sessions.

## What Gets Installed

The installation process sets up the automatic system:

### Directory Structure
```
~/.claude/
├── hooks/
│   └── rate-limit-hook.js          # Automatic detection hook
├── auto-resume/
│   ├── auto-resume-daemon.js       # Background service
│   ├── status.json                 # Status file (created at runtime)
│   ├── daemon.pid                  # PID file (created at runtime)
│   └── daemon.log                  # Activity log
└── settings.json                   # Updated with hook configuration
```

### Hook Script
- **Location:** `~/.claude/hooks/rate-limit-hook.js`
- **Purpose:** Automatically runs after every Claude Code session
- **Action:** Analyzes transcript and writes rate limit detection to status file
- **Configuration:** Added to `~/.claude/settings.json` under "Stop" hooks

### Daemon Service
- **Location:** `~/.claude/auto-resume/auto-resume-daemon.js`
- **Purpose:** Background service that monitors for rate limit detection
- **Configuration:** Runs independently after installation

### Settings Update
- **File:** `~/.claude/settings.json`
- **Change:** Adds Stop hook configuration:
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

## Starting the Daemon

### First Time
After installation, you need to start the daemon once:

**Windows:**
```powershell
node "$env:USERPROFILE\.claude\auto-resume\auto-resume-daemon.js" start
```

**Linux/macOS:**
```bash
node ~/.claude/auto-resume/auto-resume-daemon.js start
```

### Auto-Start at Login

#### Windows
The installer offers to add the daemon to Windows Startup automatically. If you declined, you can do it manually:

1. Create a PowerShell shortcut in your Startup folder
2. Or run:
   ```powershell
   powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\.claude\auto-resume\start-daemon.ps1"
   ```

#### Linux
Use systemd user service (automatically configured during installation):
```bash
systemctl --user enable claude-auto-resume
systemctl --user start claude-auto-resume
```

To check status:
```bash
systemctl --user status claude-auto-resume
```

#### macOS
Use launchd (automatically configured during installation):
```bash
launchctl load ~/Library/LaunchAgents/com.claude.auto-resume.plist
```

To unload:
```bash
launchctl unload ~/Library/LaunchAgents/com.claude.auto-resume.plist
```

## Daemon Management

### Check if Running
```bash
node ~/.claude/auto-resume/auto-resume-daemon.js status
```

### Stop the Daemon
```bash
node ~/.claude/auto-resume/auto-resume-daemon.js stop
```

### Restart the Daemon
```bash
node ~/.claude/auto-resume/auto-resume-daemon.js restart
```

### View Logs
```bash
# View recent logs
tail -f ~/.claude/auto-resume/daemon.log

# View full log
cat ~/.claude/auto-resume/daemon.log
```

## Manual Modes (Optional)

While the automatic system handles everything, you can also use manual modes for testing or specific use cases:

### Interactive Mode
Manually paste a rate limit message:
```bash
node ~/.claude/auto-resume/auto-resume-daemon.js -i
```

### Clipboard Monitor Mode
Monitor clipboard for rate limit messages:
```bash
node ~/.claude/auto-resume/auto-resume-daemon.js -m
```

### Test Mode
Test the countdown with a custom duration:
```bash
node ~/.claude/auto-resume/auto-resume-daemon.js --test 30
```
(Counts down 30 seconds)

## Troubleshooting

### Daemon Not Starting

1. **Check if already running:**
   ```bash
   node ~/.claude/auto-resume/auto-resume-daemon.js status
   ```

2. **Verify Node.js installation:**
   ```bash
   node --version
   ```
   (Should be v16 or higher)

3. **Check for errors:**
   ```bash
   cat ~/.claude/auto-resume/daemon.log
   ```

4. **Ensure status directory exists:**
   ```bash
   mkdir -p ~/.claude/auto-resume
   ```

### Hook Not Detecting Rate Limits

1. **Verify hook is configured in settings:**
   ```bash
   cat ~/.claude/settings.json | grep rate-limit-hook
   ```

2. **Check Claude Code settings location:**
   - Should be at `~/.claude/settings.json`
   - Windows: `%USERPROFILE%\.claude\settings.json`

3. **View daemon log for detection events:**
   ```bash
   tail ~/.claude/auto-resume/daemon.log
   ```

### Linux: xdotool Not Installed

If you see "xdotool not found" error:

**Ubuntu/Debian:**
```bash
sudo apt-get install xdotool
```

**RHEL/CentOS:**
```bash
sudo yum install xdotool
```

**Arch:**
```bash
sudo pacman -S xdotool
```

### Windows: PowerShell Execution Policy

If installation fails, enable script execution:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

Then re-run the installer.

## Uninstallation

### Windows
```powershell
powershell -ExecutionPolicy Bypass -File install.ps1 -Uninstall
```

### Linux/macOS
```bash
./install.sh --uninstall
```

The uninstaller will:
- Stop any running daemon processes
- Remove hook and daemon scripts
- Remove the auto-resume directory
- Remove hook configuration from settings.json
- Remove startup shortcuts/services
- Preserve backup files (`.backup` extension)

## Supported Timezones

The hook script supports 40+ timezones including:
- Americas: America/New_York, America/Chicago, America/Denver, America/Los_Angeles, America/Toronto, America/Mexico_City, America/Argentina/Buenos_Aires, America/Sao_Paulo
- Europe: Europe/London, Europe/Berlin, Europe/Paris, Europe/Amsterdam, Europe/Tokyo, Europe/Istanbul, Europe/Moscow
- Asia: Asia/Tokyo, Asia/Shanghai, Asia/Hong_Kong, Asia/Singapore, Asia/Dubai, Asia/Bangkok, Asia/Kolkata, Asia/Dhaka
- Australia: Australia/Sydney, Australia/Melbourne, Australia/Brisbane
- Pacific: Pacific/Auckland, Pacific/Fiji

Plus many others. The system automatically handles timezone conversion from the rate limit message.

## How to Report Issues

If you encounter problems:

1. **Check the daemon log:**
   ```bash
   cat ~/.claude/auto-resume/daemon.log
   ```

2. **Enable debug output:**
   - Edit daemon startup to see verbose output
   - Check the log file location

3. **Verify system configuration:**
   - Check Node.js version
   - Verify Claude Code settings.json syntax
   - Ensure directories have write permissions

## Contributing

This is an automated system designed to work silently. For improvements or bug reports, ensure you have:
- Current Claude Code version
- Node.js 16+
- Proper filesystem permissions
- System requirements met for your platform

## License

MIT License
