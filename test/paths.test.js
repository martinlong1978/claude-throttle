const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { resolveDataDir } = require('../hooks/lib/paths');

test('resolveDataDir prefers CLAUDE_PLUGIN_DATA when set', () => {
  const dir = resolveDataDir({ CLAUDE_PLUGIN_DATA: '/explicit/data/dir', CLAUDE_PLUGIN_ROOT: 'ignored' });
  assert.equal(dir, '/explicit/data/dir');
});

test('resolveDataDir derives from CLAUDE_PLUGIN_ROOT when CLAUDE_PLUGIN_DATA is unset', () => {
  const dir = resolveDataDir({
    CLAUDE_PLUGIN_ROOT: 'C:/Users/marti/.claude/plugins/cache/throttle-marketplace/throttle/1.0.0',
    USERPROFILE: 'C:/Users/marti',
  });
  assert.equal(dir, path.join('C:/Users/marti', '.claude', 'plugins', 'data', 'throttle-throttle-marketplace'));
});

test('resolveDataDir uses HOME when USERPROFILE is absent', () => {
  const dir = resolveDataDir({
    CLAUDE_PLUGIN_ROOT: '/home/marti/.claude/plugins/cache/throttle-marketplace/throttle/1.0.0',
    HOME: '/home/marti',
  });
  assert.equal(dir, path.join('/home/marti', '.claude', 'plugins', 'data', 'throttle-throttle-marketplace'));
});

test('resolveDataDir returns null when neither env var nor a usable root is available', () => {
  assert.equal(resolveDataDir({}), null);
});

test('resolveDataDir returns null when CLAUDE_PLUGIN_ROOT has an unexpected shape', () => {
  assert.equal(resolveDataDir({ CLAUDE_PLUGIN_ROOT: '/some/other/path', HOME: '/home/marti' }), null);
});
