<#
.SYNOPSIS
    Claude Code Auto-Resume Plugin Installer for Windows

.DESCRIPTION
    Installs the Auto-Resume plugin for Claude Code. This plugin automatically
    resumes Claude Code sessions when rate limits reset.

    Features:
    - Creates required directory structure
    - Copies hook and daemon scripts
    - Updates Claude Code settings.json with Stop hook
    - Creates startup scripts
    - Optionally adds daemon to Windows startup

.PARAMETER Uninstall
    Removes the plugin and all associated files

.EXAMPLE
    .\install.ps1
    Installs the plugin

.EXAMPLE
    .\install.ps1 -Uninstall
    Uninstalls the plugin

.NOTES
    Version: 1.0.0
    Requires: PowerShell 5.1+, Node.js 16+ (optional)
#>

param(
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

# ANSI color codes for Windows
$ESC = [char]27
$Colors = @{
    Reset   = "$ESC[0m"
    Red     = "$ESC[31m"
    Green   = "$ESC[32m"
    Yellow  = "$ESC[33m"
    Blue    = "$ESC[34m"
    Magenta = "$ESC[35m"
    Cyan    = "$ESC[36m"
}

# Paths
$HOME_DIR = $env:USERPROFILE
$CLAUDE_DIR = Join-Path $HOME_DIR ".claude"
$AUTO_RESUME_DIR = Join-Path $CLAUDE_DIR "auto-resume"
$HOOKS_DIR = Join-Path $CLAUDE_DIR "hooks"
$SETTINGS_FILE = Join-Path $CLAUDE_DIR "settings.json"
$STARTUP_FOLDER = [Environment]::GetFolderPath('Startup')

# Source files
$SCRIPT_DIR = $PSScriptRoot
$HOOK_SOURCE = Join-Path $SCRIPT_DIR "hooks\rate-limit-hook.js"
$DAEMON_SOURCE = Join-Path $SCRIPT_DIR "index.js"
$PACKAGE_JSON_SOURCE = Join-Path $SCRIPT_DIR "package.json"

# Destination files
$HOOK_DEST = Join-Path $HOOKS_DIR "rate-limit-hook.js"
$DAEMON_DEST = Join-Path $AUTO_RESUME_DIR "auto-resume-daemon.js"
$PACKAGE_JSON_DEST = Join-Path $AUTO_RESUME_DIR "package.json"
$STATUS_FILE = Join-Path $AUTO_RESUME_DIR "status.json"
$STARTUP_SCRIPT = Join-Path $AUTO_RESUME_DIR "start-daemon.ps1"
$STARTUP_LINK = Join-Path $STARTUP_FOLDER "ClaudeAutoResume.lnk"

#region Helper Functions

function Write-ColorMessage {
    param(
        [string]$Message,
        [string]$Color = "Reset"
    )
    $ColorCode = $Colors[$Color]
    Write-Host "${ColorCode}${Message}$($Colors.Reset)"
}

function Write-Success {
    param([string]$Message)
    Write-ColorMessage "[OK] $Message" "Green"
}

function Write-Info {
    param([string]$Message)
    Write-ColorMessage "[INFO] $Message" "Cyan"
}

function Write-Warning {
    param([string]$Message)
    Write-ColorMessage "[WARN] $Message" "Yellow"
}

function Write-Error {
    param([string]$Message)
    Write-ColorMessage "[ERROR] $Message" "Red"
}

function Show-Banner {
    Write-Host ""
    Write-ColorMessage "===============================================================" "Magenta"
    Write-ColorMessage "   Claude Code Auto-Resume Plugin Installer v1.0.0           " "Magenta"
    Write-ColorMessage "   Automatically resume when rate limits reset               " "Magenta"
    Write-ColorMessage "===============================================================" "Magenta"
    Write-Host ""
}

function Test-NodeInstalled {
    try {
        $nodeVersion = node --version 2>$null
        if ($nodeVersion) {
            return $true
        }
    } catch {
        return $false
    }
    return $false
}

function Backup-File {
    param([string]$FilePath)

    if (Test-Path $FilePath) {
        $BackupPath = "$FilePath.backup.$(Get-Date -Format 'yyyyMMddHHmmss')"
        Copy-Item -Path $FilePath -Destination $BackupPath -Force
        Write-Info "Backed up existing file to: $BackupPath"
    }
}

function Merge-Settings {
    param(
        [string]$SettingsPath
    )

    $hookConfig = @{
        type = "command"
        command = "node `"$HOOK_DEST`""
        timeout = 10
    }

    if (Test-Path $SettingsPath) {
        # Read existing settings
        try {
            $existingSettings = Get-Content $SettingsPath -Raw | ConvertFrom-Json

            # Convert to hashtable for easier manipulation
            $settings = @{}
            $existingSettings.PSObject.Properties | ForEach-Object {
                $settings[$_.Name] = $_.Value
            }
        } catch {
            Write-Warning "Failed to parse existing settings.json, creating new one"
            $settings = @{}
        }
    } else {
        $settings = @{}
    }

    # Ensure hooks structure exists
    if (-not $settings.ContainsKey("hooks")) {
        $settings.hooks = @{}
    } elseif ($settings.hooks -is [PSCustomObject]) {
        # Convert hooks PSCustomObject to hashtable
        $hooksHashtable = @{}
        $settings.hooks.PSObject.Properties | ForEach-Object {
            $hooksHashtable[$_.Name] = $_.Value
        }
        $settings.hooks = $hooksHashtable
    }

    # Add or update Stop hook
    if (-not $settings.hooks.ContainsKey("Stop")) {
        $settings.hooks.Stop = @()
    }

    # Check if our hook already exists
    $hookExists = $false
    foreach ($hookGroup in $settings.hooks.Stop) {
        if ($hookGroup.hooks) {
            foreach ($hook in $hookGroup.hooks) {
                if ($hook.command -like "*rate-limit-hook.js*") {
                    $hookExists = $true
                    # Update the hook
                    $hook.command = $hookConfig.command
                    $hook.timeout = $hookConfig.timeout
                    break
                }
            }
        }
        if ($hookExists) { break }
    }

    # Add new hook if it doesn't exist
    if (-not $hookExists) {
        $settings.hooks.Stop += @{
            hooks = @($hookConfig)
        }
    }

    # Write updated settings
    $settingsJson = $settings | ConvertTo-Json -Depth 10
    Set-Content -Path $SettingsPath -Value $settingsJson -Encoding UTF8
}

function Create-StartupScript {
    $scriptContent = @"
# Claude Auto-Resume Daemon Startup Script
# This script starts the auto-resume daemon in the background

`$ErrorActionPreference = 'SilentlyContinue'

# Check if daemon is already running
`$existingProcess = Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object {
    `$_.MainWindowTitle -like "*claude-auto-resume*" -or
    `$_.CommandLine -like "*auto-resume-daemon.js*"
}

if (`$existingProcess) {
    Write-Host "Claude Auto-Resume daemon is already running (PID: `$(`$existingProcess.Id))"
    exit 0
}

# Start the daemon
`$daemonPath = "$DAEMON_DEST"

if (Test-Path `$daemonPath) {
    # Start in a new hidden window
    Start-Process -FilePath "node" -ArgumentList "`"`$daemonPath`" -m" -WindowStyle Hidden -WorkingDirectory "$AUTO_RESUME_DIR"
    Write-Host "Claude Auto-Resume daemon started successfully"
} else {
    Write-Host "Error: Daemon script not found at `$daemonPath"
    exit 1
}
"@

    Set-Content -Path $STARTUP_SCRIPT -Value $scriptContent -Encoding UTF8
}

