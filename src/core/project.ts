import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const norm = (p: string) => {
  const s = p.replaceAll("\\", "/").replace(/\/+$/, "");
  return process.platform === "win32" ? s.toLowerCase() : s;
};

/** Project key = first 12 hex of sha256(root path). */
export function projectKey(root: string): string {
  return createHash("sha256").update(norm(root)).digest("hex").slice(0, 12);
}

/** True if cwd is root or inside it. */
export function isInside(root: string, cwd: string): boolean {
  const r = norm(root);
  const c = norm(cwd);
  return c === r || c.startsWith(r + "/");
}

/** Given the path of a ".git" entry, return the main checkout root (worktrees map to their main repo). */
function rootFromDotGit(dotGit: string): string {
  try {
    if (statSync(dotGit).isDirectory()) return dirname(dotGit);
    const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8"));
    if (m?.[1]) {
      const gitdir = resolve(dirname(dotGit), m[1].trim());
      const commonFile = join(gitdir, "commondir");
      if (existsSync(commonFile)) {
        const common = resolve(gitdir, readFileSync(commonFile, "utf8").trim());
        if (/[\\/]\.git$/.test(common)) return dirname(common);
      }
    }
  } catch {
    // fall through: treat the folder holding .git as the root
  }
  return dirname(dotGit);
}

/**
 * Walk up from cwd to find the project root: the nearest folder holding .git (a worktree resolves to
 * its main checkout) or .officebots. Pure filesystem reads, no git process.
 */
export function findProjectRoot(cwd: string): string | null {
  let dir = resolve(cwd);
  for (;;) {
    const dotGit = join(dir, ".git");
    if (existsSync(dotGit)) return rootFromDotGit(dotGit);
    if (existsSync(join(dir, ".officebots"))) return dir;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/** Cached cwd -> project key lookup for log records. */
export function createProjectResolver(): (cwd: string) => string | null {
  const cache = new Map<string, string | null>();
  return (cwd) => {
    if (cache.has(cwd)) return cache.get(cwd)!;
    const root = findProjectRoot(cwd);
    const key = root ? projectKey(root) : null;
    if (cache.size > 5000) cache.clear();
    cache.set(cwd, key);
    return key;
  };
}
