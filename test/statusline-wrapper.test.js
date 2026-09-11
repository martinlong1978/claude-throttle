const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { extractRateLimit, loadOriginalCommand } = require('../hooks/statusline-wrapper');
const { readCache } = require('../hooks/lib/cache');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'throttle-statusline-'));
}

test('extractRateLimit reads five_hour fields', () => {
  const result = extractRateLimit({ rate_limits: { five_hour: { used_percentage: 12.5, resets_at: 5000 } } });
  assert.deepEqual(result, { usedPercentage: 12.5, resetsAt: 5000 });
});

test('extractRateLimit returns null when rate_limits is absent', () => {
  assert.equal(extractRateLimit({}), null);
  assert.equal(extractRateLimit(null), null);
});

test('loadOriginalCommand reads config.json', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ originalStatusLineCommand: 'echo hi' }));
  assert.equal(loadOriginalCommand(dir), 'echo hi');
});

test('loadOriginalCommand returns null when config.json is missing', () => {
  assert.equal(loadOriginalCommand(tmpDir()), null);
});

test('CLI caches usage and chains to the original command, passing stdin through', () => {
  const dir = tmpDir();
  const echoScript = path.join(dir, 'echo-status.js');
  fs.writeFileSync(echoScript, "process.stdout.write('MY STATUS LINE\\n');");
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ originalStatusLineCommand: `node ${echoScript}` }));
  const stdin = JSON.stringify({ rate_limits: { five_hour: { used_percentage: 33, resets_at: 9999999999 } } });

  const output = execFileSync('node', [path.join(__dirname, '..', 'hooks', 'statusline-wrapper.js')], {
    env: { ...process.env, CLAUDE_PLUGIN_DATA: dir },
    input: stdin,
    encoding: 'utf8',
  });

  assert.equal(output.trim(), 'MY STATUS LINE');
  const cache = readCache(dir, { now: Date.now() / 1000 });
  assert.equal(cache.usedPercentage, 33);
});

test('CLI prints a setup hint when no original command is configured yet', () => {
  const dir = tmpDir();
  const output = execFileSync('node', [path.join(__dirname, '..', 'hooks', 'statusline-wrapper.js')], {
    env: { ...process.env, CLAUDE_PLUGIN_DATA: dir },
    input: '{}',
    encoding: 'utf8',
  });
  assert.match(output, /\/throttle-setup/);
});
