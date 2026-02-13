# Tiered Resume Delivery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the auto-resume daemon so it reliably resumes Claude Code even when the screen is locked, with active verification of success and a rate limit queue.

**Architecture:** Three-tiered delivery (tmux > PTY write > xdotool) with auto-detection, active transcript-based verification replacing passive re-detection check, and a queue-based status file replacing single-slot overwrites.

**Tech Stack:** Node.js, tmux CLI, Linux `/proc` filesystem, xdotool (existing), Jest for testing.

**Security Note:** All new process execution uses `execFile` (array arguments) instead of `exec` (shell string) to prevent command injection. Only the existing xdotool shell script fallback uses `exec` since it generates a temp shell script (pre-existing pattern).

---

### Task 1: Verify existing tests and --monitor flag

The `--monitor` CLI flag may already be fixed. Run existing tests to establish baseline.

**Files:**
- Test: `tests/cli.test.js` (existing)

**Step 1: Install dependencies**

Run: `cd ~/.claude/auto-resume && npm install`
Expected: Success, node_modules populated

**Step 2: Run existing tests**

Run: `cd ~/.claude/auto-resume && npx jest --verbose`
Expected: Note which tests pass/fail. The `--monitor` and `monitor` tests should pass (the CLI switch already has these cases). Record results.

**Step 3: Commit baseline (if tests pass)**

```bash
cd ~/.claude/auto-resume
git add -A
git commit -m "chore: verify baseline - existing tests passing"
```

---

### Task 2: tmux detection module

Create a module that detects whether a given PID is running inside a tmux session and returns the session name.

**Files:**
- Create: `src/delivery/tmux-delivery.js`
- Create: `tests/delivery/tmux-delivery.test.js`

**Step 1: Write the failing tests**

Create `tests/delivery/tmux-delivery.test.js`:

```javascript
const { detectTmuxSession, sendViaTmux } = require('../../src/delivery/tmux-delivery');
const { execSync } = require('child_process');

describe('tmux-delivery', () => {
  describe('detectTmuxSession', () => {
    test('returns null when PID is not in any tmux session', async () => {
      // Use our own PID (not in tmux during tests)
      const result = await detectTmuxSession(process.pid);
      expect(result).toBeNull();
    });

    test('returns null for non-existent PID', async () => {
      const result = await detectTmuxSession(999999999);
      expect(result).toBeNull();
    });

    test('returns null when tmux is not installed', async () => {
      // Save PATH and set to empty to simulate missing tmux
      const origPath = process.env.PATH;
      process.env.PATH = '';
      const result = await detectTmuxSession(process.pid);
      process.env.PATH = origPath;
      expect(result).toBeNull();
    });
  });

  describe('sendViaTmux', () => {
    test('rejects when session does not exist', async () => {
      await expect(sendViaTmux('nonexistent-session-12345', 'continue'))
        .rejects.toThrow();
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd ~/.claude/auto-resume && npx jest tests/delivery/tmux-delivery.test.js --verbose`
Expected: FAIL with "Cannot find module '../../src/delivery/tmux-delivery'"

**Step 3: Create directory structure**

Run: `mkdir -p ~/.claude/auto-resume/src/delivery`

**Step 4: Write minimal implementation**

Create `src/delivery/tmux-delivery.js`:

```javascript
const { execFile } = require('child_process');

/**
 * Detect if a PID is running inside a tmux session.
 * Walks the process tree and checks tmux pane PIDs.
 * @param {number} pid - The process ID to check
 * @returns {Promise<string|null>} tmux session name or null
 */
async function detectTmuxSession(pid) {
  return new Promise((resolve) => {
    // First check if tmux is available
    execFile('which', ['tmux'], (err, tmuxPath) => {
      if (err || !tmuxPath.trim()) {
        return resolve(null);
      }

      // List all tmux panes with their PIDs and session names
      execFile('tmux', ['list-panes', '-a', '-F', '#{pane_pid} #{session_name}'], (err, stdout) => {
        if (err || !stdout.trim()) {
          return resolve(null);
        }

        // Build a map of pane_pid -> session_name
        const paneMap = new Map();
        for (const line of stdout.trim().split('\n')) {
          const [panePid, sessionName] = line.trim().split(' ', 2);
          if (panePid && sessionName) {
            paneMap.set(parseInt(panePid, 10), sessionName);
          }
        }

        // Walk the process tree from the given PID upward
        walkProcessTree(pid, paneMap).then(resolve);
      });
    });
  });
}

/**
 * Walk the process tree upward looking for a PID in the paneMap.
 */
async function walkProcessTree(pid, paneMap) {
  let currentPid = pid;
  const visited = new Set();

  while (currentPid && currentPid > 1 && !visited.has(currentPid)) {
    visited.add(currentPid);

    if (paneMap.has(currentPid)) {
      return paneMap.get(currentPid);
    }

    // Get parent PID
    currentPid = await getParentPid(currentPid);
  }

  return null;
}

/**
 * Get the parent PID of a process.
 */
function getParentPid(pid) {
  return new Promise((resolve) => {
    execFile('ps', ['-o', 'ppid=', '-p', String(pid)], (err, stdout) => {
      if (err || !stdout.trim()) {
        return resolve(null);
      }
      const ppid = parseInt(stdout.trim(), 10);
      resolve(isNaN(ppid) ? null : ppid);
    });
  });
}

/**
 * Send keystrokes to a tmux session.
 * @param {string} sessionName - tmux session name
 * @param {string} text - Text to send (e.g., "continue")
 * @returns {Promise<void>}
 */
async function sendViaTmux(sessionName, text) {
  return new Promise((resolve, reject) => {
    // Send Escape first
    execFile('tmux', ['send-keys', '-t', sessionName, 'Escape'], (err) => {
      if (err) {
        return reject(new Error(`tmux send-keys Escape failed: ${err.message}`));
      }
      // Send Ctrl+U to clear line
      execFile('tmux', ['send-keys', '-t', sessionName, 'C-u'], (err) => {
        if (err) {
          return reject(new Error(`tmux send-keys C-u failed: ${err.message}`));
        }
        // Send text + Enter
        execFile('tmux', ['send-keys', '-t', sessionName, text, 'Enter'], (err) => {
          if (err) {
            return reject(new Error(`tmux send-keys text failed: ${err.message}`));
          }
          resolve();
        });
      });
    });
  });
}

module.exports = { detectTmuxSession, sendViaTmux, walkProcessTree, getParentPid };
```

