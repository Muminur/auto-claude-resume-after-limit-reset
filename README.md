# Auto Claude Resume

A Claude Code plugin that automatically resumes your sessions when rate limits reset.

## Core Features

- **Automatic Detection**: Detects rate limits without any user intervention
- **Auto-Resume**: Sends "continue" to your terminal when limits reset
- **Auto-Start Daemon**: Daemon starts automatically when you open Claude Code
- **Background Daemon**: Runs silently, always ready to resume your sessions
- **Cross-Platform**: Windows, Linux, macOS support
- **Zero Configuration**: Just install and forget

## New Features

### 1. Configuration System (`config-manager.js`)
Manage all plugin settings via a centralized configuration file:
- Resume prompt customization
- Check interval adjustment
- Log level control
- Notification preferences
- WebSocket and REST API configuration
- Analytics retention settings
- Plugin directory management

### 2. Desktop Notifications (`notification-manager.js`)
Receive desktop notifications for all events:
- Rate limit detection alerts with time remaining
- Session resume notifications
- Windows PowerShell fallback for reliability
- Configurable sound and timeout options
- Cross-platform support (Windows, macOS, Linux)

### 3. Multiple Status File Watching (`status-watcher.js`)
Monitor multiple Claude Code sessions simultaneously:
- Watch multiple status.json files at once
- Real-time status aggregation
- Event-based notifications for rate limit changes
- Automatic session detection and labeling
- Graceful error handling

### 4. WebSocket Real-time Updates (`websocket-server.js`)
Real-time data streaming to connected clients:
- Live session status updates
- Rate limit countdown timers
- Analytics data streaming
- Web GUI dashboard integration
- Configurable port and auto-reconnection

### 5. REST API Endpoint (`api-server.js`)
Full-featured HTTP API for external integration:
- Query daemon status and sessions
- Manual session resume triggers
- Configuration management endpoints
- Analytics data retrieval
- Daemon control commands

### 6. Rate Limit Analytics & Prediction (`analytics-collector.js`)
Deep insights into your rate limit patterns:
- Track rate limit events and resume history
- Statistical analysis (averages, peaks, trends)
- Predictive modeling for next rate limit
- Historical data export and cleanup
- 30-day data retention (configurable)

### 7. Plugin System (`plugin-loader.js`)
Extend functionality with custom plugins:
- Hook system for custom actions
- Plugins for rate limit events, resume, status changes
- Plugin discovery and lifecycle management
- JavaScript plugin development support
- Example plugins included (log-to-file, slack-notify, console-logger)

### 8. Web GUI Dashboard (`gui/`)
Beautiful cyberpunk-themed monitoring interface:
- Real-time session monitoring with countdowns
- Rate limit analytics and charts
- Interactive configuration panel
- Quick action buttons
- WebSocket-powered live updates
- Dark theme with neon accents

## New Commands

### Configuration Management
```
/auto-resume:config [--get <key>] [--set <key> <value>] [--reset]
```

Access and modify plugin configuration:
```bash
# View all configuration
/auto-resume:config --get

# View specific setting
/auto-resume:config --get notifications.enabled

# Update a setting
/auto-resume:config --set notifications.enabled true

# Reset to defaults
/auto-resume:config --reset
```

### Web Dashboard
```
/auto-resume:gui
```

Open the web-based monitoring dashboard. Displays real-time sessions, analytics, and controls.

### View Analytics
```
/auto-resume:analytics [--format json|text] [--days 7|30|all]
```

Display statistics and predictions:
```bash
# Show last 7 days of analytics
/auto-resume:analytics --days 7

# Export as JSON
/auto-resume:analytics --format json
```

### Test Notifications
```
/auto-resume:notify [--title <text>] [--message <text>]
```

Test desktop notification system:
```bash
# Send test notification
/auto-resume:notify --title "Test" --message "Notifications working!"
```

## Installation

### One-Line Install (Recommended)

**Linux / macOS:**
```bash
curl -fsSL https://raw.githubusercontent.com/Muminur/auto-claude-resume-after-limit-reset/main/quick-install.sh | bash
```

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/Muminur/auto-claude-resume-after-limit-reset/main/install.ps1 | iex
```

That's it! The installer checks dependencies, installs the plugin, and registers all hooks automatically.

### Manual Install

Clone the repository and run the installer:

```bash
git clone https://github.com/Muminur/auto-claude-resume-after-limit-reset.git
cd auto-claude-resume-after-limit-reset

