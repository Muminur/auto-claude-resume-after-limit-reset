# Linux Installation Guide

Complete guide for installing Auto Claude Resume on Linux (Ubuntu, Debian, Fedora, Arch, etc.).

## Prerequisites

- Linux with Bash shell
- `xdotool` for sending keystrokes
- `xclip` or `xsel` for clipboard monitoring
- Node.js 16+ (optional, for Node.js version)

## Step 1: Install Dependencies

### Ubuntu/Debian
```bash
sudo apt update
sudo apt install xdotool xclip bc
```

### Fedora/RHEL/CentOS
```bash
sudo dnf install xdotool xclip bc
```

### Arch Linux
```bash
sudo pacman -S xdotool xclip bc
```

### openSUSE
```bash
sudo zypper install xdotool xclip bc
```

## Step 2: Download the Plugin

### Option A: Clone with Git
```bash
git clone https://github.com/Muminur/auto-claude-resume-after-limit-reset.git
cd auto-claude-resume-after-limit-reset
```

### Option B: Download with wget
```bash
wget https://github.com/Muminur/auto-claude-resume-after-limit-reset/archive/main.zip
unzip main.zip
cd auto-claude-resume-after-limit-reset-main
```

## Step 3: Make Script Executable

```bash
chmod +x claude-auto-resume.sh
```

## Step 4: Run the Script

```bash
./claude-auto-resume.sh
```

When prompted, select:
1. **Interactive Mode** - Paste messages directly
2. **Clipboard Monitor** - Monitors clipboard for rate limit messages
3. **Test Mode** - Test with 30-second countdown

## Usage Examples

### Basic Usage
```bash
# Interactive menu
./claude-auto-resume.sh

# Interactive mode directly
./claude-auto-resume.sh -i

# Clipboard monitoring
./claude-auto-resume.sh -m

# Test with 10-second countdown
./claude-auto-resume.sh -t 10

# Custom prompt
./claude-auto-resume.sh -i -p "please continue with the task"
```

### Node.js Usage (Alternative)
```bash
# Install Node.js if needed
# Ubuntu/Debian:
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Run with Node.js
node index.js -i
```

## Claude Code Plugin Setup

### Step 1: Create Plugin Directory

```bash
mkdir -p ~/.claude/plugins/auto-resume
```

### Step 2: Copy Files

```bash
cp -r ./* ~/.claude/plugins/auto-resume/
chmod +x ~/.claude/plugins/auto-resume/claude-auto-resume.sh
```

### Step 3: Add to PATH (Optional)

Add to your `~/.bashrc` or `~/.zshrc`:
```bash
export PATH="$PATH:$HOME/.claude/plugins/auto-resume"
alias claude-resume="~/.claude/plugins/auto-resume/claude-auto-resume.sh"
```

Then reload:
```bash
source ~/.bashrc  # or source ~/.zshrc
```

### Step 4: Create Claude Code Hook

Create or edit `~/.claude/settings.json`:
```json
{
  "hooks": {
    "on_rate_limit": {
      "command": "~/.claude/plugins/auto-resume/claude-auto-resume.sh -m"
    }
  }
}
```

## Running Alongside Claude Code

### Option 1: Separate Terminal Window

1. Open a new terminal window
2. Run the auto-resume script:
   ```bash
   ./claude-auto-resume.sh -m
   ```
3. When Claude Code hits rate limit, copy the message
4. The script detects it and starts countdown

### Option 2: tmux Split

```bash
# Start tmux
tmux

# Split horizontally
Ctrl+b %

# Run Claude Code in left pane
# In right pane, run:
./claude-auto-resume.sh -m

# Switch between panes with Ctrl+b arrow keys
```

### Option 3: Background with Screen

```bash
# Start screen session for auto-resume
screen -S auto-resume
./claude-auto-resume.sh -m

# Detach with Ctrl+a d
# Reattach later with: screen -r auto-resume
```

## Desktop Integration

### Create Desktop Entry

Create `~/.local/share/applications/claude-auto-resume.desktop`:
```ini
[Desktop Entry]
Name=Claude Auto Resume
Comment=Auto-resume Claude Code after rate limit
Exec=gnome-terminal -- bash -c "~/.claude/plugins/auto-resume/claude-auto-resume.sh -m; read"
Icon=utilities-terminal
Terminal=false
Type=Application
Categories=Development;Utility;
```

### Create System Service (Advanced)

Create `~/.config/systemd/user/claude-auto-resume.service`:
```ini
[Unit]
Description=Claude Code Auto Resume Monitor

[Service]
ExecStart=/home/YOUR_USERNAME/.claude/plugins/auto-resume/claude-auto-resume.sh -m
Restart=on-failure

[Install]
WantedBy=default.target
```

Enable with:
```bash
systemctl --user enable claude-auto-resume
systemctl --user start claude-auto-resume
```

## Troubleshooting

### "xdotool not found"
```bash
# Ubuntu/Debian
sudo apt install xdotool

# Fedora
sudo dnf install xdotool

# Arch
sudo pacman -S xdotool
```

### "xclip not found" (Clipboard monitoring)
```bash
# Ubuntu/Debian
sudo apt install xclip

# Or use xsel instead
sudo apt install xsel
```

### "bc: command not found"
```bash
sudo apt install bc
```

### Permission Denied
```bash
chmod +x claude-auto-resume.sh
```

### Keystrokes Not Being Sent
1. Ensure xdotool is installed
2. Make sure you're running in an X11 session (not Wayland)
3. For Wayland, try running with XWayland

### For Wayland Users
If using Wayland, some features may not work. Try:
```bash
# Run under XWayland
GDK_BACKEND=x11 ./claude-auto-resume.sh -m
```

Or switch to X11 session at login.

### Testing the Installation
```bash
# Verify dependencies
which xdotool xclip

# Quick test
./claude-auto-resume.sh -t 5
```

## Uninstallation

```bash
# Remove plugin files
rm -rf ~/.claude/plugins/auto-resume

# Remove from PATH (edit ~/.bashrc)
# Remove the alias line you added

# Remove desktop entry
rm ~/.local/share/applications/claude-auto-resume.desktop

# Remove systemd service (if created)
systemctl --user stop claude-auto-resume
systemctl --user disable claude-auto-resume
rm ~/.config/systemd/user/claude-auto-resume.service
```
