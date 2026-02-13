<#
.SYNOPSIS
    Claude Code Auto-Resume Plugin for Windows
    Automatically resumes Claude Code terminal sessions when rate limits reset.

.DESCRIPTION
    This script monitors a Claude Code terminal window for rate limit messages
    and automatically sends "continue" when the limit resets.

    Rate limit message pattern: "You've hit your limit · resets Xpm (Timezone)"

.PARAMETER MonitorMode
    Run in continuous monitoring mode (default)

.PARAMETER TestMode
    Test mode with simulated wait time in seconds

.PARAMETER Prompt
    Custom prompt to send (default: "continue")

.PARAMETER WindowTitle
    Partial title of the Claude Code terminal window to monitor

.EXAMPLE
    .\claude-auto-resume.ps1

.EXAMPLE
    .\claude-auto-resume.ps1 -Prompt "please continue" -WindowTitle "Claude"

.NOTES
    Version: 1.0.0
    Requires: Windows 10/11 with PowerShell 5.1+
#>

[CmdletBinding()]
param(
    [Parameter()]
    [switch]$MonitorMode,

    [Parameter()]
    [int]$TestMode = 0,

    [Parameter()]
    [string]$Prompt = "continue",

    [Parameter()]
    [string]$WindowTitle = "",

    [Parameter()]
    [switch]$Help,

    [Parameter()]
    [switch]$ShowVersion
)

# Version information
$script:SCRIPT_VERSION = "1.0.0"

# Color definitions for output
$script:Colors = @{
    Info    = "Cyan"
    Success = "Green"
    Warning = "Yellow"
    Error   = "Red"
    Highlight = "Magenta"
}

function Write-ColorOutput {
    param(
        [string]$Message,
        [string]$Color = "White",
        [switch]$NoNewline
    )
    if ($NoNewline) {
        Write-Host $Message -ForegroundColor $Color -NoNewline
    } else {
        Write-Host $Message -ForegroundColor $Color
    }
}

function Show-Banner {
    $banner = @"

  ╔═══════════════════════════════════════════════════════════════╗
  ║         Claude Code Auto-Resume Plugin v$($script:SCRIPT_VERSION)              ║
  ║     Automatically resume when rate limits reset               ║
  ╚═══════════════════════════════════════════════════════════════╝

"@
    Write-ColorOutput $banner -Color $script:Colors.Highlight
}

function Show-Help {
    Show-Banner
    $help = @"
USAGE:
    .\claude-auto-resume.ps1 [OPTIONS]

OPTIONS:
    -MonitorMode        Run in continuous monitoring mode (default behavior)
    -TestMode <seconds> Test mode with simulated wait time
    -Prompt <text>      Custom prompt to send (default: "continue")
    -WindowTitle <text> Partial title of Claude Code terminal to monitor
    -Help               Show this help message
    -ShowVersion        Show version information

EXAMPLES:
    # Basic usage - monitor and auto-resume
    .\claude-auto-resume.ps1

    # With custom prompt
    .\claude-auto-resume.ps1 -Prompt "please continue with the task"

    # Test mode with 30 second wait
    .\claude-auto-resume.ps1 -TestMode 30

    # Monitor specific window
    .\claude-auto-resume.ps1 -WindowTitle "my-project"

HOW IT WORKS:
    1. Monitors clipboard and console output for rate limit messages
    2. Parses the reset time from messages like:
       "You've hit your limit · resets 8pm (Asia/Dhaka)"
    3. Calculates wait time until reset
    4. Automatically sends "continue" when limit resets

RATE LIMIT PATTERN:
    The script detects: "You've hit your limit · resets <time> (<timezone>)"

NOTE:
    This script requires appropriate permissions to send keystrokes.
    Run PowerShell as Administrator if you encounter permission issues.

"@
    Write-Host $help
}

function Show-Version {
    Write-Host "claude-auto-resume v$script:SCRIPT_VERSION"
    Write-Host "Platform: Windows PowerShell"
}

