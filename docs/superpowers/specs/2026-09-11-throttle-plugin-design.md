# Claude Code Throttle Plugin — Design

Date: 2026-09-11
Status: Approved for planning

## Purpose

A Claude Code plugin that paces token usage across the 5-hour rate-limit
window, so a session doesn't burn its budget early and hit the limit
before the window resets. It introduces small delays in `PreToolUse`,
`PostToolUse`, and `UserPromptSubmit` hooks when usage is running ahead
of a target pace, and reports the delay to the user.

## Why this shape

Claude Code hooks (`PreToolUse`/`PostToolUse`/`UserPromptSubmit`) do not
receive any usage/rate-limit data in their stdin payload. The only
documented place Claude Code exposes the 5-hour window's
`used_percentage` and `resets_at` is the `statusLine` command's stdin
JSON (`rate_limits.five_hour`), gated to Pro/Max subscribers on CLI
v2.1.251+. Plugins cannot register or override `statusLine` — it is a
single top-level field in the user's/project's `settings.json`. So a
statusLine wrapper script is required as a side channel that writes a
cache file the hooks can read.

## Components

```
throttle/
  .claude-plugin/
    plugin.json
  hooks/
    hooks.json
    throttle-hook.js        # entry point for all 3 hook events
    statusline-wrapper.js    # replaces user's statusLine command
    lib/
      calc.js                # pure throttle math, unit tested
      cache.js                # read/write the rate-limit cache file
      log.js                   # append-only JSONL logger
  commands/
    throttle-setup.md          # slash command: prints manual settings.json edit
    throttle-off.md             # slash command: disable throttling
    throttle-on.md               # slash command: re-enable throttling
  test/
    calc.test.js               # node:test unit tests
  README.md
```

### statusline-wrapper.js

Installed manually (see Setup) as the user's `statusLine` command. On
each invocation:

1. Reads the JSON payload Claude Code sends on stdin.
2. Extracts `rate_limits.five_hour.used_percentage` and
   `rate_limits.five_hour.resets_at`, if present.
3. Writes `{ used_percentage, resets_at, captured_at: Date.now()/1000 }`
   to `${CLAUDE_PLUGIN_DATA}/rate-limit-cache.json`.
4. Reads the original statusLine command string from
   `${CLAUDE_PLUGIN_DATA}/config.json` (`originalStatusLineCommand`,
   captured by `/throttle-setup`), execs it with the same stdin, and
   prints its stdout unchanged — so the visible status line is
   unaffected.
5. If `rate_limits.five_hour` is absent (non-Pro/Max account, or older
   CLI), skips the cache write but still chains to the original
   command. No usage data means no throttling, never a broken status
   line.

### throttle-hook.js

Registered for `PreToolUse`, `PostToolUse`, and `UserPromptSubmit` via
`hooks/hooks.json`, invoked as
`node ${CLAUDE_PLUGIN_ROOT}/hooks/throttle-hook.js <EventName>`.

1. If `THROTTLE_DISABLE=1` is set, or `${CLAUDE_PLUGIN_DATA}/disabled`
   exists (the on/off toggle, see Enable/Disable below), exit 0
   immediately, no output.
2. Read the cache file via `lib/cache.js`. If missing, unreadable, or
   `captured_at` is more than 15 minutes old, treat as "no data" —
   exit 0, no delay, one log line noting why.
3. Compute `delay` via `lib/calc.js` (see Math below).
4. If `delay <= 0`: exit 0, no output.
5. If `delay > 0`: sleep synchronously for `delay` seconds, then emit
   on stdout and exit 0:
   ```json
   {"hookSpecificOutput":{"hookEventName":"<EventName>","systemMessage":"Throttle: delayed <N>s (used <P>% of 5h window, <M>min actual time left, target <T>%) — pacing to stay under budget by reset."}}
   ```
6. Append one JSONL line per invocation (including delay=0 cases with
   a reason) to `${CLAUDE_PLUGIN_DATA}/throttle.log`. Truncate the log
   if it exceeds 5MB (drop oldest half).
7. Any unexpected error anywhere in this flow is caught, logged, and
   treated as delay=0. The plugin must never fail a tool call or block
   the hook chain — it only ever adds a bounded delay or does nothing.

`PreToolUse` and `UserPromptSubmit` return `hookSpecificOutput` with no
`permissionDecision` field (equivalent to allow) — only add
`systemMessage`. `PostToolUse` uses the same message shape; it cannot
block anything (the tool already ran) so its only effect is the delay
and message.

