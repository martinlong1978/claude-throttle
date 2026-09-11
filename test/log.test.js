const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { appendLog, MAX_BYTES } = require('../hooks/lib/log');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'throttle-log-'));
}

test('appendLog writes a JSON line', () => {
  const dir = tmpDir();
  appendLog(dir, { a: 1 });
  const content = fs.readFileSync(path.join(dir, 'throttle.log'), 'utf8');
  assert.deepEqual(JSON.parse(content.trim()), { a: 1 });
});

test('appendLog truncates when the file grows past MAX_BYTES', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'throttle.log');
  const bigLine = JSON.stringify({ pad: 'x'.repeat(1000) });
  const lines = new Array(Math.ceil(MAX_BYTES / 1000) + 100).fill(bigLine);
  fs.writeFileSync(file, lines.join('\n') + '\n');
  const before = fs.statSync(file).size;
  appendLog(dir, { marker: 'newest' });
  const after = fs.statSync(file).size;
  assert.ok(after < before);
  const content = fs.readFileSync(file, 'utf8').trim().split('\n');
  assert.deepEqual(JSON.parse(content[content.length - 1]), { marker: 'newest' });
});
