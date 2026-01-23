---
description: Test the auto-resume keystroke sending with a countdown
argument-hint: seconds (default 30)
---

# Auto-Resume Test

## Task: Test Keystroke Sending

Test the auto-resume functionality by running a countdown and then sending "continue" + Enter to terminal windows.

### Arguments

- `$ARGUMENTS` - Number of seconds to countdown (default: 30)

### Execute

Run this command to test with specified seconds:

```bash
node "${CLAUDE_PLUGIN_ROOT}/auto-resume-daemon.js" --test $ARGUMENTS
```

**Windows PowerShell:**
```powershell
node "$env:CLAUDE_PLUGIN_ROOT\auto-resume-daemon.js" --test $ARGUMENTS
```

If no argument provided, use 10 seconds:
```bash
node "${CLAUDE_PLUGIN_ROOT}/auto-resume-daemon.js" --test 10
```

### Warning

This will actually send "continue" + Enter keystrokes to your terminal windows after the countdown completes. Make sure you're ready for this!

### Expected Output

```
[WARNING] [TEST MODE] Simulating rate limit with X second countdown
[WARNING] WARNING: This will send "continue" + Enter to terminal windows!
[TEST] Sending "continue" in 00:00:10...
[TEST] Countdown complete! Sending keystrokes...
[SUCCESS] [TEST] Test completed successfully!
```
