---
description: Open the web-based status monitoring dashboard
---

# Auto-Resume GUI

## Task: Open Status Dashboard

Opens the web-based status monitoring dashboard to view real-time daemon status, rate limit information, and analytics.

### Execute

**Option 1: Open local HTML file (No server required):**

```bash
open ~/.claude/auto-resume/dashboard.html
```

**Windows PowerShell:**
```powershell
Start-Process "$env:USERPROFILE\.claude\auto-resume\dashboard.html"
```

**Windows Command Prompt:**
```cmd
start %USERPROFILE%\.claude\auto-resume\dashboard.html
```

**Linux:**
```bash
xdg-open ~/.claude/auto-resume/dashboard.html
```

**Option 2: Start HTTP server (for live updates):**

```bash
node "${CLAUDE_PLUGIN_ROOT}/auto-resume-daemon.js" --gui
```

**Windows PowerShell:**
```powershell
node "$env:CLAUDE_PLUGIN_ROOT\auto-resume-daemon.js" --gui
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
