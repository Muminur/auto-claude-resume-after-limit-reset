---
description: View the auto-resume daemon logs
---

# Auto-Resume Logs

## Task: View Daemon Logs

View the auto-resume daemon log file to see recent activity and debug issues.

### Execute

**View last 20 lines:**

```bash
tail -20 ~/.claude/auto-resume/daemon.log
```

**Windows PowerShell:**
```powershell
Get-Content "$env:USERPROFILE\.claude\auto-resume\daemon.log" -Tail 20
```

**Watch logs in real-time:**

```bash
tail -f ~/.claude/auto-resume/daemon.log
```

**Windows PowerShell:**
```powershell
Get-Content "$env:USERPROFILE\.claude\auto-resume\daemon.log" -Wait -Tail 20
```

### Log Location

- **Linux/macOS:** `~/.claude/auto-resume/daemon.log`
- **Windows:** `%USERPROFILE%\.claude\auto-resume\daemon.log`

### What to Look For

- `[INFO]` - Normal operation messages
- `[SUCCESS]` - Successful operations (daemon started, keystrokes sent)
- `[WARNING]` - Rate limit detected, waiting for reset
- `[ERROR]` - Problems that need attention
