# Auto-Resume — Feature Status

## Completed Features

| Feature | Status | Notes |
|---------|--------|-------|
| Background daemon | Done | `auto-resume-daemon.js` — 60KB, cross-platform |
| Rate limit detection (Stop hook) | Done | `rate-limit-hook.js` — parses transcripts for rate limit messages |
| Rate limit detection (transcript polling) | Done | Redundant fallback — daemon polls JSONL transcripts |
| Countdown timer | Done | Live HH:MM:SS display with 10s post-reset safety delay |
| Cross-platform keystrokes | Done | xdotool (Linux), osascript (macOS), SendKeys (Windows) |
| Terminal tab cycling | Done | Counts bash children of gnome-terminal-server, Ctrl+PageDown |
| Window finding strategies | Done | Saved PID, live PID, all terminals — 3 strategies in order |
| systemd service | Done | `systemd-wrapper.js` + crash-loop protection |
| Crash-loop protection | Done | `StartLimitBurst=3`, `RestartSec=60`, daemon-level 30s guard |
| Memory watchdog | Done | Exits at 200MB, systemd enforces 512MB hard cap |
| Log rotation | Done | Auto-rotate at 1MB |
| Configuration system | Done | `config.json` with resumePrompt, intervals, retries |
| Desktop notifications | Done | `node-notifier` — cross-platform |
| Multi-file status watching | Done | `chokidar` — watches multiple status files |
| WebSocket server | Done | Real-time status updates for GUI |
| REST API | Done | Status, config, analytics endpoints |
| Analytics & prediction | Done | Rate limit history, usage patterns |
| Plugin system | Done | Dynamic plugin loading from plugins/ directory |
| GUI dashboard | Done | HTML/CSS/JS dashboard via WebSocket |
| SessionStart auto-start | Done | `ensure-daemon-running.js` — starts daemon on Claude Code launch |
| Retry with backoff | Done | 4 retries with exponential backoff |
| require.main guard | Done | All modules guarded — prevents process.exit() on require() |
| Bash test suite | Done | 24 tests covering daemon, systemd, runtime behavior |
| Jest test suite | Done | Unit tests for daemon modules |

## Architecture Notes

### Detection Flow
```
Claude Code session stops
    -> Stop hook reads transcript JSONL
    -> Parses "You've hit your limit · resets Xpm (Timezone)"
    -> Writes status.json with reset_time
    -> Daemon detects file change
    -> Countdown starts
    -> After reset + 10s: keystrokes sent to all terminal tabs
```

### systemd Flow
```
systemd starts systemd-wrapper.js
    -> TCP anchor created (keeps event loop alive)
    -> daemon = require('./auto-resume-daemon.js')
    -> daemon.main() called explicitly
    -> Daemon runs in monitor mode
```

### Key Lessons Learned

1. **require.main guard is critical**: Any module that calls `main()` or `process.exit()` unconditionally will kill the parent process when `require()`'d. Always use `if (require.main === module) { main(); }`.

2. **Node.js event loop under systemd**: Without a TTY, stdin becomes `/dev/null` and the event loop can drain before async handles register. A synchronous `net.createServer().listen()` TCP anchor prevents this.

3. **xdotool and DISPLAY**: systemd services don't inherit `DISPLAY` or `XAUTHORITY`. Must be explicitly set in the service file.

4. **gnome-terminal tabs**: xdotool can only send to the active tab. Must use `Ctrl+PageDown` to cycle through tabs, sending keystrokes to each.
