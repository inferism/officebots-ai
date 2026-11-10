import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { claudeCodeAdapter, withAccounts } from "../../src/adapters/index.js";
import { loadPersonalConfig, setNickname } from "../../src/core/config.js";
import { createAccountHasher } from "../../src/core/identity.js";
import { normalizePath } from "../../src/core/project.js";
import { startOffice, type Office } from "../../src/server/office.js";
import { appendLines, assistantLine } from "../helpers/fake-writer.js";

let base: string;
let repo: string;
let personal: string;
let uiDir: string;
let office: Office | undefined;
const problems: string[] = [];
beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "officebots-settings-")));
  repo = join(base, "repo");
  mkdirSync(join(repo, ".git"), { recursive: true });
  personal = join(base, "cfg", "personal.json");
  uiDir = join(base, "ui");
  mkdirSync(uiDir);
  writeFileSync(join(uiDir, "index.html"), "x");
  problems.length = 0;
});
afterEach(async () => {
  await office?.close();
  office = undefined;
  rmSync(base, { recursive: true, force: true });
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 8000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timeout");
    await sleep(25);
  }
}
const writeOffice = (cfg: unknown) => writeFileSync(join(repo, ".officebots", "office.json"), typeof cfg === "string" ? cfg : JSON.stringify(cfg));
const roles = () => office!.snapshot().characters.map((c) => c.role);

async function open(sources: Parameters<typeof startOffice>[0]["logSources"]) {
  office = await startOffice({
    root: repo,
    uiDir,
    logSources: sources,
    personalConfigPath: personal,
    hashAccount: createAccountHasher(personal),
    onProblem: (m) => problems.push(m),
    throttleMs: 20,
    settingsPollMs: 60, // edits are noticed quickly, so these tests do not depend on a slow poll
  });
  return office;
}

describe("live settings", () => {
  it("editing role names in office.json relabels characters without a restart", async () => {
    const claude = join(base, "claude", "projects");
    mkdirSync(claude, { recursive: true });
    await open([{ adapter: claudeCodeAdapter, root: claude }]);
    appendLines(join(claude, "-p", "s.jsonl"), [assistantLine({ session: "s1", msgId: "m1", cwd: repo })]);
    await until(() => roles().length === 1);
    expect(roles()).toEqual(["Lead"]);
    const key = office!.snapshot().characters[0]!.key;

    writeOffice({ roles: { Lead: "Architect" } });
    await until(() => roles()[0] === "Architect");

    writeOffice({ roles: { Lead: "Architect" }, rules: [{ tool: "claude-code", model: "claude-sonnet*", name: "Builder", color: "#123456" }] });
    await until(() => roles()[0] === "Builder");
    expect(office!.snapshot().characters[0]).toMatchObject({ role: "Builder", color: "#123456" });
    expect(office!.snapshot().characters[0]!.key).toBe(key); // same character, only relabelled

    writeOffice({});
    await until(() => roles()[0] === "Lead");
  });

  it("keeps working with a broken office.json and says so, without echoing it", async () => {
    await open([]);
    writeOffice({ roles: { Lead: "Architect" } });
    await sleep(400);
    writeOffice('{"roles": SECRET-NOT-JSON');
    await until(() => problems.some((p) => p.includes("not valid JSON")));
    expect(problems.join("\n")).not.toContain("SECRET");
  });

  it("two accounts on two config folders, same model: two characters with different nicknames and accents", async () => {
    const home = join(base, "home");
    mkdirSync(home);
    const roots: string[] = [];
    for (const [name, uuid] of [["work", "fake-uuid-a"], ["personal", "fake-uuid-b"]] as const) {
      const cfg = join(base, `claude-${name}`);
      mkdirSync(join(cfg, "projects"), { recursive: true });
      writeFileSync(join(cfg, ".claude.json"), JSON.stringify({ oauthAccount: { accountUuid: uuid } }));
      roots.push(join(cfg, "projects"));
    }
    const hash = createAccountHasher(personal);
    const sources = withAccounts(roots.map((root) => ({ adapter: claudeCodeAdapter, root })), { hash, personalPath: personal, home });
    await open(sources);

    appendLines(join(roots[0]!, "-p", "a.jsonl"), [assistantLine({ session: "sess-a", msgId: "ma", cwd: repo, output: 10 })]);
    appendLines(join(roots[1]!, "-p", "b.jsonl"), [assistantLine({ session: "sess-b", msgId: "mb", cwd: repo, output: 20 })]);
    await until(() => office!.snapshot().characters.length === 2);

    // before any nickname exists they are told apart as "account 1" / "account 2"
    expect(office!.snapshot().characters.map((c) => c.accountAlias).sort()).toEqual(["account 1", "account 2"]);

    // give them nicknames: the personal config is watched, so this shows up live
    const ids = Object.fromEntries(roots.map((r) => [r, loadPersonalConfig(personal).roots[normalizePath(r)]!]));
    expect(setNickname(personal, ids[roots[0]!]!, "work")).toBeNull();
    expect(setNickname(personal, ids[roots[1]!]!, "personal")).toBeNull();
    await until(() => office!.snapshot().characters.every((c) => ["work", "personal"].includes(c.accountAlias ?? "")));

    const chars = office!.snapshot().characters;
    expect(chars).toHaveLength(2);
    expect(chars.map((c) => c.accountAlias).sort()).toEqual(["personal", "work"]);
    expect(new Set(chars.map((c) => c.accent)).size).toBe(2); // different accent colors
    expect(new Set(chars.map((c) => c.model)).size).toBe(1); // same model
    expect(chars.find((c) => c.accountAlias === "work")!.tokens.output).toBe(10);
    expect(chars.find((c) => c.accountAlias === "personal")!.tokens.output).toBe(20);
    expect(JSON.stringify(chars)).not.toMatch(/acct_|fake-uuid/);
  });

  it("a rule can target an account by nickname", async () => {
    const claude = join(base, "claude", "projects");
    mkdirSync(claude, { recursive: true });
    const hash = createAccountHasher(personal);
    const id = hash("fake-raw-account");
    setNickname(personal, id, "work");
    await open([{ adapter: claudeCodeAdapter, root: claude, account: id }]);
    writeOffice({ rules: [{ account: "work", name: "Boss", color: "#abcdef" }] });
    appendLines(join(claude, "-p", "s.jsonl"), [assistantLine({ session: "s1", msgId: "m1", cwd: repo })]);
    await until(() => roles()[0] === "Boss");
    expect(office!.snapshot().characters[0]).toMatchObject({ role: "Boss", color: "#abcdef", accountAlias: "work" });
  });
});
