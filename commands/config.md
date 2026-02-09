---
description: View and modify auto-resume daemon configuration
---

# Auto-Resume Configuration

## Task: View and Edit Configuration

View or modify the auto-resume daemon configuration settings.

### View Current Config

**macOS/Linux:**
```bash
node ~/.claude/plugins/cache/auto-claude-resume/auto-resume/1.7.0/auto-resume-daemon.js config
```

**Windows (PowerShell):**
```powershell
node "$env:USERPROFILE\.claude\plugins\cache\auto-claude-resume\auto-resume\1.4.13\auto-resume-daemon.js" config
```

**Windows (CMD/Git Bash):**
```cmd
node "%USERPROFILE%\.claude\plugins\cache\auto-claude-resume\auto-resume\1.4.13\auto-resume-daemon.js" config
```

> **Note:** When Claude Code executes these commands via Bash tool, use the direct Windows path:
> `node "C:\Users\YOUR_USERNAME\.claude\plugins\cache\auto-claude-resume\auto-resume\1.4.13\auto-resume-daemon.js" config`

### Edit Config

The config file is located at:
- **macOS/Linux:** `~/.claude/auto-resume/config.json`
- **Windows:** `%USERPROFILE%\.claude\auto-resume\config.json`

**Direct edit (macOS/Linux):**
```bash
nano ~/.claude/auto-resume/config.json
```

**Direct edit (Windows PowerShell):**
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
| `gui.enabled` | boolean | true | Enable GUI dashboard |
| `gui.port` | number | 3737 | GUI dashboard port |
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
  "gui": {
    "enabled": true,
    "port": 3737
  },
  "analytics": {
    "enabled": true
  }
}
```

### Reset to Defaults

**macOS/Linux:**
```bash
node ~/.claude/plugins/cache/auto-claude-resume/auto-resume/1.7.0/auto-resume-daemon.js reset-config
```

**Windows (PowerShell):**
```powershell
node "$env:USERPROFILE\.claude\plugins\cache\auto-claude-resume\auto-resume\1.4.13\auto-resume-daemon.js" reset-config
```

### Apply Changes

After editing the config file, restart the daemon:

**macOS/Linux:**
```bash
node ~/.claude/plugins/cache/auto-claude-resume/auto-resume/1.7.0/auto-resume-daemon.js restart
```

**Windows (PowerShell):**
```powershell
node "$env:USERPROFILE\.claude\plugins\cache\auto-claude-resume\auto-resume\1.4.13\auto-resume-daemon.js" restart
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
