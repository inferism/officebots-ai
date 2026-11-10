import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptySettings, loadSettings, parsePersonalConfig, parseProjectConfig, setNickname, type Settings } from "../../src/core/config.js";
import { resolveStyle } from "../../src/core/roles.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "officebots-cfg-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("project config (office.json)", () => {
  it("reads role renames and rules", () => {
    const { value, problems } = parseProjectConfig(
      JSON.stringify({
        roles: { Lead: "Architect", Coder: "Reviewer" },
        rules: [{ tool: "codex", model: "gpt-6*", name: "Reviewer", color: "#10A37F" }],
      }),
    );
    expect(problems).toEqual([]);
    expect(value.roles).toEqual({ Lead: "Architect", Coder: "Reviewer" });
    expect(value.rules).toEqual([{ tool: "codex", model: "gpt-6*", name: "Reviewer", color: "#10a37f" }]);
  });

  it("uses defaults for a missing file, invalid JSON, or the wrong shape", () => {
    expect(parseProjectConfig(undefined)).toEqual({ value: { roles: {}, rules: [] }, problems: [] });
    expect(parseProjectConfig("{nope").value).toEqual({ roles: {}, rules: [] });
    expect(parseProjectConfig("{nope").problems).toHaveLength(1);
    expect(parseProjectConfig("[1]").value).toEqual({ roles: {}, rules: [] });
  });

  it("drops unknown keys and bad entries, and says what it dropped", () => {
    const { value, problems } = parseProjectConfig(
      JSON.stringify({
        evil: "x",
        roles: { Lead: "ok", Bad: 5, Empty: "  ", Ctl: "a\u0007b", Long: "x".repeat(41) },
        rules: [
          { tool: "codex", name: "Ok", color: "red" }, // bad color: the whole rule has name, so only color is reported
          { tool: "codex" }, // does nothing
          "not an object",
          { model: "m", color: "#112233", extra: "dropped" },
        ],
      }),
    );
    expect(value.roles).toEqual({ Lead: "ok" });
    expect(value.rules).toEqual([{ tool: "codex", name: "Ok" }, { model: "m", color: "#112233" }]);
    expect(value.rules.some((r) => "extra" in r)).toBe(false);
    expect(problems.length).toBeGreaterThanOrEqual(6);
  });
});

describe("personal config", () => {
  it("keeps valid nicknames, folders and remembered roots only", () => {
    const { value } = parsePersonalConfig(
      JSON.stringify({
        salt: "secret-salt",
        accounts: { acct_3f9a1c07: "work", not_an_id: "x", acct_aaaaaaaa: "" },
        claudeConfigDirs: ["/a", 5, ""],
        roots: { "/a/projects": "acct_3f9a1c07", "/b/projects": "nope" },
      }),
    );
    expect(value).toEqual({ accounts: { acct_3f9a1c07: "work" }, claudeConfigDirs: ["/a"], roots: { "/a/projects": "acct_3f9a1c07" } });
    expect(JSON.stringify(value)).not.toContain("secret-salt");
  });

  it("setNickname validates, preserves other keys, and removes on an empty name", () => {
    const path = join(dir, "sub", "config.json");
    writeFileSync(join(dir, "x"), "");
    expect(setNickname(path, "not-an-id", "work")).toMatch(/acct_/);
    expect(setNickname(path, "acct_3f9a1c07", "x".repeat(25))).toMatch(/1 to 24/);
    expect(setNickname(path, "acct_3f9a1c07", "work")).toBeNull();
    // other keys written by other parts of the tool survive
    const cfg = JSON.parse(readFileSync(path, "utf8"));
    writeFileSync(path, JSON.stringify({ ...cfg, salt: "keep-me", future: 1 }));
    expect(setNickname(path, "acct_aaaaaaaa", "personal")).toBeNull();
    const after = JSON.parse(readFileSync(path, "utf8"));
    expect(after).toMatchObject({ salt: "keep-me", future: 1, accounts: { acct_3f9a1c07: "work", acct_aaaaaaaa: "personal" } });
    expect(setNickname(path, "acct_3f9a1c07", "")).toBeNull();
    expect(JSON.parse(readFileSync(path, "utf8")).accounts).toEqual({ acct_aaaaaaaa: "personal" });
  });

  it("loadSettings combines both files and reports problems", () => {
    const root = join(dir, "proj");
    const personal = join(dir, "personal.json");
    writeFileSync(personal, JSON.stringify({ accounts: { acct_3f9a1c07: "work" } }));
    expect(loadSettings(root, personal).value).toEqual({ roles: {}, rules: [], nicknames: { acct_3f9a1c07: "work" } });
  });
});

describe("resolveStyle", () => {
  const who = { tool: "codex", model: "gpt-6.1-sol", role: "Coder", nickname: "work" as string | null };
  const settings = (s: Partial<Settings>): Settings => ({ ...emptySettings(), ...s });

  it("defaults to the built-in role, and renames it", () => {
    expect(resolveStyle(who, settings({}))).toEqual({ role: "Coder" });
    expect(resolveStyle(who, settings({ roles: { Coder: "Reviewer" } }))).toEqual({ role: "Reviewer" });
  });

  it("matches rules on tool, model (with trailing *), built-in role and account nickname; first match wins per property", () => {
    const rules = [
      { tool: "claude-code", name: "Nope" },
      { model: "gpt-6*", account: "personal", name: "Nope too" },
      { model: "gpt-6*", account: "work", name: "Work reviewer" },
      { tool: "codex", name: "Second", color: "#112233" },
      { role: "Coder", color: "#445566" },
    ];
    expect(resolveStyle(who, settings({ rules }))).toEqual({ role: "Work reviewer", color: "#112233" });
    expect(resolveStyle({ ...who, nickname: null }, settings({ rules }))).toEqual({ role: "Second", color: "#112233" });
    expect(resolveStyle({ tool: "other", model: "x", role: "Agent", nickname: null }, settings({ rules }))).toEqual({ role: "Agent" });
  });

  it("a rule's color applies even when an earlier rule set the name", () => {
    const rules = [{ tool: "codex", name: "A" }, { tool: "codex", color: "#abcdef" }];
    expect(resolveStyle(who, settings({ rules }))).toEqual({ role: "A", color: "#abcdef" });
  });
});
