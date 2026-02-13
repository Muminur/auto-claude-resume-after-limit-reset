# Auto-Resume Daemon Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Claude Code Auto-Resume System                        │
└─────────────────────────────────────────────────────────────────────────┘

          ┌──────────────────┐
          │  Claude Code API │
          │  (Rate Limited)  │
          └────────┬─────────┘
                   │ sends rate limit message
                   │ "You've hit your limit · resets 8pm (Asia/Dhaka)"
                   ▼
          ┌──────────────────┐
          │ Claude Code CLI  │
          │   (Terminal)     │
          └────────┬─────────┘
                   │ detected by Stop hook
                   ▼
        ┌─────────────────────────┐
        │   rate-limit-hook.js    │
        │  - Reads transcript     │
        │  - Parses reset time    │
        │  - Writes status.json   │
        └────────┬────────────────┘
                 │ writes JSON file
                 ▼
    ┌────────────────────────────────┐
    │ ~/.claude/auto-resume/         │
    │   status.json                  │
    │   {                            │
    │     "detected": true,          │
    │     "reset_time": "2026-..."   │
    │   }                            │
    └────────┬───────────────────────┘
             │ watched by daemon (5s poll)
             ▼
    ┌───────────────────────────────┐
    │  Auto-Resume Daemon Process   │
    │  - File watcher               │
    │  - Countdown timer            │
    │  - Terminal automation        │
    └────────┬──────────────────────┘
             │ when reset time + 10s delay arrives
             ▼
    ┌───────────────────────────────┐
    │  Terminal Automation          │
    │  Strategy 1: Saved PID        │
    │  Strategy 2: Live PID         │
    │  Strategy 3: All Terminals    │
    │  + Tab cycling (Ctrl+PgDown) │
    └────────┬──────────────────────┘
             │ sends Esc + Ctrl+U + "continue" + Enter
             ▼
    ┌───────────────────────────────┐
    │  Claude Code Terminal(s)      │
    │  - All tabs receive keystroke │
    │  - Sessions resume            │
    └───────────────────────────────┘
```

## Component Architecture

### 1. systemd Service Stack (Linux)

```
systemd
  └── systemd-wrapper.js
        ├── TCP anchor (keeps event loop alive)
        ├── require('./auto-resume-daemon.js')
        └── daemon.main() (explicit call)
              ├── File watcher (polls status.json)
              ├── Transcript poller (scans JSONL)
              ├── Countdown timer
              ├── src/
              │     ├── delivery/
              │     │     ├── orchestrator.js   (tiered delivery coordinator)
              │     │     ├── tmux.js           (Tier 1 — tmux send-keys)
              │     │     └── pty.js            (Tier 2 — PTY /dev/pts/N)
              │     ├── verification/
              │     │     └── active.js          (post-delivery transcript poll)
              │     └── queue/
              │           └── rate-limit-queue.js (FIFO event queue)
              └── Keystroke injector (Tier 3: xdotool / osascript / SendKeys)
```

#### Why the wrapper?

Without a TTY (stdin = /dev/null under systemd), Node.js event loop can drain before
async handles register. The wrapper:
1. Creates `net.createServer().listen()` — synchronous anchor that keeps Node alive
2. Calls `daemon.main()` explicitly — bypasses `require.main === module` guard

#### require.main Guard

All modules with a `main()` function use:
```javascript
if (require.main === module) { main(); }
```

Without this, `require()`-ing a module that calls `main()` → `process.exit()` will
kill the parent process. This was the root cause of the daemon crashing under systemd
(rate-limit-hook.js was reading stdin and calling process.exit(0) when require()'d).

### 2. Status File System

```
[Created by Stop hook]
    │
    │ rate-limit-hook.js writes status.json
    │
    ▼
┌─────────────────────────┐
│  status.json            │
│  {                      │
│    detected: true,      │
│    reset_time: "...",   │
│    message: "...",      │
│    claude_pid: 12345    │
│  }                      │
└────────┬────────────────┘
         │
         │ Daemon polls (fs.statSync + mtime check)
         │ Every 5 seconds (configurable)
         │
         ▼
    [Countdown Active]
         │
         │ Display: "[WAITING] Resuming in HH:MM:SS..."
         │
         ▼
    [Reset Time + 10s Delay]
         │
         │ Send keystrokes to all terminal tabs
         │
         ▼
    [Status cleared, back to watching]
