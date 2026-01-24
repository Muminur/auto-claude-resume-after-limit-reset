---
description: Test desktop notification settings
---

# Auto-Resume Notifications

## Task: Test Desktop Notifications

Sends a test notification to verify that desktop notifications are configured correctly and working.

### Execute

Run this command to send a test notification:

```bash
DAEMON_PATH=$(find ~/.claude/plugins/cache -name "auto-resume-daemon.js" 2>/dev/null | head -1) && node "$DAEMON_PATH" --notify-test
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

   On Windows (if tail is unavailable):
   ```bash
   cat ~/.claude/auto-resume/daemon.log | head -20
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
