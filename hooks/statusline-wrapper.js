const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { writeCache } = require('./lib/cache');

function extractRateLimit(payload) {
  const fh = payload && payload.rate_limits && payload.rate_limits.five_hour;
  if (!fh || typeof fh.used_percentage !== 'number' || typeof fh.resets_at !== 'number') return null;
  return { usedPercentage: fh.used_percentage, resetsAt: fh.resets_at };
}

function loadOriginalCommand(dataDir) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8'));
    return cfg.originalStatusLineCommand || null;
  } catch (_) {
    return null;
  }
}

function main() {
  const dataDir = process.env.CLAUDE_PLUGIN_DATA;
  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch (_) {
    raw = '';
  }
  let payload = null;
  try {
    payload = JSON.parse(raw);
  } catch (_) {
    payload = null;
  }

  const rl = extractRateLimit(payload);
  if (rl) {
    try {
      writeCache(dataDir, { usedPercentage: rl.usedPercentage, resetsAt: rl.resetsAt, now: Date.now() / 1000 });
    } catch (_) {
      // caching must never block the status line from rendering
    }
  }

  const originalCommand = loadOriginalCommand(dataDir);
  if (!originalCommand) {
    process.stdout.write('throttle: run /throttle-setup to finish wiring your status line\n');
    return;
  }

  const result = spawnSync(originalCommand, { shell: true, input: raw, encoding: 'utf8' });
  process.stdout.write(result.stdout || '');
}

if (require.main === module) main();

module.exports = { extractRateLimit, loadOriginalCommand };
