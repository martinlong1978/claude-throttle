const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('plugin.json is valid and has required fields', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.equal(typeof manifest.name, 'string');
  assert.equal(typeof manifest.version, 'string');
});

test('hooks.json registers all three events pointing at throttle-hook.js', () => {
  const hooksConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'hooks', 'hooks.json'), 'utf8'));
  for (const eventName of ['PreToolUse', 'PostToolUse', 'UserPromptSubmit']) {
    const entries = hooksConfig.hooks[eventName];
    assert.ok(Array.isArray(entries) && entries.length > 0, `missing ${eventName}`);
    const command = entries[0].hooks[0].command;
    assert.match(command, /throttle-hook\.js/);
    assert.match(command, new RegExp(eventName));
  }
});