**Step 5: Run tests to verify they pass**

Run: `cd ~/.claude/auto-resume && npx jest tests/delivery/tmux-delivery.test.js --verbose`
Expected: All 4 tests PASS

**Step 6: Commit**

```bash
cd ~/.claude/auto-resume
git add src/delivery/tmux-delivery.js tests/delivery/tmux-delivery.test.js
git commit -m "feat: add tmux session detection and delivery module (TDD)"
```

---

### Task 3: PTY write delivery module

Create a module that writes directly to a process's PTY, bypassing X11 entirely.

**Files:**
- Create: `src/delivery/pty-delivery.js`
- Create: `tests/delivery/pty-delivery.test.js`

**Step 1: Write the failing tests**

Create `tests/delivery/pty-delivery.test.js`:

```javascript
const { resolvePty, sendViaPty } = require('../../src/delivery/pty-delivery');
const fs = require('fs');

describe('pty-delivery', () => {
  describe('resolvePty', () => {
    test('resolves PTY path for own process', async () => {
      const ptyPath = await resolvePty(process.pid);
      // Our process should have a PTY (running in terminal via jest)
      // It might be null in CI, so just check it does not throw
      if (ptyPath) {
        expect(ptyPath).toMatch(/\/dev\/pts\/\d+|\/dev\/tty\w*/);
      }
    });

    test('returns null for non-existent PID', async () => {
      const result = await resolvePty(999999999);
      expect(result).toBeNull();
    });

    test('returns null for PID without terminal (e.g., daemon)', async () => {
      // PID 1 (init/systemd) typically has no PTY
      const result = await resolvePty(1);
      expect(result).toBeNull();
    });
  });

  describe('sendViaPty', () => {
    test('rejects for non-existent PTY path', async () => {
      await expect(sendViaPty('/dev/pts/99999', 'continue'))
        .rejects.toThrow();
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd ~/.claude/auto-resume && npx jest tests/delivery/pty-delivery.test.js --verbose`
Expected: FAIL with "Cannot find module '../../src/delivery/pty-delivery'"

**Step 3: Write minimal implementation**

Create `src/delivery/pty-delivery.js`:

```javascript
const fs = require('fs');

/**
 * Resolve the PTY device path for a given PID.
 * Reads /proc/<pid>/fd/0 symlink to find the terminal device.
 * @param {number} pid - Process ID
 * @returns {Promise<string|null>} PTY path like /dev/pts/3, or null
 */
async function resolvePty(pid) {
  try {
    const fdPath = `/proc/${pid}/fd/0`;
    const target = fs.readlinkSync(fdPath);

    // Verify it is a PTY device
    if (target.startsWith('/dev/pts/') || target.startsWith('/dev/tty')) {
      return target;
    }

    return null;
  } catch (err) {
    // Permission denied, no such process, or fd/0 does not exist
    return null;
  }
}

/**
 * Send text to a PTY device by writing directly to it.
 * This bypasses X11 entirely and works when the screen is locked.
 * @param {string} ptyPath - Path to PTY device (e.g., /dev/pts/3)
 * @param {string} text - Text to send (e.g., "continue")
 * @returns {Promise<void>}
 */
async function sendViaPty(ptyPath, text) {
  return new Promise((resolve, reject) => {
    try {
      // Open the PTY for writing
      const fd = fs.openSync(ptyPath, 'w');

      // Send Escape (0x1B) to dismiss any menu
      fs.writeSync(fd, Buffer.from([0x1B]));

      // Send Ctrl+U (0x15) to clear line
      fs.writeSync(fd, Buffer.from([0x15]));

      // Send the text followed by Enter (0x0A)
      fs.writeSync(fd, text + '\n');

      fs.closeSync(fd);
      resolve();
    } catch (err) {
      reject(new Error(`PTY write failed for ${ptyPath}: ${err.message}`));
    }
  });
}

module.exports = { resolvePty, sendViaPty };
```

**Step 4: Run tests to verify they pass**

Run: `cd ~/.claude/auto-resume && npx jest tests/delivery/pty-delivery.test.js --verbose`
Expected: All 4 tests PASS

**Step 5: Commit**

```bash
cd ~/.claude/auto-resume
git add src/delivery/pty-delivery.js tests/delivery/pty-delivery.test.js
git commit -m "feat: add PTY write delivery module for locked-screen resume (TDD)"
```

---

### Task 4: Tiered delivery orchestrator

Create a module that tries delivery tiers in order: tmux > PTY > xdotool.

**Files:**
- Create: `src/delivery/tiered-delivery.js`
- Create: `tests/delivery/tiered-delivery.test.js`

**Step 1: Write the failing tests**

Create `tests/delivery/tiered-delivery.test.js`:

