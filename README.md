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
  (default 240), `THROTTLE_DISABLE=1` (same effect as `/throttle-off`).
  Each hook's timeout in `hooks/hooks.json` (default 300s) must stay
  comfortably above `THROTTLE_MAX_DELAY_S`, or Claude Code can kill the
  hook mid-sleep before it reports back.
- Decisions are logged as JSONL to `${CLAUDE_PLUGIN_DATA}/throttle.log`,
  including `paceDiffSeconds` and `paceDiff` (signed `HH:MM:SS`) —
  positive means ahead of pace (burning budget faster than time
  elapsed), negative means behind pace (safe margin).
- The status line itself also shows the pace diff, appended to your
  original status line's output as `· pace +00:05:30` (or `-…` when
  behind pace), whenever usage data is available.

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
