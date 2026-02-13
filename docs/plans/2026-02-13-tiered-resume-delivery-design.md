# Tiered Resume Delivery + Active Verification + Rate Limit Queue

**Date:** 2026-02-13
**Status:** Approved

## Problem

The auto-resume daemon sent "continue" keystrokes via `xdotool` at 8PM (Feb 12) when the rate limit reset. `xdotool` reported success (exit code 0), but the keystrokes were silently dropped because the screen was locked. The daemon declared success because its verification only checks for absence of a new rate limit re-detection — not actual Claude Code activity. Claude Code never resumed.

Additionally, a rate limit detection for 3PM Feb 13 was overwritten by the 8PM Feb 12 detection, causing the daemon to lose track of future resets.

## Root Cause

1. **`xdotool` is unreliable when screen is locked** — it returns exit code 0 even when keystrokes are dropped by the screen locker
2. **Passive verification** — "no re-detection in 90s" is not proof of successful resume
3. **Single-slot status** — new rate limit detections overwrite previous ones

## Solution: Three-Part Fix

### Part 1: Tiered Delivery (Auto-Detected)

The daemon auto-detects the best available delivery method for each Claude session:

| Tier | Method | Detection | Works When Locked? |
|------|--------|-----------|-------------------|
| 1 | `tmux send-keys` | Match PID via `tmux list-panes -a -F "#{pane_pid} #{session_name}"` | Yes |
| 2 | PTY write | Resolve `/proc/<pid>/fd/0` → `/dev/pts/N`, write directly | Yes |
| 3 | `xdotool` (existing) | Current window-finding strategies | No (screen must be unlocked) |

**Delivery sequence:**
- Try Tier 1 first. If Claude PID is not in any tmux session, skip.
- Try Tier 2. If PTY resolution fails or write fails, skip.
- Fall back to Tier 3 (xdotool).
- If all tiers fail, retry with exponential backoff.

**Transparent tmux opt-in (optional):**
Users can add to `.bashrc`/`.zshrc` for guaranteed Tier 1 reliability:
```bash
claude() { tmux new-session -A -s claude-auto -- command claude "$@"; }
```
This means `claude --dangerously-skip-permissions` works as before, but inside tmux.

### Part 2: Active Verification

After sending keystrokes (via any tier):
1. Wait 15 seconds
2. Check the Claude Code transcript JSONL file for new content (compare `mtime` or line count before/after)
3. If new transcript activity detected → **confirmed success**
4. If no activity → **delivery failed**, try next tier or retry

**Retry logic:**
- Cycle through Tier 1 → 2 → 3 on first failure
- If all tiers fail, retry best available tier with exponential backoff: 15s, 30s, 60s, 120s
- Max retries: 4 (configurable)

**Desktop notifications (via `node-notifier`, already installed):**
- On confirmed success: "Claude Code resumed successfully after rate limit reset"
- On all-tiers failure: "Failed to resume Claude Code — manual intervention needed"
- On each retry: silent (avoid notification spam)

### Part 3: Rate Limit Queue

Replace single-slot `status.json` with a queue:

```json
{
  "queue": [
    {
      "id": "uuid-1",
      "reset_time": "2026-02-12T14:00:00.000Z",
      "timezone": "Asia/Dhaka",
      "message": "resets 8pm (Asia/Dhaka)",
      "detected_at": "2026-02-12T11:25:53.000Z",
      "claude_pid": 12345,
      "transcript_path": "/path/to/transcript.jsonl",
      "status": "completed",
      "completed_at": "2026-02-12T14:01:44.000Z"
    },
    {
      "id": "uuid-2",
      "reset_time": "2026-02-13T09:00:00.000Z",
      "timezone": "Asia/Dhaka",
      "message": "resets 3pm (Asia/Dhaka)",
      "detected_at": "2026-02-12T09:12:15.000Z",
      "claude_pid": 12345,
      "transcript_path": "/path/to/transcript.jsonl",
      "status": "pending"
    }
  ],
  "last_hook_run": "2026-02-13T02:29:19.733Z"
}
```

**Queue behavior:**
- New detections appended (deduplicated by `reset_time`)
- Daemon processes entries in chronological order by `reset_time`
- Status progression: `pending` → `waiting` → `resuming` → `completed` / `failed`
- Completed/failed entries retained for audit (cleaned by log rotation)

### Bonus: `--monitor` CLI Flag Fix

Add `case 'monitor':` and `case '--monitor':` to the CLI switch in `auto-resume-daemon.js` as aliases for `startDaemon()`. This fixes the systemd service crash loop (13,338+ restarts).

## Files Changed

| File | Change |
|------|--------|
| `auto-resume-daemon.js` | Tiered delivery, active verification, queue processing, notifications, `--monitor` fix |
| `rate-limit-hook.js` | Write to queue array instead of overwriting single slot |
| `status.json` | Schema change: single object → queue array |
| `config.json` | New config keys for verification and notification settings |
| `tests/tiered-delivery.test.js` | Tests for tmux/PTY/xdotool delivery |
| `tests/active-verification.test.js` | Tests for transcript-based verification |
| `tests/rate-limit-queue.test.js` | Tests for queue operations |
| `tests/cli.test.js` | Tests for `--monitor` flag (already exists) |

## Testing Strategy (TDD)

All changes follow test-driven development:
1. Write failing tests first
2. Implement minimum code to pass
3. Refactor

Key test scenarios:
- tmux session detection when PID is/isn't in tmux
- PTY write success/failure
- Active verification with mock transcript files
- Queue append, dedup, chronological processing
- Desktop notification triggers
- `--monitor` CLI flag routing