```javascript
const { deliverResume, TIER } = require('../../src/delivery/tiered-delivery');

describe('tiered-delivery', () => {
  test('exports TIER constants', () => {
    expect(TIER.TMUX).toBe('tmux');
    expect(TIER.PTY).toBe('pty');
    expect(TIER.XDOTOOL).toBe('xdotool');
  });

  test('returns result object with tier and success fields', async () => {
    // With a non-existent PID, all tiers should fail
    const result = await deliverResume({
      claudePid: 999999999,
      resumeText: 'continue',
    });
    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('tier');
    expect(result).toHaveProperty('error');
  });

  test('falls through all tiers for invalid PID', async () => {
    const result = await deliverResume({
      claudePid: 999999999,
      resumeText: 'continue',
    });
    expect(result.success).toBe(false);
    expect(result.tiersAttempted).toEqual(
      expect.arrayContaining([TIER.TMUX, TIER.PTY])
    );
  });

  test('accepts optional log function', async () => {
    const logs = [];
    const logFn = (level, msg) => logs.push({ level, msg });

    await deliverResume({
      claudePid: 999999999,
      resumeText: 'continue',
      log: logFn,
    });

    expect(logs.length).toBeGreaterThan(0);
    expect(logs.some(l => l.msg.includes('tmux'))).toBe(true);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd ~/.claude/auto-resume && npx jest tests/delivery/tiered-delivery.test.js --verbose`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

Create `src/delivery/tiered-delivery.js`:

```javascript
const { detectTmuxSession, sendViaTmux } = require('./tmux-delivery');
const { resolvePty, sendViaPty } = require('./pty-delivery');

const TIER = {
  TMUX: 'tmux',
  PTY: 'pty',
  XDOTOOL: 'xdotool',
};

/**
 * Deliver resume keystrokes using the best available method.
 * Tries tiers in order: tmux > PTY write > xdotool.
 *
 * @param {Object} opts
 * @param {number} opts.claudePid - Claude Code process PID
 * @param {string} opts.resumeText - Text to send (default: "continue")
 * @param {Function} [opts.log] - Logging function(level, message)
 * @param {Function} [opts.xdotoolFallback] - Existing xdotool function for Tier 3
 * @returns {Promise<{success: boolean, tier: string|null, error: string|null, tiersAttempted: string[]}>}
 */
async function deliverResume(opts) {
  const { claudePid, resumeText = 'continue', log = () => {}, xdotoolFallback = null } = opts;
  const tiersAttempted = [];
  let lastError = null;

  // Tier 1: tmux
  try {
    log('debug', `Tier 1 (tmux): checking PID ${claudePid}...`);
    tiersAttempted.push(TIER.TMUX);
    const sessionName = await detectTmuxSession(claudePid);
    if (sessionName) {
      log('info', `Tier 1 (tmux): found session "${sessionName}", sending keys...`);
      await sendViaTmux(sessionName, resumeText);
      log('success', `Tier 1 (tmux): sent "${resumeText}" to session "${sessionName}"`);
      return { success: true, tier: TIER.TMUX, error: null, tiersAttempted };
    } else {
      log('debug', 'Tier 1 (tmux): PID not in any tmux session, skipping');
    }
  } catch (err) {
    lastError = err.message;
    log('warning', `Tier 1 (tmux) failed: ${err.message}`);
  }

  // Tier 2: PTY write
  try {
    log('debug', `Tier 2 (PTY): resolving PTY for PID ${claudePid}...`);
    tiersAttempted.push(TIER.PTY);
    const ptyPath = await resolvePty(claudePid);
    if (ptyPath) {
      log('info', `Tier 2 (PTY): found ${ptyPath}, writing directly...`);
      await sendViaPty(ptyPath, resumeText);
      log('success', `Tier 2 (PTY): sent "${resumeText}" to ${ptyPath}`);
      return { success: true, tier: TIER.PTY, error: null, tiersAttempted };
    } else {
      log('debug', 'Tier 2 (PTY): could not resolve PTY path, skipping');
    }
  } catch (err) {
    lastError = err.message;
    log('warning', `Tier 2 (PTY) failed: ${err.message}`);
  }

  // Tier 3: xdotool (existing implementation)
  if (xdotoolFallback) {
    try {
      log('debug', 'Tier 3 (xdotool): falling back to xdotool...');
      tiersAttempted.push(TIER.XDOTOOL);
      await xdotoolFallback();
      log('success', 'Tier 3 (xdotool): keystrokes sent');
      return { success: true, tier: TIER.XDOTOOL, error: null, tiersAttempted };
    } catch (err) {
      lastError = err.message;
      log('warning', `Tier 3 (xdotool) failed: ${err.message}`);
    }
  } else {
    tiersAttempted.push(TIER.XDOTOOL);
    log('debug', 'Tier 3 (xdotool): no fallback function provided, skipping');
  }

  return {
    success: false,
    tier: null,
    error: lastError || 'All delivery tiers failed',
    tiersAttempted,
  };
}

module.exports = { deliverResume, TIER };
```

**Step 4: Run tests to verify they pass**

Run: `cd ~/.claude/auto-resume && npx jest tests/delivery/tiered-delivery.test.js --verbose`
Expected: All 4 tests PASS

**Step 5: Commit**

```bash
cd ~/.claude/auto-resume
git add src/delivery/tiered-delivery.js tests/delivery/tiered-delivery.test.js
git commit -m "feat: add tiered delivery orchestrator (tmux > PTY > xdotool) (TDD)"
```

---

### Task 5: Active transcript verification module

Create a module that verifies Claude Code actually resumed by checking for new transcript activity.