```

### 3. Window Finding Strategies (Linux)

```
sendContinueToTerminals()
    │
    ├── Strategy 1: Saved PID
    │   │
    │   │ status.json has claude_pid?
    │   │ Walk process tree: claude → bash → gnome-terminal
    │   │ Get window ID from PID
    │   │
    │   └── Found? → Use this window
    │
    ├── Strategy 2: Live PID
    │   │
    │   │ pgrep -f "claude"
    │   │ Walk each process tree to find terminal window
    │   │
    │   └── Found? → Use these windows
    │
    └── Strategy 3: All Terminals
        │
        │ xdotool search --class "gnome-terminal|konsole|xterm|..."
        │
        └── Use all matching windows
```

### 4. Tab Cycling (Linux gnome-terminal)

```
┌─────────────────────────────┐
│ gnome-terminal window       │
│ ┌─────┬─────┬─────┬─────┐  │
│ │Tab 1│Tab 2│Tab 3│Tab 4│  │  ← All tabs share one window ID
│ └─────┴─────┴─────┴─────┘  │
│                             │
│ xdotool can only type in    │
│ the ACTIVE tab              │
└─────────────────────────────┘

Solution:
1. Count tabs: ps --ppid <gnome-terminal-server PID> | grep bash | wc -l
2. For each tab:
   a. If not first tab: Ctrl+PageDown (switch tab)
   b. Sleep 0.5s
   c. Send: Escape → Ctrl+U → "continue" → Enter
3. Return to original tab: Ctrl+PageDown (wraps around)
```

### 5. Crash-Loop Protection

```
┌──────────────────────────────────────────┐
│         Crash-Loop Prevention            │
├──────────────────────────────────────────┤
│                                          │
│  systemd level:                          │
│  ├── StartLimitBurst=3                   │
│  ├── StartLimitIntervalSec=300           │
│  └── RestartSec=60                       │
│  = Max 3 starts in 5 min, 60s between   │
│                                          │
│  Daemon level:                           │
│  ├── .last-start file (30s guard)        │
│  └── Atomics.wait() for blocking delay   │
│                                          │
│  Memory watchdog:                        │
│  ├── Daemon: exits at 200MB RSS          │
│  └── systemd: MemoryMax=512M hard cap   │
│                                          │
│  Log rotation:                           │
│  └── daemon.log rotated at 1MB           │
│                                          │
└──────────────────────────────────────────┘
```

### 6. Tiered Delivery Stack

Keystroke delivery uses a tiered fallback approach. The `DeliveryOrchestrator`
tries each tier in order and falls back to the next on failure.

```
┌──────────────────────────────────────────────────────────┐
│  DeliveryOrchestrator  (src/delivery/orchestrator.js)    │
│  Coordinates tiers — tries 1 → 2 → 3 until one succeeds │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  Tier 1: TmuxDelivery  (src/delivery/tmux.js)            │
│  └── tmux send-keys to target pane                       │
│  └── Most reliable when session runs inside tmux         │
│                                                          │
│  Tier 2: PtyDelivery   (src/delivery/pty.js)             │
│  └── Direct PTY write to /dev/pts/N                      │
│  └── Works without X11 / Wayland; needs read access      │
│                                                          │
│  Tier 3: Platform-native                                 │
│  ├── Linux:   XdotoolDelivery (xdotool type + key)       │
│  ├── macOS:   osascript keystroke                         │
│  └── Windows: PowerShell SendKeys                        │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### 7. Active Verification

After delivery, the daemon verifies that the resume actually took effect
by polling the Claude Code transcript file for new activity.

