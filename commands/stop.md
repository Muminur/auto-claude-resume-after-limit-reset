---
description: Stop the auto-resume daemon
---

# Auto-Resume Stop

## Task: Stop the Daemon

Stop the running auto-resume daemon.

### Execute

Run this command to stop the daemon:

```bash
DAEMON_PATH=$(find ~/.claude/plugins/cache -name "auto-resume-daemon.js" 2>/dev/null | head -1) && node "$DAEMON_PATH" stop
```

### Expected Output

**If stopped successfully:**
```
[INFO] Stopping daemon (PID: 12345)...
[SUCCESS] Daemon stopped successfully
```

**If not running:**
```
[WARNING] No PID file found. Daemon may not be running.
```

### Note

The daemon will auto-start again the next time you open Claude Code (via the SessionStart hook).