**Files:**
- Create: `src/verification/transcript-verifier.js`
- Create: `tests/verification/transcript-verifier.test.js`

**Step 1: Write the failing tests**

Create `tests/verification/transcript-verifier.test.js`:

```javascript
const path = require('path');
const fs = require('fs');
const os = require('os');
const { verifyResumeByTranscript } = require('../../src/verification/transcript-verifier');

describe('transcript-verifier', () => {
  const tmpDir = path.join(os.tmpdir(), 'auto-resume-test-' + process.pid);
  const testTranscript = path.join(tmpDir, 'test-transcript.jsonl');

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    // Write initial transcript content
    fs.writeFileSync(testTranscript, '{"type":"assistant","message":"hello"}\n');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns true when transcript has new content after baseline', async () => {
    const baselineMtime = fs.statSync(testTranscript).mtimeMs;
    const baselineSize = fs.statSync(testTranscript).size;

    // Simulate Claude writing new content after a short delay
    setTimeout(() => {
      fs.appendFileSync(testTranscript, '{"type":"assistant","message":"resumed"}\n');
    }, 100);

    const result = await verifyResumeByTranscript({
      transcriptPath: testTranscript,
      baselineMtime,
      baselineSize,
      timeoutMs: 2000,
      pollIntervalMs: 50,
    });
    expect(result.verified).toBe(true);
  });

  test('returns false when transcript has no new content within timeout', async () => {
    const baselineMtime = fs.statSync(testTranscript).mtimeMs;
    const baselineSize = fs.statSync(testTranscript).size;

    const result = await verifyResumeByTranscript({
      transcriptPath: testTranscript,
      baselineMtime,
      baselineSize,
      timeoutMs: 300,
      pollIntervalMs: 50,
    });
    expect(result.verified).toBe(false);
  });

  test('returns false for non-existent transcript path', async () => {
    const result = await verifyResumeByTranscript({
      transcriptPath: '/tmp/nonexistent-transcript.jsonl',
      baselineMtime: 0,
      baselineSize: 0,
      timeoutMs: 300,
      pollIntervalMs: 50,
    });
    expect(result.verified).toBe(false);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd ~/.claude/auto-resume && npx jest tests/verification/transcript-verifier.test.js --verbose`
Expected: FAIL with "Cannot find module"

**Step 3: Create directory and write implementation**

Run: `mkdir -p ~/.claude/auto-resume/src/verification`

Create `src/verification/transcript-verifier.js`:

```javascript
const fs = require('fs');

/**
 * Verify that Claude Code actually resumed by checking for new transcript activity.
 *
 * @param {Object} opts
 * @param {string} opts.transcriptPath - Path to the Claude transcript JSONL file
 * @param {number} opts.baselineMtime - mtime (ms) of transcript before resume was sent
 * @param {number} opts.baselineSize - size (bytes) of transcript before resume was sent
 * @param {number} [opts.timeoutMs=15000] - How long to wait for new activity
 * @param {number} [opts.pollIntervalMs=1000] - How often to check
 * @returns {Promise<{verified: boolean, newBytes: number, elapsedMs: number}>}
 */
async function verifyResumeByTranscript(opts) {
  const {
    transcriptPath,
    baselineMtime,
    baselineSize,
    timeoutMs = 15000,
    pollIntervalMs = 1000,
  } = opts;

  const startTime = Date.now();

  return new Promise((resolve) => {
    const check = () => {
      const elapsed = Date.now() - startTime;

      if (elapsed >= timeoutMs) {
        return resolve({ verified: false, newBytes: 0, elapsedMs: elapsed });
      }

      try {
        const stats = fs.statSync(transcriptPath);

        // Check if file has grown (new content written) or mtime changed
        if (stats.size > baselineSize || stats.mtimeMs > baselineMtime) {
          return resolve({
            verified: true,
            newBytes: stats.size - baselineSize,
            elapsedMs: elapsed,
          });
        }
      } catch (err) {
        // File does not exist or is inaccessible
        if (Date.now() - startTime >= timeoutMs) {
          return resolve({ verified: false, newBytes: 0, elapsedMs: elapsed });
        }
      }

      setTimeout(check, pollIntervalMs);
    };

    check();
  });
}

module.exports = { verifyResumeByTranscript };
```

**Step 4: Run tests to verify they pass**

Run: `cd ~/.claude/auto-resume && npx jest tests/verification/transcript-verifier.test.js --verbose`
Expected: All 3 tests PASS

**Step 5: Commit**

```bash
cd ~/.claude/auto-resume
git add src/verification/transcript-verifier.js tests/verification/transcript-verifier.test.js
git commit -m "feat: add active transcript verification for resume confirmation (TDD)"
```

---

### Task 6: Rate limit queue module

Replace single-slot status.json with a queue that tracks multiple rate limit events.

**Files:**
- Create: `src/queue/rate-limit-queue.js`
- Create: `tests/queue/rate-limit-queue.test.js`

**Step 1: Write the failing tests**

Create `tests/queue/rate-limit-queue.test.js`:

