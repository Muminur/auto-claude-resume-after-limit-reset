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
                   │
                   │ sends rate limit message
                   │ "You've hit your limit · resets 8pm (Asia/Dhaka)"
                   │
                   ▼
          ┌──────────────────┐
          │ Claude Code CLI  │
          │   (Terminal)     │
          └────────┬─────────┘
                   │
                   │ detected by plugin/user
                   │
                   ▼
        ┌─────────────────────────┐
        │   Plugin / User Script  │
        │  - Parses reset time    │
        │  - Writes status.json   │
        └────────┬────────────────┘
                 │
                 │ writes JSON file
                 │
                 ▼
    ┌────────────────────────────────┐
    │ ~/.claude/auto-resume/         │
    │   status.json                  │
    │   {                            │
    │     "detected": true,          │
    │     "reset_time": "2026-..."   │
    │   }                            │
    └────────┬───────────────────────┘
             │
             │ watched by (1s poll)
             │
             ▼
    ┌───────────────────────────────┐
    │  Auto-Resume Daemon Process   │
    │  - File watcher               │
    │  - Countdown timer            │
    │  - Terminal automation        │
    └────────┬──────────────────────┘
             │
             │ when reset time arrives
             │
             ▼
    ┌───────────────────────────────┐
    │  Terminal Automation          │
    │  - Find Claude windows        │
    │  - Send "continue" + Enter    │
    └────────┬──────────────────────┘
             │
             │ resumes
             │
             ▼
    ┌───────────────────────────────┐
    │  Claude Code Terminal(s)      │
    │  - Receives keystroke         │
    │  - Continues conversation     │
    └───────────────────────────────┘
```

## Component Architecture

### 1. Status File System

```
┌─────────────────────────────────────────────────────┐
│              Status File Lifecycle                  │
└─────────────────────────────────────────────────────┘

[Created]
    │
    │ writeRateLimitStatus()
    │
    ▼
┌─────────────────────────┐
│  status.json            │
│  ┌────────────────────┐ │
│  │ detected: true     │ │
│  │ reset_time: "..."  │ │
│  │ message: "..."     │ │
│  │ timezone: "..."    │ │
│  └────────────────────┘ │
└────────┬────────────────┘
         │
         │ Daemon watches (fs.statSync + mtime check)
         │ Every 1 second
         │
         ▼
    [Detected]
         │
         │ Parse reset_time
         │ Calculate wait duration
         │
         ▼
  [Countdown Active]
         │
         │ Update console every 1s
         │ "[WAITING] Resuming in HH:MM:SS..."
         │
         ▼
  [Reset Time Reached]
         │
         │ Send keystrokes
         │
         ▼
┌─────────────────────────┐
│  fs.unlinkSync()        │
│  (Status file deleted)  │
└─────────────────────────┘
         │
         ▼
     [Complete]
```

### 2. Daemon Process Management

```
┌─────────────────────────────────────────────────────┐
│             Daemon Process Lifecycle                 │
└─────────────────────────────────────────────────────┘

[Start Command]
    │
    │ node auto-resume-daemon.js start
    │
    ▼
┌──────────────────────────┐
│ Check Existing Daemon    │
│ - Read daemon.pid        │
│ - Check if process alive │
└──────┬───────────────────┘
       │
       ├─ Already Running? → [Exit with error]
       │
       └─ Not Running
           │
           ▼
    ┌──────────────────┐
    │ Initialize       │
    │ - Create dirs    │
    │ - Write PID file │
    │ - Setup signals  │
    └────┬─────────────┘
         │
         ▼
    ┌─────────────────────┐
    │ Start File Watcher  │
    │ setInterval(1000ms) │
    └────┬────────────────┘
         │
         │ Running...
         │
         ▼
    ┌──────────────────────┐
    │ Receive SIGTERM/INT  │
    │ - Stop watcher       │
    │ - Stop countdown     │
    │ - Remove PID file    │
    │ - Log shutdown       │
    └────┬─────────────────┘
         │
         ▼
     [Exit 0]
