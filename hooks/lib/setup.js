const fs = require('fs');
const path = require('path');
const { resolveDataDir, resolvePluginRoot } = require('./paths');

const DEFAULT_REFRESH_INTERVAL_S = 10;

function readSettings(settingsPath) {
  let raw;
  try {
    raw = fs.readFileSync(settingsPath, 'utf8');
  } catch (_) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function readOriginalStatusLine(settingsPath) {
  const settings = readSettings(settingsPath);
  return (settings && settings.statusLine && settings.statusLine.command) || null;
}

function writeConfig(dataDir, { originalStatusLineCommand }) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ originalStatusLineCommand }));
}

function buildInstructions({ pluginRoot, originalCommand, existingStatusLine = null, refreshIntervalS = DEFAULT_REFRESH_INTERVAL_S }) {
  const before = JSON.stringify(
    { statusLine: existingStatusLine || { type: 'command', command: originalCommand || '<none set>' } },
    null,
    2
  );
  const after = JSON.stringify(
    {
      statusLine: {
        ...(existingStatusLine || {}),
        type: 'command',
        command: `node ${pluginRoot}/hooks/statusline-wrapper.js`,
        refreshInterval: (existingStatusLine && existingStatusLine.refreshInterval) || refreshIntervalS,
      },
    },
    null,
    2
  );
  return [
    'Current statusLine in ~/.claude/settings.json:',
    before,
    '',
    'Replace it with:',
    after,
    '',
    `(added refreshInterval: ${refreshIntervalS}s so the pace display updates on a timer, not just on tool activity — remove or change it if you'd rather rely on event-driven updates only)`,
  ].join('\n');
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
  const settings = readSettings(settingsPath);
  const existingStatusLine = (settings && settings.statusLine) || null;
  const originalCommand = (existingStatusLine && existingStatusLine.command) || null;
  writeConfig(dataDir, { originalStatusLineCommand: originalCommand });
  console.log(buildInstructions({ pluginRoot, originalCommand, existingStatusLine }));
}

if (require.main === module) main();

module.exports = { readOriginalStatusLine, writeConfig, buildInstructions };
