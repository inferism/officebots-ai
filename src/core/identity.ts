import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Opaque account id: "acct_" + 8 hex of sha256(salt + raw id). The raw id never leaves this function. */
export function hashAccount(raw: string, salt: string): string {
  return "acct_" + createHash("sha256").update(salt + raw).digest("hex").slice(0, 8);
}

export const personalConfigPath = () => join(homedir(), ".config", "officebots", "config.json");

/**
 * Hasher with a random per-install salt kept in the personal config file (never in a project).
 * The file is only created the first time an account id actually needs hashing.
 */
export function createAccountHasher(configPath = personalConfigPath()): (raw: string) => string {
  let salt: string | undefined;
  const load = (): string => {
    let cfg: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(readFileSync(configPath, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) cfg = parsed;
    } catch {
      // missing or unreadable: start a new one
    }
    if (typeof cfg.salt === "string" && cfg.salt.length >= 16) return cfg.salt;
    const fresh = randomBytes(16).toString("hex");
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ ...cfg, salt: fresh }, null, 2) + "\n", { mode: 0o600 });
    return fresh;
  };
  return (raw) => hashAccount(raw, (salt ??= load()));
}
