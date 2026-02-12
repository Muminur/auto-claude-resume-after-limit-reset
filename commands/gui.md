---
description: Open the web-based status monitoring dashboard
---

# Auto-Resume GUI

## Task: Open Status Dashboard

Opens the web-based status monitoring dashboard to view real-time daemon status, rate limit information, and analytics.

### Execute

**macOS/Linux:**
```bash
node ~/.claude/plugins/cache/auto-claude-resume/auto-resume/1.8.0/auto-resume-daemon.js gui
```

**Windows (PowerShell):**
```powershell
node "$env:USERPROFILE\.claude\plugins\cache\auto-claude-resume\auto-resume\1.4.13\auto-resume-daemon.js" gui
```

**Windows (CMD/Git Bash):**
```cmd
node "%USERPROFILE%\.claude\plugins\cache\auto-claude-resume\auto-resume\1.4.13\auto-resume-daemon.js" gui
```

> **Note:** When Claude Code executes these commands via Bash tool, use the direct Windows path:
> `node "C:\Users\YOUR_USERNAME\.claude\plugins\cache\auto-claude-resume\auto-resume\1.4.13\auto-resume-daemon.js" gui`

This opens http://localhost:3737 in your default browser with the full dashboard GUI.

### Dashboard Features

- Real-time daemon status
- Rate limit information and countdown timer
- Analytics and statistics
- Session history
- Configuration overview
- WebSocket support for live updates

### How It Works

The dashboard is served by the daemon's built-in HTTP server (port 3737) from the `gui/` directory within the plugin. The `gui` command:
1. Starts the HTTP server if not running
2. Opens your default browser to http://localhost:3737

### Troubleshooting

If the browser doesn't open automatically, manually navigate to:
- **URL:** http://localhost:3737

Or open the HTML file directly:
- **Windows:** `%USERPROFILE%\.claude\plugins\cache\auto-claude-resume\auto-resume\1.4.13\gui\index.html`
- **macOS/Linux:** `~/.claude/plugins/cache/auto-claude-resume/auto-resume/1.8.0/gui/index.html`

Note: Opening the HTML file directly won't have WebSocket live updates.
