const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  readOriginalStatusLine,
  writeConfig,
  buildInstructions,
  looksLikeOwnWrapper,
  resolveOriginalCommand,
  readPlan,
} = require('../hooks/lib/setup');

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

test('buildInstructions suggests a default refreshInterval when none exists', () => {
  const text = buildInstructions({ pluginRoot: '/plugins/throttle', originalCommand: 'bash foo.sh' });
  assert.match(text, /"refreshInterval": 10/);
});

test('buildInstructions preserves an existing refreshInterval instead of overriding it', () => {
  const text = buildInstructions({
    pluginRoot: '/plugins/throttle',
    originalCommand: 'bash foo.sh',
    existingStatusLine: { type: 'command', command: 'bash foo.sh', refreshInterval: 5 },
  });
  assert.match(text, /"refreshInterval": 5/);
});

test('buildInstructions preserves other existing statusLine fields', () => {
  const text = buildInstructions({
    pluginRoot: '/plugins/throttle',
    originalCommand: 'bash foo.sh',
    existingStatusLine: { type: 'command', command: 'bash foo.sh', padding: 0 },
  });
  assert.match(text, /"padding": 0/);
});

test('looksLikeOwnWrapper detects throttle\'s own statusline-wrapper.js path', () => {
  assert.equal(looksLikeOwnWrapper('node /plugins/cache/throttle-marketplace/throttle/1.0.0/hooks/statusline-wrapper.js'), true);
});

test('looksLikeOwnWrapper is false for an unrelated command', () => {
  assert.equal(looksLikeOwnWrapper('bash ~/.claude/statusline-command.sh'), false);
  assert.equal(looksLikeOwnWrapper(null), false);
});

test('resolveOriginalCommand treats a non-wrapper command as the fresh original', () => {
  const dir = tmpDir();
  const result = resolveOriginalCommand({ currentCommand: 'bash ~/.claude/statusline-command.sh', dataDir: dir });
  assert.deepEqual(result, { originalCommand: 'bash ~/.claude/statusline-command.sh', reusedStored: false, lostOriginal: false });
});

test('resolveOriginalCommand reuses the stored original when the current command is already our wrapper', () => {
  const dir = tmpDir();
  writeConfig(dir, { originalStatusLineCommand: 'bash ~/.claude/statusline-command.sh' });
  const wrapperCommand = 'node /plugins/cache/throttle-marketplace/throttle/1.0.1/hooks/statusline-wrapper.js';
  const result = resolveOriginalCommand({ currentCommand: wrapperCommand, dataDir: dir });
  assert.deepEqual(result, { originalCommand: 'bash ~/.claude/statusline-command.sh', reusedStored: true, lostOriginal: false });
});

test('resolveOriginalCommand flags lostOriginal when the wrapper is set but nothing was ever stored', () => {
  const dir = tmpDir();
  const wrapperCommand = 'node /plugins/cache/throttle-marketplace/throttle/1.0.1/hooks/statusline-wrapper.js';
  const result = resolveOriginalCommand({ currentCommand: wrapperCommand, dataDir: dir });
  assert.deepEqual(result, { originalCommand: null, reusedStored: false, lostOriginal: true });
});

test('buildInstructions notes when it reused the stored original instead of the wrapper', () => {
  const text = buildInstructions({ pluginRoot: '/plugins/throttle', originalCommand: 'bash foo.sh', reusedStored: true });
  assert.match(text, /reusing the previously saved original/i);
  assert.match(text, /bash foo\.sh/);
});

test('buildInstructions warns when the original command could not be recovered', () => {
  const text = buildInstructions({ pluginRoot: '/plugins/throttle', originalCommand: null, lostOriginal: true });
  assert.match(text, /WARNING/);
  assert.match(text, /cannot recover/i);
});

test('CLI writes a machine-readable plan file alongside the human-readable instructions', () => {
  const home = tmpDir();
  fs.mkdirSync(path.join(home, '.claude'));
  fs.writeFileSync(
    path.join(home, '.claude', 'settings.json'),
    JSON.stringify({ statusLine: { type: 'command', command: 'bash ~/.claude/statusline-command.sh' } })
  );
  const pluginRoot = path.join(home, '.claude', 'plugins', 'cache', 'throttle-marketplace', 'throttle', '1.0.0');

  execFileSync('node', [path.join(__dirname, '..', 'hooks', 'lib', 'setup.js')], {
    env: { ...process.env, CLAUDE_PLUGIN_DATA: '', CLAUDE_PLUGIN_ROOT: pluginRoot, HOME: home, USERPROFILE: home },
    encoding: 'utf8',
  });

  const dataDir = path.join(home, '.claude', 'plugins', 'data', 'throttle-throttle-marketplace');
  const plan = readPlan(dataDir);
  assert.equal(plan.statusLine.command, `node ${pluginRoot}/hooks/statusline-wrapper.js`);
  assert.equal(plan.statusLine.refreshInterval, 10);
});

test('CLI reuses the stored original on a second run after the settings.json now points at the wrapper (simulating a post-upgrade re-run)', () => {
  const home = tmpDir();
  fs.mkdirSync(path.join(home, '.claude'));
  const settingsPath = path.join(home, '.claude', 'settings.json');
  fs.writeFileSync(
    settingsPath,
    JSON.stringify({ statusLine: { type: 'command', command: 'bash ~/.claude/statusline-command.sh' } })
  );
  const pluginRootV1 = path.join(home, '.claude', 'plugins', 'cache', 'throttle-marketplace', 'throttle', '1.0.0');
  const dataDir = path.join(home, '.claude', 'plugins', 'data', 'throttle-throttle-marketplace');

  execFileSync('node', [path.join(__dirname, '..', 'hooks', 'lib', 'setup.js')], {
    env: { ...process.env, CLAUDE_PLUGIN_DATA: '', CLAUDE_PLUGIN_ROOT: pluginRootV1, HOME: home, USERPROFILE: home },
    encoding: 'utf8',
  });

  // Simulate the user having pasted the wrapper command in, then upgrading to v1.0.1
  fs.writeFileSync(
    settingsPath,
    JSON.stringify({ statusLine: { type: 'command', command: `node ${pluginRootV1}/hooks/statusline-wrapper.js` } })
  );
  const pluginRootV2 = path.join(home, '.claude', 'plugins', 'cache', 'throttle-marketplace', 'throttle', '1.0.1');

  const output = execFileSync('node', [path.join(__dirname, '..', 'hooks', 'lib', 'setup.js')], {
    env: { ...process.env, CLAUDE_PLUGIN_DATA: '', CLAUDE_PLUGIN_ROOT: pluginRootV2, HOME: home, USERPROFILE: home },
    encoding: 'utf8',
  });

  assert.match(output, /reusing the previously saved original/i);
  const config = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8'));
  assert.equal(config.originalStatusLineCommand, 'bash ~/.claude/statusline-command.sh');
  const plan = readPlan(dataDir);
  assert.equal(plan.statusLine.command, `node ${pluginRootV2}/hooks/statusline-wrapper.js`);
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
