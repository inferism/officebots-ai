import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { claudeJsonPath, createSessionAccountLookup, readLoginAccount, resolveRootAccount } from "../../src/adapters/claude-code/account.js";
import { createClaudeCodeParser } from "../../src/adapters/claude-code/parse.js";
import { claudeCodeAdapter, withAccounts } from "../../src/adapters/index.js";
import { loadPersonalConfig } from "../../src/core/config.js";
import { hashAccount } from "../../src/core/identity.js";
import { assistantLine } from "../helpers/fake-writer.js";

let base: string;
let home: string;
let personal: string;
const hash = (raw: string) => hashAccount(raw, "salt");
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "officebots-acct-"));
  home = join(base, "home");
  mkdirSync(home);
  personal = join(base, "personal.json");
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

const login = (file: string, uuid: string | null) =>
  writeFileSync(file, JSON.stringify({ oauthAccount: uuid ? { accountUuid: uuid, emailAddress: "someone@example.com" } : {}, other: "<redacted>" }));

describe("Claude Code account resolution", () => {
  it("the default ~/.claude keeps its login in ~/.claude.json, other folders keep it inside themselves", () => {
    expect(claudeJsonPath(join(home, ".claude"), home)).toBe(join(home, ".claude.json"));
    expect(claudeJsonPath(join(base, "work"), home)).toBe(join(base, "work", ".claude.json"));
  });

  it("reads only the account id", () => {
    login(join(home, ".claude.json"), "fake-uuid-1");
    expect(readLoginAccount(join(home, ".claude"), home)).toBe("fake-uuid-1");
    login(join(home, ".claude.json"), null);
    expect(readLoginAccount(join(home, ".claude"), home)).toBeNull();
    expect(readLoginAccount(join(base, "missing"), home)).toBeNull();
  });

  it("remembers the account a folder first had, hashed, even after someone else logs in", () => {
    const cfg = join(base, "work");
    mkdirSync(cfg);
    login(join(cfg, ".claude.json"), "fake-uuid-a");
    const root = join(cfg, "projects");
    const first = resolveRootAccount({ root, hash, personalPath: personal, home });
    expect(first).toBe(hash("fake-uuid-a"));
    expect(first).toMatch(/^acct_[0-9a-f]{8}$/);

    login(join(cfg, ".claude.json"), "fake-uuid-b"); // a different login later
    expect(resolveRootAccount({ root, hash, personalPath: personal, home })).toBe(first);

    const saved = JSON.stringify(loadPersonalConfig(personal));
    expect(saved).toContain(first!);
    expect(saved).not.toContain("fake-uuid");
    expect(saved).not.toContain("someone@");
  });

  it("is null when nobody is logged in, and does not write anything", () => {
    expect(resolveRootAccount({ root: join(base, "none", "projects"), hash, personalPath: personal, home })).toBeNull();
    expect(loadPersonalConfig(personal).roots).toEqual({});
  });

  it("two config folders give two different accounts", () => {
    const a = join(base, "a");
    const b = join(base, "b");
    mkdirSync(a);
    mkdirSync(b);
    login(join(a, ".claude.json"), "fake-uuid-a");
    login(join(b, ".claude.json"), "fake-uuid-b");
    const sources = withAccounts(
      [
        { adapter: claudeCodeAdapter, root: join(a, "projects") },
        { adapter: claudeCodeAdapter, root: join(b, "projects") },
      ],
      { hash, personalPath: personal, home },
    );
    expect(sources[0]!.account).not.toBe(sources[1]!.account);
    expect(sources.every((s) => /^acct_[0-9a-f]{8}$/.test(s.account!))).toBe(true);
  });

  it("a session record beats the folder's account", () => {
    const file = join(base, "sessions.json");
    writeFileSync(file, JSON.stringify({ "sess-0001": "acct_aaaaaaaa", "sess-bad": "someone@example.com" }));
    const lookup = createSessionAccountLookup(file);
    expect(lookup("sess-0001")).toBe("acct_aaaaaaaa");
    expect(lookup("sess-bad")).toBeUndefined(); // only hashed ids are accepted
    expect(lookup("sess-other")).toBeUndefined();

    const parser = createClaudeCodeParser({ project: () => "p", account: "acct_bbbbbbbb", accountFor: lookup });
    const line = (session: string) => assistantLine({ session, msgId: `m-${session}`, cwd: "/x" });
    const { events } = parser.parse([line("sess-0001"), line("sess-other")]);
    expect(events.map((e) => e.account)).toEqual(["acct_aaaaaaaa", "acct_bbbbbbbb"]);
  });

  it("the session lookup notices when the file changes", async () => {
    const file = join(base, "sessions.json");
    writeFileSync(file, JSON.stringify({ s: "acct_aaaaaaaa" }));
    const lookup = createSessionAccountLookup(file);
    expect(lookup("s")).toBe("acct_aaaaaaaa");
    writeFileSync(file, JSON.stringify({ s: "acct_cccccccc" }));
    const later = new Date(Date.now() + 5000);
    utimesSync(file, later, later);
    await new Promise((r) => setTimeout(r, 1100)); // the lookup only re-checks once a second
    expect(lookup("s")).toBe("acct_cccccccc");
  });
});