```

### 3. File Watching Mechanism

```
┌─────────────────────────────────────────────────────┐
│           Status File Watching Loop                  │
└─────────────────────────────────────────────────────┘

    ┌──────────────────────┐
    │ setInterval(1s)      │
    └──────────┬───────────┘
               │
               ▼
    ┌──────────────────────────┐
    │ fs.existsSync()          │
    │ Check status.json exists │
    └──────┬──────────┬────────┘
           │          │
    No ◄───┘          └───► Yes
     │                        │
     │                        ▼
     │              ┌─────────────────────┐
     │              │ fs.statSync()       │
     │              │ Get mtime           │
     │              └──────┬──────────────┘
     │                     │
     │                     ▼
     │              ┌─────────────────────┐
     │              │ Compare mtimes      │
     │              │ Changed?            │
     │              └──────┬──────┬───────┘
     │                     │      │
     │              No ◄───┘      └───► Yes
     │               │                   │
     ▼               │                   ▼
┌─────────────┐     │        ┌──────────────────────┐
│ Stop any    │     │        │ fs.readFileSync()    │
│ countdown   │     │        │ Parse JSON           │
└─────────────┘     │        └──────┬───────────────┘
     │              │               │
     │              │               ▼
     │              │        ┌──────────────────────┐
     │              │        │ Validate format      │
     │              │        │ detected === true?   │
     │              │        └──────┬──────┬────────┘
     │              │               │      │
     │              │        No ◄───┘      └───► Yes
     │              │         │                   │
     │              │         │                   ▼
     │              │         │        ┌─────────────────────┐
     │              │         │        │ Parse reset_time    │
     │              │         │        │ new Date(...)       │
     │              │         │        └──────┬──────────────┘
     │              │         │               │
     │              │         │               ▼
     │              │         │        ┌─────────────────────┐
     │              │         │        │ Valid Date?         │
     │              │         │        └──────┬──────┬───────┘
     │              │         │               │      │
     │              │         │        No ◄───┘      └───► Yes
     │              │         │         │                   │
     │              │         │         │                   ▼
     │              │         │         │        ┌─────────────────────┐
     │              │         │         │        │ Start countdown     │
     │              │         │         │        │ Display timer       │
     │              │         │         │        └─────────────────────┘
     │              │         │         │
     └──────────────┴─────────┴─────────┘
                    │
                    ▼
              [Next iteration]
```

### 4. Countdown Timer System

```
┌─────────────────────────────────────────────────────┐
│            Countdown Timer Logic                     │
└─────────────────────────────────────────────────────┘

    ┌─────────────────────────┐
    │ Reset time detected     │
    │ resetTime = new Date()  │
    └──────────┬──────────────┘
               │
               ▼
    ┌─────────────────────────────┐
    │ Start countdown interval    │
    │ setInterval(1000ms)         │
    └──────────┬──────────────────┘
               │
               ▼
    ┌──────────────────────────────┐
    │ Calculate remaining time     │
    │ remaining = resetTime - now  │
    └──────────┬───────────────────┘
               │
               ▼
    ┌──────────────────────────────┐
    │ remaining > 0?               │
    └──────┬───────────┬───────────┘
           │           │
        No │           │ Yes
           │           │
           │           ▼
           │    ┌─────────────────────────────┐
           │    │ Format time HH:MM:SS        │
           │    │ Display:                    │
           │    │ "[WAITING] Resuming in..." │
           │    └──────────┬──────────────────┘
           │               │
           │               │ Continue loop
           │               │
           │               └───► [Next second]
           │
           ▼
    ┌───────────────────────────────┐
    │ Clear countdown interval      │
    │ Display: "[READY] Reset!"     │
    └──────────┬────────────────────┘
               │
               ▼
    ┌───────────────────────────────┐
    │ Wait 5 seconds (buffer)       │
    │ setTimeout(5000)              │
    └──────────┬────────────────────┘
               │
               ▼
    ┌───────────────────────────────┐
    │ Send keystrokes to terminals  │
    └──────────┬────────────────────┘
               │
               ▼
    ┌───────────────────────────────┐
    │ Clear status file             │
    │ fs.unlinkSync()               │
    └──────────┬────────────────────┘
               │
               ▼
           [Complete]
