---
description: Reset stale rate limit status to allow fresh detection
---

# Auto-Resume Reset

## Task: Reset Rate Limit Status

Clear any stale rate limit status so the daemon can detect fresh rate limits.

### Execute

Run this command to reset the status:

```bash
node ~/.claude/auto-resume/auto-resume-daemon.js --reset
```

**Windows PowerShell:**
```powershell
node "$env:USERPROFILE\.claude\auto-resume\auto-resume-daemon.js" --reset
```

### When to Use

Use this command when:
- Claude Code shows a rate limit message from the past
- The daemon is waiting for an old reset time
- You want to clear the status and start fresh

### Expected Output

```
[INFO] Stale rate limit found (was set to reset at <timestamp>)
[SUCCESS] Rate limit status has been reset.
[INFO] The daemon will now wait for new rate limit detection.
```

Or if no status exists:
```
[INFO] No rate limit status found. Nothing to reset.
```
