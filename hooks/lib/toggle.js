const fs = require('fs');
const path = require('path');
const { resolveDataDir } = require('./paths');

function togglePath(dataDir) {
  return path.join(dataDir, 'disabled');
}

function isDisabled(dataDir) {
  return fs.existsSync(togglePath(dataDir));
}

function setDisabled(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(togglePath(dataDir), '');
}

function setEnabled(dataDir) {
  const p = togglePath(dataDir);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function main() {
  // toggle.js lives at hooks/lib/toggle.js, two levels below the plugin
  // root. Commands run this via the model's own shell, which never has
  // CLAUDE_PLUGIN_ROOT/CLAUDE_PLUGIN_DATA set, so fall back to this
  // file's own location.
  const fallbackRoot = path.join(__dirname, '..', '..');
  const dataDir = resolveDataDir(process.env, fallbackRoot);
  if (!dataDir) {
    console.error('throttle: could not determine the plugin data directory (CLAUDE_PLUGIN_DATA/CLAUDE_PLUGIN_ROOT unavailable)');
    process.exitCode = 1;
    return;
  }
  const arg = process.argv[2];
  if (arg === 'off') {
    setDisabled(dataDir);
    console.log('Throttle: disabled.');
  } else if (arg === 'on') {
    setEnabled(dataDir);
    console.log('Throttle: enabled.');
  } else {
    console.log(`Throttle is currently ${isDisabled(dataDir) ? 'disabled' : 'enabled'}.`);
  }
}

if (require.main === module) main();

module.exports = { isDisabled, setDisabled, setEnabled, togglePath };
