---
description: Manually start the auto-resume daemon
---

# Auto-Resume Start

## Task: Start the Daemon

Manually start the auto-resume daemon. Note: The daemon auto-starts when you open Claude Code, so this is usually not needed.

### Execute

**macOS/Linux:**
```bash
node ~/.claude/plugins/cache/auto-claude-resume/auto-resume/1.7.0/auto-resume-daemon.js start
```

**Windows (PowerShell):**
```powershell
node "$env:USERPROFILE\.claude\plugins\cache\auto-claude-resume\auto-resume\1.4.13\auto-resume-daemon.js" start
```

**Windows (CMD/Git Bash):**
```cmd
node "%USERPROFILE%\.claude\plugins\cache\auto-claude-resume\auto-resume\1.4.13\auto-resume-daemon.js" start
```

> **Note:** When Claude Code executes these commands via Bash tool, use the direct Windows path:
> `node "C:\Users\YOUR_USERNAME\.claude\plugins\cache\auto-claude-resume\auto-resume\1.4.13\auto-resume-daemon.js" start`

### Expected Output

**If started successfully:**
```
[SUCCESS] Daemon started (PID: 12345)
[INFO] Log file: ~/.claude/auto-resume/daemon.log
[SUCCESS] Watching status file for changes...
```

**If already running:**
```
[WARNING] Daemon is already running (PID: 12345)
[INFO] Use "stop" command to stop it first, or "restart" to restart
```

### Running in Background

To start the daemon in background mode (detached from terminal):

**macOS/Linux:**
```bash
nohup node ~/.claude/plugins/cache/auto-claude-resume/auto-resume/1.7.0/auto-resume-daemon.js start > /dev/null 2>&1 &
```

**Windows (PowerShell):**
```powershell
Start-Process -NoNewWindow node -ArgumentList "$env:USERPROFILE\.claude\plugins\cache\auto-claude-resume\auto-resume\1.4.13\auto-resume-daemon.js", "start"
```

### Note

The daemon runs in the foreground when started directly. For automatic background operation, the plugin's SessionStart hook handles this automatically when Claude Code starts.