```

### 5. Cross-Platform Terminal Automation

```
┌─────────────────────────────────────────────────────┐
│         Platform-Specific Keystroke Sending         │
└─────────────────────────────────────────────────────┘

    ┌─────────────────────┐
    │ sendKeystrokes()    │
    └──────────┬──────────┘
               │
               ▼
    ┌─────────────────────┐
    │ Detect platform     │
    │ os.platform()       │
    └──────┬──────────────┘
           │
           ├──► Windows (win32)
           │     │
           │     ▼
           │    ┌─────────────────────────────────────┐
           │    │ PowerShell Script:                  │
           │    │ Get-Process                         │
           │    │   | Where MainWindowTitle -match    │
           │    │     "Claude"                        │
           │    │ → [System.Windows.Forms.SendKeys]   │
           │    │     .SendWait('continue')           │
           │    │     .SendWait('{ENTER}')            │
           │    └─────────────────┬───────────────────┘
           │                      │
           ├──► macOS (darwin)    │
           │     │                │
           │     ▼                │
           │    ┌─────────────────────────────────────┐
           │    │ osascript:                          │
           │    │ tell application "System Events"    │
           │    │   tell process "Terminal"           │
           │    │     keystroke "continue"            │
           │    │     keystroke return                │
           │    │   end tell                          │
           │    │ end tell                            │
           │    └─────────────────┬───────────────────┘
           │                      │
           └──► Linux             │
                 │                │
                 ▼                │
                ┌─────────────────────────────────────┐
                │ xdotool:                            │
                │ # Find terminal windows             │
                │ xdotool search --class              │
                │   "gnome-terminal|konsole|..."      │
                │                                     │
                │ # Send keystrokes                   │
                │ xdotool type "continue"             │
                │ xdotool key Return                  │
                └─────────────────┬───────────────────┘
                                  │
                                  │
                ┌─────────────────┴───────────────────┐
                │                                     │
                ▼                                     ▼
         [Success: Resolve]              [Error: Reject]
```

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                      Data Flow Overview                          │
└─────────────────────────────────────────────────────────────────┘

Time: T0 (Rate Limit Hit)
    │
    │ User/Plugin detects: "You've hit your limit · resets 8pm (Asia/Dhaka)"
    │
    ▼
┌───────────────────────────────────────┐
│ parseResetTime(message)               │
│ → Extract: hour=8pm, timezone=Dhaka   │
│ → Convert to UTC                      │
│ → Return: Date object                 │
└─────────────┬─────────────────────────┘
              │
              ▼
┌───────────────────────────────────────┐
│ writeRateLimitStatus()                │
│ {                                     │
│   detected: true,                     │
│   reset_time: "2026-01-21T14:00:00Z" │
│ }                                     │
│ → Write to: status.json               │
└─────────────┬─────────────────────────┘
              │
              │ File system write
              │
Time: T0 + 1s (Daemon detects)
    │
    ▼
┌───────────────────────────────────────┐
│ Daemon: watchInterval fires           │
│ → fs.statSync(status.json)            │
│ → mtime changed? Yes                  │
│ → fs.readFileSync(status.json)        │
│ → JSON.parse()                        │
└─────────────┬─────────────────────────┘
              │
              ▼
┌───────────────────────────────────────┐
│ Validate status                       │
│ → detected === true? ✓                │
│ → reset_time valid? ✓                 │
│ → resetTime = new Date(reset_time)    │
└─────────────┬─────────────────────────┘
              │
              ▼
┌───────────────────────────────────────┐
│ startCountdown(resetTime)             │
│ → Calculate: remaining = reset - now  │
│ → Start interval: every 1s            │
└─────────────┬─────────────────────────┘
              │
Time: T0 + 2s to Reset Time
    │
    │ Every second:
    │ ├─ Calculate remaining
    │ ├─ Format HH:MM:SS
    │ └─ Display: "[WAITING] Resuming in..."
    │
    ▼
Time: Reset Time (e.g., 8pm Dhaka = 2pm UTC)
    │
    ▼
┌───────────────────────────────────────┐
│ Countdown: remaining <= 0             │
│ → Stop interval                       │
│ → Display: "[READY] Reset!"           │
└─────────────┬─────────────────────────┘
              │
              ▼
┌───────────────────────────────────────┐
│ Buffer delay: setTimeout(5000ms)      │
│ → Wait for API to fully reset         │
└─────────────┬─────────────────────────┘
              │
              ▼
┌───────────────────────────────────────┐
│ sendContinueToTerminals()             │
│ → Detect platform                     │
│ → Find Claude windows/terminals       │
│ → Send "continue" + Enter             │
└─────────────┬─────────────────────────┘
              │
              ▼
┌───────────────────────────────────────┐
│ clearStatus()                         │
│ → fs.unlinkSync(status.json)          │
│ → Log completion                      │
└─────────────┬─────────────────────────┘
              │
              ▼
Time: Reset + 5s (Complete)
              │
              ▼
          [Session resumed]
```

