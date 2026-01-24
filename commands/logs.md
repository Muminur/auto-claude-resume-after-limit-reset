---
description: View the auto-resume daemon logs
---

# Auto-Resume Logs

## Task: View Daemon Logs

View the auto-resume daemon log file to see recent activity and debug issues.

### Execute

**macOS/Linux - View last 20 lines:**
```bash
tail -20 ~/.claude/auto-resume/daemon.log
```

**macOS/Linux - Watch logs in real-time:**
```bash
tail -f ~/.claude/auto-resume/daemon.log
```

**Windows (PowerShell) - View last 20 lines:**
```powershell
Get-Content "$env:USERPROFILE\.claude\auto-resume\daemon.log" -Tail 20
```

**Windows (PowerShell) - Watch logs in real-time:**
```powershell
Get-Content "$env:USERPROFILE\.claude\auto-resume\daemon.log" -Wait -Tail 20
```

**Windows (CMD) - View entire log:**
```cmd
type "%USERPROFILE%\.claude\auto-resume\daemon.log"
```

### Log Location

- **macOS/Linux:** `~/.claude/auto-resume/daemon.log`
- **Windows:** `%USERPROFILE%\.claude\auto-resume\daemon.log`

### Log Levels

- `[INFO]` - Normal operation messages
- `[SUCCESS]` - Successful operations (daemon started, keystrokes sent)
- `[WARNING]` - Rate limit detected, waiting for reset
- `[ERROR]` - Problems that need attention
- `[DEBUG]` - Detailed debugging information (when debug logging enabled)

### Example Log Output

```
[2026-01-24T10:30:00.000Z] INFO: Daemon started (PID: 12345)
[2026-01-24T10:30:00.100Z] SUCCESS: Watching status file for changes...
[2026-01-24T10:32:15.500Z] WARNING: Rate limit detected!
[2026-01-24T10:32:15.501Z] INFO: Reset time: 1/24/2026, 2:00:00 PM
[2026-01-24T14:00:00.000Z] SUCCESS: Keystrokes sent: Sent to 2 window(s)
[2026-01-24T14:00:00.001Z] SUCCESS: Auto-resume completed!
```

### Clear Logs

**macOS/Linux:**
```bash
> ~/.claude/auto-resume/daemon.log
```

**Windows (PowerShell):**
```powershell
Clear-Content "$env:USERPROFILE\.claude\auto-resume\daemon.log"
```
