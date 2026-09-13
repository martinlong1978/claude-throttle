const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { writeCache } = require('./lib/cache');
const { resolveDataDir } = require('./lib/paths');
const { computePaceDiff } = require('./lib/calc');
const { formatSignedDuration } = require('./lib/format');

function extractRateLimit(payload) {
  const fh = payload && payload.rate_limits && payload.rate_limits.five_hour;
  if (!fh || typeof fh.used_percentage !== 'number' || typeof fh.resets_at !== 'number') return null;
  return { usedPercentage: fh.used_percentage, resetsAt: fh.resets_at };
}

function buildPaceSuffix({ usedPercentage, resetsAt, now, targetPct }) {
  const diff = computePaceDiff({ usedPercentage, resetsAt, now, targetPct });
  return ` · pace ${formatSignedDuration(diff)}`;
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
  // The statusLine command configured in settings.json is a bare
  // top-level setting, not a plugin-scoped hook invocation, so Claude
  // Code never sets CLAUDE_PLUGIN_ROOT/CLAUDE_PLUGIN_DATA for it. Fall
  // back to this file's own location, which is always correct.
  const fallbackRoot = path.join(__dirname, '..');
  const dataDir = resolveDataDir(process.env, fallbackRoot);
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
  let output = result.stdout || '';

  if (rl) {
    const targetPct = Number(process.env.THROTTLE_TARGET_PCT) || 95;
    const suffix = buildPaceSuffix({
      usedPercentage: rl.usedPercentage,
      resetsAt: rl.resetsAt,
      now: Date.now() / 1000,
      targetPct,
    });
    output = output.replace(/\n$/, '') + suffix + '\n';
  }

  process.stdout.write(output);
}

if (require.main === module) main();

module.exports = { extractRateLimit, loadOriginalCommand, buildPaceSuffix };
