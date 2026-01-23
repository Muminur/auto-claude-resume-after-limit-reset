# Windows Installation Guide

Complete guide for installing Auto Claude Resume on Windows 10/11.

## Prerequisites

- Windows 10 or Windows 11
- Claude Code CLI installed
- Node.js 16+ ([Download](https://nodejs.org/))
- PowerShell 5.1+ (pre-installed on Windows 10/11)

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

You don't need to configure Windows Startup manually - the plugin handles everything!

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

## Method 2: Manual Installation (Alternative)

If the plugin method doesn't work, use manual installation.

### Step 1: Clone Repository

```powershell
git clone https://github.com/Muminur/auto-claude-resume-after-limit-reset.git
cd auto-claude-resume-after-limit-reset
```

### Step 2: Run Installer

```powershell
# Allow script execution (one-time)
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# Run installer
powershell -ExecutionPolicy Bypass -File install.ps1
```

The manual installer will set up hooks and optionally configure Windows Startup for you.

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

---

## Troubleshooting

### Plugin Not Showing in /plugin

Ensure you've added the marketplace first:
```
/plugin marketplace add https://github.com/Muminur/auto-claude-resume-after-limit-reset
```

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

If not present, try reinstalling the plugin.

### Keystrokes Not Being Sent

The daemon sends keystrokes to terminal windows. Ensure:
1. Claude Code is running in a terminal window (Windows Terminal, PowerShell, CMD)
2. The terminal window is not minimized
3. Try running PowerShell as Administrator

---

## Uninstallation

### Plugin Method
```
/plugin uninstall auto-resume
```

### Manual Method
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
