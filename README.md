# Auto Claude Resume

A Claude Code plugin that automatically resumes your sessions when rate limits reset.

## Features

- **Automatic Detection**: Detects rate limits without any user intervention
- **Auto-Resume**: Sends "continue" to your terminal when limits reset
- **Auto-Start Daemon**: Daemon starts automatically when you open Claude Code
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

**That's it!** The daemon will automatically start when you open a new Claude Code session.

### Method 2: Manual Installation

If you prefer manual installation, see the platform-specific guides:
- [Windows Installation](docs/INSTALL-WINDOWS.md)
- [Linux Installation](docs/INSTALL-LINUX.md)
- [macOS Installation](docs/INSTALL-MACOS.md)

## How It Works

```
┌─────────────────┐                     ┌──────────────────┐
│  SessionStart   │ ──── auto-start ───►│  Daemon Process  │
│  Hook           │                     │  (if not running)│
└─────────────────┘                     └──────────────────┘

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

### Three Components

1. **SessionStart Hook** (`scripts/ensure-daemon-running.js`)
   - Runs automatically when Claude Code starts
   - Checks if daemon is running
   - Starts daemon if not running

2. **Stop Hook** (`hooks/rate-limit-hook.js`)
   - Runs automatically when Claude Code stops
   - Analyzes transcript for rate limit messages
   - Writes detection to `~/.claude/auto-resume/status.json`

3. **Daemon Service** (`auto-resume-daemon.js`)
   - Monitors for rate limit detections
   - Waits until reset time
   - Sends "continue" to terminal automatically

## Daemon Management

The daemon auto-starts, but you can manage it manually if needed:

**Windows (PowerShell):**
```powershell
$daemon = "$env:USERPROFILE\.claude\auto-resume\auto-resume-daemon.js"

# Check status
node $daemon status

# Stop daemon
node $daemon stop

# Restart daemon
node $daemon restart

# View logs
Get-Content "$env:USERPROFILE\.claude\auto-resume\daemon.log" -Tail 20
```

**macOS / Linux:**
```bash
daemon=~/.claude/auto-resume/auto-resume-daemon.js

# Check status
node $daemon status

# Stop daemon
node $daemon stop

# Restart daemon
node $daemon restart

# View logs
tail -f ~/.claude/auto-resume/daemon.log
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
   - **Windows:** `node "$env:USERPROFILE\.claude\auto-resume\auto-resume-daemon.js" status`
   - **macOS/Linux:** `node ~/.claude/auto-resume/auto-resume-daemon.js status`

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

### macOS: Accessibility Permission

Grant accessibility permission to Node.js:
1. System Settings > Privacy & Security > Accessibility
2. Add your Node.js binary (run `which node` to find path)

## Uninstallation

```
/plugin uninstall auto-resume
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
- macOS: Accessibility permission for Node.js

## License

MIT License
