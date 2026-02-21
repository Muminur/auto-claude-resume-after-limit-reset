# Universal Claude Process Targeting Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make auto-resume deliver keystrokes to ALL Claude Code processes system-wide (both tmux panes and plain terminal tabs), not just the one whose PID was saved in status.json.

**Architecture:** At delivery time, discover all running `claude` processes via `pgrep`, classify each as tmux-based or PTY-based, and deliver the resume sequence to every one. This replaces the current serial pipeline with a parallel "discover all, deliver to each" approach.

**Tech Stack:** Node.js, child_process.execFile, /proc/<pid>/fd/0 symlinks, tmux send-keys

---

### Task 1: Add discoverAllClaudeProcesses() to tmux-delivery.js

Find all running `claude` processes and classify each as tmux-reachable or PTY-reachable.

**Files:**
- Modify: `src/delivery/tmux-delivery.js`
- Test: `tests/delivery/tmux-delivery.test.js`

**Step 1: Write the failing test**

Add to `tests/delivery/tmux-delivery.test.js`:

```js
const { discoverAllClaudeProcesses } = require('../../src/delivery/tmux-delivery');

describe('discoverAllClaudeProcesses', () => {
  test('returns an array', async () => {
    const results = await discoverAllClaudeProcesses();
    expect(Array.isArray(results)).toBe(true);
  });

  test('each entry has pid, method, and either target or ptyPath', async () => {
    const results = await discoverAllClaudeProcesses();
    for (const entry of results) {
      expect(typeof entry.pid).toBe('number');
      expect(['tmux', 'pty']).toContain(entry.method);
      if (entry.method === 'tmux') {
        expect(typeof entry.target).toBe('string');
        expect(entry.target).toMatch(/^.+:\d+\.\d+$/);
      } else {
        expect(typeof entry.ptyPath).toBe('string');
        expect(entry.ptyPath).toMatch(/^\/dev\/pts\//);
      }
    }
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx jest tests/delivery/tmux-delivery.test.js -t 'discoverAllClaudeProcesses' 2>&1 | tail -20
```

Expected: FAIL with `discoverAllClaudeProcesses is not a function`

**Step 3: Implement discoverAllClaudeProcesses in src/delivery/tmux-delivery.js**

At the top of the file, add the require for pty-delivery:

```js
const { resolvePty } = require('./pty-delivery');
```

Add this function after the existing `findClaudeTargetPanes` function:

```js
/**
 * Discover ALL running claude processes and classify each as tmux or PTY.
 * Used to deliver resume keystrokes to every Claude instance system-wide.
 * Rate limits are account-level so all instances need the resume signal.
 *
 * @returns {Promise<Array<{pid: number, method: 'tmux'|'pty', target?: string, ptyPath?: string}>>}
 */
async function discoverAllClaudeProcesses() {
  // Find all claude PIDs system-wide
  const pids = await new Promise((resolve) => {
    execFile('pgrep', ['-x', 'claude'], (err, stdout) => {
      if (err || !stdout.trim()) return resolve([]);
      resolve(
        stdout.trim().split('\n')
          .map(s => parseInt(s.trim(), 10))
          .filter(n => !isNaN(n))
      );
    });
  });

  if (pids.length === 0) return [];

  // Build tmux pane map once (pid -> full pane target)
  const paneMap = await new Promise((resolve) => {
    execFile('tmux', [
      'list-panes', '-a', '-F',
      '#{pane_pid} #{session_name}:#{window_index}.#{pane_index}'
    ], (err, stdout) => {
      if (err || !stdout || !stdout.trim()) return resolve(new Map());
      const map = new Map();
      for (const line of stdout.trim().split('\n')) {
        const [panePid, target] = line.trim().split(' ', 2);
        if (panePid && target) map.set(parseInt(panePid, 10), target);
      }
      resolve(map);
    });
  });

  const results = [];
  for (const pid of pids) {
    // Try tmux first: walk process tree to find a tmux pane ancestor
    const tmuxTarget = await walkProcessTree(pid, paneMap);
    if (tmuxTarget) {
      results.push({ pid, method: 'tmux', target: tmuxTarget });
      continue;
    }
    // Fall back to PTY
    const ptyPath = await resolvePty(pid);
    if (ptyPath) {
      results.push({ pid, method: 'pty', ptyPath });
    }
  }

  return results;
}
```

