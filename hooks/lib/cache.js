const fs = require('fs');
const path = require('path');

function cachePath(dataDir) {
  return path.join(dataDir, 'rate-limit-cache.json');
}

function writeCache(dataDir, { usedPercentage, resetsAt, now }) {
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
