# Auto-Resume Daemon Usage Guide

The auto-resume daemon is a background service that continuously watches for Claude Code rate limits and automatically resumes sessions when limits reset.

## Daemon Location

The daemon location depends on how you installed:

| Installation Method | Daemon Path |
|---------------------|-------------|
| **Plugin** (recommended) | `~/.claude/plugins/cache/auto-claude-resume/auto-resume/*/auto-resume-daemon.js` |
| **Manual** | `~/.claude/auto-resume/auto-resume-daemon.js` |

**Tip:** Use auto-discovery to find the daemon regardless of installation method:
```bash
DAEMON=$(find ~/.claude -name "auto-resume-daemon.js" 2>/dev/null | head -1)
```

## Quick Start

**Using slash commands (in Claude Code):**
```
/auto-resume:start     # Start the daemon
/auto-resume:status    # Check if it's running
/auto-resume:stop      # Stop the daemon
```

**Using terminal (auto-discovery):**
```bash
DAEMON=$(find ~/.claude -name "auto-resume-daemon.js" 2>/dev/null | head -1)

# Start the daemon
node "$DAEMON" start

# Check if it's running
node "$DAEMON" status

# Stop the daemon
node "$DAEMON" stop
```

## How It Works

### 1. Daemon Startup
When you start the daemon, it:
- Creates necessary directories (`~/.claude/auto-resume/`)
- Writes a PID file for process management
- Begins watching the status file
- Logs all activity to `daemon.log`

### 2. Rate Limit Detection
The daemon watches `~/.claude/auto-resume/status.json` for changes. When it detects a rate limit:
- Reads the `reset_time` from the status file
- Displays a live countdown timer in the console
- Logs the detection event

### 3. Automatic Resume
When the reset time arrives:
- Finds all Claude Code terminal windows (cross-platform)
- Sends "continue" + Enter keystroke to each window
- Clears the status file
- Logs the completion

### 4. Cross-Platform Support

#### Windows
- Uses PowerShell to find windows with "Claude" in title
- Uses `System.Windows.Forms.SendKeys` to send keystrokes
- No additional dependencies required

#### macOS
- Uses osascript to find Terminal/iTerm/iTerm2 windows
- Uses AppleScript `keystroke` commands
- Built into macOS, no installation needed

#### Linux
- Uses xdotool to find terminal windows
- Searches for common terminal emulators (gnome-terminal, konsole, xterm, etc.)
- **Requires xdotool installation:**
  ```bash
  # Ubuntu/Debian
  sudo apt-get install xdotool

  # RHEL/CentOS
  sudo yum install xdotool

  # Arch
  sudo pacman -S xdotool
  ```

## Status File Format

The daemon expects a JSON status file at `~/.claude/auto-resume/status.json`:

```json
{
  "detected": true,
  "reset_time": "2026-01-21T20:00:00.000Z",
  "message": "You've hit your limit · resets 8pm (Asia/Dhaka)",
  "timezone": "Asia/Dhaka"
}
```

### Required Fields
- `detected` (boolean): Must be `true` to trigger countdown
- `reset_time` (ISO 8601 string): When the rate limit resets (in UTC or with timezone)

### Optional Fields
- `message` (string): The original rate limit message (for logging)
- `timezone` (string): The timezone name (for logging)

## Commands

### Start Daemon
```bash
node auto-resume-daemon.js start
```
Starts the daemon in the foreground. The daemon will:
- Display a banner
- Show the PID and log file location
- Begin watching for status changes
- Display countdown timers when rate limits are detected

**Output:**
```
  ╔═══════════════════════════════════════════════════════════════╗
  ║      Claude Code Auto-Resume Daemon v1.0.0                 ║
  ║      Background service for automatic session resume          ║
  ╚═══════════════════════════════════════════════════════════════╝

[SUCCESS] Daemon started (PID: 12345)
[INFO] Log file: /home/user/.claude/auto-resume/daemon.log
[INFO] PID file: /home/user/.claude/auto-resume/daemon.pid
[SUCCESS] Watching status file for changes...
[INFO] Status file: /home/user/.claude/auto-resume/status.json
[INFO] Press Ctrl+C to stop daemon
```