Also add `discoverAllClaudeProcesses` to the module.exports line.

**Step 4: Run test to verify it passes**

```bash
npx jest tests/delivery/tmux-delivery.test.js 2>&1 | tail -20
```

Expected: all PASS

**Step 5: Commit**

```bash
git add src/delivery/tmux-delivery.js tests/delivery/tmux-delivery.test.js
git commit -m "feat(delivery): add discoverAllClaudeProcesses for universal targeting"
```

---

### Task 2: Enhance sendViaPty with menu selection sequence

The current `sendViaPty` sends Escape -> Ctrl+U -> text + CR. For parity with tmux delivery, it needs to also try menu selection (key `1`) before the text fallback.

**Files:**
- Modify: `src/delivery/pty-delivery.js`
- Test: `tests/delivery/pty-delivery.test.js`

**Step 1: Write the failing tests**

Add to `tests/delivery/pty-delivery.test.js`:

```js
test('sends menu selection "1" before text fallback', async () => {
  const written = [];
  const origOpen = fs.openSync;
  const origWrite = fs.writeSync;
  const origClose = fs.closeSync;
  fs.openSync = () => 99;
  fs.writeSync = (_fd, data) => { written.push(data); };
  fs.closeSync = () => {};
  try {
    await sendViaPty('/dev/pts/test', 'continue');
  } finally {
    fs.openSync = origOpen;
    fs.writeSync = origWrite;
    fs.closeSync = origClose;
  }
  expect(written.some(w => w === '1')).toBe(true);
});

test('accepts menuSelection option', async () => {
  const written = [];
  const origOpen = fs.openSync;
  const origWrite = fs.writeSync;
  const origClose = fs.closeSync;
  fs.openSync = () => 99;
  fs.writeSync = (_fd, data) => { written.push(data); };
  fs.closeSync = () => {};
  try {
    await sendViaPty('/dev/pts/test', 'continue', { menuSelection: '2' });
  } finally {
    fs.openSync = origOpen;
    fs.writeSync = origWrite;
    fs.closeSync = origClose;
  }
  expect(written.some(w => w === '2')).toBe(true);
});
```

**Step 2: Run tests to verify they fail**

```bash
npx jest tests/delivery/pty-delivery.test.js -t 'menu selection' 2>&1 | tail -20
```

Expected: FAIL

**Step 3: Update sendViaPty in src/delivery/pty-delivery.js**

Replace the entire `sendViaPty` function:

```js
async function sendViaPty(ptyPath, text, opts = {}) {
  return new Promise((resolve, reject) => {
    try {
      const menuSelection = opts.menuSelection || '1';
      const fd = fs.openSync(ptyPath, 'w');

      // Phase 1: Dismiss any open dialog
      fs.writeSync(fd, Buffer.from([0x1B])); // Escape
      fs.writeSync(fd, Buffer.from([0x1B])); // Escape again

      // Phase 2: Try menu option selection (works when rate limit dialog is showing)
      fs.writeSync(fd, menuSelection);

      // Phase 3: Fallback — dismiss again, clear line, type text
      fs.writeSync(fd, Buffer.from([0x1B])); // Escape
      fs.writeSync(fd, Buffer.from([0x1B])); // Escape again
      fs.writeSync(fd, Buffer.from([0x15])); // Ctrl+U (clear line)
      fs.writeSync(fd, text + '\r');          // text + CR (NOT LF)

      fs.closeSync(fd);
      resolve();
    } catch (err) {
      reject(new Error(`PTY write failed for ${ptyPath}: ${err.message}`));
    }
  });
}
```

**Step 4: Run all pty tests**

```bash
npx jest tests/delivery/pty-delivery.test.js 2>&1 | tail -20
```

Expected: all PASS

**Step 5: Commit**

```bash
git add src/delivery/pty-delivery.js tests/delivery/pty-delivery.test.js
git commit -m "feat(delivery): add menu selection sequence to sendViaPty"
```

---

