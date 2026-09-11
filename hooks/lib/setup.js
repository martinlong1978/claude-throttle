const fs = require('fs');
const path = require('path');
const { resolveDataDir, resolvePluginRoot } = require('./paths');

function readOriginalStatusLine(settingsPath) {
  let raw;
  try {
    raw = fs.readFileSync(settingsPath, 'utf8');
  } catch (_) {
    return null;
  }
  let settings;
  try {
    settings = JSON.parse(raw);
  } catch (_) {
    return null;
  }
  return (settings.statusLine && settings.statusLine.command) || null;
}

function writeConfig(dataDir, { originalStatusLineCommand }) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ originalStatusLineCommand }));
}

function buildInstructions({ pluginRoot, originalCommand }) {
  const before = JSON.stringify(
    { statusLine: { type: 'command', command: originalCommand || '<none set>' } },
    null,
    2
  );
  const after = JSON.stringify(
    { statusLine: { type: 'command', command: `node ${pluginRoot}/hooks/statusline-wrapper.js` } },
    null,
    2
  );
  return ['Current statusLine in ~/.claude/settings.json:', before, '', 'Replace it with:', after].join('\n');
}

function main() {
  // setup.js lives at hooks/lib/setup.js, two levels below the plugin
  // root. When a command runs this via the model's own shell (rather
  // than the hook runner), CLAUDE_PLUGIN_ROOT/CLAUDE_PLUGIN_DATA are
  // never set, so fall back to this file's own location.
  const fallbackRoot = path.join(__dirname, '..', '..');
  const dataDir = resolveDataDir(process.env, fallbackRoot);
  if (!dataDir) {
    console.error('throttle: could not determine the plugin data directory (CLAUDE_PLUGIN_DATA/CLAUDE_PLUGIN_ROOT unavailable)');
    process.exitCode = 1;
    return;
  }
  const pluginRoot = resolvePluginRoot(process.env, fallbackRoot);
  const home = process.env.HOME || process.env.USERPROFILE;
  const settingsPath = path.join(home, '.claude', 'settings.json');
  const originalCommand = readOriginalStatusLine(settingsPath);
  writeConfig(dataDir, { originalStatusLineCommand: originalCommand });
  console.log(buildInstructions({ pluginRoot, originalCommand }));
}

if (require.main === module) main();

module.exports = { readOriginalStatusLine, writeConfig, buildInstructions };