function Get-TimeZoneOffset {
    param([string]$TimezoneName)

    # Common timezone mappings to UTC offset in hours
    $timezones = @{
        # Asia
        "Asia/Dhaka"       = 6
        "Asia/Kolkata"     = 5.5
        "Asia/Tokyo"       = 9
        "Asia/Shanghai"    = 8
        "Asia/Singapore"   = 8
        "Asia/Seoul"       = 9
        "Asia/Dubai"       = 4
        "Asia/Jakarta"     = 7
        "Asia/Manila"      = 8
        "Asia/Bangkok"     = 7
        "Asia/Hong_Kong"   = 8
        # Americas
        "America/New_York" = -5
        "America/Los_Angeles" = -8
        "America/Chicago"  = -6
        "America/Denver"   = -7
        "America/Toronto"  = -5
        "America/Vancouver" = -8
        "America/Sao_Paulo" = -3
        # Europe
        "Europe/London"    = 0
        "Europe/Paris"     = 1
        "Europe/Berlin"    = 1
        "Europe/Moscow"    = 3
        "Europe/Amsterdam" = 1
        # Australia
        "Australia/Sydney" = 11
        "Australia/Melbourne" = 11
        "Australia/Perth"  = 8
        # Pacific
        "Pacific/Auckland" = 13
        "Pacific/Honolulu" = -10
        # UTC
        "UTC"              = 0
        "GMT"              = 0
    }

    if ($timezones.ContainsKey($TimezoneName)) {
        return $timezones[$TimezoneName]
    }

    # Try to get system timezone offset
    try {
        $tz = [System.TimeZoneInfo]::FindSystemTimeZoneById($TimezoneName)
        return $tz.BaseUtcOffset.TotalHours
    } catch {
        # Default to local timezone
        return ([System.TimeZoneInfo]::Local).BaseUtcOffset.TotalHours
    }
}

function Parse-ResetTime {
    <#
    .SYNOPSIS
        Parses the reset time from Claude Code rate limit message
    .DESCRIPTION
        Extracts and converts reset time from format like "resets 8pm (Asia/Dhaka)"
    #>
    param([string]$Message)

    # Pattern: "resets Xam/pm (Timezone)" or "resets X:XXam/pm (Timezone)"
    $pattern = "resets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*\(([^)]+)\)"

    if ($Message -match $pattern) {
        $hour = [int]$Matches[1]
        $minute = if ($Matches[2]) { [int]$Matches[2] } else { 0 }
        $period = $Matches[3].ToLower()
        $timezone = $Matches[4]

        Write-ColorOutput "[DEBUG] Parsed: Hour=$hour, Minute=$minute, Period=$period, Timezone=$timezone" -Color $script:Colors.Info

        # Convert to 24-hour format
        if ($period -eq "am") {
            if ($hour -eq 12) { $hour = 0 }
        } else {
            if ($hour -ne 12) { $hour += 12 }
        }

        # Get timezone offset
        $tzOffset = Get-TimeZoneOffset -TimezoneName $timezone
        $localOffset = ([System.TimeZoneInfo]::Local).BaseUtcOffset.TotalHours

        # Calculate the reset time in local timezone
        $now = Get-Date
        $resetTimeToday = Get-Date -Hour $hour -Minute $minute -Second 0

        # Adjust for timezone difference
        $offsetDiff = $localOffset - $tzOffset
        $resetTimeLocal = $resetTimeToday.AddHours($offsetDiff)

        # If reset time has passed today, it's tomorrow
        if ($resetTimeLocal -lt $now) {
            $resetTimeLocal = $resetTimeLocal.AddDays(1)
        }

        return $resetTimeLocal
    }

    return $null
}

function Parse-RateLimitMessage {
    <#
    .SYNOPSIS
        Parses rate limit message and returns reset timestamp
    #>
    param([string]$Message)

    # Check for rate limit pattern
    if ($Message -match "You've hit your limit") {
        return Parse-ResetTime -Message $Message
    }

    # Alternative pattern: "hit your limit" without "You've"
    if ($Message -match "hit your limit.*resets") {
        return Parse-ResetTime -Message $Message
    }

    return $null
}

function Format-TimeSpan {
    param([TimeSpan]$TimeSpan)

    if ($TimeSpan.TotalSeconds -lt 0) {
        return "00:00:00"
    }

    return "{0:D2}:{1:D2}:{2:D2}" -f [int]$TimeSpan.Hours, $TimeSpan.Minutes, $TimeSpan.Seconds
}

