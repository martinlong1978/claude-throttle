const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readCache, writeCache } = require('../hooks/lib/cache');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'throttle-cache-'));
}

test('writeCache then readCache round-trips fresh data', () => {
  const dir = tmpDir();
  const now = 1000;
  writeCache(dir, { usedPercentage: 42, resetsAt: 5000, now });
  const result = readCache(dir, { now: now + 10 });
  assert.deepEqual(result, { usedPercentage: 42, resetsAt: 5000, capturedAt: now });
});

test('readCache returns null when file is missing', () => {
  const dir = tmpDir();
  assert.equal(readCache(dir, { now: 1000 }), null);
});

test('readCache returns null when stale beyond maxAgeS', () => {
  const dir = tmpDir();
  const now = 1000;
  writeCache(dir, { usedPercentage: 10, resetsAt: 5000, now });
  const result = readCache(dir, { now: now + 901, maxAgeS: 900 });
  assert.equal(result, null);
});

test('readCache returns null on corrupt JSON', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'rate-limit-cache.json'), 'not json');
  assert.equal(readCache(dir, { now: 1000 }), null);
});

test('writeCache ignores a write whose "now" is older than the already-stored captured_at (out-of-order concurrent invocation)', () => {
  const dir = tmpDir();
  // Newer invocation (started later) finishes writing first.
  writeCache(dir, { usedPercentage: 43, resetsAt: 5000, now: 2000 });
  // Older invocation (started earlier, e.g. a slower refreshInterval-triggered
  // process) finishes writing second and must not clobber the newer value.
  writeCache(dir, { usedPercentage: 35, resetsAt: 5000, now: 1000 });
  const result = readCache(dir, { now: 2000 });
  assert.equal(result.usedPercentage, 43);
});

test('writeCache still accepts a write whose "now" is newer than the stored captured_at', () => {
  const dir = tmpDir();
  writeCache(dir, { usedPercentage: 35, resetsAt: 5000, now: 1000 });
  writeCache(dir, { usedPercentage: 43, resetsAt: 5000, now: 2000 });
  const result = readCache(dir, { now: 2000 });
  assert.equal(result.usedPercentage, 43);
});
