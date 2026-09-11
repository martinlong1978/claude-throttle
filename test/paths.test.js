const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { resolveDataDir, resolvePluginRoot } = require('../hooks/lib/paths');

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

test('resolveDataDir falls back to fallbackRoot when no env vars are set at all (statusLine invocation)', () => {
  const dir = resolveDataDir(
    { HOME: '/home/marti' },
    '/home/marti/.claude/plugins/cache/throttle-marketplace/throttle/1.0.1'
  );
  assert.equal(dir, path.join('/home/marti', '.claude', 'plugins', 'data', 'throttle-throttle-marketplace'));
});

test('resolveDataDir prefers env CLAUDE_PLUGIN_ROOT over fallbackRoot when both are present', () => {
  const dir = resolveDataDir(
    { CLAUDE_PLUGIN_ROOT: '/home/marti/.claude/plugins/cache/throttle-marketplace/throttle/1.0.0', HOME: '/home/marti' },
    '/home/marti/.claude/plugins/cache/throttle-marketplace/throttle/9.9.9'
  );
  assert.equal(dir, path.join('/home/marti', '.claude', 'plugins', 'data', 'throttle-throttle-marketplace'));
});

test('resolvePluginRoot prefers CLAUDE_PLUGIN_ROOT when set', () => {
  assert.equal(resolvePluginRoot({ CLAUDE_PLUGIN_ROOT: '/explicit/root' }, '/fallback/root'), '/explicit/root');
});

test('resolvePluginRoot falls back when CLAUDE_PLUGIN_ROOT is unset', () => {
  assert.equal(resolvePluginRoot({}, '/fallback/root'), '/fallback/root');
});
