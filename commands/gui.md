---
description: Open the web-based status monitoring dashboard
---

# Auto-Resume GUI

## Task: Open Status Dashboard

Opens the web-based status monitoring dashboard to view real-time daemon status, rate limit information, and analytics.

### Execute

**Option 1: Open local HTML file (No server required):**

```bash
# macOS
open ~/.claude/auto-resume/dashboard.html

# Linux
xdg-open ~/.claude/auto-resume/dashboard.html

# Windows (Git Bash)
start ~/.claude/auto-resume/dashboard.html
```

**Option 2: Start HTTP server (for live updates):**

```bash
DAEMON_PATH=$(find ~/.claude/plugins/cache -name "auto-resume-daemon.js" 2>/dev/null | head -1) && node "$DAEMON_PATH" --gui
```

This starts a local web server on http://localhost:3737 with WebSocket support for live status updates.

### Dashboard Features

- Real-time daemon status
- Rate limit information and countdown
- Analytics and statistics
- Session history
- Configuration overview

### Dashboard Location

- **Linux/macOS:** `~/.claude/auto-resume/dashboard.html`
- **Windows:** `%USERPROFILE%\.claude\auto-resume\dashboard.html`
- **HTTP Server:** `http://localhost:3737` (when using --gui flag)
