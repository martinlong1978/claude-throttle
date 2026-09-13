const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { run, formatMessage } = require('../hooks/throttle-hook');
const { writeCache } = require('../hooks/lib/cache');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'throttle-hook-'));
}

test('run returns delay 0 when disabled via toggle file', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'disabled'), '');
  const result = run('PreToolUse', { dataDir: dir, env: {}, now: 1000 });
  assert.equal(result.delay, 0);
});

test('run returns delay 0 when THROTTLE_DISABLE=1', () => {
  const dir = tmpDir();
  const result = run('PreToolUse', { dataDir: dir, env: { THROTTLE_DISABLE: '1' }, now: 1000 });
  assert.equal(result.delay, 0);
});

test('run returns delay 0 when no cache is present', () => {
  const dir = tmpDir();
  const result = run('PreToolUse', { dataDir: dir, env: {}, now: 1000 });
  assert.equal(result.delay, 0);
});

test('run computes a positive delay when usage is ahead of pace', () => {
  const dir = tmpDir();
  const now = 1000;
  writeCache(dir, { usedPercentage: 50, resetsAt: now + 14400, now });
  const result = run('PreToolUse', { dataDir: dir, env: {}, now: now + 5 });
  assert.ok(result.delay > 0);
});

test('run returns and logs paceDiffSeconds/paceDiff alongside the delay', () => {
  const dir = tmpDir();
  const now = 1000;
  writeCache(dir, { usedPercentage: 50, resetsAt: now + 14400, now });
  const result = run('PreToolUse', { dataDir: dir, env: {}, now: now + 5 });
  assert.equal(typeof result.paceDiffSeconds, 'number');
  assert.ok(result.paceDiffSeconds > 0);
  assert.match(result.paceDiff, /^\+\d{2}:\d{2}:\d{2}$/);

  const logLines = fs.readFileSync(path.join(dir, 'throttle.log'), 'utf8').trim().split('\n');
  const lastEntry = JSON.parse(logLines[logLines.length - 1]);
  assert.equal(lastEntry.paceDiffSeconds, result.paceDiffSeconds);
  assert.equal(lastEntry.paceDiff, result.paceDiff);
});

test('run fails open on a corrupt cache file', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'rate-limit-cache.json'), '{ not valid json');
  const result = run('PreToolUse', { dataDir: dir, env: {}, now: 1000 });
  assert.equal(result.delay, 0);
});

test('formatMessage mentions the delay, usage percentage, and pace diff', () => {
  const msg = formatMessage(
    'PreToolUse',
    { delay: 12, usedPercentage: 61, resetsAt: 1000 + 2580, targetPct: 95, paceDiff: '+00:00:12' },
    1000
  );
  assert.match(msg, /12s/);
  assert.match(msg, /61%/);
  assert.match(msg, /\+00:00:12/);
});

test('CLI sleeps for the computed delay and prints a systemMessage', () => {
  const dir = tmpDir();
  const now = Date.now() / 1000;
  writeCache(dir, { usedPercentage: 95, resetsAt: now + 100, now });
  const start = Date.now();
  const output = execFileSync(
    'node',
    [path.join(__dirname, '..', 'hooks', 'throttle-hook.js'), 'PreToolUse'],
    {
      env: { ...process.env, CLAUDE_PLUGIN_DATA: dir, THROTTLE_MAX_DELAY_S: '0.3' },
      encoding: 'utf8',
    }
  );
  const elapsedMs = Date.now() - start;
  assert.ok(elapsedMs >= 250, `expected sleep, elapsed=${elapsedMs}ms`);
  const parsed = JSON.parse(output);
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.match(parsed.hookSpecificOutput.systemMessage, /Throttle:/);
});
