# Throttle Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Claude Code plugin that paces token usage against the 5-hour rate-limit window by delaying `PreToolUse`, `PostToolUse`, and `UserPromptSubmit` hooks when usage is running ahead of pace, sourcing usage data through a `statusLine` wrapper, with slash commands to set it up and to pause/resume it.

**Architecture:** A `statusline-wrapper.js` script (installed manually as the user's `statusLine` command) caches `rate_limits.five_hour` data from Claude Code's statusLine stdin JSON to a plugin-data-dir file. A single `throttle-hook.js` entry point, registered for all three hook events, reads that cache, computes a pro-rata delay via pure functions in `hooks/lib/`, sleeps synchronously, and reports the delay via `systemMessage`. Everything fails open.

**Tech Stack:** Node.js (built-in `fs`, `path`, `child_process`, `node:test` — no npm dependencies), Claude Code plugin manifest (`.claude-plugin/plugin.json`, `hooks/hooks.json`, `commands/*.md`).

**Spec:** `docs/superpowers/specs/2026-09-11-throttle-plugin-design.md`

## Global Constraints

- Node.js implementation, no external npm dependencies.
- Fixed 5-hour window: `WINDOW_SECONDS = 18000`. Only the `five_hour` rate-limit field is used; `seven_day` is out of scope.
- Default pacing target `THROTTLE_TARGET_PCT = 95`, overridable via that env var.
- Default per-call cap `THROTTLE_MAX_DELAY_S = 30`, overridable via that env var.
- Disable via either `THROTTLE_DISABLE=1` env var OR the presence of `${CLAUDE_PLUGIN_DATA}/disabled` — either one fully disables, checked before any other logic.
- Cache staleness: a cache file with `captured_at` older than 900s (15 min) is treated as no data.
- Log file `${CLAUDE_PLUGIN_DATA}/throttle.log` is JSONL; once it exceeds 5MB (`5 * 1024 * 1024` bytes), drop the oldest half of lines before appending.
- Fail open, always: any missing data, parse error, or unexpected exception results in delay=0, logged, never thrown, never blocks a tool call.
- The plugin never edits `~/.claude/settings.json` itself. `/throttle-setup` only prints the change for the user to paste in.
- Hook JSON output is always allow-shaped (`hookSpecificOutput` with only `hookEventName` and optional `systemMessage` — never `permissionDecision`). The plugin never blocks a tool call.

---

### Task 1: Plugin scaffold

**Files:**
- Create: `.claude-plugin/plugin.json`
- Create: `hooks/hooks.json`
- Create: `package.json`
- Create: `README.md`
- Test: `test/plugin-manifest.test.js`

**Interfaces:**
- Produces: the on-disk manifest layout every later task's hooks.json entry and package.json test script depend on.

- [ ] **Step 1: Write the failing test**

```js
// test/plugin-manifest.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/plugin-manifest.test.js`
Expected: FAIL — `.claude-plugin/plugin.json` does not exist (ENOENT).

- [ ] **Step 3: Create package.json**

```json
{
  "name": "throttle-plugin",
  "private": true,
  "version": "1.0.0",
  "description": "Paces Claude Code token usage against the 5-hour rate-limit window.",
  "scripts": {
    "test": "node --test test/"
  },
  "engines": {
    "node": ">=18"
  }
}
```

- [ ] **Step 4: Create .claude-plugin/plugin.json**

```json
{
  "name": "throttle",
  "version": "1.0.0",
  "description": "Paces token usage against the Claude Code 5-hour rate-limit window."
}
```

- [ ] **Step 5: Create hooks/hooks.json**

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/throttle-hook.js PreToolUse"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/throttle-hook.js PostToolUse"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/throttle-hook.js UserPromptSubmit"
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 6: Create README.md stub**

```markdown
# throttle

Paces Claude Code token usage against the 5-hour rate-limit window by
delaying tool calls and prompts when usage is running ahead of pace.

See `docs/superpowers/specs/2026-09-11-throttle-plugin-design.md` for
the design. Setup and usage instructions land here as later tasks add
the setup and toggle commands.
```

- [ ] **Step 7: Run test to verify it passes**

Run: `node --test test/plugin-manifest.test.js`
Expected: PASS (2 tests)

- [ ] **Step 8: Commit**

```bash
git add .claude-plugin/plugin.json hooks/hooks.json package.json README.md test/plugin-manifest.test.js
git commit -m "feat: scaffold throttle plugin manifest and hook registration"
```

---

### Task 2: Throttle math (`hooks/lib/calc.js`)

**Files:**
- Create: `hooks/lib/calc.js`
- Test: `test/calc.test.js`

**Interfaces:**
- Produces: `computeDelay({ usedPercentage, resetsAt, now, targetPct = 95, maxDelayS = 30 }) -> number` (seconds, >= 0), and `WINDOW_SECONDS` constant (`18000`). Both used by Task 7.

- [ ] **Step 1: Write the failing tests**

```js
// test/calc.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeDelay } = require('../hooks/lib/calc');

test('on pace or behind pace: no delay', () => {
  const now = 1000;
  const resetsAt = now + 14400; // 1h elapsed of 5h, 4h actual remaining
  const delay = computeDelay({ usedPercentage: 10, resetsAt, now, targetPct: 95, maxDelayS: 30 });
  assert.equal(delay, 0);
});

test('ahead of pace: positive delay, capped', () => {
  const now = 1000;
  const resetsAt = now + 14400; // 1h elapsed, 4h left
  const delay = computeDelay({ usedPercentage: 50, resetsAt, now, targetPct: 95, maxDelayS: 30 });
  assert.equal(delay, 30);
});

test('cap is respected at a different cap value', () => {
  const now = 0;
  const resetsAt = now + 17999;
  const delay = computeDelay({ usedPercentage: 94, resetsAt, now, targetPct: 95, maxDelayS: 5 });
  assert.equal(delay, 5);
});

test('hitting target percentage forces full throttle regardless of clock time left', () => {
  const now = 0;
  const resetsAt = now + 100;
  const delay = computeDelay({ usedPercentage: 95, resetsAt, now, targetPct: 95, maxDelayS: 30 });
  assert.equal(delay, 30);
});

test('boundary: exactly on pace at target yields zero delay', () => {
  const now = 0;
  const targetPct = 95;
  const usedPercentage = 47.5; // half of target
  const resetsAt = now + 9000; // idealRemaining works out to exactly 9000
  const delay = computeDelay({ usedPercentage, resetsAt, now, targetPct, maxDelayS: 30 });
  assert.equal(delay, 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/calc.test.js`
Expected: FAIL — `Cannot find module '../hooks/lib/calc'`

- [ ] **Step 3: Write minimal implementation**

```js
// hooks/lib/calc.js
const WINDOW_SECONDS = 18000; // fixed 5h rate-limit window

function computeDelay({ usedPercentage, resetsAt, now, targetPct = 95, maxDelayS = 30 }) {
  const targetFraction = targetPct / 100;
  const usedFraction = usedPercentage / 100;
  const paceUsed = usedFraction / targetFraction;
  const idealRemaining = Math.max(0, (1 - paceUsed) * WINDOW_SECONDS);
  const actualRemaining = resetsAt - now;

  if (idealRemaining >= actualRemaining) return 0;
  return Math.min(actualRemaining - idealRemaining, maxDelayS);
}

module.exports = { computeDelay, WINDOW_SECONDS };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/calc.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add hooks/lib/calc.js test/calc.test.js
git commit -m "feat: add throttle pacing math with 95% target margin"
```

---

### Task 3: Rate-limit cache (`hooks/lib/cache.js`)

**Files:**
- Create: `hooks/lib/cache.js`
- Test: `test/cache.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `writeCache(dataDir, { usedPercentage, resetsAt, now })`, `readCache(dataDir, { maxAgeS = 900, now = Date.now()/1000 } = {}) -> { usedPercentage, resetsAt, capturedAt } | null`. Used by Task 7 (`readCache`) and Task 8 (`writeCache`).

- [ ] **Step 1: Write the failing tests**

```js
// test/cache.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readCache, writeCache } = require('../hooks/lib/cache');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'throttle-cache-'));
}