```javascript
const path = require('path');
const fs = require('fs');
const os = require('os');
const { RateLimitQueue } = require('../../src/queue/rate-limit-queue');

describe('RateLimitQueue', () => {
  const tmpDir = path.join(os.tmpdir(), 'auto-resume-queue-test-' + process.pid);
  const statusFile = path.join(tmpDir, 'status.json');
  let queue;

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    queue = new RateLimitQueue(statusFile);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('adds a new detection to the queue', () => {
    queue.addDetection({
      reset_time: '2026-02-13T14:00:00.000Z',
      timezone: 'Asia/Dhaka',
      message: 'resets 8pm (Asia/Dhaka)',
      claude_pid: 12345,
    });

    const data = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    expect(data.queue).toHaveLength(1);
    expect(data.queue[0].reset_time).toBe('2026-02-13T14:00:00.000Z');
    expect(data.queue[0].status).toBe('pending');
  });

  test('deduplicates by reset_time', () => {
    queue.addDetection({
      reset_time: '2026-02-13T14:00:00.000Z',
      timezone: 'Asia/Dhaka',
      message: 'resets 8pm (Asia/Dhaka)',
      claude_pid: 12345,
    });
    queue.addDetection({
      reset_time: '2026-02-13T14:00:00.000Z',
      timezone: 'Asia/Dhaka',
      message: 'resets 8pm (Asia/Dhaka)',
      claude_pid: 12345,
    });

    const data = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    expect(data.queue).toHaveLength(1);
  });

  test('appends different reset times', () => {
    queue.addDetection({
      reset_time: '2026-02-12T14:00:00.000Z',
      message: 'resets 8pm',
      claude_pid: 12345,
    });
    queue.addDetection({
      reset_time: '2026-02-13T09:00:00.000Z',
      message: 'resets 3pm',
      claude_pid: 12345,
    });

    const data = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    expect(data.queue).toHaveLength(2);
  });

  test('getNextPending returns earliest pending entry', () => {
    queue.addDetection({
      reset_time: '2026-02-13T09:00:00.000Z',
      message: 'later',
      claude_pid: 12345,
    });
    queue.addDetection({
      reset_time: '2026-02-12T14:00:00.000Z',
      message: 'earlier',
      claude_pid: 12345,
    });

    const next = queue.getNextPending();
    expect(next.message).toBe('earlier');
  });

  test('getNextPending returns null when queue is empty', () => {
    expect(queue.getNextPending()).toBeNull();
  });

  test('updateStatus changes entry status', () => {
    queue.addDetection({
      reset_time: '2026-02-13T14:00:00.000Z',
      message: 'test',
      claude_pid: 12345,
    });

    const entry = queue.getNextPending();
    queue.updateEntryStatus(entry.id, 'completed');

    const next = queue.getNextPending();
    expect(next).toBeNull();

    const data = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    expect(data.queue[0].status).toBe('completed');
  });

  test('maintains backward compatibility with old format', () => {
    // Write old-format status.json
    fs.writeFileSync(statusFile, JSON.stringify({
      detected: true,
      reset_time: '2026-02-13T14:00:00.000Z',
      timezone: 'Asia/Dhaka',
      message: 'resets 8pm',
      last_detected: '2026-02-13T12:00:00.000Z',
      claude_pid: 12345,
    }));

    // Reading should migrate to queue format
    const next = queue.getNextPending();
    expect(next).not.toBeNull();
    expect(next.reset_time).toBe('2026-02-13T14:00:00.000Z');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd ~/.claude/auto-resume && npx jest tests/queue/rate-limit-queue.test.js --verbose`
Expected: FAIL with "Cannot find module"

**Step 3: Create directory and write implementation**

Run: `mkdir -p ~/.claude/auto-resume/src/queue`

Create `src/queue/rate-limit-queue.js`:

```javascript
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Manages a queue of rate limit detections in status.json.
 * Replaces the single-slot overwrite behavior.
 */
class RateLimitQueue {
  constructor(statusFilePath) {
    this.statusFile = statusFilePath;
  }

  /**
   * Read and parse the status file. Migrates old format to queue format.
   */
  _read() {
    if (!fs.existsSync(this.statusFile)) {
      return { queue: [], last_hook_run: null };
    }

    try {
      const raw = fs.readFileSync(this.statusFile, 'utf8');
      const data = JSON.parse(raw);

      // Migrate old single-slot format to queue format
      if (!Array.isArray(data.queue)) {
        const migrated = { queue: [], last_hook_run: data.last_hook_run || null };

        if (data.detected && data.reset_time) {
          migrated.queue.push({
            id: crypto.randomUUID(),
            reset_time: data.reset_time,
            timezone: data.timezone || null,
            message: data.message || '',
            detected_at: data.last_detected || new Date().toISOString(),
            claude_pid: data.claude_pid || null,
            status: 'pending',
          });
        }

        return migrated;
      }

      return data;
    } catch (err) {
      return { queue: [], last_hook_run: null };
    }
  }

  /**
   * Write the status data atomically.
   */
  _write(data) {
    const dir = path.dirname(this.statusFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.statusFile, JSON.stringify(data, null, 2), 'utf8');
  }

  /**
   * Add a new rate limit detection to the queue.
   * Deduplicates by reset_time.
   */
  addDetection(detection) {
    const data = this._read();

    // Deduplicate by reset_time
    const exists = data.queue.some(
      (entry) => entry.reset_time === detection.reset_time
    );
    if (exists) {
      return;
    }

    data.queue.push({
      id: crypto.randomUUID(),
      reset_time: detection.reset_time,
      timezone: detection.timezone || null,
      message: detection.message || '',
      detected_at: new Date().toISOString(),
      claude_pid: detection.claude_pid || null,
      status: 'pending',
    });

    data.last_hook_run = new Date().toISOString();
    this._write(data);
  }

  /**
   * Get the next pending entry (earliest reset_time first).
   * Returns null if no pending entries.
   */
  getNextPending() {
    const data = this._read();

    const pending = data.queue
      .filter((entry) => entry.status === 'pending' || entry.status === 'waiting')
      .sort((a, b) => new Date(a.reset_time) - new Date(b.reset_time));

    return pending.length > 0 ? pending[0] : null;
  }

  /**
   * Update the status of a queue entry.
   */
  updateEntryStatus(id, status) {
    const data = this._read();
    const entry = data.queue.find((e) => e.id === id);
    if (entry) {
      entry.status = status;
      if (status === 'completed') {
        entry.completed_at = new Date().toISOString();
      }
      this._write(data);
    }
  }
}

module.exports = { RateLimitQueue };
```

