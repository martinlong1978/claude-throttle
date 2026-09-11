const fs = require('fs');
const path = require('path');

const MAX_BYTES = 5 * 1024 * 1024;

function appendLog(dataDir, entry) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'throttle.log');
  let lines = [];
  if (fs.existsSync(file)) {
    const content = fs.readFileSync(file, 'utf8');
    lines = content.length ? content.split('\n').filter(Boolean) : [];
  }
  lines.push(JSON.stringify(entry));
  let joined = lines.join('\n') + '\n';
  if (Buffer.byteLength(joined, 'utf8') > MAX_BYTES) {
    lines = lines.slice(Math.floor(lines.length / 2));
    joined = lines.join('\n') + '\n';
  }
  fs.writeFileSync(file, joined);
}

module.exports = { appendLog, MAX_BYTES };