## Math (`lib/calc.js`)

Pure function, no I/O, fully unit tested:

```js
const WINDOW_SECONDS = 18000; // fixed 5h window

function computeDelay({ usedPercentage, resetsAt, now, targetPct = 95, maxDelayS = 30 }) {
  const targetFraction = targetPct / 100;
  const usedFraction = usedPercentage / 100;
  const paceUsed = usedFraction / targetFraction;
  const idealRemaining = Math.max(0, (1 - paceUsed) * WINDOW_SECONDS);
  const actualRemaining = resetsAt - now;

  if (idealRemaining >= actualRemaining) return 0;
  return Math.min(actualRemaining - idealRemaining, maxDelayS);
}
```

Derivation: throttling should trigger when the fraction of tokens used
exceeds the fraction of the window elapsed (burning budget faster than
time passes). Elapsed fraction equals `1 - actualRemaining / WINDOW`.
Scaling used-fraction by `1/targetFraction` means hitting `targetPct`
(default 95%) usage is treated as "fully used" for pacing purposes —
built-in safety margin so the plugin aims to land under 95% used by
reset, not exactly at 100%. Once usage reaches the target, every
subsequent hook call throttles at `maxDelayS` regardless of clock time
left, until usage data changes.

Config, both via environment variables (no plugin-contributed settings
mechanism exists for arbitrary config):
- `THROTTLE_TARGET_PCT` (default 95)
- `THROTTLE_MAX_DELAY_S` (default 30)
- `THROTTLE_DISABLE` (set to `1` to fully disable)

Plus the `${CLAUDE_PLUGIN_DATA}/disabled` toggle file (see Enable /
disable below), checked ahead of any of the above.

## Setup (manual statusLine step)

Plugin installation via the standard plugin mechanism auto-registers
the three hooks — no manual step needed for those.

`statusLine` cannot be plugin-registered. The `/throttle-setup` slash
command:
1. Reads the current `statusLine.command` from `~/.claude/settings.json`
   (or reports if none is set).
2. Writes that original command string into
   `${CLAUDE_PLUGIN_DATA}/config.json` as `originalStatusLineCommand`.
3. Prints the exact before/after JSON snippet for the user to paste
   into `~/.claude/settings.json`, replacing `statusLine.command` with
   `node ${CLAUDE_PLUGIN_ROOT}/hooks/statusline-wrapper.js`.

The plugin never edits `~/.claude/settings.json` itself — it is a
shared, user-owned config file; the edit is the user's to make.

## Enable / disable

For short jobs where pacing is unwanted, plain on/off toggle via a
state file (not an env var — env vars set by a slash command's output
don't propagate to the separate hook processes Claude Code spawns
later; a file does):

- `/throttle-off` — creates `${CLAUDE_PLUGIN_DATA}/disabled` (empty
  file). `throttle-hook.js` checks for it first, before touching the
  cache, and short-circuits to delay=0, no output, if present.
- `/throttle-on` — removes that file.
- Both commands print current state after acting, so there's no
  ambiguity about whether throttling is on.
- Stays off until `/throttle-on` is run — indefinite, no auto-resume,
  per your choice of plain on/off over a timed pause.
- `THROTTLE_DISABLE=1` remains as a separate, env-based override
  (useful for scripting/CI) — either mechanism disables.

## Error handling

Fail-open throughout: any missing data, stale cache, parse error, or
unexpected exception results in delay=0 and a log line, never an
exception surfaced to Claude Code, never a blocked tool call.

## Testing

- Unit tests (`node:test`) for `lib/calc.js`: on-pace (delay=0),
  ahead-of-pace (positive delay), cap enforcement, target-pct scaling,
  boundary at exactly target%, negative/zero `actualRemaining`.
- Manual end-to-end verification (documented in README, not automated):
  fabricate a `rate-limit-cache.json` with a high `used_percentage` and
  short `resets_at`, run `node hooks/throttle-hook.js PreToolUse`
  directly, confirm the sleep and `systemMessage` output.
- No automated test can exercise real `rate_limits` data — that
  requires a live Pro/Max session under actual usage. This is called
  out explicitly rather than claimed as covered.

## Out of scope (v1)

- Auto-editing `~/.claude/settings.json`.
- Any UI/dashboard for usage history beyond the JSONL log.
- Handling the `seven_day` rate-limit window (five_hour only).
- Wrapping statusLine commands more complex than a single shell command
  string (e.g. commands with piping already baked in) — documented as
  a known limitation.
