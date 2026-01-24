---
description: Reset stale rate limit status to allow fresh detection
---

# Auto-Resume Reset

## Task: Reset Rate Limit Status

Clear any stale rate limit status so the daemon can detect fresh rate limits.

### Execute

**macOS/Linux:**
```bash
node ~/.claude/plugins/cache/auto-claude-resume/auto-resume/1.4.4/auto-resume-daemon.js reset
```

**Windows (PowerShell):**
```powershell
node "$env:USERPROFILE\.claude\plugins\cache\auto-claude-resume\auto-resume\1.4.4\auto-resume-daemon.js" reset
```

**Windows (CMD):**
```cmd
node "%USERPROFILE%\.claude\plugins\cache\auto-claude-resume\auto-resume\1.4.4\auto-resume-daemon.js" reset
```

### When to Use

Use this command when:
- Claude Code shows a rate limit message from the past
- The daemon is waiting for an old reset time
- You want to clear the status and start fresh
- The countdown timer seems stuck or incorrect

### Expected Output

**If stale status found:**
```
[INFO] Stale rate limit found (was set to reset at <timestamp>)
[SUCCESS] Rate limit status has been reset.
[INFO] The daemon will now wait for new rate limit detection.
```

**If no status exists:**
```
[INFO] No rate limit status found. Nothing to reset.
```

### Status File Location

The status file that gets cleared is located at:
- **macOS/Linux:** `~/.claude/auto-resume/status.json`
- **Windows:** `%USERPROFILE%\.claude\auto-resume\status.json`
