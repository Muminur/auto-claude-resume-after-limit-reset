---
description: Test desktop notification settings
---

# Auto-Resume Notifications

## Task: Test Desktop Notifications

Sends a test notification to verify that desktop notifications are configured correctly and working.

### Execute

Run this command to send a test notification:

```bash
node "${CLAUDE_PLUGIN_ROOT}/auto-resume-daemon.js" --notify-test
```

**Windows PowerShell:**
```powershell
node "$env:CLAUDE_PLUGIN_ROOT\auto-resume-daemon.js" --notify-test
```

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

2. **Verify node-notifier is installed:**
   ```bash
   npm list node-notifier
   ```

3. **Check daemon logs:**
   ```bash
   tail -20 ~/.claude/auto-resume/daemon.log
   ```

**Windows PowerShell:**
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
- **Linux/macOS:** `~/.claude/auto-resume/config.json`
- **Windows:** `%USERPROFILE%\.claude\auto-resume\config.json`

Set `notifications.enabled` to `true` or `false` to control notifications.
