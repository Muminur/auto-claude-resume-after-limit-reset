#!/usr/bin/env bash
# TDD Tests for Claude Code Auto-Resume Service (2026-02-12)
# Ensures the auto-resume daemon runs properly without crash-looping
set -euo pipefail

PASS=0
FAIL=0
TOTAL=0

pass() { PASS=$((PASS + 1)); TOTAL=$((TOTAL + 1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); TOTAL=$((TOTAL + 1)); echo "  FAIL: $1"; }
section() { echo ""; echo "=== $1 ==="; }

DAEMON_DIR="$HOME/.claude/auto-resume"
DAEMON_SCRIPT="$DAEMON_DIR/auto-resume-daemon.js"
SERVICE_FILE="$HOME/.config/systemd/user/claude-auto-resume.service"

# ════════════════════════════════════════════════════════════════
# SECTION 1: Daemon script integrity
# ════════════════════════════════════════════════════════════════
section "Daemon Script Integrity"

# Test 1: Daemon script exists
if [ -f "$DAEMON_SCRIPT" ]; then
    pass "auto-resume-daemon.js exists"
else
    fail "auto-resume-daemon.js not found at $DAEMON_SCRIPT"
fi

# Test 2: Daemon accepts --monitor flag (the crash-loop root cause)
MONITOR_TEST=$(timeout 5 node "$DAEMON_SCRIPT" --help 2>&1 || true)
if echo "$MONITOR_TEST" | grep -qi "monitor"; then
    pass "Daemon recognizes 'monitor' command"
else
    fail "Daemon does not recognize 'monitor' command"
fi

# Test 3: Daemon does NOT exit with error on --monitor (dry check via help)
# We verify the switch case handles --monitor by checking the source
if grep -q "case '--monitor'" "$DAEMON_SCRIPT" 2>/dev/null; then
    pass "Source handles --monitor in switch case"
else
    fail "Source missing --monitor case (was the crash-loop root cause)"
fi

# Test 4: Node.js can load the daemon without module errors
LOAD_TEST=$(timeout 5 node -e "
try {
  // Just parse the file, don't execute
  require('fs').readFileSync('$DAEMON_SCRIPT', 'utf8');
  const vm = require('vm');
  new vm.Script(require('fs').readFileSync('$DAEMON_SCRIPT', 'utf8'), {filename: 'test'});
  console.log('OK');
} catch(e) {
  console.log('ERROR: ' + e.message);
}
" 2>&1 || true)
if echo "$LOAD_TEST" | grep -q "OK"; then
    pass "Daemon script parses without syntax errors"
else
    fail "Daemon script has syntax errors: $LOAD_TEST"
fi

# Test 5: Required npm dependencies installed
if [ -d "$DAEMON_DIR/node_modules" ]; then
    MISSING_DEPS=""
    for dep in chokidar ws; do
        if [ ! -d "$DAEMON_DIR/node_modules/$dep" ]; then
            MISSING_DEPS="$MISSING_DEPS $dep"
        fi
    done
    if [ -z "$MISSING_DEPS" ]; then
        pass "Required npm dependencies installed (chokidar, ws)"
    else
        fail "Missing npm dependencies:$MISSING_DEPS"
    fi
else
    fail "node_modules directory missing"
fi

# Test 6: xdotool available (required for Linux keystroke injection)
if command -v xdotool &>/dev/null; then
    pass "xdotool is installed (required for keystroke injection)"
else
    fail "xdotool not installed (apt install xdotool)"
fi

# ════════════════════════════════════════════════════════════════
# SECTION 2: Systemd service configuration
# ════════════════════════════════════════════════════════════════
section "Systemd Service Configuration"

# Test 7: Service file exists and is NOT masked
SVC_STATUS=$(systemctl --user is-enabled claude-auto-resume.service 2>/dev/null || true)
if [ "$SVC_STATUS" = "enabled" ]; then
    pass "claude-auto-resume.service is enabled"
elif [ "$SVC_STATUS" = "masked" ]; then
    fail "claude-auto-resume.service is masked (should be enabled)"
elif [ "$SVC_STATUS" = "disabled" ]; then
    fail "claude-auto-resume.service is disabled (should be enabled)"
else
    fail "claude-auto-resume.service state: $SVC_STATUS"
fi

# Test 8: Service file has crash-loop prevention (StartLimitBurst)
if [ -f "$SERVICE_FILE" ] && [ ! -L "$SERVICE_FILE" ]; then
    if grep -q "StartLimitBurst" "$SERVICE_FILE" 2>/dev/null; then
        BURST=$(grep -oP 'StartLimitBurst=\K\d+' "$SERVICE_FILE" 2>/dev/null || echo "0")
        if [ "$BURST" -gt 0 ] && [ "$BURST" -le 5 ]; then
            pass "StartLimitBurst=$BURST (prevents infinite crash loops)"
        else
            fail "StartLimitBurst=$BURST (should be 3-5)"
        fi
    else
        fail "Missing StartLimitBurst (allows infinite crash loops like 13,361 restarts)"
    fi
else
    fail "Service file missing or is a symlink (masked)"
fi

# Test 9: Service has StartLimitIntervalSec
if [ -f "$SERVICE_FILE" ] && [ ! -L "$SERVICE_FILE" ]; then
    if grep -q "StartLimitIntervalSec" "$SERVICE_FILE" 2>/dev/null; then
        pass "StartLimitIntervalSec is set"
    else
        fail "Missing StartLimitIntervalSec"
    fi
else
    fail "Service file missing or masked"
fi

# Test 10: Service has reasonable RestartSec (not too fast)
if [ -f "$SERVICE_FILE" ] && [ ! -L "$SERVICE_FILE" ]; then
    RESTART_SEC=$(grep -oP 'RestartSec=\K\d+' "$SERVICE_FILE" 2>/dev/null || echo "0")
    if [ "$RESTART_SEC" -ge 30 ]; then
        pass "RestartSec=$RESTART_SEC (>= 30s, prevents rapid restarts)"
    else
        fail "RestartSec=$RESTART_SEC (should be >= 30s, was 10s causing rapid crash loop)"
    fi
else
    fail "Service file missing or masked"
fi

# Test 11: Service uses correct ExecStart command
if [ -f "$SERVICE_FILE" ] && [ ! -L "$SERVICE_FILE" ]; then
    if grep -q "auto-resume-daemon.js" "$SERVICE_FILE" 2>/dev/null; then
        # Should use 'monitor' or '--monitor' (both are now handled)
        if grep -qE "monitor" "$SERVICE_FILE" 2>/dev/null; then
            pass "ExecStart uses monitor command"
        else
            fail "ExecStart missing monitor/--monitor argument"
        fi
    else
        fail "ExecStart does not reference auto-resume-daemon.js"
    fi
else
    fail "Service file missing or masked"
fi

# Test 12: Service has ExecStartPre dependency check
if [ -f "$SERVICE_FILE" ] && [ ! -L "$SERVICE_FILE" ]; then
    if grep -q "ExecStartPre" "$SERVICE_FILE" 2>/dev/null; then
        pass "Service has ExecStartPre dependency check"
    else
        fail "Missing ExecStartPre (should verify node + deps before starting)"
    fi
else
    fail "Service file missing or masked"
fi

# Test 13: Service has MemoryMax to prevent unbounded growth
if [ -f "$SERVICE_FILE" ] && [ ! -L "$SERVICE_FILE" ]; then
    if grep -q "MemoryMax" "$SERVICE_FILE" 2>/dev/null; then
        pass "Service has MemoryMax set"
    else
        fail "Missing MemoryMax (daemon watchdog checks at 200MB but systemd should enforce too)"
    fi
else
    fail "Service file missing or masked"
fi

# ════════════════════════════════════════════════════════════════
# SECTION 3: Runtime behavior
# ════════════════════════════════════════════════════════════════
section "Runtime Behavior"

# Test 14: Service is running (or can start)
SVC_ACTIVE=$(systemctl --user is-active claude-auto-resume.service 2>/dev/null || true)
if [ "$SVC_ACTIVE" = "active" ]; then
    pass "claude-auto-resume.service is running"
else
    fail "claude-auto-resume.service is not running (state: $SVC_ACTIVE)"
fi

# Test 15: Daemon process is running (PID file or systemd MainPID)
# The systemd-wrapper.js loads daemon via require(), so daemon.pid may be stale
# if it was written by a previous non-wrapper run. Accept systemd MainPID as valid.
DAEMON_PID_OK=false
if [ -f "$DAEMON_DIR/daemon.pid" ]; then
    DAEMON_PID=$(cat "$DAEMON_DIR/daemon.pid" 2>/dev/null || echo "0")
    if ps -p "$DAEMON_PID" &>/dev/null; then
        DAEMON_PID_OK=true
        pass "Daemon PID $DAEMON_PID is a live process"
    fi
fi
if [ "$DAEMON_PID_OK" = false ]; then
    MAIN_PID=$(systemctl --user show -p MainPID claude-auto-resume.service 2>/dev/null | cut -d= -f2 || echo "0")
    if [ "$MAIN_PID" != "0" ] && ps -p "$MAIN_PID" &>/dev/null; then
        pass "Systemd MainPID $MAIN_PID is alive (daemon.pid stale or missing)"
    else
        fail "No live daemon process found (daemon.pid stale, systemd MainPID=$MAIN_PID)"
    fi
fi

# Test 16: Heartbeat is fresh (< 120s old)
if [ -f "$DAEMON_DIR/heartbeat.json" ]; then
    HB_MTIME=$(stat -c %Y "$DAEMON_DIR/heartbeat.json" 2>/dev/null || echo "0")
    NOW=$(date +%s)
    HB_AGE=$((NOW - HB_MTIME))
    if [ "$HB_AGE" -lt 120 ]; then
        pass "Heartbeat is fresh (${HB_AGE}s old, < 120s)"
    else
        fail "Heartbeat is stale (${HB_AGE}s old, should be < 120s)"
    fi
else
    fail "No heartbeat.json file"
fi

# Test 17: Log file is not excessively large (< 5MB)
if [ -f "$DAEMON_DIR/daemon.log" ]; then
    LOG_SIZE=$(stat -c %s "$DAEMON_DIR/daemon.log" 2>/dev/null || echo "0")
    LOG_SIZE_MB=$((LOG_SIZE / 1024 / 1024))
    if [ "$LOG_SIZE_MB" -lt 5 ]; then
        pass "Log file is ${LOG_SIZE_MB}MB (< 5MB)"
    else
        fail "Log file is ${LOG_SIZE_MB}MB (too large, log rotation may be broken)"
    fi
else
    pass "No log file yet (daemon just started)"
fi

# Test 18: No crash-loop indicators in recent journal
# Check for failure exits (the real crash-loop signal), not just any start/stop events
# Normal deployments/debugging can cause several restarts without being a crash loop
SVC_FAILURES=$(journalctl --user -u claude-auto-resume.service --since "10 min ago" --no-pager 2>/dev/null | grep -c "status=1/FAILURE\|code=dumped\|code=killed" 2>/dev/null || true)
SVC_RESTARTS=$(journalctl --user -u claude-auto-resume.service --since "10 min ago" --no-pager 2>/dev/null | grep -c "Started\|Stopped\|Main process exited" 2>/dev/null || true)
if [ "$SVC_FAILURES" -le 2 ] && [ "$SVC_RESTARTS" -le 8 ]; then
    pass "No crash-loop in last 10 min ($SVC_FAILURES failures, $SVC_RESTARTS events)"
else
    fail "Possible crash-loop: $SVC_FAILURES failures, $SVC_RESTARTS events in last 10 min"
fi

# ════════════════════════════════════════════════════════════════
# SECTION 4: Daemon self-protection
# ════════════════════════════════════════════════════════════════
section "Daemon Self-Protection"

# Test 19: Daemon has self-watchdog (memory check)
if grep -q "startSelfWatchdog\|selfWatchdog\|watchdog" "$DAEMON_SCRIPT" 2>/dev/null; then
    pass "Daemon has self-watchdog mechanism"
else
    fail "Daemon missing self-watchdog"
fi

# Test 20: Daemon has log rotation
if grep -q "rotateLog\|log.*rotation\|maxLogSize" "$DAEMON_SCRIPT" 2>/dev/null; then
    pass "Daemon has log rotation"
else
    fail "Daemon missing log rotation (log can grow unbounded)"
fi

# Test 21: Daemon has graceful shutdown handler
if grep -q "SIGTERM\|SIGINT\|gracefulShutdown\|setupSignalHandlers" "$DAEMON_SCRIPT" 2>/dev/null; then
    pass "Daemon handles SIGTERM/SIGINT gracefully"
else
    fail "Daemon missing signal handlers"
fi

# Test 22: Daemon has uncaught exception handler
if grep -q "uncaughtException\|unhandledRejection" "$DAEMON_SCRIPT" 2>/dev/null; then
    pass "Daemon has uncaught exception handler"
else
    fail "Daemon missing uncaught exception handler (crashes will be unhandled)"
fi

# Test 23: Status file is valid JSON
if [ -f "$DAEMON_DIR/status.json" ]; then
    if node -e "JSON.parse(require('fs').readFileSync('$DAEMON_DIR/status.json', 'utf8'))" 2>/dev/null; then
        pass "status.json is valid JSON"
    else
        fail "status.json is corrupt (not valid JSON)"
    fi
else
    pass "No status.json yet (no rate limit detected)"
fi

# Test 24: Config file is valid JSON
if [ -f "$DAEMON_DIR/config.json" ]; then
    if node -e "JSON.parse(require('fs').readFileSync('$DAEMON_DIR/config.json', 'utf8'))" 2>/dev/null; then
        pass "config.json is valid JSON"
    else
        fail "config.json is corrupt"
    fi
else
    fail "config.json missing"
fi

# ════════════════════════════════════════════════════════════════
# RESULTS
# ════════════════════════════════════════════════════════════════
echo ""
echo "════════════════════════════════════════"
echo "Results: $PASS passed, $FAIL failed, $TOTAL total"
echo "════════════════════════════════════════"

if [ "$FAIL" -eq 0 ]; then
    echo "ALL TESTS PASSED"
    exit 0
else
    echo "SOME TESTS FAILED"
    exit 1
fi
