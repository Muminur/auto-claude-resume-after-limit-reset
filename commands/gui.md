---
description: Open the web-based status monitoring dashboard
---

# Auto-Resume GUI

## Task: Open Status Dashboard

Opens the web-based status monitoring dashboard to view real-time daemon status, rate limit information, and analytics.

### Execute

**Recommended: Use the daemon's GUI command:**

```bash
# Find and run the daemon with GUI flag
node "$(find ~/.claude/plugins/cache -path "*/auto-resume/*/auto-resume-daemon.js" 2>/dev/null | sort -V | tail -1)" gui
```

**Platform-specific commands:**

```bash
# Windows (PowerShell)
node "$env:USERPROFILE\.claude\plugins\cache\auto-claude-resume\auto-resume\1.4.4\auto-resume-daemon.js" gui

# Windows (CMD)
node "%USERPROFILE%\.claude\plugins\cache\auto-claude-resume\auto-resume\1.4.4\auto-resume-daemon.js" gui

# macOS/Linux
node ~/.claude/plugins/cache/auto-claude-resume/auto-resume/1.4.4/auto-resume-daemon.js gui
```

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
- **Windows:** `%USERPROFILE%\.claude\plugins\cache\auto-claude-resume\auto-resume\1.4.4\gui\index.html`
- **macOS/Linux:** `~/.claude/plugins/cache/auto-claude-resume/auto-resume/1.4.4/gui/index.html`

Note: Opening the HTML file directly won't have WebSocket live updates.
