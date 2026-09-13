const fs = require('fs');
const path = require('path');

function cachePath(dataDir) {
  return path.join(dataDir, 'rate-limit-cache.json');
}

// Concurrent statusline-wrapper.js invocations (event-driven trigger and
// refreshInterval timer can overlap) race to write this file. Completion
// order isn't the same as start order — a later-started invocation (with
// fresher data) can finish writing before an earlier-started one that's
// still waiting on the wrapped original statusLine command. Guard against
// that by refusing to overwrite a newer "now" with an older one.
function writeCache(dataDir, { usedPercentage, resetsAt, now }) {
  const existing = readCache(dataDir, { maxAgeS: Infinity, now });
  if (existing && existing.capturedAt > now) return;
  fs.mkdirSync(dataDir, { recursive: true });
  const data = { used_percentage: usedPercentage, resets_at: resetsAt, captured_at: now };
  fs.writeFileSync(cachePath(dataDir), JSON.stringify(data));
}

function readCache(dataDir, { maxAgeS = 900, now = Date.now() / 1000 } = {}) {
  let raw;
  try {
    raw = fs.readFileSync(cachePath(dataDir), 'utf8');
  } catch (_) {
    return null;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (_) {
    return null;
  }
  if (
    typeof data.used_percentage !== 'number' ||
    typeof data.resets_at !== 'number' ||
    typeof data.captured_at !== 'number'
  ) {
    return null;
  }
  if (now - data.captured_at > maxAgeS) return null;
  return { usedPercentage: data.used_percentage, resetsAt: data.resets_at, capturedAt: data.captured_at };
}

module.exports = { readCache, writeCache, cachePath };
