const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
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

test('CLI works with only CLAUDE_PLUGIN_ROOT set, as when a command runs it without the hook runner', () => {
  const home = tmpDir();
  const pluginRoot = path.join(home, '.claude', 'plugins', 'cache', 'throttle-marketplace', 'throttle', '1.0.0');

  const output = execFileSync('node', [path.join(__dirname, '..', 'hooks', 'lib', 'setup.js')], {
    env: { ...process.env, CLAUDE_PLUGIN_DATA: '', CLAUDE_PLUGIN_ROOT: pluginRoot, HOME: home, USERPROFILE: home },
    encoding: 'utf8',
  });

  assert.match(output, /Replace it with/);
  const dataDir = path.join(home, '.claude', 'plugins', 'data', 'throttle-throttle-marketplace');
  const config = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8'));
  assert.equal(config.originalStatusLineCommand, null);
});
