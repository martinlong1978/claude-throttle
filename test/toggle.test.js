const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { isDisabled, setDisabled, setEnabled } = require('../hooks/lib/toggle');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'throttle-toggle-'));
}

test('starts enabled (not disabled) by default', () => {
  const dir = tmpDir();
  assert.equal(isDisabled(dir), false);
});

test('setDisabled then isDisabled is true', () => {
  const dir = tmpDir();
  setDisabled(dir);
  assert.equal(isDisabled(dir), true);
});

test('setEnabled clears disabled state', () => {
  const dir = tmpDir();
  setDisabled(dir);
  setEnabled(dir);
  assert.equal(isDisabled(dir), false);
});

test('setEnabled is safe to call when already enabled', () => {
  const dir = tmpDir();
  assert.doesNotThrow(() => setEnabled(dir));
});

test('CLI works with only CLAUDE_PLUGIN_ROOT set, as when a command runs it without the hook runner', () => {
  const home = tmpDir();
  const pluginRoot = path.join(home, '.claude', 'plugins', 'cache', 'throttle-marketplace', 'throttle', '1.0.0');

  const output = execFileSync('node', [path.join(__dirname, '..', 'hooks', 'lib', 'toggle.js'), 'off'], {
    env: { ...process.env, CLAUDE_PLUGIN_DATA: '', CLAUDE_PLUGIN_ROOT: pluginRoot, HOME: home, USERPROFILE: home },
    encoding: 'utf8',
  });

  assert.match(output, /disabled/);
  const dataDir = path.join(home, '.claude', 'plugins', 'data', 'throttle-throttle-marketplace');
  assert.ok(fs.existsSync(path.join(dataDir, 'disabled')));
});