### Task 3: Refactor deliverResume in tiered-delivery.js

Replace the serial pipeline with: discover all Claude processes, deliver to each via best method.

**Files:**
- Modify: `src/delivery/tiered-delivery.js`
- Test: `tests/delivery/tiered-delivery.test.js`

**Step 1: Write the new tests**

Replace `tests/delivery/tiered-delivery.test.js` entirely:

```js
const { deliverResume, TIER } = require('../../src/delivery/tiered-delivery');

describe('tiered-delivery', () => {
  test('exports TIER constants', () => {
    expect(TIER.TMUX).toBe('tmux');
    expect(TIER.PTY).toBe('pty');
    expect(TIER.XDOTOOL).toBe('xdotool');
  });

  test('returns result with success, tiersAttempted, and targets fields', async () => {
    const result = await deliverResume({ resumeText: 'continue' });
    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('tiersAttempted');
    expect(result).toHaveProperty('targets');
    expect(Array.isArray(result.targets)).toBe(true);
  }, 30000);

  test('tiersAttempted always includes tmux (discovery always runs)', async () => {
    const result = await deliverResume({ resumeText: 'continue' });
    expect(result.tiersAttempted).toContain(TIER.TMUX);
  }, 30000);

  test('accepts optional log function', async () => {
    const logs = [];
    await deliverResume({
      resumeText: 'continue',
      log: (level, msg) => logs.push({ level, msg }),
    });
    expect(logs.length).toBeGreaterThan(0);
  }, 30000);

  test('falls back to xdotool when discoverer returns empty', async () => {
    let xdotoolCalled = false;
    const result = await deliverResume({
      resumeText: 'continue',
      _discoverer: async () => [],
      xdotoolFallback: async () => { xdotoolCalled = true; },
    });
    expect(xdotoolCalled).toBe(true);
    expect(result.tiersAttempted).toContain(TIER.XDOTOOL);
  }, 10000);
});
```

**Step 2: Run tests to verify they fail**

```bash
npx jest tests/delivery/tiered-delivery.test.js 2>&1 | tail -30
```

Expected: some FAIL (missing `targets` field, `_discoverer` not supported)

**Step 3: Rewrite src/delivery/tiered-delivery.js**

```js
const { discoverAllClaudeProcesses, sendKeystrokeSequence, buildResumeSequence } = require('./tmux-delivery');
const { sendViaPty } = require('./pty-delivery');

const TIER = {
  TMUX: 'tmux',
  PTY: 'pty',
  XDOTOOL: 'xdotool',
};

/**
 * Deliver resume keystrokes to ALL running Claude Code processes.
 * Discovers processes via pgrep, classifies each as tmux or PTY, delivers to each.
 *
 * @param {Object} opts
 * @param {string} [opts.resumeText='continue'] - Text to send as fallback prompt
 * @param {string} [opts.menuSelection='1'] - Menu option key to press
 * @param {Function} [opts.log] - Logging function(level, message)
 * @param {Function} [opts.xdotoolFallback] - Fallback when no processes found/delivered
 * @param {Function} [opts._discoverer] - Override discovery function (for testing)
 * @returns {Promise<{success: boolean, tiersAttempted: string[], targets: Array, error: string|null}>}
 */
async function deliverResume(opts = {}) {
  const {
    resumeText = 'continue',
    menuSelection = '1',
    log = () => {},
    xdotoolFallback = null,
    _discoverer = discoverAllClaudeProcesses,
  } = opts;

  const tiersAttempted = [TIER.TMUX]; // discovery always attempts tmux classification
  const targets = [];
  let anySuccess = false;
  let lastError = null;

  // Discover all Claude processes
  log('debug', 'Discovering all running claude processes...');
  let processes = [];
  try {
    processes = await _discoverer();
    log('info', `Found ${processes.length} claude process(es): ${
      processes.map(p => `PID ${p.pid} (${p.method})`).join(', ') || 'none'
    }`);
  } catch (err) {
    lastError = err.message;
    log('warning', `Process discovery failed: ${err.message}`);
  }

  // Deliver to each discovered process
  for (const proc of processes) {
    const entry = { pid: proc.pid, method: proc.method, success: false, error: null };

    try {
      if (proc.method === 'tmux') {
        const sequence = buildResumeSequence({ menuSelection, resumePrompt: resumeText });
        await sendKeystrokeSequence(proc.target, sequence);
        entry.success = true;
        log('success', `Delivered to PID ${proc.pid} via tmux pane ${proc.target}`);
      } else if (proc.method === 'pty') {
        if (!tiersAttempted.includes(TIER.PTY)) tiersAttempted.push(TIER.PTY);
        await sendViaPty(proc.ptyPath, resumeText, { menuSelection });
        entry.success = true;
        log('success', `Delivered to PID ${proc.pid} via PTY ${proc.ptyPath}`);
      }
      if (entry.success) anySuccess = true;
    } catch (err) {
      entry.error = err.message;
      lastError = err.message;
      log('warning', `Failed to deliver to PID ${proc.pid}: ${err.message}`);
    }

    targets.push(entry);
  }

  // Fallback to xdotool if nothing was found or delivered
  if (!anySuccess && xdotoolFallback) {
    tiersAttempted.push(TIER.XDOTOOL);
    try {
      log('debug', 'No processes reached, falling back to xdotool...');
      await xdotoolFallback();
      log('success', 'xdotool fallback succeeded');
      anySuccess = true;
    } catch (err) {
      lastError = err.message;
      log('warning', `xdotool fallback failed: ${err.message}`);
    }
  }

  return {
    success: anySuccess,
    tiersAttempted,
    targets,
    error: anySuccess ? null : (lastError || 'No claude processes found and no fallback available'),
  };
}

module.exports = { deliverResume, TIER };
```