test('writeCache then readCache round-trips fresh data', () => {
  const dir = tmpDir();
  const now = 1000;
  writeCache(dir, { usedPercentage: 42, resetsAt: 5000, now });
  const result = readCache(dir, { now: now + 10 });
  assert.deepEqual(result, { usedPercentage: 42, resetsAt: 5000, capturedAt: now });
});

test('readCache returns null when file is missing', () => {
  const dir = tmpDir();
  assert.equal(readCache(dir, { now: 1000 }), null);
});

test('readCache returns null when stale beyond maxAgeS', () => {
  const dir = tmpDir();
  const now = 1000;
  writeCache(dir, { usedPercentage: 10, resetsAt: 5000, now });
  const result = readCache(dir, { now: now + 901, maxAgeS: 900 });
  assert.equal(result, null);
});

test('readCache returns null on corrupt JSON', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'rate-limit-cache.json'), 'not json');
  assert.equal(readCache(dir, { now: 1000 }), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/cache.test.js`
Expected: FAIL — `Cannot find module '../hooks/lib/cache'`

- [ ] **Step 3: Write minimal implementation**

```js
// hooks/lib/cache.js
const fs = require('fs');
const path = require('path');

function cachePath(dataDir) {
  return path.join(dataDir, 'rate-limit-cache.json');
}

function writeCache(dataDir, { usedPercentage, resetsAt, now }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const data = { used_percentage: usedPercentage, resets_at: resetsAt, captured_at: now };
  fs.writeFileSync(cachePath(dataDir), JSON.stringify(data));
}

function readCache(dataDir, { maxAgeS = 900, now = Date.now() / 1000 } = {}) {
  let raw;
  try {
    raw = fs.readFileSync(cachePath(dataDir), 'utf8');
  } catch (_) {
    return null;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (_) {
    return null;
  }
  if (
    typeof data.used_percentage !== 'number' ||
    typeof data.resets_at !== 'number' ||
    typeof data.captured_at !== 'number'
  ) {
    return null;
  }
  if (now - data.captured_at > maxAgeS) return null;
  return { usedPercentage: data.used_percentage, resetsAt: data.resets_at, capturedAt: data.captured_at };
}

module.exports = { readCache, writeCache, cachePath };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/cache.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add hooks/lib/cache.js test/cache.test.js
git commit -m "feat: add rate-limit cache read/write with staleness guard"
```

---

### Task 4: Bounded JSONL logger (`hooks/lib/log.js`)

**Files:**
- Create: `hooks/lib/log.js`
- Test: `test/log.test.js`

**Interfaces:**
- Produces: `appendLog(dataDir, entry)`, `MAX_BYTES` constant (`5 * 1024 * 1024`). Used by Task 7.

- [ ] **Step 1: Write the failing tests**

```js
// test/log.test.js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/log.test.js`
Expected: FAIL — `Cannot find module '../hooks/lib/log'`

- [ ] **Step 3: Write minimal implementation**

```js
// hooks/lib/log.js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/log.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add hooks/lib/log.js test/log.test.js
git commit -m "feat: add bounded JSONL logger for throttle decisions"
```

---

### Task 5: On/off toggle (`hooks/lib/toggle.js`)

**Files:**
- Create: `hooks/lib/toggle.js`
- Test: `test/toggle.test.js`

**Interfaces:**
- Produces: `isDisabled(dataDir) -> boolean`, `setDisabled(dataDir)`, `setEnabled(dataDir)`. `isDisabled` used by Task 7. Also a CLI (`node hooks/lib/toggle.js on|off`) used by Task 9's `/throttle-off` and `/throttle-on` commands.

- [ ] **Step 1: Write the failing tests**

```js
// test/toggle.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isDisabled, setDisabled, setEnabled } = require('../hooks/lib/toggle');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'throttle-toggle-'));
}

test('starts enabled (not disabled) by default', () => {
  const dir = tmpDir();
  assert.equal(isDisabled(dir), false);
});

test('setDisabled then isDisabled is true', () => {
  const dir = tmpDir();
  setDisabled(dir);
  assert.equal(isDisabled(dir), true);
});

test('setEnabled clears disabled state', () => {
  const dir = tmpDir();
  setDisabled(dir);
  setEnabled(dir);
  assert.equal(isDisabled(dir), false);
});

test('setEnabled is safe to call when already enabled', () => {
  const dir = tmpDir();
  assert.doesNotThrow(() => setEnabled(dir));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/toggle.test.js`
Expected: FAIL — `Cannot find module '../hooks/lib/toggle'`

- [ ] **Step 3: Write minimal implementation**

```js
// hooks/lib/toggle.js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/toggle.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add hooks/lib/toggle.js test/toggle.test.js
git commit -m "feat: add throttle on/off toggle backed by a state file"
```

---

### Task 6: Setup helper (`hooks/lib/setup.js`)

**Files:**
- Create: `hooks/lib/setup.js`
- Test: `test/setup.test.js`

**Interfaces:**
- Produces: `readOriginalStatusLine(settingsPath) -> string|null`, `writeConfig(dataDir, { originalStatusLineCommand })`, `buildInstructions({ pluginRoot, originalCommand }) -> string`. Used by Task 9's `/throttle-setup` command. Also a CLI (`node hooks/lib/setup.js`) invoked directly by that command.

- [ ] **Step 1: Write the failing tests**

```js
// test/setup.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/setup.test.js`
Expected: FAIL — `Cannot find module '../hooks/lib/setup'`

- [ ] **Step 3: Write minimal implementation**

```js
// hooks/lib/setup.js
const fs = require('fs');
const path = require('path');

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
  const dataDir = process.env.CLAUDE_PLUGIN_DATA;
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  const home = process.env.HOME || process.env.USERPROFILE;
  const settingsPath = path.join(home, '.claude', 'settings.json');
  const originalCommand = readOriginalStatusLine(settingsPath);
  writeConfig(dataDir, { originalStatusLineCommand: originalCommand });
  console.log(buildInstructions({ pluginRoot, originalCommand }));
}

if (require.main === module) main();

module.exports = { readOriginalStatusLine, writeConfig, buildInstructions };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/setup.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add hooks/lib/setup.js test/setup.test.js
git commit -m "feat: add statusLine setup helper that captures the original command"
```

---

### Task 7: Hook entry point (`hooks/throttle-hook.js`)

**Files:**
- Create: `hooks/throttle-hook.js`
- Test: `test/throttle-hook.test.js`

**Interfaces:**
- Consumes: `computeDelay`, `WINDOW_SECONDS` from Task 2 (`hooks/lib/calc.js`); `readCache` from Task 3 (`hooks/lib/cache.js`); `appendLog` from Task 4 (`hooks/lib/log.js`); `isDisabled` from Task 5 (`hooks/lib/toggle.js`).
- Produces: `run(eventName, { dataDir, env = process.env, now = Date.now()/1000 } = {}) -> { delay, usedPercentage?, resetsAt?, targetPct? }` and `formatMessage(eventName, result, now) -> string`, both exported for testing. A CLI entry (`node hooks/throttle-hook.js <EventName>`) that sleeps and prints the hook JSON.

- [ ] **Step 1: Write the failing tests**

```js
// test/throttle-hook.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { run, formatMessage } = require('../hooks/throttle-hook');
const { writeCache } = require('../hooks/lib/cache');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'throttle-hook-'));
}

test('run returns delay 0 when disabled via toggle file', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'disabled'), '');
  const result = run('PreToolUse', { dataDir: dir, env: {}, now: 1000 });
  assert.equal(result.delay, 0);
});

test('run returns delay 0 when THROTTLE_DISABLE=1', () => {
  const dir = tmpDir();
  const result = run('PreToolUse', { dataDir: dir, env: { THROTTLE_DISABLE: '1' }, now: 1000 });
  assert.equal(result.delay, 0);
});

test('run returns delay 0 when no cache is present', () => {
  const dir = tmpDir();
  const result = run('PreToolUse', { dataDir: dir, env: {}, now: 1000 });
  assert.equal(result.delay, 0);
});

test('run computes a positive delay when usage is ahead of pace', () => {
  const dir = tmpDir();
  const now = 1000;
  writeCache(dir, { usedPercentage: 50, resetsAt: now + 14400, now });
  const result = run('PreToolUse', { dataDir: dir, env: {}, now: now + 5 });
  assert.ok(result.delay > 0);
});

test('run fails open on a corrupt cache file', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'rate-limit-cache.json'), '{ not valid json');
  const result = run('PreToolUse', { dataDir: dir, env: {}, now: 1000 });
  assert.equal(result.delay, 0);
});

test('formatMessage mentions the delay and usage percentage', () => {
  const msg = formatMessage('PreToolUse', { delay: 12, usedPercentage: 61, resetsAt: 1000 + 2580, targetPct: 95 }, 1000);
  assert.match(msg, /12s/);
  assert.match(msg, /61%/);
});

test('CLI sleeps for the computed delay and prints a systemMessage', () => {
  const dir = tmpDir();
  const now = Date.now() / 1000;
  writeCache(dir, { usedPercentage: 95, resetsAt: now + 100, now });
  const start = Date.now();
  const output = execFileSync(
    'node',
    [path.join(__dirname, '..', 'hooks', 'throttle-hook.js'), 'PreToolUse'],
    {
      env: { ...process.env, CLAUDE_PLUGIN_DATA: dir, THROTTLE_MAX_DELAY_S: '0.3' },
      encoding: 'utf8',
    }
  );
  const elapsedMs = Date.now() - start;
  assert.ok(elapsedMs >= 250, `expected sleep, elapsed=${elapsedMs}ms`);
  const parsed = JSON.parse(output);
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.match(parsed.hookSpecificOutput.systemMessage, /Throttle:/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/throttle-hook.test.js`
Expected: FAIL — `Cannot find module '../hooks/throttle-hook'`

- [ ] **Step 3: Write minimal implementation**

```js
// hooks/throttle-hook.js
const { computeDelay } = require('./lib/calc');
const { readCache } = require('./lib/cache');
const { appendLog } = require('./lib/log');
const { isDisabled } = require('./lib/toggle');

function run(eventName, { dataDir, env = process.env, now = Date.now() / 1000 } = {}) {
  try {
    if (env.THROTTLE_DISABLE === '1' || isDisabled(dataDir)) {
      appendLog(dataDir, { ts: now, event: eventName, delay: 0, reason: 'disabled' });
      return { delay: 0 };
    }

    const cache = readCache(dataDir, { now });
    if (!cache) {
      appendLog(dataDir, { ts: now, event: eventName, delay: 0, reason: 'no-data' });
      return { delay: 0 };
    }

    const targetPct = Number(env.THROTTLE_TARGET_PCT) || 95;
    const maxDelayS = Number(env.THROTTLE_MAX_DELAY_S) || 30;
    const delay = computeDelay({
      usedPercentage: cache.usedPercentage,
      resetsAt: cache.resetsAt,
      now,
      targetPct,
      maxDelayS,
    });

    appendLog(dataDir, {
      ts: now,
      event: eventName,
      delay,
      usedPercentage: cache.usedPercentage,
      resetsAt: cache.resetsAt,
    });

    return { delay, usedPercentage: cache.usedPercentage, resetsAt: cache.resetsAt, targetPct };
  } catch (err) {
    try {
      appendLog(dataDir, {
        ts: now,
        event: eventName,
        delay: 0,
        reason: 'error',
        message: String((err && err.message) || err),
      });
    } catch (_) {
      // logging must never throw past this point
    }
    return { delay: 0 };
  }
}

function formatMessage(eventName, result, now) {
  const minsLeft = Math.round((result.resetsAt - now) / 60);
  return `Throttle: delayed ${Math.round(result.delay)}s (used ${result.usedPercentage}% of 5h window, ${minsLeft}min actual time left, target ${result.targetPct}%) — pacing to stay under budget by reset.`;
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function main() {
  const eventName = process.argv[2];
  const dataDir = process.env.CLAUDE_PLUGIN_DATA;
  const now = Date.now() / 1000;
  const result = run(eventName, { dataDir, now });

  if (result.delay > 0) {
    sleepSync(result.delay * 1000);
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: eventName,
          systemMessage: formatMessage(eventName, result, now),
        },
      })
    );
  }
}

if (require.main === module) main();

module.exports = { run, formatMessage };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/throttle-hook.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add hooks/throttle-hook.js test/throttle-hook.test.js
git commit -m "feat: wire throttle hook entry point with fail-open sleep and reporting"
```

---

### Task 8: StatusLine wrapper (`hooks/statusline-wrapper.js`)

**Files:**
- Create: `hooks/statusline-wrapper.js`
- Test: `test/statusline-wrapper.test.js`

**Interfaces:**
- Consumes: `writeCache` from Task 3 (`hooks/lib/cache.js`).
- Produces: `extractRateLimit(payload) -> { usedPercentage, resetsAt } | null`, `loadOriginalCommand(dataDir) -> string | null`, both exported for testing. A CLI entry that reads stdin, caches usage, and chains to the original statusLine command (from Task 6's `config.json`).

- [ ] **Step 1: Write the failing tests**

```js
// test/statusline-wrapper.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { extractRateLimit, loadOriginalCommand } = require('../hooks/statusline-wrapper');
const { readCache } = require('../hooks/lib/cache');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'throttle-statusline-'));
}

test('extractRateLimit reads five_hour fields', () => {
  const result = extractRateLimit({ rate_limits: { five_hour: { used_percentage: 12.5, resets_at: 5000 } } });
  assert.deepEqual(result, { usedPercentage: 12.5, resetsAt: 5000 });
});

test('extractRateLimit returns null when rate_limits is absent', () => {
  assert.equal(extractRateLimit({}), null);
  assert.equal(extractRateLimit(null), null);
});

test('loadOriginalCommand reads config.json', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ originalStatusLineCommand: 'echo hi' }));
  assert.equal(loadOriginalCommand(dir), 'echo hi');
});

test('loadOriginalCommand returns null when config.json is missing', () => {
  assert.equal(loadOriginalCommand(tmpDir()), null);
});

test('CLI caches usage and chains to the original command, passing stdin through', () => {
  const dir = tmpDir();
  const echoScript = path.join(dir, 'echo-status.js');
  fs.writeFileSync(echoScript, "process.stdout.write('MY STATUS LINE\\n');");
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ originalStatusLineCommand: `node ${echoScript}` }));
  const stdin = JSON.stringify({ rate_limits: { five_hour: { used_percentage: 33, resets_at: 9999999999 } } });

  const output = execFileSync('node', [path.join(__dirname, '..', 'hooks', 'statusline-wrapper.js')], {
    env: { ...process.env, CLAUDE_PLUGIN_DATA: dir },
    input: stdin,
    encoding: 'utf8',
  });

  assert.equal(output.trim(), 'MY STATUS LINE');
  const cache = readCache(dir, { now: Date.now() / 1000 });
  assert.equal(cache.usedPercentage, 33);
});

test('CLI prints a setup hint when no original command is configured yet', () => {
  const dir = tmpDir();
  const output = execFileSync('node', [path.join(__dirname, '..', 'hooks', 'statusline-wrapper.js')], {
    env: { ...process.env, CLAUDE_PLUGIN_DATA: dir },
    input: '{}',
    encoding: 'utf8',
  });
  assert.match(output, /\/throttle-setup/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/statusline-wrapper.test.js`
Expected: FAIL — `Cannot find module '../hooks/statusline-wrapper'`

- [ ] **Step 3: Write minimal implementation**

```js
// hooks/statusline-wrapper.js
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { writeCache } = require('./lib/cache');

function extractRateLimit(payload) {
  const fh = payload && payload.rate_limits && payload.rate_limits.five_hour;
  if (!fh || typeof fh.used_percentage !== 'number' || typeof fh.resets_at !== 'number') return null;
  return { usedPercentage: fh.used_percentage, resetsAt: fh.resets_at };
}

function loadOriginalCommand(dataDir) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8'));
    return cfg.originalStatusLineCommand || null;
  } catch (_) {
    return null;
  }
}

function main() {
  const dataDir = process.env.CLAUDE_PLUGIN_DATA;
  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch (_) {
    raw = '';
  }
  let payload = null;
  try {
    payload = JSON.parse(raw);
  } catch (_) {
    payload = null;
  }

  const rl = extractRateLimit(payload);
  if (rl) {
    try {
      writeCache(dataDir, { usedPercentage: rl.usedPercentage, resetsAt: rl.resetsAt, now: Date.now() / 1000 });
    } catch (_) {
      // caching must never block the status line from rendering
    }
  }

  const originalCommand = loadOriginalCommand(dataDir);
  if (!originalCommand) {
    process.stdout.write('throttle: run /throttle-setup to finish wiring your status line\n');
    return;
  }

  const result = spawnSync(originalCommand, { shell: true, input: raw, encoding: 'utf8' });
  process.stdout.write(result.stdout || '');
}

if (require.main === module) main();

module.exports = { extractRateLimit, loadOriginalCommand };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/statusline-wrapper.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add hooks/statusline-wrapper.js test/statusline-wrapper.test.js
git commit -m "feat: add statusLine wrapper that caches usage and chains to the original command"
```

---

### Task 9: Slash commands, README, and manual verification

**Files:**
- Create: `commands/throttle-setup.md`
- Create: `commands/throttle-off.md`
- Create: `commands/throttle-on.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: `hooks/lib/setup.js` CLI (Task 6), `hooks/lib/toggle.js` CLI (Task 5) — invoked as plain shell commands from the markdown, not required as Node modules.
- Produces: nothing consumed by other tasks — this is the terminal task.

- [ ] **Step 1: Create commands/throttle-setup.md**

```markdown
---
description: Wire the throttle plugin's statusLine wrapper into your Claude Code settings
---

Run:

```
node ${CLAUDE_PLUGIN_ROOT}/hooks/lib/setup.js
```

Show its output to the user verbatim. Then tell them to paste the
"Replace it with" JSON into `~/.claude/settings.json` themselves
(replacing the existing `statusLine` value) and restart Claude Code
for it to take effect. Do not edit `~/.claude/settings.json` yourself.
```

- [ ] **Step 2: Create commands/throttle-off.md**

```markdown
---
description: Disable throttle plugin pacing until you run /throttle-on
---

Run:

```
node ${CLAUDE_PLUGIN_ROOT}/hooks/lib/toggle.js off
```

Show its output to the user verbatim.
```

- [ ] **Step 3: Create commands/throttle-on.md**

```markdown
---
description: Re-enable throttle plugin pacing
---

Run:

```
node ${CLAUDE_PLUGIN_ROOT}/hooks/lib/toggle.js on
```

Show its output to the user verbatim.
```

- [ ] **Step 4: Rewrite README.md with full usage instructions**

```markdown
# throttle

Paces Claude Code token usage against the 5-hour rate-limit window by
delaying `PreToolUse`, `PostToolUse`, and `UserPromptSubmit` hooks when
usage is running ahead of a 95%-by-reset pacing target, and reports any
delay inline via the hook's `systemMessage`.

See `docs/superpowers/specs/2026-09-11-throttle-plugin-design.md` for
the full design.

## Requirements

- Claude Code CLI v2.1.251+ on a Claude.ai Pro or Max plan — older
  versions or other plans don't expose the `rate_limits` field this
  plugin reads, and it will simply never throttle (fails open).
- Node.js 18+ on PATH.

## Setup

1. Enable the plugin.
2. Run `/throttle-setup`. It prints your current `statusLine` command
   and the replacement to use.
3. Paste the replacement into `~/.claude/settings.json` yourself and
   restart Claude Code. (The plugin never edits this file for you.)

Hooks register automatically once the plugin is enabled — no manual
step needed for those.

## Usage

- Runs automatically once set up: no action needed for normal pacing.
- `/throttle-off` — disable pacing, e.g. for a short job you want done
  now. Stays off until you run `/throttle-on`.
- `/throttle-on` — re-enable pacing.
- Env overrides: `THROTTLE_TARGET_PCT` (default 95), `THROTTLE_MAX_DELAY_S`
  (default 30), `THROTTLE_DISABLE=1` (same effect as `/throttle-off`).
- Decisions are logged as JSONL to `${CLAUDE_PLUGIN_DATA}/throttle.log`.

## Manual end-to-end verification

Automated tests cover the math, caching, logging, toggle, and CLI
wiring, but not real `rate_limits` data end-to-end (that needs a live
Pro/Max session under real usage). After `/throttle-setup`:

1. Fabricate a cache file to force a throttle:
   ```bash
   node -e "require('./hooks/lib/cache').writeCache(process.env.CLAUDE_PLUGIN_DATA, { usedPercentage: 95, resetsAt: Date.now()/1000 + 100, now: Date.now()/1000 })"
   ```
2. Run `node hooks/throttle-hook.js PreToolUse` directly and confirm it
   sleeps for the capped delay and prints a `systemMessage` mentioning
   `Throttle:`.
3. Confirm `${CLAUDE_PLUGIN_DATA}/throttle.log` gained a line for that
   call.
4. Run `/throttle-off`, repeat step 2, confirm no delay and no output.
5. Run `/throttle-on` to restore normal behavior.
```

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS (all tests across every task)

- [ ] **Step 6: Commit**

```bash
git add commands/throttle-setup.md commands/throttle-off.md commands/throttle-on.md README.md
git commit -m "docs: add setup/toggle commands and usage instructions"
```

- [ ] **Step 7: Manual verification**

Follow the "Manual end-to-end verification" steps just added to
README.md, in this repo, with `CLAUDE_PLUGIN_DATA` set to a scratch
directory (e.g. `export CLAUDE_PLUGIN_DATA=$(mktemp -d)`). Confirm each
step's expected behavior before considering the plugin done.
