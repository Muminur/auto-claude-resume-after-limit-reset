# Linux Installation Guide

Complete guide for installing Auto Claude Resume on Linux (Ubuntu, Debian, Fedora, Arch, etc.).

## Prerequisites

- Linux with Bash shell
- Claude Code CLI installed
- Node.js 16+ ([Installation guide](https://nodejs.org/en/download/package-manager))
- `xdotool` (for sending keystrokes)

---

## Method 1: Claude Code Plugin (Recommended)

This is the easiest installation method. Just two steps!

### Step 1: Install xdotool (One-Time Requirement)

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install xdotool
```

**Fedora/RHEL/CentOS:**
```bash
sudo dnf install xdotool
```

**Arch Linux:**
```bash
sudo pacman -S xdotool
```

**openSUSE:**
```bash
sudo zypper install xdotool
```

### Step 2: Add the Marketplace

Open Claude Code and run:
```
/plugin marketplace add https://github.com/Muminur/auto-claude-resume-after-limit-reset
```

### Step 3: Install the Plugin

```
/plugin install auto-resume
```

**That's it!** The daemon will automatically start when you open a new Claude Code session.

### How It Works

The plugin registers a **SessionStart hook** that:
1. Runs automatically when you open Claude Code
2. Checks if the daemon is already running
3. Starts the daemon in the background if it's not running

You don't need to configure systemd or any auto-start mechanism - the plugin handles everything!

### Verify Installation (Optional)

```bash
# Check if hooks are registered
cat ~/.claude/settings.json | grep -A5 "SessionStart"

# Check daemon status
node ~/.claude/auto-resume/auto-resume-daemon.js status

# View logs
tail -20 ~/.claude/auto-resume/daemon.log
```

### Test the Installation

```bash
# Run a 10-second test countdown
node ~/.claude/auto-resume/auto-resume-daemon.js --test 10
```

---

## Method 2: Manual Installation (Alternative)

If the plugin method doesn't work, use manual installation.

### Step 1: Install Dependencies

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install xdotool nodejs npm

# Fedora
sudo dnf install xdotool nodejs npm

# Arch
sudo pacman -S xdotool nodejs npm
```

### Step 2: Clone Repository

```bash
git clone https://github.com/Muminur/auto-claude-resume-after-limit-reset.git
cd auto-claude-resume-after-limit-reset
```

### Step 3: Run Installer

```bash
chmod +x install.sh
./install.sh
```

The manual installer will set up hooks and optionally configure systemd for you.

---

## Daemon Management

The daemon auto-starts with Claude Code, but you can manage it manually:

```bash
# Store daemon path for convenience
daemon=~/.claude/auto-resume/auto-resume-daemon.js

# Check status
node $daemon status

# Stop daemon
node $daemon stop

# Restart daemon
node $daemon restart

# View logs
tail -f ~/.claude/auto-resume/daemon.log

# View last 50 lines
tail -50 ~/.claude/auto-resume/daemon.log
```

---

## Troubleshooting

### Plugin Not Showing in /plugin

Ensure you've added the marketplace first:
```
/plugin marketplace add https://github.com/Muminur/auto-claude-resume-after-limit-reset
```

### "xdotool: command not found"

Install xdotool for your distribution:
```bash
# Ubuntu/Debian
sudo apt install xdotool

# Fedora
sudo dnf install xdotool

# Arch
sudo pacman -S xdotool
```

### Node.js Not Found or Wrong Version

```bash
# Check version (must be 16+)
node --version

# Install via NodeSource (Ubuntu/Debian)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Or use nvm (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 20
```

### Daemon Not Auto-Starting

Check if the SessionStart hook is registered:
```bash
cat ~/.claude/settings.json | grep -A5 "SessionStart"
```

If not present, try reinstalling the plugin.

### Keystrokes Not Being Sent

The daemon uses `xdotool` to send keystrokes. Common issues:

1. **xdotool not installed:** See installation section above

2. **Running on Wayland:** xdotool requires X11. Try:
   ```bash
   # Run under XWayland
   GDK_BACKEND=x11 node ~/.claude/auto-resume/auto-resume-daemon.js start
   ```
   Or switch to an X11 session at login.

3. **No DISPLAY variable:**
   ```bash
   export DISPLAY=:0
   node ~/.claude/auto-resume/auto-resume-daemon.js start
   ```

### Wayland Compatibility

If using Wayland (default on newer Ubuntu/Fedora), xdotool may not work. Options:

1. **Switch to X11 session** at login screen
2. **Use XWayland:**
   ```bash
   GDK_BACKEND=x11 node ~/.claude/auto-resume/auto-resume-daemon.js start
   ```
3. **Install ydotool** (Wayland alternative - requires additional setup)

### Permission Denied

```bash
chmod +x ~/.claude/hooks/rate-limit-hook.js
chmod +x ~/.claude/auto-resume/auto-resume-daemon.js
```

---

## Uninstallation

### Plugin Method
```
/plugin uninstall auto-resume
```

### Manual Method
```bash
./install.sh --uninstall
```

### Complete Cleanup

```bash
# Stop daemon
node ~/.claude/auto-resume/auto-resume-daemon.js stop

# Remove files
rm -rf ~/.claude/auto-resume
rm -f ~/.claude/hooks/rate-limit-hook.js
```
