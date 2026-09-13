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

function readStoredOriginal(dataDir) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8'));
    return cfg.originalStatusLineCommand || null;
  } catch (_) {
    return null;
  }
}

function looksLikeOwnWrapper(command) {
  return typeof command === 'string' && command.includes('statusline-wrapper.js');
}

// Re-running /throttle-setup after an upgrade sees settings.json already
// pointing at our own wrapper (from the last run). Naively re-capturing
// "the current statusLine command" would store our own wrapper as the
// "original" — statusline-wrapper.js would then spawn itself instead of
// the user's real original script. Detect that case and keep whatever
// original was already stored instead of overwriting it.
function resolveOriginalCommand({ currentCommand, dataDir }) {
  if (!looksLikeOwnWrapper(currentCommand)) {
    return { originalCommand: currentCommand, reusedStored: false, lostOriginal: false };
  }
  const stored = readStoredOriginal(dataDir);
  if (stored) {
    return { originalCommand: stored, reusedStored: true, lostOriginal: false };
  }
  return { originalCommand: null, reusedStored: false, lostOriginal: true };
}

function writePlan(dataDir, statusLine) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'setup-plan.json'), JSON.stringify({ statusLine }));
}

function readPlan(dataDir) {
  return JSON.parse(fs.readFileSync(path.join(dataDir, 'setup-plan.json'), 'utf8'));
}

function buildProposedStatusLine({ pluginRoot, existingStatusLine, refreshIntervalS = DEFAULT_REFRESH_INTERVAL_S }) {
  return {
    ...(existingStatusLine || {}),
    type: 'command',
    command: `node ${pluginRoot}/hooks/statusline-wrapper.js`,
    refreshInterval: (existingStatusLine && existingStatusLine.refreshInterval) || refreshIntervalS,
  };
}

function buildInstructions({
  pluginRoot,
  originalCommand,
  existingStatusLine = null,
  refreshIntervalS = DEFAULT_REFRESH_INTERVAL_S,
  reusedStored = false,
  lostOriginal = false,
}) {
  const before = JSON.stringify(
    { statusLine: existingStatusLine || { type: 'command', command: originalCommand || '<none set>' } },
    null,
    2
  );
  const after = JSON.stringify(
    { statusLine: buildProposedStatusLine({ pluginRoot, existingStatusLine, refreshIntervalS }) },
    null,
    2
  );

  const lines = ['Current statusLine in ~/.claude/settings.json:', before, '', 'Replace it with:', after, ''];

  if (lostOriginal) {
    lines.push(
      "WARNING: statusLine already points at throttle's own wrapper, but no original command was found in storage — cannot recover your original statusLine automatically. Check throttle's git history or your own memory for what it used to be, and set it manually if needed."
    );
  } else if (reusedStored) {
    lines.push(
      `Detected throttle's own wrapper already in place — reusing the previously saved original command instead of overwriting it: ${originalCommand}`
    );
  } else {
    lines.push(
      `(added refreshInterval: ${refreshIntervalS}s so the pace display updates on a timer, not just on tool activity — remove or change it if you'd rather rely on event-driven updates only)`
    );
  }

  return lines.join('\n');
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
  const currentCommand = (existingStatusLine && existingStatusLine.command) || null;

  const { originalCommand, reusedStored, lostOriginal } = resolveOriginalCommand({ currentCommand, dataDir });
  writeConfig(dataDir, { originalStatusLineCommand: originalCommand });

  const proposedStatusLine = buildProposedStatusLine({ pluginRoot, existingStatusLine });
  writePlan(dataDir, proposedStatusLine);

  console.log(buildInstructions({ pluginRoot, originalCommand, existingStatusLine, reusedStored, lostOriginal }));
  console.log(`\nPlan file: ${path.join(dataDir, 'setup-plan.json')}`);
}

if (require.main === module) main();

module.exports = {
  readOriginalStatusLine,
  writeConfig,
  buildInstructions,
  looksLikeOwnWrapper,
  resolveOriginalCommand,
  readPlan,
};
