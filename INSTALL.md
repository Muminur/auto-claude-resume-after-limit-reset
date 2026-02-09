# Installation Guide

This guide covers installation for the Auto Claude Resume plugin.

---

## Quick Install (All Platforms)

Clone the repository and run the installer for your platform.

> **Linux users:** You must install `xdotool` for keystroke sending. The installer will offer to install it for you, or run: `sudo apt-get install -y xdotool` (Ubuntu/Debian). See [Linux Detailed Guide](docs/INSTALL-LINUX.md).

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

# Verify xdotool can find terminal windows
xdotool search --class "gnome-terminal"
```

---

## How Auto-Start Works

The installer registers a **SessionStart hook** that:
1. Runs automatically when you open Claude Code
2. Checks if the daemon is already running
3. Starts the daemon if it's not running

This means you **don't need to configure auto-start manually** - just install and it works!

---

## Uninstallation

#### macOS / Linux
```bash
./install.sh --uninstall
```

#### Windows
```powershell
powershell -ExecutionPolicy Bypass -File install.ps1 -Uninstall
```

---

## Testing

After installation, verify everything works:

**Using slash command (in Claude Code):**
```
/auto-resume:test 10
```

**Using terminal (auto-discovery):**
```bash
# Test with 10-second countdown
DAEMON=$(find ~/.claude -name "auto-resume-daemon.js" 2>/dev/null | head -1)
node "$DAEMON" --test 10
```

**If the test shows "xdotool not found":**
```bash
# Install xdotool (see Linux manual section above)
sudo apt-get install -y xdotool

# Restart the daemon to pick up the new binary
DAEMON=$(find ~/.claude -name "auto-resume-daemon.js" 2>/dev/null | head -1)
node "$DAEMON" stop && node "$DAEMON" start

# Re-run the test
node "$DAEMON" --test 10
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
