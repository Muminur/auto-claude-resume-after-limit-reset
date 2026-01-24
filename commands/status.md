---
description: Check if the auto-resume daemon is running
---

# Auto-Resume Status

## Task: Check Daemon Status

Check whether the auto-resume daemon is currently running and view its status.

### Execute

Run this command to check status:

```bash
DAEMON_PATH=$(find ~/.claude/plugins/cache -name "auto-resume-daemon.js" 2>/dev/null | head -1) && node "$DAEMON_PATH" status
```

### Expected Output

**If running:**
```
[SUCCESS] Daemon is running (PID: 12345)
[INFO] Status: { ... current rate limit info if any ... }
```

**If not running:**
```
[INFO] Daemon is not running (no PID file)
```

### Next Steps

- If not running, daemon will auto-start on next Claude Code session
- Or manually start using the `/auto-resume:start` command
