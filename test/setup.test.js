const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readOriginalStatusLine, writeConfig, buildInstructions } = require('../hooks/lib/setup');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'throttle-setup-'));
}

test('readOriginalStatusLine reads statusLine.command from settings.json', () => {
  const dir = tmpDir();
  const settingsPath = path.join(dir, 'settings.json');
  fs.writeFileSync(
    settingsPath,
    JSON.stringify({ statusLine: { type: 'command', command: 'bash ~/.claude/statusline-command.sh' } })
  );
  assert.equal(readOriginalStatusLine(settingsPath), 'bash ~/.claude/statusline-command.sh');
});

test('readOriginalStatusLine returns null when the file is missing', () => {
  assert.equal(readOriginalStatusLine(path.join(tmpDir(), 'missing.json')), null);
});

test('readOriginalStatusLine returns null when no statusLine is set', () => {
  const dir = tmpDir();
  const settingsPath = path.join(dir, 'settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify({}));
  assert.equal(readOriginalStatusLine(settingsPath), null);
});

test('writeConfig writes originalStatusLineCommand to config.json', () => {
  const dir = tmpDir();
  writeConfig(dir, { originalStatusLineCommand: 'echo hi' });
  const config = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
  assert.deepEqual(config, { originalStatusLineCommand: 'echo hi' });
});

test('buildInstructions includes the wrapper path and the original command', () => {
  const text = buildInstructions({ pluginRoot: '/plugins/throttle', originalCommand: 'bash foo.sh' });
  assert.match(text, /bash foo\.sh/);
  assert.match(text, /\/plugins\/throttle\/hooks\/statusline-wrapper\.js/);
});
