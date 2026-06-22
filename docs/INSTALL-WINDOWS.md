# Windows Installation Guide

Complete guide for installing Auto Claude Resume on Windows 10/11.

## Windows Delivery Tiers

The daemon delivers via console-input injection first, falling back to the GUI strategies only if that reaches no sessions:

| Tier | Method | Needs focus? | Works locked? | Notes |
|------|--------|--------------|---------------|-------|
| **1 (primary)** | Console-input injection (`AttachConsole` + `WriteConsoleInput`) | No | **Yes** | Injects the resume sequence straight into **each** Claude session's console buffer, by PID. Works from the detached daemon with no window focus, reaches every Windows Terminal ConPTY session, and is AMSI-clean. Targets only Claude session roots (`claude.exe` / node-hosted Claude CLIs); plugin and MCP child processes are excluded so `continue` is delivered exactly once per session. |
| **2 (fallback)** | WezTerm CLI (`wezterm cli send-text`) | No | Yes (WezTerm only) | Used only if Tier 1 delivers to zero sessions. Injects into WezTerm panes via its CLI socket. |
| **3 (fallback)** | UI Automation window enumeration | Yes | No | Used only if Tier 1 delivers to zero sessions. Focuses each Claude window by handle and sends keystrokes — but a background process generally cannot steal focus, so this rarely succeeds from the daemon. |
| **4 (fallback)** | Process-tree SendKeys | Yes | No | Last-resort legacy path. |

Tier 1 is the path that actually works from the daemon: GUI `SendKeys` requires stealing window focus, which Windows denies to a background process (foreground-lock) **whether the workstation is locked or unlocked**. Console-input injection bypasses the GUI entirely, so it delivers from the background daemon and — because the console API never touches the secure desktop — **continues to work while the workstation is locked**.

The Linux/macOS tiers (tmux and PTY) are not available on Windows; the daemon skips them automatically. No manual configuration is needed.

## Prerequisites

