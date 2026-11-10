import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAccountHasher, hashAccount } from "../../src/core/identity.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "officebots-id-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("account hashing", () => {
  it("is opaque, stable per salt and different across salts", () => {
    const a = hashAccount("user-1", "salt-a");
    expect(a).toMatch(/^acct_[0-9a-f]{8}$/);
    expect(a).not.toContain("user-1");
    expect(hashAccount("user-1", "salt-a")).toBe(a);
    expect(hashAccount("user-1", "salt-b")).not.toBe(a);
    expect(hashAccount("user-2", "salt-a")).not.toBe(a);
  });

  it("creates the salt file lazily, reuses it, and keeps other settings", () => {
    const path = join(dir, "sub", "config.json");
    const hash = createAccountHasher(path);
    expect(existsSync(path)).toBe(false); // nothing written until an id needs hashing
    const a = hash("user-1");
    const cfg = JSON.parse(readFileSync(path, "utf8"));
    expect(cfg.salt).toMatch(/^[0-9a-f]{32}$/);
    expect(createAccountHasher(path)("user-1")).toBe(a);

    const path2 = join(dir, "config2.json");
    writeFileSync(path2, JSON.stringify({ accounts: { x: "work" } }));
    createAccountHasher(path2)("user-1");
    const merged = JSON.parse(readFileSync(path2, "utf8"));
    expect(merged.accounts).toEqual({ x: "work" });
    expect(typeof merged.salt).toBe("string");
  });
});