# Linux / macOS
chmod +x install.sh
./install.sh

# Windows (PowerShell)
powershell -ExecutionPolicy Bypass -File install.ps1
```

The installer will:
- Check and optionally install dependencies (Node.js, xdotool on Linux)
- Copy scripts to `~/.claude/`
- Register both SessionStart and Stop hooks in `settings.json`
- Install npm dependencies
- Optionally set up a system service (systemd/launchd)

**That's it!** The daemon will automatically start when you open a new Claude Code session.

For platform-specific details, see:
- [Windows Installation](docs/INSTALL-WINDOWS.md)
- [Linux Installation](docs/INSTALL-LINUX.md)
- [macOS Installation](docs/INSTALL-MACOS.md)

## How It Works

```
┌─────────────────┐                     ┌──────────────────┐
│  SessionStart   │ ──── auto-start ───►│  Daemon Process  │
│  Hook           │                     │  (if not running)│
└─────────────────┘                     └──────────────────┘

┌─────────────────┐     writes      ┌──────────────────┐
│  Rate Limit     │ ───────────────►│  status.json     │
│  Detection Hook │                 │  (reset_time)    │
└─────────────────┘                 └────────┬─────────┘
                                             │ watches
                                             ▼
                                    ┌──────────────────┐
                                    │  Daemon Process  │
                                    │  (background)    │
                                    └────────┬─────────┘
                                             │ when reset_time arrives
                                             ▼
                                    ┌──────────────────┐
                                    │  Send Keystrokes │
                                    │  to Terminal     │
                                    └──────────────────┘
```

### Three Components

1. **SessionStart Hook** (`scripts/ensure-daemon-running.js`)
   - Runs automatically when Claude Code starts
   - Checks if daemon is running
   - Starts daemon if not running

2. **Stop Hook** (`hooks/rate-limit-hook.js`)
   - Runs automatically when Claude Code stops
   - Analyzes transcript for rate limit messages
   - Writes detection to `~/.claude/auto-resume/status.json`

3. **Daemon Service** (`auto-resume-daemon.js`)
   - Monitors for rate limit detections
   - Waits until reset time
   - Sends "continue" to terminal automatically

## Configuration

Configure the plugin via `~/.claude/auto-resume/config.json`:

```json
{
  "resumePrompt": "continue",
  "menuSelection": "1",
  "checkInterval": 5000,
  "logLevel": "info",
  "notifications": {
    "enabled": true,
    "sound": false
  },
  "websocket": {
    "enabled": false,
    "port": 3847
  },
  "api": {
    "enabled": false,
    "port": 3848
  },
  "analytics": {
    "enabled": true,
    "retentionDays": 30
  },
  "watchPaths": [],
  "plugins": {
    "enabled": false,
    "directory": "~/.claude/auto-resume/plugins"
  }
}
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `resumePrompt` | string | `"continue"` | Text to send when resuming |
| `menuSelection` | string | `"1"` | Default menu choice |
| `checkInterval` | number | `5000` | Check status every N milliseconds |
| `logLevel` | string | `"info"` | Log level: debug, info, warn, error |
| `notifications.enabled` | boolean | `true` | Enable desktop notifications |
| `notifications.sound` | boolean | `false` | Play sound with notifications |
| `websocket.enabled` | boolean | `false` | Enable WebSocket server |
| `websocket.port` | number | `3847` | WebSocket server port |
| `api.enabled` | boolean | `false` | Enable REST API server |
| `api.port` | number | `3848` | REST API server port |
| `analytics.enabled` | boolean | `true` | Enable analytics collection |
| `analytics.retentionDays` | number | `30` | Days to keep analytics data |
| `watchPaths` | array | `[]` | Additional status.json paths to monitor |
| `plugins.enabled` | boolean | `false` | Enable plugin system |
| `plugins.directory` | string | `~/.claude/auto-resume/plugins` | Plugin directory path |

## GUI Dashboard

A visually stunning cyberpunk-themed dashboard is available for monitoring and controlling the daemon:

**Quick Start:**
```bash
# Open the dashboard in your browser
# Windows
start gui/index.html

# macOS
open gui/index.html

# Linux
xdg-open gui/index.html
```