### Stop Daemon
```bash
node auto-resume-daemon.js stop
```
Gracefully stops the running daemon:
- Sends SIGTERM signal
- Waits up to 5 seconds for graceful shutdown
- Force kills if necessary
- Removes PID file

**Output:**
```
[INFO] Stopping daemon (PID: 12345)...
[SUCCESS] Daemon stopped successfully
```

### Check Status
```bash
node auto-resume-daemon.js status
```
Checks if the daemon is running and shows its status:
- Reads the PID file
- Verifies the process is running
- Displays current status file contents (if available)

**Output (running):**
```
[SUCCESS] Daemon is running (PID: 12345)
[INFO] Status: {
  "detected": true,
  "reset_time": "2026-01-21T20:00:00.000Z",
  "message": "You've hit your limit · resets 8pm (Asia/Dhaka)",
  "timezone": "Asia/Dhaka"
}
```

**Output (not running):**
```
[INFO] Daemon is not running (no PID file)
```

### Restart Daemon
```bash
node auto-resume-daemon.js restart
```
Stops and then starts the daemon:
- Calls stop command
- Waits 1 second
- Calls start command

## Process Management

### PID File
Location: `~/.claude/auto-resume/daemon.pid`

Contains the process ID of the running daemon. Used to:
- Check if daemon is already running
- Send signals to the daemon
- Prevent multiple instances

### Log File
Location: `~/.claude/auto-resume/daemon.log`

Contains timestamped log entries:
```
[2026-01-21T14:30:00.000Z] INFO: Daemon started (PID: 12345)
[2026-01-21T14:30:00.100Z] INFO: Watching status file for changes...
[2026-01-21T14:32:15.500Z] WARNING: Rate limit detected!
[2026-01-21T14:32:15.501Z] INFO: Reset time: 1/21/2026, 8:00:00 PM
[2026-01-21T20:00:05.000Z] SUCCESS: Sent: 'continue' + Enter to terminal windows
[2026-01-21T20:00:05.001Z] SUCCESS: Auto-resume completed!
```

### Graceful Shutdown
The daemon handles these signals:
- `SIGINT` (Ctrl+C): Graceful shutdown
- `SIGTERM`: Graceful shutdown
- `uncaughtException`: Logs error and shuts down

On shutdown, the daemon:
1. Stops the file watcher
2. Stops any active countdown
3. Removes the PID file
4. Logs shutdown event
5. Exits cleanly

## Integration with Claude Code Plugin

To integrate the daemon with your Claude Code plugin, create a status writer:

```javascript
const fs = require('fs');
const path = require('path');
const os = require('os');

function writeRateLimitStatus(resetTime, message, timezone) {
  const statusDir = path.join(os.homedir(), '.claude', 'auto-resume');
  const statusFile = path.join(statusDir, 'status.json');

  // Ensure directory exists
  if (!fs.existsSync(statusDir)) {
    fs.mkdirSync(statusDir, { recursive: true });
  }

  // Write status
  const status = {
    detected: true,
    reset_time: resetTime.toISOString(),
    message: message,
    timezone: timezone,
    timestamp: new Date().toISOString()
  };

  fs.writeFileSync(statusFile, JSON.stringify(status, null, 2));
  console.log('Rate limit status written to:', statusFile);
}

// Example usage when rate limit detected
const resetTime = new Date('2026-01-21T20:00:00.000Z');
writeRateLimitStatus(
  resetTime,
  "You've hit your limit · resets 8pm (Asia/Dhaka)",
  "Asia/Dhaka"
);
```

## Troubleshooting

### Daemon Won't Start
**Problem:** "Daemon is already running"

**Solution:**
```bash
# Check if it's actually running
node auto-resume-daemon.js status

# If stale, remove PID file
rm ~/.claude/auto-resume/daemon.pid

# Try starting again
node auto-resume-daemon.js start
```

### Status File Not Detected
**Problem:** Daemon runs but doesn't detect status changes

**Solution:**
1. Check status file location:
   ```bash
   ls -la ~/.claude/auto-resume/status.json
   ```

2. Verify file format:
   ```bash
   cat ~/.claude/auto-resume/status.json
   ```

3. Check daemon logs:
   ```bash
   tail -f ~/.claude/auto-resume/daemon.log
   ```

### Keystrokes Not Sent (Linux)
**Problem:** Countdown completes but "continue" not sent

