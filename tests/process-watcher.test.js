/**
 * Tests for the process watcher module.
 * Run: node tests/process-watcher.test.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { scanFileTail, isRealRateLimit, parseResetTime, writeStatus, ProcessWatcher, isUserOriginatedEntry } = require('../src/watcher/process-watcher');

let passed = 0;
let failed = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`  \u2713 ${testName}`);
    passed++;
  } else {
    console.log(`  \u2717 FAIL: ${testName}`);
    failed++;
  }
}

function tmpFile(content) {
  const p = path.join(os.tmpdir(), `pw-test-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  fs.writeFileSync(p, content);
  return p;
}

function cleanup(filePath) {
  try { fs.unlinkSync(filePath); } catch {}
}

// Clean up any status.json before tests
const STATUS_FILE = path.join(os.homedir(), '.claude', 'auto-resume', 'status.json');
try { fs.unlinkSync(STATUS_FILE); } catch {}

console.log('\n=== isRealRateLimit ===');
assert(isRealRateLimit("You're out of extra usage \u00b7 resets 11pm (Asia/Dhaka)") === true, 'detects extra usage message');
assert(isRealRateLimit("You've hit your limit") === true, 'detects hit limit');
assert(isRealRateLimit("Rate limit exceeded") === true, 'detects rate limit exceeded');
assert(isRealRateLimit("try again in 30 minutes") === true, 'detects try again');
assert(isRealRateLimit("too many requests") === true, 'detects too many requests');
assert(isRealRateLimit("Hello world") === false, 'ignores normal text');
assert(isRealRateLimit("fix auto resume plugin") === false, 'ignores false positive about fixing');
assert(isRealRateLimit("RATE_LIMIT_PATTERNS") === false, 'ignores code references');
assert(isRealRateLimit("") === false, 'handles empty string');
assert(isRealRateLimit(null) === false, 'handles null');

console.log('\n=== parseResetTime ===');
const rt1 = parseResetTime("resets 11pm (Asia/Dhaka)");
assert(rt1.timezone === 'Asia/Dhaka', 'extracts timezone from reset message');
assert(rt1.reset_time.includes('T'), 'returns ISO timestamp');

const rt2 = parseResetTime("try again in 30 minutes");
assert(rt2.reset_time.includes('T'), 'parses try-again-in format');

const rt3 = parseResetTime("some message without time");
assert(rt3.reset_time.includes('T'), 'defaults to 1 hour from now');

console.log('\n=== scanFileTail ===');

// Test: detects rate limit in JSONL entry
const f1 = tmpFile('{"type":"user","message":"hello"}\n{"type":"system","message":"You\'re out of extra usage \u00b7 resets 11pm (Asia/Dhaka)"}\n');
const r1 = scanFileTail(f1);
assert(r1 !== null, 'detects rate limit in JSONL');
assert(r1.timezone === 'Asia/Dhaka', 'extracts timezone from JSONL');
cleanup(f1);

// Test: ignores normal JSONL
const f2 = tmpFile('{"type":"user","message":"hello"}\n{"type":"assistant","message":"Hi there!"}\n');
const r2 = scanFileTail(f2);
assert(r2 === null, 'returns null for normal JSONL');
cleanup(f2);

// Test: detects rate limit in nested message content
const f3 = tmpFile('{"type":"system","message":{"role":"system","content":[{"type":"text","text":"You\'re out of extra usage \u00b7 resets 3am (Asia/Dhaka)"}]}}\n');
const r3 = scanFileTail(f3);
assert(r3 !== null, 'detects nested rate limit');
cleanup(f3);

// Test: handles empty file
const f4 = tmpFile('');
const r4 = scanFileTail(f4);
assert(r4 === null, 'handles empty file');
cleanup(f4);

// Test: handles non-existent file
const r5 = scanFileTail('/nonexistent/file.jsonl');
assert(r5 === null, 'handles non-existent file');

// Test: detects rate limit in large file (only reads tail)
let bigContent = '';
for (let i = 0; i < 1000; i++) {
  bigContent += `{"type":"assistant","message":"Response ${i}"}\n`;
}
bigContent += '{"type":"system","message":"You\'re out of extra usage \u00b7 resets 5am (Asia/Dhaka)"}\n';
const f6 = tmpFile(bigContent);
const r6 = scanFileTail(f6);
assert(r6 !== null, 'detects rate limit at end of large file');
cleanup(f6);

// Test: ignores false positive (conversation about rate limits)
const f7 = tmpFile('{"type":"assistant","message":"I will fix the rate limit hook detection issue"}\n');
const r7 = scanFileTail(f7);
assert(r7 === null, 'ignores false positive conversation');
cleanup(f7);

// Test: ignores user-typed prompt that pastes/quotes rate-limit text
const f8 = tmpFile('{"type":"last-prompt","lastPrompt":"auto resume did not work. ⎿  You\'ve hit your limit · resets 10:29am (UTC)","sessionId":"abc"}\n');
const r8 = scanFileTail(f8);
assert(r8 === null, 'ignores user-typed last-prompt that quotes rate-limit text');
cleanup(f8);

// Test: ignores user-role message containing rate-limit text in plain content
const f9 = tmpFile('{"type":"user","message":{"role":"user","content":[{"type":"text","text":"You\'ve hit your limit, can you fix?"}]}}\n');
const r9 = scanFileTail(f9);
assert(r9 === null, 'ignores user message with plain text mentioning rate limit');
cleanup(f9);

// Test: ignores our own hook_system_message attachment
const f10 = tmpFile('{"type":"attachment","attachment":{"type":"hook_system_message","hookName":"Stop","content":"⚠️  Rate limit detected! Auto-resume will retry at 1:59 PM (UTC)"}}\n');
const r10 = scanFileTail(f10);
assert(r10 === null, 'ignores hook_system_message attachment from auto-resume');
cleanup(f10);

// Test: still detects real rate_limit_error inside a user-role tool_result
const f11 = tmpFile('{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"x","content":"{\\"type\\":\\"rate_limit_error\\",\\"message\\":\\"too many requests\\"}"}]}}\n');
const r11 = scanFileTail(f11);
assert(r11 !== null, 'still detects rate_limit_error inside tool_result content');
cleanup(f11);

// Test: scans only newly appended bytes when startOffset is given
const oldContent = '{"type":"system","message":"You\'re out of extra usage · resets 11pm (Asia/Dhaka)"}\n';
const newContent = '{"type":"assistant","message":"hi"}\n';
const f12 = tmpFile(oldContent + newContent);
const r12 = scanFileTail(f12, 16384, oldContent.length);
assert(r12 === null, 'startOffset skips already-seen historical rate-limit text');
const r12b = scanFileTail(f12);
assert(r12b !== null, 'tail-mode (no startOffset) still finds historical rate-limit text');
cleanup(f12);

console.log('\n=== isUserOriginatedEntry ===');
assert(isUserOriginatedEntry({ type: 'last-prompt', lastPrompt: 'x' }) === true, 'last-prompt is user-originated');
assert(isUserOriginatedEntry({ type: 'attachment', attachment: { type: 'hook_system_message', content: 'x' } }) === true, 'hook_system_message is user-originated');
assert(isUserOriginatedEntry({ type: 'user', message: { role: 'user', content: 'hello' } }) === true, 'user with string content is user-originated');
assert(isUserOriginatedEntry({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } }) === true, 'user with text content is user-originated');
assert(isUserOriginatedEntry({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'x' }] } }) === false, 'user with only tool_result is NOT user-originated');
assert(isUserOriginatedEntry({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } }) === false, 'assistant entry is not user-originated');
assert(isUserOriginatedEntry(null) === false, 'null is not user-originated');

console.log('\n=== writeStatus ===');

// Test: writes status.json
const ws1 = writeStatus({ message: 'test', reset_time: '2026-01-01T00:00:00Z', timezone: 'UTC' }, null);
assert(ws1 === true, 'writes status.json successfully');
assert(fs.existsSync(STATUS_FILE), 'status.json exists after write');
const statusContent = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
assert(statusContent.detected === true, 'status.detected is true');
assert(statusContent.detected_by === 'process_watcher', 'detected_by is process_watcher');

// Test: doesn't overwrite active detection
const ws2 = writeStatus({ message: 'test2', reset_time: '2026-01-02T00:00:00Z', timezone: 'UTC' }, null);
assert(ws2 === false, 'does not overwrite active detection');
cleanup(STATUS_FILE);

console.log('\n=== ProcessWatcher class ===');

const watcher = new ProcessWatcher({ debounceMs: 100 });
assert(typeof watcher.start === 'function', 'has start method');
assert(typeof watcher.stop === 'function', 'has stop method');
assert(watcher._running === false, 'not running initially');

// Don't actually start the watcher in tests (would need real project dirs)

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
