const fs = require('fs');
const path = require('path');

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
  const dataDir = process.env.CLAUDE_PLUGIN_DATA;
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
