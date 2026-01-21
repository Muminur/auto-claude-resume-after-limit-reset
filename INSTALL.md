# Installation Guide

This guide covers the automated installation process for the Claude Code Auto-Resume Plugin on Windows.

## Quick Install

### Step 1: Download or Clone the Repository

**Option A: Using Git**
```powershell
git clone https://github.com/your-username/auto-claude-resume.git
cd auto-claude-resume
```

**Option B: Download ZIP**
1. Download the repository as a ZIP file
2. Extract to your desired location
3. Open PowerShell and navigate to the extracted folder

### Step 2: Run the Installer

Open PowerShell in the plugin directory and run:

```powershell
.\install.ps1
```

The installer will:
1. Check if Node.js is installed (optional but recommended)
2. Create the required directory structure
3. Copy hook and daemon scripts
4. Update Claude Code settings.json
5. Create a startup script
6. Optionally add the daemon to Windows startup

## What Gets Installed

### Directory Structure

```
%USERPROFILE%\.claude\
├── auto-resume\
│   ├── auto-resume-daemon.js     # Main daemon script
│   ├── package.json               # Dependencies
│   ├── status.json                # Rate limit status (created at runtime)
│   └── start-daemon.ps1          # Startup script
└── hooks\
    └── rate-limit-hook.js        # Claude Code Stop hook
```

### Settings Configuration

The installer updates `~/.claude/settings.json` with:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"%USERPROFILE%\\.claude\\hooks\\rate-limit-hook.js\"",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

## Starting the Daemon

### Method 1: Manual Start

```powershell
node "%USERPROFILE%\.claude\auto-resume\auto-resume-daemon.js" -m
```

### Method 2: Using Startup Script

```powershell
powershell -ExecutionPolicy Bypass -File "%USERPROFILE%\.claude\auto-resume\start-daemon.ps1"
```

### Method 3: Automatic on Login

If you chose to add to Windows startup during installation, the daemon will start automatically when you log in.

## How It Works

1. **Rate Limit Detection**: When Claude Code stops, the Stop hook (`rate-limit-hook.js`) analyzes the session transcript
2. **Status File**: If a rate limit is detected, details are written to `status.json`
3. **Daemon Monitoring**: The daemon monitors `status.json` and calculates wait time
4. **Auto-Resume**: When the rate limit resets, the daemon automatically sends "continue" to resume your session

## Verification

To verify the installation:

1. Check that files exist:
   ```powershell
   Test-Path "$env:USERPROFILE\.claude\hooks\rate-limit-hook.js"
   Test-Path "$env:USERPROFILE\.claude\auto-resume\auto-resume-daemon.js"
   ```

2. Verify settings.json was updated:
   ```powershell
   Get-Content "$env:USERPROFILE\.claude\settings.json"
   ```

3. Test the daemon:
   ```powershell
   node "$env:USERPROFILE\.claude\auto-resume\auto-resume-daemon.js" --test 10
   ```

## Uninstallation

To remove the plugin:

```powershell
.\install.ps1 -Uninstall
```

This will:
- Stop any running daemon processes
- Remove all installed files
- Remove the hook from settings.json
- Remove the Windows startup shortcut
- Create backup files (*.backup) before deletion

## Troubleshooting

### Node.js Not Found

The installer will warn if Node.js is not installed. Install it from:
https://nodejs.org/

Minimum version: Node.js 16+

### Permission Issues

If you encounter permission errors:
1. Run PowerShell as Administrator
2. Or run the installer from the same user account that runs Claude Code

### Execution Policy Error

If you see "execution policy" errors:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Hook Not Triggering

1. Verify settings.json syntax:
   ```powershell
   Get-Content "$env:USERPROFILE\.claude\settings.json" | ConvertFrom-Json
   ```

2. Check hook script permissions
3. Ensure Node.js is in your PATH

### Daemon Not Starting

1. Check if already running:
   ```powershell
   Get-Process -Name node | Where-Object { $_.CommandLine -like "*auto-resume*" }
   ```

2. Check for errors:
   ```powershell
   node "$env:USERPROFILE\.claude\auto-resume\auto-resume-daemon.js" -m
   ```

## Manual Installation

If the automated installer fails, you can install manually:

1. Create directories:
   ```powershell
   New-Item -Path "$env:USERPROFILE\.claude\auto-resume" -ItemType Directory -Force
   New-Item -Path "$env:USERPROFILE\.claude\hooks" -ItemType Directory -Force
   ```

2. Copy files:
   ```powershell
   Copy-Item "hooks\rate-limit-hook.js" "$env:USERPROFILE\.claude\hooks\"
   Copy-Item "index.js" "$env:USERPROFILE\.claude\auto-resume\auto-resume-daemon.js"
   ```

3. Update settings.json manually (see Settings Configuration above)

## Advanced Configuration

### Custom Resume Prompt

Edit the daemon startup to use a custom prompt:

```powershell
node "%USERPROFILE%\.claude\auto-resume\auto-resume-daemon.js" -m --prompt "please continue with the previous task"
```

### Different Monitor Mode

The daemon supports multiple modes:
- `-m` or `--monitor`: Clipboard monitor (default)
- `-i` or `--interactive`: Interactive mode
- `--test <seconds>`: Test mode

### Hook Timeout

To adjust the hook timeout, edit settings.json and change the `timeout` value (in seconds).

## Support

For issues and questions:
- GitHub Issues: [Create an issue](https://github.com/your-username/auto-claude-resume/issues)
- Documentation: [README.md](README.md)

## License

MIT License - See [LICENSE](LICENSE) file for details
