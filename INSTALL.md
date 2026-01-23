# Installation Guide

This guide covers all installation methods for the Auto Claude Resume plugin.

---

## Quick Install via Plugin (All Platforms)

Installation is **identical** for Windows, macOS, and Linux. Just two steps!

### Step 1: Add the Marketplace

In Claude Code, run:
```
/plugin marketplace add https://github.com/Muminur/auto-claude-resume-after-limit-reset
```

### Step 2: Install the Plugin

```
/plugin install auto-resume
```

**That's it!** The daemon will automatically start when you open a new Claude Code session.

### Verify Installation (Optional)

#### Windows (PowerShell)

```powershell
# Check if hooks are registered
Get-Content "$env:USERPROFILE\.claude\settings.json" | Select-String "auto-resume"

# Check daemon status
node "$env:USERPROFILE\.claude\auto-resume\auto-resume-daemon.js" status

# View logs
Get-Content "$env:USERPROFILE\.claude\auto-resume\daemon.log" -Tail 20
```

#### macOS / Linux (Terminal)

```bash
# Check if hooks are registered
cat ~/.claude/settings.json | grep -A5 "SessionStart"

# Check daemon status
node ~/.claude/auto-resume/auto-resume-daemon.js status

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

## How Auto-Start Works

When you install the plugin, it registers a **SessionStart hook** that:
1. Runs automatically when you open Claude Code
2. Checks if the daemon is already running
3. Starts the daemon if it's not running

This means you **don't need to configure auto-start manually** - just install the plugin and it works!

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
node "$env:USERPROFILE\.claude\auto-resume\auto-resume-daemon.js" --test 10
```

### macOS / Linux (Terminal)
```bash
# Test with 10-second countdown
node ~/.claude/auto-resume/auto-resume-daemon.js --test 10
```

---

## Platform-Specific Requirements

| Platform | Requirements |
|----------|--------------|
| **Windows** | Node.js 16+, PowerShell 5.1+ |
| **macOS** | Node.js 16+, Accessibility permission for Node.js |
| **Linux** | Node.js 16+, xdotool (for keystroke sending) |

---

## Detailed Platform Guides

For more detailed instructions:

- [Windows Detailed Guide](docs/INSTALL-WINDOWS.md)
- [Linux Detailed Guide](docs/INSTALL-LINUX.md)
- [macOS Detailed Guide](docs/INSTALL-MACOS.md)
