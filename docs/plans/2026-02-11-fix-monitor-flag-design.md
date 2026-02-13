# Fix: Add `--monitor` CLI Alias to Auto-Resume Daemon

**Date:** 2026-02-11
**Status:** Draft

## Problem

The systemd service (`claude-auto-resume.service`) invokes:
```
node auto-resume-daemon.js --monitor
```

But the daemon's CLI parser (line 1812) has no `--monitor` case. It falls through to `default:`, logs `Unknown command: --monitor`, and exits with code 1. The service has been crash-looping **13,338+ times** (every 10 seconds for ~37 hours).

## Root Cause

The systemd service was written expecting a `--monitor` flag that was never implemented in the daemon's CLI `switch` statement.

## Fix

Add `--monitor` and `monitor` as aliases for `start` in the daemon's CLI switch. This is semantically correct: `--monitor` means "run in foreground and monitor" which is exactly what `start` does (writes PID, starts file watcher, heartbeat, watchdog).

### Changes Required

1. **`auto-resume-daemon.js`** (line ~1813): Add `case 'monitor':` and `case '--monitor':` falling through to `startDaemon()`
2. **`auto-resume-daemon.js`** (help text): Add `monitor` as documented alias
3. **Testability**: Add `require.main === module` guard and export `main` for testing
4. **Tests**: New test file validating CLI command parsing

### Not Changing

- The systemd service file stays as-is (`--monitor` will now work)
- `ensure-daemon-running.js` stays as-is (already correctly uses `start`)

## TDD Plan

### Phase 1: Make Daemon Testable
- Replace unconditional `main()` call with `require.main === module` guard
- Export `main` and key functions for test access

### Phase 2: Write Failing Tests
Create `tests/cli.test.js`:
- Test that `--monitor` is accepted as valid CLI command (doesn't exit 1)
- Test that `monitor` is accepted as valid CLI command
- Test that existing commands (`start`, `help`, `--help`) still work
- Test that unknown commands still fail with exit 1

### Phase 3: Implement Fix
- Add `--monitor`/`monitor` cases to the switch
- Update help text

### Phase 4: Verify
- Run `npm test` — all tests pass
- Restart systemd service
- Confirm service stays running (not crash-looping)
