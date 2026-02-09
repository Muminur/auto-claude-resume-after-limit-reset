# Reliability Improvements Design

**Date:** 2026-02-09
**Focus:** Missed detections, keystroke failures, daemon silent death
**Version target:** 1.6.0 (minor — no breaking changes)

---

## 1. Missed Detections

### 1A. Redundant detection via daemon transcript polling

**Problem:** The Stop hook is the sole detection path. If it doesn't fire (crash, kill, terminal close), rate limits go undetected.

**Solution:** The daemon periodically scans the most recent transcript file for rate limit patterns as a fallback.

**Implementation:**
- In `auto-resume-daemon.js`, add a new interval (every 30 seconds) that:
  1. Finds the most recent `.jsonl` file in `~/.claude/projects/` (by mtime)
  2. Runs `analyzeTranscript()` on the last 50 lines (tail, not full scan)
  3. If rate limit found and `status.json` doesn't already have it → write detection
- Import `analyzeTranscript` and `parseResetTime` from `hooks/rate-limit-hook.js` (already exported)
- Only scan if `status.json` doesn't currently have an active detection (avoid re-detecting same limit)
- Add config key `daemon.transcriptPolling` (default: `true`) to enable/disable

**Files changed:**
- `auto-resume-daemon.js` — add `pollTranscripts()` function and interval
- `src/modules/config-manager.js` — add `daemon.transcriptPolling` default

**Risk:** Low. Polling is read-only. False positives already handled by `isRateLimitMessage()` filters.

### 1B. Stop hook watchdog

**Problem:** No way to know if the Stop hook is silently failing.

**Solution:** On SessionStart, check `status.json` metadata to detect anomalies.

**Implementation:**
- In `ensure-daemon-running.js`, after verifying daemon is running:
  1. Check `status.json` → `last_hook_run` timestamp (new field written by Stop hook on every run, even if no rate limit found)
  2. If daemon PID is alive but `last_hook_run` is missing or older than 24 hours, log a diagnostic warning
- In `rate-limit-hook.js`, add: always write `last_hook_run: new Date().toISOString()` to `status.json`, even on non-detection runs (separate from `detected` field)

**Files changed:**
- `hooks/rate-limit-hook.js` — write `last_hook_run` on every invocation
- `scripts/ensure-daemon-running.js` — check `last_hook_run` age

### 1C. Relax length filter

**Problem:** `MAX_RATE_LIMIT_MESSAGE_LENGTH = 200` may reject valid messages if Anthropic adds text.

**Solution:** Bump to 500. The false-positive filters (tool_result, line numbers, function defs, JSDoc) are the real guard.

**Files changed:**
- `hooks/rate-limit-hook.js` — change `const MAX_RATE_LIMIT_MESSAGE_LENGTH = 200;` to `500`

---

## 2. Keystroke Failures

### 2A. Post-resume verification loop

**Problem:** No way to confirm that "continue" actually worked. API may not be ready yet.

**Solution:** After sending keystrokes, monitor for re-detection. If a new rate limit appears within 90 seconds, retry.

**Implementation:**
- After `sendContinueToTerminals()` succeeds:
  1. Don't clear `status.json` immediately
  2. Start a verification timer: check `status.json` every 10 seconds for 90 seconds
  3. If `status.json` gets updated with a NEW `last_detected` timestamp during this window → API wasn't ready, retry
  4. Retry with exponential backoff: delays of 10s, 20s, 40s, 60s (max 4 retries)
  5. On final retry failure, send desktop notification
  6. If no re-detection after 90 seconds → success, clear `status.json`
- Add config key `resume.maxRetries` (default: `4`)
- Add config key `resume.verificationWindowSec` (default: `90`)

**Files changed:**
- `auto-resume-daemon.js` — refactor `startCountdown()` completion handler into `attemptResume()` with verification

### 2B. Tighter PID matching

**Problem:** `pgrep -f "claude"` matches browser tabs, this daemon, unrelated processes.

**Solution:** Use more specific matching.

**Implementation:**
- Change from: `pgrep -f "claude" 2>/dev/null | grep -v "^$DAEMON_PID$"`
- Change to: `pgrep -f "claude-code|claude --" 2>/dev/null | grep -v "^$DAEMON_PID$"`
- This matches the actual Claude Code CLI binary/command, not every process with "claude" in its args
- Also add exclusion for `auto-resume-daemon` to be safe

**Files changed:**
- `auto-resume-daemon.js` — update Strategy 2 shell script

### 2C. Retry mechanism on send failure

**Problem:** Single-shot attempt. If xdotool fails (locked screen, wrong focus), no retry.

**Solution:** Retry up to 3 times with 10-second intervals.

**Implementation:**
- Wrap `sendContinueToTerminals()` call in a retry loop
- On failure: wait 10s, retry. Max 3 attempts.
- Log each retry attempt
- After final failure, send desktop notification

**Files changed:**
- `auto-resume-daemon.js` — add `sendWithRetry()` wrapper function

### 2D. Configurable post-reset delay

**Problem:** 5-second post-reset wait may be too short for some users/tiers.

**Solution:** Make it configurable.

**Implementation:**
- Add config key `resume.postResetDelaySec` (default: `10` — increased from current 5)
- Read from config in the countdown completion handler
- Document in README configuration table

