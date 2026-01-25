---
description: Test desktop notification settings
---

# Auto-Resume Notifications

## Task: Test Desktop Notifications

Sends a test notification to verify that desktop notifications are configured correctly and working.

### Execute

**macOS/Linux:**
```bash
node ~/.claude/plugins/cache/auto-claude-resume/auto-resume/1.4.11/auto-resume-daemon.js notify
```

**Windows (PowerShell):**
```powershell
node "$env:USERPROFILE\.claude\plugins\cache\auto-claude-resume\auto-resume\1.4.11\auto-resume-daemon.js" notify
```

**Windows (CMD/Git Bash):**
```cmd
node "%USERPROFILE%\.claude\plugins\cache\auto-claude-resume\auto-resume\1.4.11\auto-resume-daemon.js" notify
```

> **Note:** When Claude Code executes these commands via Bash tool, use the direct Windows path:
> `node "C:\Users\YOUR_USERNAME\.claude\plugins\cache\auto-claude-resume\auto-resume\1.4.11\auto-resume-daemon.js" notify`

### Expected Behavior

You should see a desktop notification with:
- **Title:** "Auto-Resume Test"
- **Message:** "Desktop notifications are working correctly!"
- **Icon:** Claude Code icon (if available)

### Troubleshooting

**No notification appears:**

1. **Check notification permissions:**
   - **macOS:** System Preferences → Notifications → Terminal (or your terminal app)
   - **Windows:** Settings → System → Notifications → Enable notifications
   - **Linux:** Check your desktop environment notification settings

2. **Check daemon logs:**

   **macOS/Linux:**
   ```bash
   tail -20 ~/.claude/auto-resume/daemon.log
   ```

   **Windows (PowerShell):**
   ```powershell
   Get-Content "$env:USERPROFILE\.claude\auto-resume\daemon.log" -Tail 20
   ```

### Notification Events

The daemon sends notifications for:
- Rate limit detected
- Resume countdown started
- Session successfully resumed
- Errors requiring attention

### Configuration

Notification preferences can be configured in:
- **macOS/Linux:** `~/.claude/auto-resume/config.json`
- **Windows:** `%USERPROFILE%\.claude\auto-resume\config.json`

Set `notifications.enabled` to `true` or `false` to control notifications.

```json
{
  "notifications": {
    "enabled": true,
    "sound": false
  }
}
```
