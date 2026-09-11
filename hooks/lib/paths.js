const path = require('path');

function resolveDataDir(env = process.env) {
  if (env.CLAUDE_PLUGIN_DATA) return env.CLAUDE_PLUGIN_DATA;

  const root = env.CLAUDE_PLUGIN_ROOT;
  const home = env.HOME || env.USERPROFILE;
  if (!root || !home) return null;

  // Claude Code lays out plugin installs as
  // .../plugins/cache/<marketplace>/<plugin>/<version>, with per-plugin
  // data at .../plugins/data/<plugin>-<marketplace>. Fall back to
  // deriving that path when CLAUDE_PLUGIN_DATA hasn't been set for us
  // (e.g. a command's script run outside the hook runner).
  const parts = root.split(/[\\/]/).filter(Boolean);
  const idx = parts.lastIndexOf('cache');
  if (idx === -1 || parts.length < idx + 3) return null;

  const marketplace = parts[idx + 1];
  const plugin = parts[idx + 2];
  return path.join(home, '.claude', 'plugins', 'data', `${plugin}-${marketplace}`);
}

module.exports = { resolveDataDir };
