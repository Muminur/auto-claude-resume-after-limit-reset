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
    Version: 1.3.0
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
$PLUGIN_CACHE_DIR = Join-Path $CLAUDE_DIR "plugins\cache\auto-claude-resume"

# Source files
$SCRIPT_DIR = $PSScriptRoot
$HOOK_SOURCE = Join-Path $SCRIPT_DIR "hooks\rate-limit-hook.js"
$DAEMON_SOURCE = Join-Path $SCRIPT_DIR "auto-resume-daemon.js"
$PACKAGE_JSON_SOURCE = Join-Path $SCRIPT_DIR "package.json"
$ENSURE_DAEMON_SOURCE = Join-Path $SCRIPT_DIR "scripts\ensure-daemon-running.js"

# Destination files
$HOOK_DEST = Join-Path $HOOKS_DIR "rate-limit-hook.js"
$DAEMON_DEST = Join-Path $AUTO_RESUME_DIR "auto-resume-daemon.js"
$PACKAGE_JSON_DEST = Join-Path $AUTO_RESUME_DIR "package.json"
$ENSURE_DAEMON_DEST = Join-Path $AUTO_RESUME_DIR "ensure-daemon-running.js"
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
    Write-ColorMessage "   Claude Code Auto-Resume Plugin Installer v1.3.0           " "Magenta"
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

function Install-Dependencies {
    Write-Info "Installing npm dependencies..."

    if (-not (Test-Path $PACKAGE_JSON_DEST)) {
        Write-Warning "package.json not found, skipping npm install"
        return
    }

    # Check if npm is available
    try {
        $npmVersion = npm --version 2>$null
        if (-not $npmVersion) {
            Write-Warning "npm not found, dependencies not installed"
            Write-Warning "Please run 'npm install ws node-notifier --save' manually in: $AUTO_RESUME_DIR"
            return
        }
    } catch {
        Write-Warning "npm not found, dependencies not installed"
        Write-Warning "Please run 'npm install ws node-notifier --save' manually in: $AUTO_RESUME_DIR"
        return
    }

    # Run npm install in the auto-resume directory
    $currentDir = Get-Location
    try {
        Set-Location $AUTO_RESUME_DIR
        Write-Info "Running npm install in $AUTO_RESUME_DIR..."

        $npmOutput = npm install --production --ignore-scripts 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Success "Dependencies installed successfully"
        } else {
            Write-Warning "npm install completed with warnings"
            Write-Host $npmOutput
        }

        # Ensure critical dashboard dependencies are installed
        Write-Info "Verifying dashboard dependencies (ws, node-notifier)..."
        $dashboardOutput = npm install ws node-notifier --save 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Success "Dashboard dependencies verified"
        }
    } catch {
        Write-Warning "Failed to install dependencies: $_"
        Write-Warning "Please run 'npm install ws node-notifier --save' manually in: $AUTO_RESUME_DIR"
    } finally {
        Set-Location $currentDir
    }
}

function Install-PluginCacheDependencies {
    Write-Info "Checking plugin cache dependencies..."

    # Find plugin cache directory
    $cachePattern = Join-Path $PLUGIN_CACHE_DIR "*\*\package.json"
    $packageJsonFiles = Get-ChildItem -Path $cachePattern -ErrorAction SilentlyContinue

    if ($packageJsonFiles) {
        $versionDir = Split-Path $packageJsonFiles[0].FullName -Parent
        Write-Info "Found plugin cache at: $versionDir"

        $wsModulePath = Join-Path $versionDir "node_modules\ws"

        if (-not (Test-Path $wsModulePath)) {
            Write-Info "Installing dashboard dependencies in plugin cache..."

            $currentDir = Get-Location
            try {
                Set-Location $versionDir
                $output = npm install ws node-notifier --save 2>&1
                if ($LASTEXITCODE -eq 0) {
                    Write-Success "Plugin cache dependencies installed"
                } else {
                    Write-Warning "Plugin cache dependencies installation had warnings"
                }
            } catch {
                Write-Warning "Failed to install plugin cache dependencies: $_"
            } finally {
                Set-Location $currentDir
            }
        } else {
            Write-Success "Plugin cache dependencies already installed"
        }
    }
}

