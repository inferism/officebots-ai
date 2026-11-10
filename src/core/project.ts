import { createHash } from "node:crypto";

const norm = (p: string) => p.replaceAll("\\", "/").replace(/\/+$/, "");

/** Project key = first 12 hex of sha256(root path). Git common-dir resolution arrives in v0.3. */
export function projectKey(root: string): string {
  return createHash("sha256").update(norm(root)).digest("hex").slice(0, 12);
}

/** True if cwd is root or inside it. */
export function isInside(root: string, cwd: string): boolean {
  const r = norm(root);
  const c = norm(cwd);
  return c === r || c.startsWith(r + "/");
}