function Create-StartupShortcut {
    param([bool]$AddToStartup)

    if (-not $AddToStartup) {
        return
    }

    try {
        $WScriptShell = New-Object -ComObject WScript.Shell
        $Shortcut = $WScriptShell.CreateShortcut($STARTUP_LINK)
        $Shortcut.TargetPath = "powershell.exe"
        $Shortcut.Arguments = "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"`"$STARTUP_SCRIPT`"`""
        $Shortcut.WorkingDirectory = $AUTO_RESUME_DIR
        $Shortcut.Description = "Claude Code Auto-Resume Daemon"
        $Shortcut.Save()

        Write-Success "Added to Windows startup folder"
    } catch {
        Write-Warning "Failed to create startup shortcut: $_"
    }
}

#endregion

#region Installation Functions

function Install-Plugin {
    Show-Banner

    Write-Info "Starting installation..."
    Write-Host ""

    # Check Node.js installation
    if (-not (Test-NodeInstalled)) {
        Write-Warning "Node.js not found. The plugin requires Node.js 16+ to run."
        Write-Info "Download Node.js from: https://nodejs.org/"
        Write-Host ""
        $continue = Read-Host "Continue installation anyway? (y/N)"
        if ($continue -ne "y" -and $continue -ne "Y") {
            Write-Info "Installation cancelled"
            exit 0
        }
    } else {
        $nodeVersion = node --version
        Write-Success "Node.js found: $nodeVersion"
    }

    Write-Host ""

    # Verify source files exist
    if (-not (Test-Path $HOOK_SOURCE)) {
        Write-Error "Hook script not found: $HOOK_SOURCE"
        exit 1
    }

    if (-not (Test-Path $DAEMON_SOURCE)) {
        Write-Error "Daemon script not found: $DAEMON_SOURCE"
        exit 1
    }

    # Step 1: Create directory structure
    Write-Info "Creating directory structure..."

    @($CLAUDE_DIR, $AUTO_RESUME_DIR, $HOOKS_DIR) | ForEach-Object {
        if (-not (Test-Path $_)) {
            New-Item -Path $_ -ItemType Directory -Force | Out-Null
            Write-Success "Created: $_"
        } else {
            Write-Info "Already exists: $_"
        }
    }

    Write-Host ""

    # Step 2: Copy hook script
    Write-Info "Installing hook script..."

    if (Test-Path $HOOK_DEST) {
        Backup-File $HOOK_DEST
    }

    Copy-Item -Path $HOOK_SOURCE -Destination $HOOK_DEST -Force
    Write-Success "Installed: $HOOK_DEST"

    Write-Host ""

    # Step 3: Copy daemon script
    Write-Info "Installing daemon script..."

    if (Test-Path $DAEMON_DEST) {
        Backup-File $DAEMON_DEST
    }

    Copy-Item -Path $DAEMON_SOURCE -Destination $DAEMON_DEST -Force
    Write-Success "Installed: $DAEMON_DEST"

    # Copy package.json if it exists
    if (Test-Path $PACKAGE_JSON_SOURCE) {
        Copy-Item -Path $PACKAGE_JSON_SOURCE -Destination $PACKAGE_JSON_DEST -Force
        Write-Success "Installed: $PACKAGE_JSON_DEST"
    }

    Write-Host ""

    # Step 4: Update settings.json
    Write-Info "Updating Claude Code settings..."

    if (Test-Path $SETTINGS_FILE) {
        Backup-File $SETTINGS_FILE
    }

    try {
        Merge-Settings $SETTINGS_FILE
        Write-Success "Updated: $SETTINGS_FILE"
    } catch {
        Write-Error "Failed to update settings.json: $_"
        exit 1
    }

    Write-Host ""

    # Step 5: Create startup script
    Write-Info "Creating startup script..."

    try {
        Create-StartupScript
        Write-Success "Created: $STARTUP_SCRIPT"
    } catch {
        Write-Error "Failed to create startup script: $_"
        exit 1
    }

    Write-Host ""

    # Step 6: Ask about Windows startup
    Write-Info "Add daemon to Windows startup?"
    Write-Host "  This will automatically start the auto-resume daemon when you log in."
    $addToStartup = Read-Host "Add to startup? (y/N)"

    if ($addToStartup -eq "y" -or $addToStartup -eq "Y") {
        Create-StartupShortcut -AddToStartup $true
    } else {
        Write-Info "Skipped startup configuration"
    }

    Write-Host ""
    Write-Host ""

    # Success summary
    Write-ColorMessage "===============================================================" "Green"
    Write-ColorMessage "                Installation Complete!                        " "Green"
    Write-ColorMessage "===============================================================" "Green"
    Write-Host ""

    Write-Info "Installation Summary:"
    Write-Host "  • Hook script:     $HOOK_DEST"
    Write-Host "  • Daemon script:   $DAEMON_DEST"
    Write-Host "  • Settings:        $SETTINGS_FILE"
    Write-Host "  • Startup script:  $STARTUP_SCRIPT"
    Write-Host ""

    Write-Info "Next Steps:"
    Write-Host ""
    Write-Host "  1. Start the daemon manually:"
    Write-ColorMessage "     node `"$DAEMON_DEST`" -m" "Yellow"
    Write-Host ""
    Write-Host "  2. Or use the startup script:"
    Write-ColorMessage "     powershell -ExecutionPolicy Bypass -File `"$STARTUP_SCRIPT`"" "Yellow"
    Write-Host ""
    Write-Host "  3. The hook will automatically detect rate limits in Claude Code"
    Write-Host ""
    Write-Host "  4. The daemon will monitor and auto-resume when limits reset"
    Write-Host ""

    if ($addToStartup -ne "y" -and $addToStartup -ne "Y") {
        Write-Info "To add to Windows startup later, run the startup script manually"
        Write-Host "or create a shortcut in your Startup folder:"
        Write-ColorMessage "  $STARTUP_FOLDER" "Yellow"
    }

    Write-Host ""
}