**Solution:**
```bash
# Check if xdotool is installed
which xdotool

# Install if missing
sudo apt-get install xdotool  # Ubuntu/Debian
```

### Multiple Windows Behavior
**Problem:** "continue" sent to all terminal windows

**Behavior:** This is intentional. The daemon finds all terminal windows that might have Claude Code running and sends the keystroke to each.

**Note:** If you have multiple Claude Code sessions, they will all receive the "continue" command.

## Advanced Usage

### Custom Status File Location
Modify the daemon source to use a different status file:

```javascript
// Change this line near the top of auto-resume-daemon.js
const STATUS_FILE = path.join(HOME_DIR, '.claude', 'auto-resume', 'status.json');
```

### Running as System Service

#### Linux (systemd)
Create `/etc/systemd/system/claude-resume-daemon.service`:

```ini
[Unit]
Description=Claude Code Auto-Resume Daemon
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/path/to/AutoClaudeResume
ExecStart=/usr/bin/node /path/to/AutoClaudeResume/auto-resume-daemon.js start
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Then:
```bash
sudo systemctl daemon-reload
sudo systemctl enable claude-resume-daemon
sudo systemctl start claude-resume-daemon
sudo systemctl status claude-resume-daemon
```

#### macOS (launchd)
Create `~/Library/LaunchAgents/com.claude.resume-daemon.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.claude.resume-daemon</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/path/to/AutoClaudeResume/auto-resume-daemon.js</string>
        <string>start</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardErrorPath</key>
    <string>/tmp/claude-resume-daemon.err</string>
    <key>StandardOutPath</key>
    <string>/tmp/claude-resume-daemon.out</string>
</dict>
</plist>
```

Then:
```bash
launchctl load ~/Library/LaunchAgents/com.claude.resume-daemon.plist
launchctl start com.claude.resume-daemon
launchctl list | grep claude
```

#### Windows (Task Scheduler)
1. Open Task Scheduler
2. Create Basic Task
3. Name: "Claude Resume Daemon"
4. Trigger: At startup
5. Action: Start a program
   - Program: `C:\Program Files\nodejs\node.exe`
   - Arguments: `C:\path\to\AutoClaudeResume\auto-resume-daemon.js start`
6. Settings: Run whether user is logged on or not

### Multiple Daemon Instances
To run multiple daemons watching different status files:

1. Copy the daemon file:
   ```bash
   cp auto-resume-daemon.js auto-resume-daemon-2.js
   ```

2. Modify the paths in the copy:
   ```javascript
   const BASE_DIR = path.join(HOME_DIR, '.claude', 'auto-resume-2');
   ```

3. Start both:
   ```bash
   node auto-resume-daemon.js start
   node auto-resume-daemon-2.js start
   ```

## NPM Scripts

If you've installed via npm, you can use these shortcuts:

```bash
# Start daemon
npm run daemon:start

# Stop daemon
npm run daemon:stop

# Check status
npm run daemon:status

# Restart daemon
npm run daemon:restart
```

## Security Considerations

1. **PID File Access:** The PID file is world-readable. Anyone can see the daemon is running.

2. **Log File:** The log file contains rate limit messages. Ensure proper permissions:
   ```bash
   chmod 600 ~/.claude/auto-resume/daemon.log
   ```

3. **Keystroke Injection:** The daemon injects keystrokes into terminal windows. This could be a security concern if malicious status files are written.

4. **Status File Validation:** The daemon validates the status file format but not the authenticity. Consider adding checksums or signatures for production use.

## Performance

- **CPU Usage:** Minimal (<0.1% on modern systems)
- **Memory:** ~30-50 MB Node.js process
- **Disk I/O:** Status file checked every 1 second (negligible)
- **Network:** None (local file watching only)

## Limitations

1. **Single Status File:** Watches only one status file at a time
2. **No Authentication:** Anyone can write to the status file
3. **Window Detection:** May send to non-Claude terminal windows
4. **No Notification:** Operates silently unless logs are monitored
5. **Platform-Specific:** Terminal detection methods vary by OS

## Future Enhancements

Possible improvements for future versions:
- Multiple status file watching
- WebSocket-based status updates
- Desktop notifications
- Configuration file support
- Auto-start on system boot
- Status API endpoint
- Plugin system for custom actions
- Rate limit prediction/analytics