```
┌──────────────────────────────────────────────────────────┐
│  Active Verification  (src/verification/)                │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  1. Delivery completes (keystrokes sent)                 │
│  2. Poll transcript JSONL for new lines / mtime change   │
│  3. If new activity detected → resume confirmed          │
│  4. If timeout reached → log warning, optionally retry   │
│                                                          │
│  Config keys (in config or status):                      │
│  ├── activeVerificationTimeoutMs  (max wait, e.g. 30s)  │
│  └── activeVerificationPollMs    (poll interval, e.g. 2s)│
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### 8. Rate Limit Queue

Multiple rate limit detections are queued rather than overwriting a single
slot, preventing lost events during rapid successive detections.

```
┌──────────────────────────────────────────────────────────┐
│  Rate Limit Queue  (src/queue/)                          │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  status.json stores a queue array:                       │
│  {                                                       │
│    "detected": true,                                     │
│    "queue": [                                            │
│      { "reset_time": "...", "claude_pid": 111 },         │
│      { "reset_time": "...", "claude_pid": 222 }          │
│    ]                                                     │
│  }                                                       │
│                                                          │
│  ┌─ Hook fires ──► enqueue(event) ──► status.json ──┐   │
│  │                                                   │   │
│  │  Daemon reads queue, processes head entry first   │   │
│  │  After successful resume, shifts queue            │   │
│  └───────────────────────────────────────────────────┘   │
│                                                          │
│  Benefits:                                               │
│  ├── No lost events when limits hit in quick succession  │
│  ├── Ordered processing (FIFO)                           │
│  └── Atomic JSON read/write with file locking            │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### 9. Cross-Platform Keystroke Sending

```
┌──────────────────────────────────────────┐
│     Platform Detection: os.platform()    │
├──────────┬──────────┬────────────────────┤
│ Windows  │ macOS    │ Linux              │
├──────────┼──────────┼────────────────────┤
│ PowerShell│osascript│ xdotool            │
│ SendKeys │keystroke│ type + key          │
│ Find by  │Find by  │ Find by WM_CLASS   │
│ title    │process  │ + tab cycling       │
└──────────┴──────────┴────────────────────┘
```

## Data Flow

```
Time T0: Rate limit hit
│
│ Claude Code shows: "You've hit your limit · resets 8pm (Asia/Dhaka)"
│ Session stops → Stop hook fires
│
▼
rate-limit-hook.js
│ Reads transcript JSONL from stdin
│ Parses reset time → ISO 8601 UTC
│ Writes status.json
│
▼
Time T0+5s: Daemon detects
│ fs.statSync() → mtime changed
│ JSON.parse() → detected: true
│ Starts countdown
│
▼
Time T0 to Reset: Countdown
│ Every second: "[WAITING] Resuming in HH:MM:SS..."
│
▼
Time Reset+10s: Dequeue & deliver
│ Pop head entry from rate limit queue
│ DeliveryOrchestrator begins tiered delivery:
│   Tier 1 → tmux send-keys (if tmux session found)
│   Tier 2 → PTY write to /dev/pts/N (if accessible)
│   Tier 3 → xdotool / osascript / SendKeys (platform-native)
│ First successful tier wins; others skipped
│
▼
Time Reset+12s: Active verification
│ Poll transcript JSONL for new activity
│ Interval: activeVerificationPollMs (default 2s)
│ Timeout: activeVerificationTimeoutMs (default 30s)
│ Confirmed → proceed to cleanup
│ Timeout  → log warning, optional retry
│
▼
Time Reset+15s: Cleanup
│ Shift processed entry from queue
│ If queue empty → clear status.json
│ If queue has more → process next entry
│ Log completion
│ Back to watching state
```

## Security Model

| Attack Vector | Risk | Mitigation |
|---------------|------|------------|
| Status file tampering | Medium | File permissions (600), format validation |
| Keystroke injection | Medium | Fixed prompt text, no user input in keys |
| PID file race | Low | Atomic operations, process existence check |
| Log file disclosure | Low | Restrictive permissions, no secrets logged |
| Privilege escalation | None | Runs as user, no elevated operations |
| Network attack | None | No network connections (purely local) |

## Performance

| Operation | Frequency | CPU | Memory | Disk I/O |
|-----------|-----------|-----|--------|----------|
| File stat check | 1/5s | <0.01% | 0 MB | 1 read |
| Status parse | On change | <0.1% | <1 MB | 1 read |
| Countdown update | 1/second | <0.01% | 0 MB | 0 |
| Tab cycling + keys | Once | 0.5-1% | <1 MB | 0 |
| Logging | Per event | <0.01% | <1 MB | 1 write |
| **Total (idle)** | — | <0.1% | 30-50 MB | 1 read/5s |
