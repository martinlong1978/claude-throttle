const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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