**Step 4: Run tests to verify they pass**

Run: `cd ~/.claude/auto-resume && npx jest tests/queue/rate-limit-queue.test.js --verbose`
Expected: All 7 tests PASS

**Step 5: Commit**

```bash
cd ~/.claude/auto-resume
git add src/queue/rate-limit-queue.js tests/queue/rate-limit-queue.test.js
git commit -m "feat: add rate limit queue to replace single-slot overwrites (TDD)"
```

---

### Task 7: Integrate tiered delivery into the daemon

Wire the new modules into `auto-resume-daemon.js`, replacing the Linux branch of `sendContinueToTerminals()` and updating `attemptResume()` with active verification.

**Files:**
- Modify: `auto-resume-daemon.js` (lines ~384-670 for sendContinueToTerminals, lines ~795-866 for attemptResume)
- Create: `tests/integration/daemon-integration.test.js`

**Step 1: Write the integration test**

Create `tests/integration/daemon-integration.test.js`:

```javascript
describe('daemon module integration', () => {
  test('delivery modules are importable from daemon context', () => {
    const { deliverResume, TIER } = require('../../src/delivery/tiered-delivery');
    const { verifyResumeByTranscript } = require('../../src/verification/transcript-verifier');
    const { RateLimitQueue } = require('../../src/queue/rate-limit-queue');

    expect(typeof deliverResume).toBe('function');
    expect(typeof verifyResumeByTranscript).toBe('function');
    expect(typeof RateLimitQueue).toBe('function');
    expect(TIER.TMUX).toBe('tmux');
  });
});
```

**Step 2: Run to verify it passes (modules exist)**

Run: `cd ~/.claude/auto-resume && npx jest tests/integration/daemon-integration.test.js --verbose`
Expected: PASS

**Step 3: Modify `auto-resume-daemon.js`**

Add new requires at the top of the file (after existing require statements around line 23):

```javascript
const { deliverResume } = require('./src/delivery/tiered-delivery');
const { verifyResumeByTranscript } = require('./src/verification/transcript-verifier');
const { RateLimitQueue } = require('./src/queue/rate-limit-queue');
```

Add to state management section (around line 87):

```javascript
let currentQueueEntryId = null;
```

Add notification helper function (before `sendContinueToTerminals`):

```javascript
function sendNotification(title, message) {
  if (NotificationManager) {
    try {
      const notifier = new NotificationManager();
      notifier.init({ enabled: true, sound: true });
      notifier.notify(title, message).catch(() => {});
    } catch (e) {
      // Best effort
    }
  }
}
```

Extract the existing Linux xdotool code from `sendContinueToTerminals()` into a new function `sendContinueViaXdotool(claudePid)` that returns a Promise (same code, just wrapped in a function).

Replace the Linux `else` branch in `sendContinueToTerminals()` with:

```javascript
    } else {
      // Linux: Use tiered delivery (tmux > PTY > xdotool)
      let claudePid = null;
      try {
        if (fs.existsSync(STATUS_FILE)) {
          const statusData = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
          claudePid = statusData.claude_pid;
          if (!claudePid && statusData.queue && statusData.queue.length > 0) {
            const pending = statusData.queue.find(e =>
              e.status === 'pending' || e.status === 'waiting' || e.status === 'resuming'
            );
            if (pending) claudePid = pending.claude_pid;
          }
        }
      } catch (e) {
        log('debug', 'Could not read claude_pid from status file');
      }

      if (!claudePid) {
        log('error', 'No Claude PID available for delivery');
        reject(new Error('No Claude PID'));
        return;
      }

      const xdotoolFallback = () => sendContinueViaXdotool(claudePid);

      deliverResume({
        claudePid,
        resumeText: getConfigValue('resumePrompt', 'continue'),
        log,
        xdotoolFallback,
      }).then((result) => {
        if (result.success) {
          log('success', `Delivered via ${result.tier} (tiers tried: ${result.tiersAttempted.join(', ')})`);
          resolve();
        } else {
          log('error', `All delivery tiers failed: ${result.error}`);
          reject(new Error(result.error));
        }
      }).catch(reject);
    }
```

In `attemptResume()`, after the successful keystroke send, add active verification before the passive verification block. Insert this code after `const sentAt = Date.now();`:

```javascript
    // Active verification: check for new transcript activity
    let transcriptPath = null;
    try {
      if (fs.existsSync(STATUS_FILE)) {
        const statusData = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
        transcriptPath = statusData.transcript_path;
        if (!transcriptPath && statusData.queue) {
          const active = statusData.queue.find(e => e.transcript_path);
          if (active) transcriptPath = active.transcript_path;
        }
      }
    } catch (e) { /* ignore */ }

    if (transcriptPath && fs.existsSync(transcriptPath)) {
      log('info', 'Verifying resume via transcript activity...');
      const baselineStats = fs.statSync(transcriptPath);
      const verification = await verifyResumeByTranscript({
        transcriptPath,
        baselineMtime: baselineStats.mtimeMs,
        baselineSize: baselineStats.size,
        timeoutMs: getConfigValue('resume.activeVerificationTimeoutMs', 15000),
        pollIntervalMs: getConfigValue('resume.activeVerificationPollMs', 1000),
      });

      if (verification.verified) {
        log('success', `Auto-resume CONFIRMED! Transcript activity detected (+${verification.newBytes} bytes in ${verification.elapsedMs}ms)`);
        sendNotification('Claude Code Resumed', 'Auto-resume successful after rate limit reset.');
        clearStatus();
        currentResetTime = null;
        return;
      } else {
        log('warning', 'No transcript activity detected - delivery may have failed');
        continue; // Try next attempt
      }
    }
    // If no transcript path, fall through to existing passive verification below
```