**Features:**
- Real-time session monitoring with countdown timers
- Rate limit analytics and visualization
- Interactive configuration panel
- Quick actions (start/stop daemon, manual resume)
- WebSocket-powered live updates
- Beautiful dark theme with neon accents

See [gui/README.md](gui/README.md) for detailed documentation.

## Daemon Management

The daemon auto-starts, but you can manage it using slash commands or manually.

### Using Slash Commands (Recommended)

When using Claude Code, the easiest way to manage the daemon is through slash commands:

```
/auto-resume:status    # Check if daemon is running
/auto-resume:start     # Start the daemon
/auto-resume:stop      # Stop the daemon
/auto-resume:logs      # View daemon logs
/auto-resume:reset     # Reset rate limit status
```

### Manual Management (Terminal)

For manual management outside Claude Code, note that the daemon location depends on how you installed:

- **Plugin install**: `~/.claude/plugins/cache/auto-claude-resume/auto-resume/*/auto-resume-daemon.js`
- **Manual install**: `~/.claude/auto-resume/auto-resume-daemon.js`

**Auto-discovery command (works for both):**
```bash
DAEMON=$(find ~/.claude -name "auto-resume-daemon.js" 2>/dev/null | head -1)
node "$DAEMON" status
node "$DAEMON" stop
node "$DAEMON" restart
```

**View logs:**
```bash
tail -f ~/.claude/auto-resume/daemon.log
```

## Rate Limit Detection

When Claude Code shows:
```
You've hit your limit · resets 8pm (Asia/Dhaka)
```

The plugin:
1. Detects this automatically via the Stop hook
2. Parses reset time (8pm in Asia/Dhaka timezone)
3. Daemon displays countdown
4. At reset time, sends "continue" to your terminal
5. Session resumes automatically

## Plugin Development

Extend the plugin with custom actions by creating plugins in `~/.claude/auto-resume/plugins/`.

### Plugin Structure

Create a directory for your plugin with an `index.js` file:

```
~/.claude/auto-resume/plugins/
├── my-plugin/
│   └── index.js
└── another-plugin/
    └── index.js
```

### Basic Plugin Example

```javascript
// ~/.claude/auto-resume/plugins/my-plugin/index.js
module.exports = {
  name: 'my-plugin',
  version: '1.0.0',
  description: 'My custom auto-resume plugin',

  hooks: {
    onRateLimitDetected: async (event) => {
      console.log('Rate limit detected!', event);
      // Your custom logic here
    },

    onResumeSent: async (event) => {
      console.log('Resume sent!', event);
      // Your custom logic here
    },

    onStatusChange: async (status) => {
      console.log('Status changed:', status);
    },

    onDaemonStart: async () => {
      console.log('Daemon started');
    },

    onDaemonStop: async () => {
      console.log('Daemon stopped');
    }
  }
};
```

### Available Hooks

| Hook | Triggered | Event Object |
|------|-----------|--------------|
| `onRateLimitDetected` | When rate limit is detected | `{ timestamp, resetTime, session }` |
| `onResumeSent` | After resume prompt is sent | `{ timestamp, session, success }` |
| `onStatusChange` | When session status changes | `{ sessionId, status, previousStatus }` |
| `onDaemonStart` | When daemon starts | `{ timestamp }` |
| `onDaemonStop` | When daemon stops | `{ timestamp }` |

### Example Plugins Included

The plugin system includes example plugins:
- **console-logger**: Logs events to console
- **log-to-file**: Writes events to a log file
- **slack-notify**: Posts notifications to Slack webhook

Enable plugins in `config.json`:

```json
{
  "plugins": {
    "enabled": true,
    "directory": "~/.claude/auto-resume/plugins"
  }
}
```

## Persistence (Reboot / Restart)

| Scenario | Works? | How |
|----------|--------|-----|
| **Close Claude Code, reopen** | Yes | SessionStart hook detects daemon isn't running and starts it automatically. |
| **Ubuntu/Linux reboot** | Yes | Daemon stops on reboot, but auto-starts when you next open Claude Code (via SessionStart hook). |
| **Close terminal window** | Yes | Daemon runs in its own process group (`detached: true` + `unref()`), survives terminal close. |
| **macOS reboot** | Yes | Same as Linux — SessionStart hook restarts daemon on next Claude Code launch. |

