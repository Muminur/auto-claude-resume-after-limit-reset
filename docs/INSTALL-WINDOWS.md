# Windows Installation Guide

Complete guide for installing Auto Claude Resume on Windows 10/11.

## Prerequisites

- Windows 10 or Windows 11
- Claude Code CLI installed
- Node.js 16+ ([Download](https://nodejs.org/))
- PowerShell 5.1+ (pre-installed on Windows 10/11)

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

Open PowerShell and run:

```powershell
# Find the daemon path
$daemonPath = Get-ChildItem "$env:USERPROFILE\.claude\plugins\cache\*\auto-claude-resume-after-limit-reset\*\auto-resume-daemon.js" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName

# Verify it was found
Write-Host "Daemon path: $daemonPath"

# Start the daemon
node $daemonPath start
```

### Step 4: Verify Installation

```powershell
# Check daemon status
node $daemonPath status

# Check if hooks are registered
Get-Content "$env:USERPROFILE\.claude\settings.json" | Select-String "rate-limit"

# View logs
Get-Content "$env:USERPROFILE\.claude\auto-resume\daemon.log" -Tail 20
```

### Step 5: Test the Installation

```powershell
# Run a 10-second test countdown
node $daemonPath --test 10
```

---

## Setting Up Auto-Start on Login

To have the daemon start automatically when you log into Windows:

### Option 1: Startup Folder (Simple)

1. Press `Win+R` and type `shell:startup`
2. Create a new shortcut:
   - Right-click > New > Shortcut
   - Target: `powershell.exe -WindowStyle Hidden -Command "node '%USERPROFILE%\.claude\auto-resume\auto-resume-daemon.js' start"`
   - Name: "Claude Auto Resume"

### Option 2: Task Scheduler (Advanced)

1. Open Task Scheduler (`taskschd.msc`)
2. Create Basic Task:
   - Name: "Claude Auto Resume Daemon"
   - Trigger: "When I log on"
   - Action: Start a program
   - Program: `node`
   - Arguments: `"%USERPROFILE%\.claude\auto-resume\auto-resume-daemon.js" start`
3. Check "Open Properties dialog" and enable "Run whether user is logged on or not"

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

### Step 3: Start Daemon

```powershell
node "$env:USERPROFILE\.claude\auto-resume\auto-resume-daemon.js" start
```

---

## Daemon Management

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

### Daemon Not Starting

```powershell
# Check if already running
Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*auto-resume*" }

# Check Node.js version (must be 16+)
node --version

# Check logs for errors
Get-Content "$env:USERPROFILE\.claude\auto-resume\daemon.log" -Tail 50
```

### Keystrokes Not Being Sent

The daemon sends keystrokes to terminal windows. Ensure:
1. Claude Code is running in a terminal window (Windows Terminal, PowerShell, CMD)
2. The terminal window is not minimized
3. Try running PowerShell as Administrator

### Test the Installation

```powershell
# Quick test with 5-second countdown
node $daemonPath --test 5
```

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
Remove-Item -Force "$env:USERPROFILE\.claude\hooks\rate-limit-hook.js"

# Remove startup shortcut (if created)
Remove-Item "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\Claude Auto Resume.lnk" -ErrorAction SilentlyContinue
```
