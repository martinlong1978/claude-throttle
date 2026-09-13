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

test('writeCache rejects a lower usedPercentage for the same resetsAt, even written out of wall-clock order', () => {
  const dir = tmpDir();
  writeCache(dir, { usedPercentage: 43, resetsAt: 5000, now: 2000 });
  writeCache(dir, { usedPercentage: 35, resetsAt: 5000, now: 1000 });
  const result = readCache(dir, { now: 2000 });
  assert.equal(result.usedPercentage, 43);
});

test('writeCache rejects a lower usedPercentage for the same resetsAt even when its own "now" is later (a lagging concurrent session reporting stale usage)', () => {
  const dir = tmpDir();
  writeCache(dir, { usedPercentage: 65, resetsAt: 5000, now: 1000 });
  // A second, out-of-sync Claude Code process/session writes its own
  // (stale, lower) view of usage later in wall-clock time. Wall-clock
  // recency alone can't be trusted as a freshness signal here — usage
  // only goes up within a window, so a lower value is stale regardless
  // of when it was written.
  writeCache(dir, { usedPercentage: 50, resetsAt: 5000, now: 1010 });
  const result = readCache(dir, { now: 1010 });
  assert.equal(result.usedPercentage, 65);
});

test('writeCache accepts a higher or equal usedPercentage for the same resetsAt', () => {
  const dir = tmpDir();
  writeCache(dir, { usedPercentage: 35, resetsAt: 5000, now: 1000 });
  writeCache(dir, { usedPercentage: 43, resetsAt: 5000, now: 2000 });
  const result = readCache(dir, { now: 2000 });
  assert.equal(result.usedPercentage, 43);
});

test('writeCache accepts a lower usedPercentage when resetsAt has rolled over to a newer window', () => {
  const dir = tmpDir();
  writeCache(dir, { usedPercentage: 90, resetsAt: 5000, now: 1000 });
  writeCache(dir, { usedPercentage: 5, resetsAt: 9000, now: 2000 });
  const result = readCache(dir, { now: 2000 });
  assert.deepEqual(result, { usedPercentage: 5, resetsAt: 9000, capturedAt: 2000 });
});

test('writeCache rejects a write for an older resetsAt than what is already stored (late-arriving previous-window write)', () => {
  const dir = tmpDir();
  writeCache(dir, { usedPercentage: 5, resetsAt: 9000, now: 2000 });
  writeCache(dir, { usedPercentage: 90, resetsAt: 5000, now: 2001 });
  const result = readCache(dir, { now: 2001 });
  assert.deepEqual(result, { usedPercentage: 5, resetsAt: 9000, capturedAt: 2000 });
});