No cron jobs or manual startup scripts needed. The SessionStart hook handles everything.

## Troubleshooting

### Daemon Not Starting

1. Check Node.js version (v16+ required):
   ```
   node --version
   ```

2. Check daemon status:
   ```bash
   node ~/.claude/auto-resume/auto-resume-daemon.js status
   ```

3. Check logs:
   ```bash
   tail -20 ~/.claude/auto-resume/daemon.log
   ```

### Hook Not Detecting Rate Limits

Verify the hook is registered in Claude Code settings:
- **Windows:** `Get-Content "$env:USERPROFILE\.claude\settings.json" | Select-String "rate-limit"`
- **macOS/Linux:** `cat ~/.claude/settings.json | grep rate-limit`

### Linux: xdotool Required

**Symptom:** The daemon starts, detects rate limits, counts down correctly, but when the countdown ends **nothing happens** — your session is not resumed. The daemon log at `~/.claude/auto-resume/daemon.log` shows:

```
ERROR: xdotool not found. Please install it:
ERROR: [TEST] Failed to send keystrokes: xdotool not found
```

**Fix:**

```bash
# Ubuntu/Debian
sudo apt-get install -y xdotool

# If sudo needs a terminal password (e.g., inside Claude Code CLI), use pkexec for a GUI prompt:
pkexec apt-get install -y xdotool

# Fedora
sudo dnf install -y xdotool

# Arch
sudo pacman -S --noconfirm xdotool
```

**After installing, restart the daemon** so it picks up the new binary:
```bash
node ~/.claude/auto-resume/auto-resume-daemon.js stop
node ~/.claude/auto-resume/auto-resume-daemon.js start
```

**Verify xdotool works with your display:**
```bash
# Should return one or more window IDs
xdotool search --class "gnome-terminal"

# Run the built-in test (sends keystrokes after countdown)
node ~/.claude/auto-resume/auto-resume-daemon.js --test 10
```

### macOS: Accessibility Permission

Grant accessibility permission to Node.js:
1. System Settings > Privacy & Security > Accessibility
2. Add your Node.js binary (run `which node` to find path)

### Dashboard Not Loading (ERR_CONNECTION_REFUSED)

If `/auto-resume:gui` shows "ERR_CONNECTION_REFUSED" on localhost:3737, the dashboard dependencies may not be installed.

**Automatic Fix (v1.4.13+):**
The plugin now auto-installs missing dependencies on session start. Simply restart Claude Code.

**Manual Fix:**
Install dependencies in the plugin cache directory:

**Windows:**
```powershell
cd "$env:USERPROFILE\.claude\plugins\cache\auto-claude-resume\auto-resume\*"
npm install ws node-notifier --save
```

**macOS/Linux:**
```bash
cd ~/.claude/plugins/cache/auto-claude-resume/auto-resume/*/
npm install ws node-notifier --save
```

Then restart the daemon:
```bash
node ~/.claude/auto-resume/auto-resume-daemon.js stop
node ~/.claude/auto-resume/auto-resume-daemon.js start
```

**Verify dashboard is running:**
```bash
# Check if ports are listening
# Windows
netstat -ano | findstr ":3737 :3847 :3848"

# macOS/Linux
lsof -i :3737 -i :3847 -i :3848
```

## Uninstallation

**Linux/macOS:**
```bash
./install.sh --uninstall
```

**Windows:**
```powershell
.\install.ps1 -Uninstall
```

## Cross-Platform Support

This plugin is fully compatible with:

### Windows
- Auto-resume via PowerShell keystroke injection
- Desktop notifications via Windows notification system
- Alternative MessageBox fallback for reliability
- Full WebSocket and API server support

### macOS
- Auto-resume via osascript keystroke events
- Desktop notifications via native macOS notification system
- Accessibility permission required (automatic prompt)
- Full feature support

### Linux
- Auto-resume via xdotool (requires system package)
- Desktop notifications via notify-send/dbus
- Full WebSocket and API server support
- Tested on Ubuntu, Debian, CentOS, Arch

## Requirements

- Claude Code CLI
- Node.js 16+
- Linux: xdotool (for keystroke sending)
- macOS: Accessibility permission for Node.js
- Optional: npm packages for enhanced features (node-notifier, ws, chokidar)

## License

MIT License
