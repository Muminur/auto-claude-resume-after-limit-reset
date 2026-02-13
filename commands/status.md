---
description: Check if the auto-resume daemon is running
---

# Auto-Resume Status

## Task: Check Daemon Status

Check whether the auto-resume daemon is currently running and view its status.

### Execute

**macOS/Linux:**
```bash
node ~/.claude/plugins/cache/auto-claude-resume/auto-resume/1.8.1/auto-resume-daemon.js status
```

**Windows (PowerShell):**
```powershell
node "$env:USERPROFILE\.claude\plugins\cache\auto-claude-resume\auto-resume\1.4.13\auto-resume-daemon.js" status
```

**Windows (CMD/Git Bash):**
```cmd
node "%USERPROFILE%\.claude\plugins\cache\auto-claude-resume\auto-resume\1.4.13\auto-resume-daemon.js" status
```

> **Note:** When Claude Code executes these commands via Bash tool, use the direct Windows path:
> `node "C:\Users\YOUR_USERNAME\.claude\plugins\cache\auto-claude-resume\auto-resume\1.4.13\auto-resume-daemon.js" status`

### Expected Output

**If running:**
```
[SUCCESS] Daemon is running (PID: 12345)
[INFO] Uptime: 2 hours, 15 minutes
[INFO] Status: Watching for rate limits...
```

**If running with active rate limit:**
```
[SUCCESS] Daemon is running (PID: 12345)
[WARNING] Rate limit active!
[INFO] Resuming in: 00:45:30
[INFO] Reset time: 2:00 PM
```

**If not running:**
```
[INFO] Daemon is not running (no PID file)
```

### Queue-Based Status Format (v1.3.0+)

The daemon now uses a queue-based status format in `status.json`. Multiple rate limit detections are tracked as an array of pending events rather than a single slot, preventing lost events during rapid successive detections.

```json
{
  "queue": [
    {
      "resetTime": "2025-02-13T14:00:00.000Z",
      "detectedAt": "2025-02-13T13:15:00.000Z",
      "tier": 1,
      "method": "tmux"
    }
  ],
  "lastResume": {
    "time": "2025-02-13T14:00:10.000Z",
    "tier": 1,
    "verified": true
  }
}
```

### PID File Location

- **macOS/Linux:** `~/.claude/auto-resume/daemon.pid`
- **Windows:** `%USERPROFILE%\.claude\auto-resume\daemon.pid`

### Next Steps

- If not running, daemon will auto-start on next Claude Code session
- Or manually start using `/auto-resume:start`
- Use `/auto-resume:gui` to view the web dashboard