**Files changed:**
- `auto-resume-daemon.js` — read `resume.postResetDelaySec` from config
- `src/modules/config-manager.js` — add default
- `README.md` — add to config table

---

## 3. Daemon Resilience

### 3A. Heartbeat file

**Problem:** PID check can't detect wedged daemons (alive but not functioning).

**Solution:** Daemon writes a heartbeat timestamp every 30 seconds. SessionStart hook checks it.

**Implementation:**
- Daemon: Every 30 seconds, write `{ timestamp: Date.now(), pid: process.pid }` to `~/.claude/auto-resume/heartbeat.json`
- SessionStart hook (`ensure-daemon-running.js`):
  1. If PID file exists and process is alive:
     - Read `heartbeat.json`
     - If timestamp is older than 120 seconds → daemon is wedged
     - Kill the old process, remove PID file, start a new daemon
  2. Log the action: "Daemon was wedged (heartbeat stale), restarted"

**Files changed:**
- `auto-resume-daemon.js` — add `startHeartbeat()` interval, called from `startDaemon()`
- `scripts/ensure-daemon-running.js` — add heartbeat staleness check in `isDaemonRunning()` or a new `isDaemonHealthy()` function

### 3B. Self-watchdog

**Problem:** Daemon has no self-repair capability if internal state breaks.

**Solution:** Periodic self-check.

**Implementation:**
- Every 60 seconds, the daemon verifies:
  1. `watchInterval` is active (not null)
  2. `BASE_DIR` exists and is writable (try `fs.accessSync`)
  3. Process memory usage < 200MB (safety check for memory leaks)
  4. `STATUS_FILE` parent directory is accessible
- If any check fails:
  1. Attempt self-repair (recreate directories, restart watch interval)
  2. If self-repair fails, log error and `process.exit(1)` — SessionStart hook will restart on next Claude Code session

**Files changed:**
- `auto-resume-daemon.js` — add `selfWatchdog()` function and interval

### 3C. Log rotation

**Problem:** `daemon.log` grows unbounded via `fs.appendFileSync` on every event.

**Solution:** Rotate when file exceeds 1MB.

**Implementation:**
- In the `log()` function, before appending:
  1. Check file size with `fs.statSync(LOG_FILE).size`
  2. If > 1MB (1048576 bytes):
     - Delete `daemon.log.1` if it exists
     - Rename `daemon.log` → `daemon.log.1`
     - Continue writing to fresh `daemon.log`
- Only check size every 100 log calls (avoid stat on every write) using a counter
- Add config key `daemon.maxLogSizeMB` (default: `1`)

**Files changed:**
- `auto-resume-daemon.js` — add rotation logic to `log()` function
- `src/modules/config-manager.js` — add `daemon.maxLogSizeMB` default

### 3D. Death notification

**Problem:** Daemon crashes silently. User doesn't know until next rate limit goes unhandled.

**Solution:** Send a desktop notification on fatal error before exit.

**Implementation:**
- In the `uncaughtException` handler and `shutdown()` function:
  1. If `NotificationManager` is available and shutdown reason is ERROR (not SIGINT/SIGTERM):
     - Fire notification: "Auto-Resume daemon crashed: [error message]"
  2. Best-effort only — don't let notification failure prevent clean shutdown

**Files changed:**
- `auto-resume-daemon.js` — add notification in `shutdown()` and `uncaughtException` handler

---

## New Config Keys Summary

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `daemon.transcriptPolling` | boolean | `true` | Enable redundant transcript polling in daemon |
| `daemon.maxLogSizeMB` | number | `1` | Max log file size before rotation |
| `resume.postResetDelaySec` | number | `10` | Seconds to wait after reset time before sending keystrokes |
| `resume.maxRetries` | number | `4` | Max retry attempts if resume fails |
| `resume.verificationWindowSec` | number | `90` | Seconds to watch for re-detection after resume attempt |

---

## Implementation Order

1. **3C. Log rotation** — simplest, zero risk, immediate quality-of-life improvement
2. **1C. Relax length filter** — one-line change, reduces missed detections
3. **3A. Heartbeat file** — critical for daemon resilience, modest complexity
4. **2D. Configurable post-reset delay** — simple config plumbing
5. **2C. Retry mechanism** — straightforward wrapper function
6. **2B. Tighter PID matching** — small shell script change
7. **1B. Stop hook watchdog** — touches two files, moderate complexity
8. **3B. Self-watchdog** — new interval, moderate complexity
9. **3D. Death notification** — small addition to existing handler
10. **1A. Daemon transcript polling** — most complex, requires importing from hook module
11. **2A. Post-resume verification loop** — most complex, refactors countdown completion flow

---

## Testing Plan

Each change gets:
1. Unit test in `tests/` covering the new function
2. Manual verification with `--test` mode where applicable
3. Integration test: trigger actual rate limit (or simulate via status.json write) and verify end-to-end

Existing test files that need updates:
- `tests/rate-limit-hook.test.js` — for 1B, 1C
- `tests/ensure-daemon-running.test.js` — for 1B, 3A
- New test file: `tests/daemon-reliability.test.js` — for 2A, 2C, 3B, 3C

---

## Version Strategy

- Implement in a single feature branch `feat/reliability-improvements`
- Bump to 1.6.0 on merge (minor — new features, no breaking changes)
- All new config keys have defaults, so existing installations work without config changes