function Send-KeystrokesToWindow {
    <#
    .SYNOPSIS
        Sends keystrokes to a window using WScript.Shell (more reliable)
    #>
    param(
        [string]$Text,
        [string]$WindowTitle = ""
    )

    try {
        # Create WScript.Shell object
        $shell = New-Object -ComObject WScript.Shell

        if ($WindowTitle) {
            # Try to activate specific window
            $activated = $shell.AppActivate($WindowTitle)
            if (-not $activated) {
                Write-ColorOutput "[WARNING] Could not find window with title containing: $WindowTitle" -Color $script:Colors.Warning
                Write-ColorOutput "[INFO] Will try to send to foreground window" -Color $script:Colors.Info
            }
            Start-Sleep -Milliseconds 500
        }

        # Use WScript.Shell SendKeys method (more reliable than System.Windows.Forms)
        $shell.SendKeys($Text)
        Start-Sleep -Milliseconds 100
        $shell.SendKeys("{ENTER}")

        Write-ColorOutput "[SUCCESS] Sent: '$Text' + Enter" -Color $script:Colors.Success
    }
    catch {
        Write-ColorOutput "[WARNING] Primary method failed, trying alternative..." -Color $script:Colors.Warning

        try {
            # Fallback to System.Windows.Forms
            Add-Type -AssemblyName System.Windows.Forms
            [System.Windows.Forms.SendKeys]::SendWait($Text)
            Start-Sleep -Milliseconds 100
            [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
            Write-ColorOutput "[SUCCESS] Sent: '$Text' + Enter (using fallback method)" -Color $script:Colors.Success
        }
        catch {
            Write-ColorOutput "[ERROR] Failed to send keystrokes: $_" -Color $script:Colors.Error
            Write-ColorOutput "[INFO] Please ensure this script is run in an interactive PowerShell window" -Color $script:Colors.Info
        }
    }
}

function Wait-ForResetTime {
    <#
    .SYNOPSIS
        Waits until the specified reset time with countdown display
    #>
    param(
        [DateTime]$ResetTime,
        [string]$Prompt,
        [string]$WindowTitle
    )

    Write-ColorOutput "`n[INFO] Rate limit detected!" -Color $script:Colors.Warning
    Write-ColorOutput "[INFO] Reset time: $($ResetTime.ToString('yyyy-MM-dd HH:mm:ss'))" -Color $script:Colors.Info

    $startTime = Get-Date

    while ((Get-Date) -lt $ResetTime) {
        $remaining = $ResetTime - (Get-Date)
        $formatted = Format-TimeSpan -TimeSpan $remaining

        Write-Host "`r[WAITING] Resuming in $formatted... " -NoNewline -ForegroundColor $script:Colors.Warning

        Start-Sleep -Seconds 1
    }

    Write-Host "`r[READY] Reset time reached!                    " -ForegroundColor $script:Colors.Success
    Write-ColorOutput ""

    # Add a small buffer after reset time
    Start-Sleep -Seconds 5

    # Send the continue prompt
    Write-ColorOutput "[ACTION] Sending resume prompt..." -Color $script:Colors.Info
    Send-KeystrokesToWindow -Text $Prompt -WindowTitle $WindowTitle

    Write-ColorOutput "[SUCCESS] Auto-resume completed!" -Color $script:Colors.Success
}

function Start-ClipboardMonitor {
    <#
    .SYNOPSIS
        Monitors clipboard for rate limit messages
    #>
    param(
        [string]$Prompt,
        [string]$WindowTitle
    )

    Write-ColorOutput "[INFO] Starting clipboard monitor..." -Color $script:Colors.Info
    Write-ColorOutput "[INFO] Copy the rate limit message to clipboard to trigger auto-resume" -Color $script:Colors.Info
    Write-ColorOutput "[INFO] Press Ctrl+C to stop monitoring`n" -Color $script:Colors.Info

    $lastClipboard = ""

    while ($true) {
        try {
            $currentClipboard = Get-Clipboard -ErrorAction SilentlyContinue

            if ($currentClipboard -and $currentClipboard -ne $lastClipboard) {
                $lastClipboard = $currentClipboard

                $resetTime = Parse-RateLimitMessage -Message $currentClipboard

                if ($resetTime) {
                    Wait-ForResetTime -ResetTime $resetTime -Prompt $Prompt -WindowTitle $WindowTitle
                    # Continue monitoring after resume
                    Write-ColorOutput "`n[INFO] Continuing to monitor..." -Color $script:Colors.Info
                }
            }

            Start-Sleep -Milliseconds 500
        } catch {
            # Ignore clipboard errors
        }
    }
}

function Start-InteractiveMode {
    <#
    .SYNOPSIS
        Interactive mode where user can paste the rate limit message
    #>
    param(
        [string]$Prompt,
        [string]$WindowTitle
    )

    Write-ColorOutput "[INFO] Interactive mode started" -Color $script:Colors.Info
    Write-ColorOutput "[INFO] Paste the rate limit message below (or type 'exit' to quit):`n" -Color $script:Colors.Info

    while ($true) {
        Write-Host "Enter message: " -NoNewline -ForegroundColor $script:Colors.Highlight
        $input = Read-Host

        if ($input -eq "exit" -or $input -eq "quit") {
            Write-ColorOutput "[INFO] Exiting..." -Color $script:Colors.Info
            break
        }

        $resetTime = Parse-RateLimitMessage -Message $input

        if ($resetTime) {
            Wait-ForResetTime -ResetTime $resetTime -Prompt $Prompt -WindowTitle $WindowTitle
            Write-ColorOutput "`n[INFO] Ready for next rate limit message (or 'exit' to quit)`n" -Color $script:Colors.Info
        } else {
            Write-ColorOutput "[WARNING] Could not parse rate limit message. Expected format:" -Color $script:Colors.Warning
            Write-ColorOutput "         'You've hit your limit · resets 8pm (Asia/Dhaka)'" -Color $script:Colors.Info
        }
    }
}

function Start-TestMode {
    <#
    .SYNOPSIS
        Test mode with simulated wait time
    #>
    param(
        [int]$WaitSeconds,
        [string]$Prompt,
        [string]$WindowTitle
    )

    Write-ColorOutput "[TEST MODE] Simulating rate limit with $WaitSeconds seconds wait" -Color $script:Colors.Warning

    $resetTime = (Get-Date).AddSeconds($WaitSeconds)
    Wait-ForResetTime -ResetTime $resetTime -Prompt $Prompt -WindowTitle $WindowTitle
}

# Main execution
function Main {
    # Handle help and version flags
    if ($Help) {
        Show-Help
        return
    }

    if ($ShowVersion) {
        Show-Version
        return
    }

    Show-Banner

    # Check for test mode
    if ($TestMode -gt 0) {
        Start-TestMode -WaitSeconds $TestMode -Prompt $Prompt -WindowTitle $WindowTitle
        return
    }

    # Ask user for preferred mode
    Write-ColorOutput "Select operation mode:" -Color $script:Colors.Highlight
    Write-ColorOutput "  1. Clipboard Monitor (copy rate limit message to trigger)" -Color $script:Colors.Info
    Write-ColorOutput "  2. Interactive Mode (paste message directly)" -Color $script:Colors.Info
    Write-ColorOutput "  3. Test Mode (simulate with 30 second wait)" -Color $script:Colors.Info
    Write-Host ""
    Write-Host "Enter choice (1-3): " -NoNewline -ForegroundColor $script:Colors.Highlight

    $choice = Read-Host

    switch ($choice) {
        "1" {
            Start-ClipboardMonitor -Prompt $Prompt -WindowTitle $WindowTitle
        }
        "2" {
            Start-InteractiveMode -Prompt $Prompt -WindowTitle $WindowTitle
        }
        "3" {
            Start-TestMode -WaitSeconds 30 -Prompt $Prompt -WindowTitle $WindowTitle
        }
        default {
            Write-ColorOutput "[INFO] Defaulting to Clipboard Monitor mode" -Color $script:Colors.Info
            Start-ClipboardMonitor -Prompt $Prompt -WindowTitle $WindowTitle
        }
    }
}

# Run main
Main
