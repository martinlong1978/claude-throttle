const path = require('path');
const { computeDelay } = require('./lib/calc');
const { readCache } = require('./lib/cache');
const { appendLog } = require('./lib/log');
const { isDisabled } = require('./lib/toggle');
const { resolveDataDir } = require('./lib/paths');

function run(eventName, { dataDir, env = process.env, now = Date.now() / 1000 } = {}) {
  try {
    if (env.THROTTLE_DISABLE === '1' || isDisabled(dataDir)) {
      appendLog(dataDir, { ts: now, event: eventName, delay: 0, reason: 'disabled' });
      return { delay: 0 };
    }

    const cache = readCache(dataDir, { now });
    if (!cache) {
      appendLog(dataDir, { ts: now, event: eventName, delay: 0, reason: 'no-data' });
      return { delay: 0 };
    }

    const targetPct = Number(env.THROTTLE_TARGET_PCT) || 95;
    const maxDelayS = Number(env.THROTTLE_MAX_DELAY_S) || 30;
    const delay = computeDelay({
      usedPercentage: cache.usedPercentage,
      resetsAt: cache.resetsAt,
      now,
      targetPct,
      maxDelayS,
    });

    appendLog(dataDir, {
      ts: now,
      event: eventName,
      delay,
      usedPercentage: cache.usedPercentage,
      resetsAt: cache.resetsAt,
    });

    return { delay, usedPercentage: cache.usedPercentage, resetsAt: cache.resetsAt, targetPct };
  } catch (err) {
    try {
      appendLog(dataDir, {
        ts: now,
        event: eventName,
        delay: 0,
        reason: 'error',
        message: String((err && err.message) || err),
      });
    } catch (_) {
      // logging must never throw past this point
    }
    return { delay: 0 };
  }
}

function formatMessage(eventName, result, now) {
  const minsLeft = Math.round((result.resetsAt - now) / 60);
  return `Throttle: delayed ${Math.round(result.delay)}s (used ${result.usedPercentage}% of 5h window, ${minsLeft}min actual time left, target ${result.targetPct}%) — pacing to stay under budget by reset.`;
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function main() {
  const eventName = process.argv[2];
  const fallbackRoot = path.join(__dirname, '..');
  const dataDir = resolveDataDir(process.env, fallbackRoot);
  const now = Date.now() / 1000;
  const result = run(eventName, { dataDir, now });

  if (result.delay > 0) {
    sleepSync(result.delay * 1000);
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: eventName,
          systemMessage: formatMessage(eventName, result, now),
        },
      })
    );
  }
}

if (require.main === module) main();

module.exports = { run, formatMessage };
