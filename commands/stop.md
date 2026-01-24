---
description: Stop the auto-resume daemon
---

# Auto-Resume Stop

## Task: Stop the Daemon

Stop the running auto-resume daemon.

### Execute

**macOS/Linux:**
```bash
node ~/.claude/plugins/cache/auto-claude-resume/auto-resume/1.4.4/auto-resume-daemon.js stop
```

**Windows (PowerShell):**
```powershell
node "$env:USERPROFILE\.claude\plugins\cache\auto-claude-resume\auto-resume\1.4.4\auto-resume-daemon.js" stop
```

**Windows (CMD):**
```cmd
node "%USERPROFILE%\.claude\plugins\cache\auto-claude-resume\auto-resume\1.4.4\auto-resume-daemon.js" stop
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

The daemon will auto-start again the next time you open Claude Code (via the SessionStart hook). To permanently disable auto-start, you would need to remove or disable the plugin.

### Force Stop (if daemon is unresponsive)

**macOS/Linux:**
```bash
pkill -f "auto-resume-daemon.js"
rm ~/.claude/auto-resume/daemon.pid
```

**Windows (PowerShell):**
```powershell
Get-Process -Name "node" | Where-Object { $_.CommandLine -like "*auto-resume-daemon*" } | Stop-Process -Force
Remove-Item "$env:USERPROFILE\.claude\auto-resume\daemon.pid" -ErrorAction SilentlyContinue
```
