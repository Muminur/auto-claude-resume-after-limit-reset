---
description: Manually start the auto-resume daemon
---

# Auto-Resume Start

## Task: Start the Daemon

Manually start the auto-resume daemon. Note: The daemon auto-starts when you open Claude Code, so this is usually not needed.

### Execute

Run this command to start the daemon:

```bash
node "${CLAUDE_PLUGIN_ROOT}/auto-resume-daemon.js" start
```

**Windows PowerShell:**
```powershell
node "$env:CLAUDE_PLUGIN_ROOT\auto-resume-daemon.js" start
```

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
[INFO] Run "node auto-resume-daemon.js stop" to stop it first
```

### Note

The daemon runs in the foreground when started this way. For background operation, the SessionStart hook handles this automatically.