#endregion

#region Uninstallation Functions

function Uninstall-Plugin {
    Show-Banner

    Write-Warning "Uninstalling Claude Code Auto-Resume Plugin..."
    Write-Host ""

    Write-Host "This will remove:"
    Write-Host "  • Hook script: $HOOK_DEST"
    Write-Host "  • Daemon script: $DAEMON_DEST"
    Write-Host "  • Auto-resume directory: $AUTO_RESUME_DIR"
    Write-Host "  • Settings.json hook configuration"
    Write-Host "  • Startup shortcut (if exists)"
    Write-Host ""

    $confirm = Read-Host "Are you sure? (y/N)"

    if ($confirm -ne "y" -and $confirm -ne "Y") {
        Write-Info "Uninstallation cancelled"
        exit 0
    }

    Write-Host ""

    # Stop any running daemon processes
    Write-Info "Stopping running daemon processes..."

    try {
        Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object {
            $_.CommandLine -like "*auto-resume-daemon.js*" -or
            $_.CommandLine -like "*rate-limit-hook.js*"
        } | Stop-Process -Force
        Write-Success "Stopped daemon processes"
    } catch {
        Write-Info "No daemon processes found"
    }

    Write-Host ""

    # Remove hook from settings.json
    Write-Info "Removing hook from settings.json..."

    if (Test-Path $SETTINGS_FILE) {
        try {
            Backup-File $SETTINGS_FILE

            $settings = Get-Content $SETTINGS_FILE -Raw | ConvertFrom-Json

            if ($settings.hooks -and $settings.hooks.Stop) {
                $updatedStopHooks = @()

                foreach ($hookGroup in $settings.hooks.Stop) {
                    if ($hookGroup.hooks) {
                        $filteredHooks = $hookGroup.hooks | Where-Object {
                            $_.command -notlike "*rate-limit-hook.js*"
                        }

                        if ($filteredHooks.Count -gt 0) {
                            $updatedStopHooks += @{
                                hooks = $filteredHooks
                            }
                        }
                    }
                }

                if ($updatedStopHooks.Count -eq 0) {
                    # Remove Stop hook section if empty
                    $settings.hooks.PSObject.Properties.Remove("Stop")
                } else {
                    $settings.hooks.Stop = $updatedStopHooks
                }

                $settingsJson = $settings | ConvertTo-Json -Depth 10
                Set-Content -Path $SETTINGS_FILE -Value $settingsJson -Encoding UTF8
                Write-Success "Removed hook from settings.json"
            }
        } catch {
            Write-Warning "Failed to update settings.json: $_"
        }
    }

    Write-Host ""

    # Remove files
    Write-Info "Removing files..."

    @($HOOK_DEST, $STARTUP_LINK) | ForEach-Object {
        if (Test-Path $_) {
            Remove-Item -Path $_ -Force
            Write-Success "Removed: $_"
        }
    }

    # Remove directory
    if (Test-Path $AUTO_RESUME_DIR) {
        Remove-Item -Path $AUTO_RESUME_DIR -Recurse -Force
        Write-Success "Removed: $AUTO_RESUME_DIR"
    }

    Write-Host ""
    Write-Host ""

    Write-ColorMessage "===============================================================" "Green"
    Write-ColorMessage "               Uninstallation Complete!                       " "Green"
    Write-ColorMessage "===============================================================" "Green"
    Write-Host ""

    Write-Info "All plugin files have been removed."
    Write-Host "Backup files were created with .backup extension if you need to restore."
    Write-Host ""
}

#endregion

#region Main Entry Point

try {
    # Check if running with appropriate permissions
    $currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    $isAdmin = $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

    if (-not $isAdmin) {
        Write-Warning "Not running as Administrator. Some features may be limited."
        Write-Host ""
    }

    # Execute install or uninstall
    if ($Uninstall) {
        Uninstall-Plugin
    } else {
        Install-Plugin
    }

    exit 0

} catch {
    Write-Error "Installation failed: $_"
    Write-Host ""
    Write-Host "Stack trace:"
    Write-Host $_.ScriptStackTrace
    exit 1
}

#endregion