In `watchStatusFile()`, update the status reading to use the queue:

```javascript
      const queue = new RateLimitQueue(STATUS_FILE);
      const nextEntry = queue.getNextPending();

      if (nextEntry) {
        const resetTime = new Date(nextEntry.reset_time);
        if (isNaN(resetTime.getTime())) {
          log('error', `Invalid reset_time in queue: ${nextEntry.reset_time}`);
          return;
        }
        if (!currentResetTime || currentResetTime.getTime() !== resetTime.getTime()) {
          log('warning', '');
          log('warning', 'Rate limit detected!');
          log('info', `Reset time: ${resetTime.toLocaleString()}`);
          log('info', `Message: ${nextEntry.message || 'N/A'}`);
          currentQueueEntryId = nextEntry.id;
          startCountdown(resetTime);
        }
      } else if (!nextEntry && currentResetTime) {
        log('info', 'No pending rate limits in queue');
        stopCountdown();
      }
```

Update `clearStatus()` to mark queue entry as completed:

```javascript
function clearStatus() {
  try {
    if (currentQueueEntryId) {
      const queue = new RateLimitQueue(STATUS_FILE);
      queue.updateEntryStatus(currentQueueEntryId, 'completed');
      currentQueueEntryId = null;
    }
  } catch (err) {
    log('debug', `Error updating queue status: ${err.message}`);
  }
}
```

Update end of `attemptResume()` failure path to send notification:

```javascript
  log('error', `Resume failed after ${maxRetries + 1} attempts`);
  sendNotification('Auto-Resume FAILED', `Failed to resume after ${maxRetries + 1} attempts. Manual intervention needed.`);
```

**Step 4: Run all tests**

Run: `cd ~/.claude/auto-resume && npx jest --verbose`
Expected: All tests PASS

**Step 5: Commit**

```bash
cd ~/.claude/auto-resume
git add auto-resume-daemon.js tests/integration/daemon-integration.test.js
git commit -m "feat: integrate tiered delivery, active verification, and queue into daemon"
```

---

### Task 8: Integrate rate limit queue into the hook

Update `rate-limit-hook.js` to write to the queue instead of overwriting.

**Files:**
- Modify: `~/.claude/hooks/rate-limit-hook.js` (function `updateStatusFile` around line 431)
- Create: `tests/hook/rate-limit-hook-queue.test.js`

**Step 1: Write a test for queue integration**

Create `tests/hook/rate-limit-hook-queue.test.js`:

```javascript
const path = require('path');
const fs = require('fs');
const os = require('os');
const { RateLimitQueue } = require('../../src/queue/rate-limit-queue');

describe('rate-limit-hook queue integration', () => {
  const tmpDir = path.join(os.tmpdir(), 'hook-queue-test-' + process.pid);
  const statusFile = path.join(tmpDir, 'status.json');

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('hook can write to queue via RateLimitQueue', () => {
    const queue = new RateLimitQueue(statusFile);
    queue.addDetection({
      reset_time: '2026-02-13T14:00:00.000Z',
      timezone: 'Asia/Dhaka',
      message: 'resets 8pm (Asia/Dhaka)',
      claude_pid: 12345,
    });

    const data = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    expect(data.queue).toHaveLength(1);
    expect(data.queue[0].status).toBe('pending');
  });

  test('multiple hook invocations create separate queue entries', () => {
    const queue = new RateLimitQueue(statusFile);
    queue.addDetection({
      reset_time: '2026-02-12T14:00:00.000Z',
      message: 'resets 8pm',
      claude_pid: 11111,
    });
    queue.addDetection({
      reset_time: '2026-02-13T09:00:00.000Z',
      message: 'resets 3pm',
      claude_pid: 22222,
    });

    const data = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    expect(data.queue).toHaveLength(2);
  });
});
```

**Step 2: Run test to verify it passes**

Run: `cd ~/.claude/auto-resume && npx jest tests/hook/rate-limit-hook-queue.test.js --verbose`
Expected: PASS

**Step 3: Modify `updateStatusFile()` in `rate-limit-hook.js`**

File: `~/.claude/hooks/rate-limit-hook.js`

At the top, add the queue import (after existing requires):

```javascript
let RateLimitQueue = null;
try {
  RateLimitQueue = require(path.join(os.homedir(), '.claude', 'auto-resume', 'src', 'queue', 'rate-limit-queue')).RateLimitQueue;
} catch (e) {
  // Queue module not available, fall back to direct write
}
```

Replace the body of `updateStatusFile()` (lines ~431-475) with:

