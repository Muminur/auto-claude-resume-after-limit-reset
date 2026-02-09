---
description: Test the auto-resume keystroke sending with a countdown
argument-hint: seconds (default 10)
---

# Auto-Resume Test

## Task: Test Keystroke Sending

Test the auto-resume functionality by running a countdown and then sending "continue" + Enter to terminal windows.

### Arguments

- `$ARGUMENTS` - Number of seconds to countdown (default: 10)

### Execute

**macOS/Linux:**
```bash
# With custom countdown (e.g., 30 seconds)
node ~/.claude/plugins/cache/auto-claude-resume/auto-resume/1.5.0/auto-resume-daemon.js test $ARGUMENTS

# Default 10 seconds
node ~/.claude/plugins/cache/auto-claude-resume/auto-resume/1.5.0/auto-resume-daemon.js test 10
```

**Windows (PowerShell):**
```powershell
# With custom countdown (e.g., 30 seconds)
node "$env:USERPROFILE\.claude\plugins\cache\auto-claude-resume\auto-resume\1.4.13\auto-resume-daemon.js" test $ARGUMENTS

# Default 10 seconds
node "$env:USERPROFILE\.claude\plugins\cache\auto-claude-resume\auto-resume\1.4.13\auto-resume-daemon.js" test 10
```

**Windows (CMD/Git Bash):**
```cmd
node "%USERPROFILE%\.claude\plugins\cache\auto-claude-resume\auto-resume\1.4.13\auto-resume-daemon.js" test 10
```

> **Note:** When Claude Code executes these commands via Bash tool, use the direct Windows path:
> `node "C:\Users\YOUR_USERNAME\.claude\plugins\cache\auto-claude-resume\auto-resume\1.4.13\auto-resume-daemon.js" test $ARGUMENTS`

### Warning

This will actually send "continue" + Enter keystrokes to your terminal windows after the countdown completes. Make sure you're ready for this!

### Expected Output

```
[WARNING] [TEST MODE] Simulating rate limit with X second countdown
[WARNING] WARNING: This will send "continue" + Enter to terminal windows!
[TEST] Sending "continue" in 00:00:10...
[TEST] Sending "continue" in 00:00:09...
...
[TEST] Countdown complete! Sending keystrokes...
[SUCCESS] [TEST] Test completed successfully!
```

### Use Cases

- Verify keystroke sending works on your system
- Test terminal window detection
- Debug issues with the resume functionality
- Demo the plugin to others