## State Machine

```
┌─────────────────────────────────────────────────────┐
│            Daemon State Machine                      │
└─────────────────────────────────────────────────────┘

             [START]
                │
                │ node auto-resume-daemon.js start
                │
                ▼
         ┌─────────────┐
         │   INIT      │
         │  - Create   │
         │    dirs     │
         │  - Write    │
         │    PID      │
         └──────┬──────┘
                │
                ▼
         ┌─────────────┐
         │  WATCHING   │◄────────────────┐
         │  - Poll     │                 │
         │    status   │                 │
         │  - Wait for │                 │
         │    changes  │                 │
         └──────┬──────┘                 │
                │                        │
                │ Status detected        │
                │                        │
                ▼                        │
         ┌─────────────┐                 │
         │  COUNTDOWN  │                 │
         │  - Display  │                 │
         │    timer    │                 │
         │  - Wait for │                 │
         │    reset    │                 │
         └──────┬──────┘                 │
                │                        │
                │ Reset time reached     │
                │                        │
                ▼                        │
         ┌─────────────┐                 │
         │  BUFFERING  │                 │
         │  - Wait 5s  │                 │
         └──────┬──────┘                 │
                │                        │
                ▼                        │
         ┌─────────────┐                 │
         │  SENDING    │                 │
         │  - Find     │                 │
         │    windows  │                 │
         │  - Send     │                 │
         │    keys     │                 │
         └──────┬──────┘                 │
                │                        │
                ▼                        │
         ┌─────────────┐                 │
         │  CLEANUP    │                 │
         │  - Clear    │                 │
         │    status   │                 │
         │  - Log      │                 │
         └──────┬──────┘                 │
                │                        │
                └────────────────────────┘
                │
                │ SIGTERM/SIGINT
                │
                ▼
         ┌─────────────┐
         │  SHUTDOWN   │
         │  - Stop     │
         │    watcher  │
         │  - Remove   │
         │    PID      │
         └──────┬──────┘
                │
                ▼
             [EXIT]
```

## Error Handling Flow

```
┌─────────────────────────────────────────────────────┐
│              Error Handling Strategy                 │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────┐
│ Any operation               │
└──────────┬──────────────────┘
           │
           ▼
    ┌──────────────┐
    │ try { ... }  │
    └──────┬───┬───┘
           │   │
      OK ◄─┘   └─► Error
       │              │
       │              ▼
       │       ┌──────────────────┐
       │       │ catch (err) {    │
       │       │   log('error')   │
       │       └──────┬───────────┘
       │              │
       │              ▼
       │       ┌──────────────────────┐
       │       │ Error Type?          │
       │       └──┬────────┬────────┬─┘
       │          │        │        │
       │          │        │        │
       │   File   │  Parse │  Other │
       │   Error  │  Error │  Error │
       │          │        │        │
       │          ▼        ▼        ▼
       │   ┌─────────┬─────────┬─────────┐
       │   │ Ignore  │ Log &   │ Log &   │
       │   │ (retry  │ Skip    │ Retry   │
       │   │  next)  │ cycle   │ once    │
       │   └─────────┴─────────┴─────────┘
       │          │        │        │
       └──────────┴────────┴────────┘
                  │
                  ▼
           [Continue operation]
```