function Merge-Settings {
    param(
        [string]$SettingsPath
    )

    $stopHookConfig = @{
        type = "command"
        command = "node `"$HOOK_DEST`""
        timeout = 10
    }

    $sessionStartHookConfig = @{
        type = "command"
        command = "node `"$ENSURE_DAEMON_DEST`""
        timeout = 15
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

    $stopHookExists = $false
    foreach ($hookGroup in $settings.hooks.Stop) {
        if ($hookGroup.hooks) {
            foreach ($hook in $hookGroup.hooks) {
                if ($hook.command -like "*rate-limit-hook.js*") {
                    $stopHookExists = $true
                    $hook.command = $stopHookConfig.command
                    $hook.timeout = $stopHookConfig.timeout
                    break
                }
            }
        }
        if ($stopHookExists) { break }
    }

    if (-not $stopHookExists) {
        $settings.hooks.Stop += @{
            matcher = ""
            hooks = @($stopHookConfig)
        }
    }

    # Add or update SessionStart hook
    if (-not $settings.hooks.ContainsKey("SessionStart")) {
        $settings.hooks.SessionStart = @()
    }

    $sessionStartHookExists = $false
    foreach ($hookGroup in $settings.hooks.SessionStart) {
        if ($hookGroup.hooks) {
            foreach ($hook in $hookGroup.hooks) {
                if ($hook.command -like "*ensure-daemon-running.js*") {
                    $sessionStartHookExists = $true
                    $hook.command = $sessionStartHookConfig.command
                    $hook.timeout = $sessionStartHookConfig.timeout
                    break
                }
            }
        }
        if ($sessionStartHookExists) { break }
    }

    if (-not $sessionStartHookExists) {
        $settings.hooks.SessionStart += @{
            matcher = ""
            hooks = @($sessionStartHookConfig)
        }
    }

    # Write updated settings
    $settingsJson = $settings | ConvertTo-Json -Depth 10
    Set-Content -Path $SettingsPath -Value $settingsJson -Encoding UTF8
}

function Verify-StopHook {
    param(
        [string]$SettingsPath
    )

    Write-Host "  Verifying Stop hook registration..." -ForegroundColor Cyan

    if (-not (Test-Path $SettingsPath)) {
        Write-Host "  Settings file not found, skipping verification" -ForegroundColor Yellow
        return
    }

    try {
        $content = Get-Content $SettingsPath -Raw
        if ($content -match "rate-limit-hook\.js") {
            Write-Host "  Stop hook already registered" -ForegroundColor Green
            return
        }

        Write-Host "  Stop hook missing, adding..." -ForegroundColor Yellow
        Merge-Settings -SettingsPath $SettingsPath
        Write-Host "  Stop hook registered successfully" -ForegroundColor Green
    } catch {
        Write-Warning "  Failed to verify Stop hook: $_"
    }
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

    # Copy ensure-daemon-running.js if it exists
    if (Test-Path $ENSURE_DAEMON_SOURCE) {
        Copy-Item -Path $ENSURE_DAEMON_SOURCE -Destination $ENSURE_DAEMON_DEST -Force
        Write-Success "Installed: $ENSURE_DAEMON_DEST"
    } else {
        Write-Warning "ensure-daemon-running.js not found: $ENSURE_DAEMON_SOURCE"
    }

    # Copy tiered delivery modules (gracefully degrade on Windows)
    foreach ($dir in @("delivery", "verification", "queue")) {
        $srcPath = Join-Path $SCRIPT_DIR "src\$dir"
        $destPath = Join-Path $AUTO_RESUME_DIR "src\$dir"
        if (Test-Path $srcPath) {
            New-Item -Path $destPath -ItemType Directory -Force | Out-Null
            Copy-Item -Path "$srcPath\*.js" -Destination $destPath -Force
            Write-Success "Installed: $destPath"
        }
    }

    Write-Host ""

    # Step 3.5: Install npm dependencies
    Install-Dependencies

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

    # Step 7: Verify Stop hook registration
    Write-Info "Final verification..."
    Verify-StopHook -SettingsPath $SETTINGS_FILE

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
    Write-Info "Note: On Windows, resume uses PowerShell SendKeys (Tier 3)."
    Write-Info "Tmux/PTY delivery (Tiers 1-2) are Linux/macOS only."
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
    Write-Host "  • Plugin cache: $PLUGIN_CACHE_DIR"
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

    # Remove hooks from settings.json
    Write-Info "Removing hooks from settings.json..."

    if (Test-Path $SETTINGS_FILE) {
        try {
            Backup-File $SETTINGS_FILE

            $settings = Get-Content $SETTINGS_FILE -Raw | ConvertFrom-Json

            # Remove Stop hooks referencing rate-limit-hook
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
                    $settings.hooks.PSObject.Properties.Remove("Stop")
                } else {
                    $settings.hooks.Stop = $updatedStopHooks
                }
            }

            # Remove SessionStart hooks referencing ensure-daemon-running
            if ($settings.hooks -and $settings.hooks.SessionStart) {
                $updatedSessionStartHooks = @()

                foreach ($hookGroup in $settings.hooks.SessionStart) {
                    if ($hookGroup.hooks) {
                        $filteredHooks = $hookGroup.hooks | Where-Object {
                            $_.command -notlike "*ensure-daemon-running.js*"
                        }

                        if ($filteredHooks.Count -gt 0) {
                            $updatedSessionStartHooks += @{
                                hooks = $filteredHooks
                            }
                        }
                    }
                }

                if ($updatedSessionStartHooks.Count -eq 0) {
                    $settings.hooks.PSObject.Properties.Remove("SessionStart")
                } else {
                    $settings.hooks.SessionStart = $updatedSessionStartHooks
                }
            }

            # Clean up empty hooks object
            if ($settings.hooks -and $settings.hooks.PSObject.Properties.Count -eq 0) {
                $settings.PSObject.Properties.Remove("hooks")
            }

            $settingsJson = $settings | ConvertTo-Json -Depth 10
            Set-Content -Path $SETTINGS_FILE -Value $settingsJson -Encoding UTF8
            Write-Success "Removed hooks from settings.json"
        } catch {
            Write-Warning "Failed to update settings.json: $_"
        }
    }

    Write-Host ""

    # Remove files
    Write-Info "Removing files..."

    @($HOOK_DEST, $ENSURE_DAEMON_DEST, $STARTUP_LINK) | ForEach-Object {
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

    # Remove plugin cache
    if (Test-Path $PLUGIN_CACHE_DIR) {
        Remove-Item -Path $PLUGIN_CACHE_DIR -Recurse -Force
        Write-Success "Removed plugin cache: $PLUGIN_CACHE_DIR"
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
