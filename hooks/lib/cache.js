const fs = require('fs');
const path = require('path');

function cachePath(dataDir) {
  return path.join(dataDir, 'rate-limit-cache.json');
}

// Concurrent statusline-wrapper.js invocations (event-driven trigger,
// refreshInterval timer, and separate Claude Code sessions/subagents all
// sharing this plugin's data dir) race to write this file. Wall-clock
// write order can't be trusted as a freshness signal: a lagging session
// can write its own stale (lower) usage reading later than a fresher one.
// The real invariant is that used_percentage only increases within a
// fixed resets_at window, so guard on content, not time: never let a
// lower usedPercentage for the same resetsAt, or a write for an older
// resetsAt, overwrite what's already stored.
function writeCache(dataDir, { usedPercentage, resetsAt, now }) {
  const existing = readCache(dataDir, { maxAgeS: Infinity, now });
  if (existing) {
    if (resetsAt < existing.resetsAt) return;
    if (resetsAt === existing.resetsAt && usedPercentage < existing.usedPercentage) return;
  }
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
