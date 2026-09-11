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