## Performance Characteristics

```
┌─────────────────────────────────────────────────────┐
│           Performance Profile                        │
└─────────────────────────────────────────────────────┘

Operation              Frequency    CPU      Memory    Disk I/O
─────────────────────────────────────────────────────────────────
File stat check        1/second     <0.01%   0 MB      1 read
Status parse           On change    <0.1%    <1 MB     1 read
Countdown update       1/second     <0.01%   0 MB      0
Terminal automation    Once         0.5-1%   <1 MB     0
Logging                Per event    <0.01%   <1 MB     1 write

Total (idle):          -            <0.1%    30-50 MB  1 read/s
Total (countdown):     -            <0.2%    30-50 MB  1 read/s
Total (sending):       -            1-2%     30-50 MB  1 write

Scalability:
- Linear with status file size (usually <1KB)
- Constant memory footprint
- No network I/O
- Single-threaded event loop
```

## Security Model

```
┌─────────────────────────────────────────────────────┐
│              Security Considerations                 │
└─────────────────────────────────────────────────────┘

Attack Vector          Risk Level    Mitigation
──────────────────────────────────────────────────────
Status file tampering  Medium        • File permissions (600)
                                    • Format validation
                                    • Bounds checking

Keystroke injection    Medium        • Only to Claude windows
                                    • Fixed prompt text
                                    • No user input in keys

PID file race          Low           • Atomic operations
                                    • Process existence check

Log file disclosure    Low           • Restrictive permissions
                                    • No secrets logged

Process hijacking      Low           • PID validation
                                    • Signal handling

Denial of service      Low           • Single instance check
                                    • Bounded memory use
                                    • No recursive operations

Privilege escalation   None          • Runs as user
                                    • No elevated operations
```

## Integration Points

```
┌─────────────────────────────────────────────────────┐
│          Integration Architecture                    │
└─────────────────────────────────────────────────────┘

External System         Interface           Data Flow
──────────────────────────────────────────────────────
Claude Code Plugin  →  status.json write  →  Daemon
Terminal Emulator   ←  Keystroke send     ←  Daemon
File System         ↔  Read/Write         ↔  Daemon
Operating System    ↔  Signals/Process    ↔  Daemon
Log Aggregator      ←  daemon.log         ←  Daemon (optional)
Monitoring System   ←  PID/Status check   ←  Daemon (optional)

Example Integration Flow:

[Claude Plugin]
     │
     │ 1. Detect rate limit in API response
     │
     ▼
[parseResetTime()]
     │
     │ 2. Convert "8pm (Asia/Dhaka)" → Date object
     │
     ▼
[writeRateLimitStatus()]
     │
     │ 3. Write status.json with reset_time
     │
     ▼
[Daemon - watchInterval]
     │
     │ 4. Detect file change, parse JSON
     │
     ▼
[Daemon - startCountdown]
     │
     │ 5. Display timer, wait for reset
     │
     ▼
[Daemon - sendContinueToTerminals]
     │
     │ 6. Send "continue" to terminals
     │
     ▼
[Claude Terminal]
     │
     │ 7. Receive keystroke, resume session
     │
     ▼
[Session Resumed]
```

## Summary

This architecture provides:

1. **Loose Coupling:** File-based communication between components
2. **Fault Tolerance:** Error handling at every level
3. **Platform Independence:** Abstracted terminal automation
4. **Process Isolation:** Single daemon instance enforcement
5. **Observability:** Comprehensive logging
6. **Performance:** Minimal resource usage
7. **Security:** Validation and permission controls
8. **Maintainability:** Clear state machine and data flow

The system is designed for reliability, with graceful degradation and clear error reporting at every stage.
