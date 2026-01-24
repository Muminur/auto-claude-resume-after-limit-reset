---
description: View and modify auto-resume daemon configuration
---

# Auto-Resume Configuration

## Task: View and Edit Configuration

View or modify the auto-resume daemon configuration settings.

### View Current Config

```bash
DAEMON_PATH=$(find ~/.claude/plugins/cache -name "auto-resume-daemon.js" 2>/dev/null | head -1) && node "$DAEMON_PATH" --config
```

### Edit Config

The config file is located at: `~/.claude/auto-resume/config.json`

**Direct edit (Linux/macOS):**
```bash
nano ~/.claude/auto-resume/config.json
```

**Direct edit (Windows):**
```powershell
notepad "$env:USERPROFILE\.claude\auto-resume\config.json"
```

### Available Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `resumePrompt` | string | "continue" | Text sent to resume session |
| `menuSelection` | string | "1" | Menu option to select |
| `checkInterval` | number | 5000 | Status check interval (ms) |
| `logLevel` | string | "info" | Log level (debug/info/warn/error) |
| `notifications.enabled` | boolean | true | Enable desktop notifications |
| `notifications.sound` | boolean | false | Enable notification sounds |
| `websocket.enabled` | boolean | false | Enable WebSocket server |
| `websocket.port` | number | 3847 | WebSocket server port |
| `api.enabled` | boolean | false | Enable REST API |
| `api.port` | number | 3848 | REST API port |
| `analytics.enabled` | boolean | true | Enable analytics tracking |

### Example Config

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
    "enabled": true
  }
}
```

### Reset to Defaults

```bash
DAEMON_PATH=$(find ~/.claude/plugins/cache -name "auto-resume-daemon.js" 2>/dev/null | head -1) && node "$DAEMON_PATH" --reset-config
```

### Apply Changes

After editing the config file, restart the daemon:

```bash
DAEMON_PATH=$(find ~/.claude/plugins/cache -name "auto-resume-daemon.js" 2>/dev/null | head -1) && node "$DAEMON_PATH" restart
```

### Common Configuration Tasks

**Enable debug logging:**
```json
{
  "logLevel": "debug"
}
```

**Change resume text:**
```json
{
  "resumePrompt": "please continue where you left off"
}
```

**Disable notifications:**
```json
{
  "notifications": {
    "enabled": false
  }
}
```

**Increase check interval (reduce resource usage):**
```json
{
  "checkInterval": 10000
}
```