**Step 4: Run all delivery tests**

```bash
npx jest tests/delivery/ 2>&1 | tail -30
```

Expected: all PASS

**Step 5: Commit**

```bash
git add src/delivery/tiered-delivery.js tests/delivery/tiered-delivery.test.js
git commit -m "feat(delivery): discover all claude processes for universal resume targeting"
```

---

### Task 4: Simplify daemon — remove claudePid dependency

deliverResume no longer needs claudePid. Remove the lookup block.

**Files:**
- Modify: `auto-resume-daemon.js`

**Step 1: Find and replace the claudePid block**

Find this block (around line 688):

```js
let claudePid = null;
try {
  if (fs.existsSync(STATUS_FILE)) {
    const statusData = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
    claudePid = statusData.claude_pid;
    if (!claudePid && statusData.queue) {
      const active = statusData.queue.find(e => e.claude_pid);
      if (active) claudePid = active.claude_pid;
    }
  }
} catch (e) {
  log('debug', 'Could not read claude_pid from status file');
}

const resumeText = getConfigValue('resumePrompt', 'continue');
const menuSelection = getConfigValue('menuSelection', '1');
deliverResume({
  claudePid,
  resumeText,
  menuSelection,
  log,
  xdotoolFallback: () => sendContinueViaXdotool(claudePid),
})
```

Replace with:

```js
const resumeText = getConfigValue('resumePrompt', 'continue');
const menuSelection = getConfigValue('menuSelection', '1');
deliverResume({
  resumeText,
  menuSelection,
  log,
  xdotoolFallback: () => sendContinueViaXdotool(null),
})
```

**Step 2: Run full test suite**

```bash
npx jest 2>&1 | tail -40
```

Expected: all existing tests pass

**Step 3: Commit**

```bash
git add auto-resume-daemon.js
git commit -m "refactor(daemon): remove claudePid dependency from delivery"
```

---

### Task 5: Smoke test the discovery

**Step 1: Quick manual verification**

```bash
node -e "
const { discoverAllClaudeProcesses } = require('./src/delivery/tmux-delivery');
discoverAllClaudeProcesses().then(ps => {
  console.log('Discovered ' + ps.length + ' process(es):');
  ps.forEach(p => console.log('  PID', p.pid, '-', p.method, p.target || p.ptyPath));
}).catch(console.error);
"
```

Expected: lists current Claude processes with correct method and target/ptyPath

**Step 2: Final full test run**

```bash
npx jest 2>&1 | tail -40
```

Expected: all pass, no regressions