```javascript
function updateStatusFile(rateLimitInfo, sessionId) {
  if (!fs.existsSync(STATUS_DIR)) {
    fs.mkdirSync(STATUS_DIR, { recursive: true });
  }

  if (RateLimitQueue) {
    // Queue-based approach (new)
    const queue = new RateLimitQueue(STATUS_FILE);
    queue.addDetection({
      reset_time: rateLimitInfo.reset_time,
      timezone: rateLimitInfo.timezone,
      message: rateLimitInfo.message,
      claude_pid: process.ppid,
      session_id: rateLimitInfo.session_id || sessionId,
    });
    return;
  }

  // Fallback: direct write (old behavior, backward compatible)
  let status = { detected: false, sessions: [] };
  if (fs.existsSync(STATUS_FILE)) {
    try {
      status = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
    } catch (err) { /* use default */ }
  }
  if (!Array.isArray(status.sessions)) status.sessions = [];

  status.detected = true;
  status.reset_time = rateLimitInfo.reset_time;
  status.timezone = rateLimitInfo.timezone;
  status.last_detected = new Date().toISOString();
  status.message = rateLimitInfo.message;
  status.claude_pid = process.ppid;

  const trackSessionId = rateLimitInfo.session_id || sessionId;
  if (trackSessionId && !status.sessions.includes(trackSessionId)) {
    status.sessions.push(trackSessionId);
  }

  fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2), 'utf8');
}
```

**Step 4: Run all tests**

Run: `cd ~/.claude/auto-resume && npx jest --verbose`
Expected: All tests PASS

**Step 5: Commit**

```bash
cd ~/.claude/auto-resume
git add tests/hook/rate-limit-hook-queue.test.js
cd ~/.claude/hooks
git add rate-limit-hook.js 2>/dev/null || true
cd ~/.claude/auto-resume
git add -A
git commit -m "feat: integrate rate limit queue into hook updateStatusFile"
```

---

### Task 9: Update config.json with new settings

**Files:**
- Modify: `config.json`

**Step 1: Add new configuration keys**

Update `config.json` to add the new settings under `resume` and `notifications`:

```json
{
  "resume": {
    "postResetDelaySec": 10,
    "maxRetries": 4,
    "verificationWindowSec": 90,
    "activeVerificationTimeoutMs": 15000,
    "activeVerificationPollMs": 1000
  },
  "notifications": {
    "enabled": true,
    "sound": false,
    "onSuccess": true,
    "onFailure": true
  }
}
```

**Step 2: Commit**

```bash
cd ~/.claude/auto-resume
git add config.json
git commit -m "chore: add active verification and notification config settings"
```

---

### Task 10: Add optional tmux shell function setup

**Files:**
- Create: `scripts/setup-tmux-alias.sh`

**Step 1: Create the setup script**

Create `scripts/setup-tmux-alias.sh`:

```bash
#!/bin/bash
# Setup script to add optional tmux wrapper for Claude Code.
# This makes the auto-resume daemon 100% reliable even when the screen is locked.
#
# Usage: bash scripts/setup-tmux-alias.sh

set -e

SHELL_RC=""
if [ -f "$HOME/.zshrc" ]; then
  SHELL_RC="$HOME/.zshrc"
elif [ -f "$HOME/.bashrc" ]; then
  SHELL_RC="$HOME/.bashrc"
else
  echo "Could not find .zshrc or .bashrc"
  exit 1
fi

MARKER="# claude-tmux-auto-resume"

if grep -q "$MARKER" "$SHELL_RC" 2>/dev/null; then
  echo "tmux wrapper already installed in $SHELL_RC"
  exit 0
fi

echo ""
echo "This will add a shell function to $SHELL_RC that launches Claude Code inside tmux."
echo "This makes auto-resume 100% reliable even when the screen is locked."
echo ""
echo "The function:"
echo '  claude() { tmux new-session -A -s claude-auto -- command claude "$@"; }'
echo ""
read -p "Install? (y/N) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
  cat >> "$SHELL_RC" << 'EOFRC'

# claude-tmux-auto-resume
# Launches Claude Code inside tmux for reliable auto-resume when screen is locked
claude() { tmux new-session -A -s claude-auto -- command claude "$@"; }
EOFRC
  echo "Installed! Restart your shell or run: source $SHELL_RC"
else
  echo "Skipped. You can run this script again any time."
fi
```

**Step 2: Make executable and commit**

```bash
mkdir -p ~/.claude/auto-resume/scripts
chmod +x ~/.claude/auto-resume/scripts/setup-tmux-alias.sh
cd ~/.claude/auto-resume
git add scripts/setup-tmux-alias.sh
git commit -m "feat: add optional tmux alias setup script for locked-screen reliability"
```

---

### Task 11: Final integration test and daemon restart

**Step 1: Run full test suite**

Run: `cd ~/.claude/auto-resume && npx jest --verbose --coverage`
Expected: All tests PASS

**Step 2: Restart the daemon**

Run: `systemctl --user restart claude-auto-resume.service`

**Step 3: Verify daemon health**

Run: `systemctl --user status claude-auto-resume.service`
Expected: Active (running), no errors

**Step 4: Check logs**

Run: `tail -20 ~/.claude/auto-resume/daemon.log`
Expected: Clean startup, "Watching status file for changes..."

**Step 5: Final commit**

```bash
cd ~/.claude/auto-resume
git add -A
git commit -m "chore: all tests passing, daemon restarted with tiered delivery"
```

---

## Task Dependency Graph

```
Task 1 (baseline)
  |
  +---> Task 2 (tmux module) ---+
  +---> Task 3 (PTY module) ----+--> Task 4 (orchestrator) --+
  +---> Task 5 (verifier) ------+                            |
  +---> Task 6 (queue) ---------+--> Task 8 (hook) ----------+--> Task 7 (daemon integration)
                                                              |
                                                              +--> Task 9 (config)
                                                              +--> Task 10 (tmux alias)
                                                              |
                                                              +--> Task 11 (final integration)
```

Tasks 2, 3, 5, 6 can run in **parallel**. Task 4 depends on 2+3. Task 8 depends on 6. Task 7 depends on 4+5+8. Tasks 9-10 are independent. Task 11 is final.
