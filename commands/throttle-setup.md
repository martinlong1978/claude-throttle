---
description: Wire the throttle plugin's statusLine wrapper into your Claude Code settings
---

Run:

```
node ${CLAUDE_PLUGIN_ROOT}/hooks/lib/setup.js
```

Show its output to the user verbatim, including any WARNING line.

If it printed a WARNING that the original statusLine command could not
be recovered, stop here — do not edit settings.json — and ask the user
how they'd like to proceed.

Otherwise:

1. Read the plan file at the path printed on the script's last line
   (`Plan file: <path>`). It contains `{"statusLine": {...}}` — the
   exact object settings.json's `statusLine` field should become.
2. Read `~/.claude/settings.json` (resolve `~` to the user's home
   directory).
3. Set its top-level `statusLine` field to the plan's `statusLine`
   object, leaving every other key in the file untouched.
4. Write the updated settings.json back using your file-editing tool.
   This will prompt for permission since it edits a file outside the
   project — that's expected, not an error.
5. Tell the user what changed and that they need to restart Claude
   Code for it to take effect.