- Windows 10 or Windows 11
- Claude Code CLI installed
- Node.js 16+ ([Download](https://nodejs.org/))
- PowerShell 5.1+ (pre-installed on Windows 10/11)
- npm 7+ (included with Node.js)

### Dependencies

The daemon automatically installs these npm packages:
- **chokidar** - File system watcher for config changes
- **node-notifier** - Native toast notifications
- **ws** - WebSocket server for dashboard and real-time updates

---

## Installation

Clone the repository and run the installer:

```powershell
git clone https://github.com/Muminur/auto-claude-resume-after-limit-reset.git
cd auto-claude-resume-after-limit-reset
powershell -ExecutionPolicy Bypass -File install.ps1
```

**That's it!** The installer registers both hooks, installs dependencies, and the daemon will automatically start when you open a new Claude Code session.

### First Run Setup

After installation, verify everything works:
```powershell
# Find and check daemon status
$daemon = (Get-ChildItem -Path "$env:USERPROFILE\.claude" -Recurse -Filter "auto-resume-daemon.js" | Select-Object -First 1).FullName
node $daemon status

# 2. Create configuration file (if not already present)
$configDir = "$env:USERPROFILE\.claude\auto-resume"
if (!(Test-Path "$configDir\config.json")) {
    @{
        "enabled" = $true
        "checkInterval" = 5000
        "notificationMethod" = "toast"
        "websocketPort" = 3847
        "apiPort" = 3848
    } | ConvertTo-Json | Set-Content "$configDir\config.json"
    Write-Host "Configuration file created" -ForegroundColor Green
}

# 3. Create plugin directory
New-Item -ItemType Directory -Force -Path "$configDir\plugins" | Out-Null

# 4. Test the daemon
node $daemon --test 5
```

### How It Works

The installer registers a **SessionStart hook** that:
1. Runs automatically when you open Claude Code
2. Checks if the daemon is already running
3. Starts the daemon in the background if it's not running

You don't need to configure Windows Startup manually - the installer handles everything!

### Verify Installation (Optional)

Open PowerShell and run:

```powershell
# Check if hooks are registered
Get-Content "$env:USERPROFILE\.claude\settings.json" | Select-String "auto-resume"

# Check daemon status
node "$env:USERPROFILE\.claude\auto-resume\auto-resume-daemon.js" status

# View logs
Get-Content "$env:USERPROFILE\.claude\auto-resume\daemon.log" -Tail 20
```

### Test the Installation

```powershell
# Run a 10-second test countdown
node "$env:USERPROFILE\.claude\auto-resume\auto-resume-daemon.js" --test 10
```

---

## Configuration Setup

The daemon reads its configuration from a JSON file in your user profile. Set this up after installation:

### Create Configuration File

```powershell
# Create the config directory
$configDir = "$env:USERPROFILE\.claude\auto-resume"
New-Item -ItemType Directory -Force -Path $configDir | Out-Null

# Create config.json with default settings
@{
    "enabled" = $true
    "checkInterval" = 5000
    "notificationMethod" = "toast"
    "websocketPort" = 3847
    "apiPort" = 3848
    "dashboard" = @{
        "enabled" = $true
        "port" = 3848
    }
    "notifications" = @{
        "enabled" = $true
        "toastNotifications" = $true
        "powershellFallback" = $true
    }
} | ConvertTo-Json | Set-Content "$configDir\config.json"

Write-Host "Configuration file created at: $configDir\config.json" -ForegroundColor Green
```

### Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `true` | Enable/disable the daemon |
| `checkInterval` | `5000` | Session check interval in milliseconds |
| `notificationMethod` | `toast` | Notification method: `toast`, `powershell`, or `both` |
| `websocketPort` | `3847` | WebSocket server port for real-time updates |
| `apiPort` | `3848` | REST API server port |

---

## Plugin Directory Setup

The daemon supports custom plugins. Set up the plugin directory:

```powershell
# Create plugin directory
$pluginDir = "$env:USERPROFILE\.claude\auto-resume\plugins"
New-Item -ItemType Directory -Force -Path $pluginDir | Out-Null

Write-Host "Plugin directory created at: $pluginDir" -ForegroundColor Green
```

**Plugin Format:** Each plugin should be a Node.js module in its own subdirectory:
```
plugins/
├── my-plugin/
│   ├── package.json
│   └── index.js
└── another-plugin/
    ├── package.json
    └── index.js
```

---

## WebSocket and API Server

The daemon includes a WebSocket and REST API server for dashboard access and programmatic control.

### Default Ports

| Service | Port | Protocol |
|---------|------|----------|
| WebSocket Server | 3847 | ws:// |
| REST API Server | 3848 | http:// |
| Dashboard GUI | 3848 | http:// |

### Access Dashboard

Once the daemon is running, access the GUI dashboard:

```powershell
# Open in default browser
Start-Process "http://localhost:3848"
```

The dashboard shows:
- Real-time daemon status
- Active session monitoring
- Keystroke logs
- Configuration settings
- Plugin management
- Notification history

---

## Notification Setup for Windows

The daemon supports Windows toast notifications with PowerShell fallback.

### Toast Notifications (Recommended)

Toast notifications appear as native Windows notifications:

```powershell
# Enable in config
$configPath = "$env:USERPROFILE\.claude\auto-resume\config.json"
$config = Get-Content $configPath | ConvertFrom-Json
$config.notifications.toastNotifications = $true
$config | ConvertTo-Json | Set-Content $configPath

Write-Host "Toast notifications enabled" -ForegroundColor Green
```

Requirements:
- Windows 10 or Windows 11
- Notification Center enabled (default)

### PowerShell Fallback

If toast notifications fail, the daemon automatically falls back to PowerShell notifications:

```powershell
# Enable fallback in config
$configPath = "$env:USERPROFILE\.claude\auto-resume\config.json"
$config = Get-Content $configPath | ConvertFrom-Json
$config.notifications.powershellFallback = $true
$config | ConvertTo-Json | Set-Content $configPath

Write-Host "PowerShell fallback enabled" -ForegroundColor Green
```

PowerShell notifications use the `[System.Windows.Forms.MessageBox]` class and appear as traditional popup dialogs.

### Notification Events

The daemon sends notifications for:
- Session started/ended
- Rate limit detected
- Keystroke sequence sent
- Daemon errors or warnings
- Plugin events

---

## Daemon Management

The daemon auto-starts with Claude Code, but you can manage it manually:

```powershell
# Store daemon path for convenience
$daemon = "$env:USERPROFILE\.claude\auto-resume\auto-resume-daemon.js"

# Check status
node $daemon status

# Stop daemon
node $daemon stop

# Restart daemon
node $daemon restart

# View logs
Get-Content "$env:USERPROFILE\.claude\auto-resume\daemon.log" -Tail 50

# Watch logs in real-time
Get-Content "$env:USERPROFILE\.claude\auto-resume\daemon.log" -Wait -Tail 20
```

### WebSocket Server Commands

Connect to the WebSocket server to monitor real-time events:

```powershell
# Example using node ws client
npm install -g ws

# Connect to WebSocket
wscat -c ws://localhost:3847

# Messages received include:
# {"type":"statusUpdate","status":"idle"}
# {"type":"keystrokeSent","keys":"Enter"}
# {"type":"notification","message":"..."}
```

---

## Troubleshooting

### "Execution Policy" Error

Run PowerShell as Administrator:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Node.js Not Found

1. Download from https://nodejs.org/
2. Run the installer
3. Restart PowerShell
4. Verify: `node --version`

### Daemon Not Auto-Starting

Check if the SessionStart hook is registered:
```powershell
Get-Content "$env:USERPROFILE\.claude\settings.json" | Select-String "SessionStart"
```

If not present, re-run `install.ps1` from the repo directory.

### Keystrokes Not Being Sent

The daemon injects the resume sequence into each Claude session's console (Tier 1),
which does not need window focus and works whether the workstation is locked or not.
If a session is not resumed, ensure:
1. Claude Code is running as `claude.exe` or a node-hosted Claude CLI (the daemon
   targets Claude session roots by PID)
2. The session is sitting at the rate-limit prompt (idle), so Claude — not a child
   shell spawned mid-tool-call — currently owns the console input
3. The daemon is running (`/auto-resume:status`)

> Multiple Claude sessions are each resumed independently (one injection per session
> console), including sessions spread across several Windows Terminal windows.

### Dashboard Not Accessible

If the dashboard won't open on http://localhost:3848:

```powershell
# Check if API server is running
$daemon = "$env:USERPROFILE\.claude\auto-resume\auto-resume-daemon.js"
node $daemon status

# Check if port 3848 is already in use
Get-NetTCPConnection -LocalPort 3848 -ErrorAction SilentlyContinue

# Try a different port in config.json
$configPath = "$env:USERPROFILE\.claude\auto-resume\config.json"
$config = Get-Content $configPath | ConvertFrom-Json
$config.apiPort = 3849
$config | ConvertTo-Json | Set-Content $configPath

# Restart daemon
node $daemon restart
```

### Toast Notifications Not Showing

If Windows notifications aren't appearing:

```powershell
# 1. Check notification settings
Start-Process ms-settings:notifications

# 2. Ensure PowerShell fallback is enabled in config
$configPath = "$env:USERPROFILE\.claude\auto-resume\config.json"
$config = Get-Content $configPath | ConvertFrom-Json
$config.notifications.powershellFallback = $true
$config | ConvertTo-Json | Set-Content $configPath

# 3. Restart daemon
node $daemon restart
```

### WebSocket Connection Failures

If WebSocket events aren't being received:

```powershell
# Verify WebSocket server is listening on port 3847
netstat -ano | Select-String ":3847"

# Check daemon logs for WebSocket errors
Get-Content "$env:USERPROFILE\.claude\auto-resume\daemon.log" | Select-String "WebSocket"

# Try restarting on a different port
$configPath = "$env:USERPROFILE\.claude\auto-resume\config.json"
$config = Get-Content $configPath | ConvertFrom-Json
$config.websocketPort = 3850
$config | ConvertTo-Json | Set-Content $configPath

node "$env:USERPROFILE\.claude\auto-resume\auto-resume-daemon.js" restart
```

---

## Uninstallation

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1 -Uninstall
```

### Complete Cleanup
```powershell
# Stop daemon
node "$env:USERPROFILE\.claude\auto-resume\auto-resume-daemon.js" stop

# Remove files
Remove-Item -Recurse -Force "$env:USERPROFILE\.claude\auto-resume"
Remove-Item -Force "$env:USERPROFILE\.claude\hooks\rate-limit-hook.js" -ErrorAction SilentlyContinue
```
