// Claude Code logs carry no account (PLAN.md §1.1), so it is worked out from outside, in this order:
//  1. a session -> account record (written by the SessionStart hook, v1.0)
//  2. the account that was logged in when this config folder was first seen (remembered, hashed)
//  3. otherwise unknown (null)
// Only oauthAccount.accountUuid is read from .claude.json, and it is hashed before it goes anywhere.
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { loadPersonalConfig, updatePersonalConfig } from "../../core/config.js";
import { normalizePath } from "../../core/project.js";
import { ACCOUNT_PATTERN } from "../../core/schema.js";

/** <config dir>/projects -> <config dir> */
export const claudeConfigDirOf = (projectsRoot: string) => dirname(projectsRoot);

/** The default ~/.claude keeps its settings in ~/.claude.json; a custom CLAUDE_CONFIG_DIR keeps them inside itself. */
export function claudeJsonPath(configDir: string, home = homedir()): string {
  return normalizePath(configDir) === normalizePath(join(home, ".claude")) ? join(home, ".claude.json") : join(configDir, ".claude.json");
}

/** Raw id of the account currently logged in for a config folder, or null. Never stored raw. */
export function readLoginAccount(configDir: string, home = homedir()): string | null {
  try {
    const id = JSON.parse(readFileSync(claudeJsonPath(configDir, home), "utf8"))?.oauthAccount?.accountUuid;
    return typeof id === "string" && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

/**
 * Account for every log under a Claude Code projects folder: remembered from the first time the folder
 * was seen, so logging in as someone else later does not re-label old sessions.
 */
export function resolveRootAccount(o: { root: string; hash: (raw: string) => string; personalPath: string; home?: string }): string | null {
  const key = normalizePath(o.root);
  const known = loadPersonalConfig(o.personalPath).roots[key];
  if (known) return known;
  const raw = readLoginAccount(claudeConfigDirOf(o.root), o.home);
  if (!raw) return null;
  const id = o.hash(raw);
  updatePersonalConfig(o.personalPath, (cfg) => {
    const roots = typeof cfg.roots === "object" && cfg.roots !== null && !Array.isArray(cfg.roots) ? (cfg.roots as Record<string, unknown>) : {};
    roots[key] = id;
    cfg.roots = roots;
  });
  return id;
}

/** Looks sessions up in a {sessionId: "acct_xxxxxxxx"} file, re-reading it when it changes (checked at most once a second). */
export function createSessionAccountLookup(file: string): (session: string) => string | undefined {
  let map: Record<string, string> = {};
  let mtime = -1;
  let checked = 0;
  return (session) => {
    const now = Date.now();
    if (now - checked > 1000) {
      checked = now;
      try {
        const m = statSync(file).mtimeMs;
        if (m !== mtime) {
          mtime = m;
          const raw = JSON.parse(readFileSync(file, "utf8"));
          map = {};
          if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
            for (const [k, v] of Object.entries(raw)) if (typeof v === "string" && ACCOUNT_PATTERN.test(v)) map[k] = v;
          }
        }
      } catch {
        map = {};
        mtime = -1;
      }
    }
    return map[session];
  };
}
