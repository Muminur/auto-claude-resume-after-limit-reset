# Windows Installation Guide

Complete guide for installing Auto Claude Resume on Windows 10/11.

## Prerequisites

- Windows 10 or Windows 11
- PowerShell 5.1+ (pre-installed on Windows 10/11)
- Node.js 16+ (optional, for Node.js version)

## Method 1: PowerShell Script (Recommended)

### Step 1: Download the Plugin

**Option A: Clone with Git**
```powershell
git clone https://github.com/Muminur/auto-claude-resume-after-limit-reset.git
cd auto-claude-resume-after-limit-reset
```

**Option B: Download ZIP**
1. Go to https://github.com/Muminur/auto-claude-resume-after-limit-reset
2. Click "Code" > "Download ZIP"
3. Extract to your desired location
4. Open PowerShell and navigate to the folder

### Step 2: Set Execution Policy (One-time)

Open PowerShell as Administrator and run:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Step 3: Run the Script

```powershell
# Navigate to the plugin directory
cd path\to\auto-claude-resume-after-limit-reset

# Run the script
.\claude-auto-resume.ps1
```

### Step 4: Choose Operation Mode

When prompted, select:
1. **Clipboard Monitor** - Monitors clipboard for rate limit messages
2. **Interactive Mode** - Paste messages directly
3. **Test Mode** - Test with 30-second countdown

## Method 2: Node.js Version

### Step 1: Install Node.js

1. Download from https://nodejs.org/
2. Run the installer
3. Verify installation:
```powershell
node --version
```

### Step 2: Download and Run

```powershell
git clone https://github.com/Muminur/auto-claude-resume-after-limit-reset.git
cd auto-claude-resume-after-limit-reset
node index.js
```

## Usage Examples

### Basic Usage
```powershell
# Interactive menu
.\claude-auto-resume.ps1

# Direct clipboard monitoring
.\claude-auto-resume.ps1 -MonitorMode

# Test with 10-second countdown
.\claude-auto-resume.ps1 -TestMode 10

# Custom prompt
.\claude-auto-resume.ps1 -Prompt "please continue with the task"
```

### Node.js Usage
```powershell
# Interactive mode
node index.js -i

# Monitor clipboard
node index.js -m

# Test mode
node index.js --test 30
```

## Claude Code Plugin Setup

### Step 1: Create Plugin Directory

```powershell
mkdir "$env:USERPROFILE\.claude\plugins\auto-resume"
```

### Step 2: Copy Files

```powershell
# Copy all plugin files
Copy-Item -Path ".\*" -Destination "$env:USERPROFILE\.claude\plugins\auto-resume\" -Recurse
```

### Step 3: Create Claude Code Hook

Create or edit `$env:USERPROFILE\.claude\settings.json`:

```json
{
  "hooks": {
    "on_rate_limit": {
      "command": "powershell -ExecutionPolicy Bypass -File \"$env:USERPROFILE\\.claude\\plugins\\auto-resume\\claude-auto-resume.ps1\" -MonitorMode"
    }
  }
}
```

### Step 4: Create Desktop Shortcut (Optional)

1. Right-click on Desktop > New > Shortcut
2. Enter location:
   ```
   powershell.exe -ExecutionPolicy Bypass -File "%USERPROFILE%\.claude\plugins\auto-resume\claude-auto-resume.ps1"
   ```
3. Name it "Claude Auto Resume"

## Running Alongside Claude Code

### Option 1: Separate Terminal Window

1. Open a new PowerShell window
2. Run the auto-resume script in clipboard monitor mode:
   ```powershell
   .\claude-auto-resume.ps1 -MonitorMode
   ```
3. When Claude Code hits rate limit, copy the message
4. The script will detect it and start countdown

### Option 2: Split Terminal (Windows Terminal)

1. Open Windows Terminal
2. Split the terminal (Alt+Shift+D)
3. Run Claude Code in one pane
4. Run auto-resume in the other:
   ```powershell
   .\claude-auto-resume.ps1 -MonitorMode
   ```

## Troubleshooting

### "Execution Policy" Error
Run PowerShell as Administrator:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### "Access Denied" When Sending Keystrokes
- Run PowerShell as Administrator
- Or use the script in the same terminal session as Claude Code

### Script Not Finding Claude Code Window
Use the `-WindowTitle` parameter:
```powershell
.\claude-auto-resume.ps1 -WindowTitle "Claude"
```

### Testing the Installation
```powershell
# Quick test with 5-second countdown
.\claude-auto-resume.ps1 -TestMode 5
```

## Uninstallation

```powershell
# Remove plugin files
Remove-Item -Recurse -Force "$env:USERPROFILE\.claude\plugins\auto-resume"
```
