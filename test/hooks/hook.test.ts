import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runHook, type HookDeps } from "../../src/hooks/claude-session-start.js";
import { hashAccount } from "../../src/core/identity.js";
import { acquireStartLock, ensureProjectFiles } from "../../src/server/launch.js";
import { startOffice, type Office } from "../../src/server/office.js";

let base: string;
let repo: string;
let home: string;
let office: Office | undefined;
const launches: string[] = [];

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "officebots-hook-")));
  repo = join(base, "repo");
  mkdirSync(join(repo, ".git"), { recursive: true });
  mkdirSync(join(repo, "sub"));
  home = join(base, "home");
  mkdirSync(home);
  writeFileSync(join(home, ".claude.json"), JSON.stringify({ oauthAccount: { accountUuid: "fake-uuid-a" } }));
  launches.length = 0;
});
afterEach(async () => {
  await office?.close();
  office = undefined;
  rmSync(base, { recursive: true, force: true });
});

const deps = (over: Partial<HookDeps> = {}): HookDeps => ({
  stdin: JSON.stringify({ session_id: "sess-0001", cwd: join(repo, "sub") }),
  cwd: base,
  env: {},
  home,
  cliPath: "/fake/cli.js",
  hash: (raw) => hashAccount(raw, "salt"),
  launch: (root) => void launches.push(root),
  ...over,
});
const sessions = () => JSON.parse(readFileSync(join(repo, ".officebots", ".state", "sessions.json"), "utf8"));

describe("claude-session-start hook", () => {
  it("does nothing in a project without .officebots/office.json", async () => {
    expect(await runHook(deps())).toBe("skipped");
    expect(launches).toEqual([]);
    expect(existsSync(join(repo, ".officebots"))).toBe(false); // not even a folder is created
  });

  it("does nothing outside any project", async () => {
    expect(await runHook(deps({ stdin: JSON.stringify({ cwd: join(base, "nowhere") }) }))).toBe("skipped");
    expect(launches).toEqual([]);
  });

  it("starts the office in the background, once, when the project has one configured", async () => {
    ensureProjectFiles(repo);
    expect(await runHook(deps())).toBe("started");
    expect(launches).toEqual([repo]);
    // a second session right after must not start another one
    expect(await runHook(deps({ stdin: JSON.stringify({ session_id: "sess-0002", cwd: repo }) }))).toBe("waiting-for-other-start");
    expect(launches).toHaveLength(1);
  });

  it("an office that has come up releases the start lock, so a later restart is not blocked", async () => {
    ensureProjectFiles(repo);
    expect(await runHook(deps())).toBe("started"); // takes the lock
    office = await startOffice({ root: repo, uiDir: base, logSources: [], personalConfigPath: join(base, "p.json"), throttleMs: 20 });
    expect(existsSync(join(repo, ".officebots", ".state", "start.lock"))).toBe(false);
    await office.close();
    office = undefined;
    expect(await runHook(deps())).toBe("started"); // stopped office, new session: starts again right away
  });

  it("does not start another office when one is already running", async () => {
    ensureProjectFiles(repo);
    office = await startOffice({ root: repo, uiDir: base, logSources: [], personalConfigPath: join(base, "p.json"), throttleMs: 20 });
    expect(await runHook(deps())).toBe("running");
    expect(launches).toEqual([]);
  });

  it("records the account the session started under (hashed) so the office can tell accounts apart", async () => {
    ensureProjectFiles(repo);
    await runHook(deps());
    const map = sessions();
    expect(map["sess-0001"]).toBe(hashAccount("fake-uuid-a", "salt"));
    expect(JSON.stringify(map)).not.toContain("fake-uuid");

    // another session, other account (a different CLAUDE_CONFIG_DIR)
    const other = join(base, "other-cfg");
    mkdirSync(other);
    writeFileSync(join(other, ".claude.json"), JSON.stringify({ oauthAccount: { accountUuid: "fake-uuid-b" } }));
    await runHook(deps({ env: { CLAUDE_CONFIG_DIR: other }, stdin: JSON.stringify({ session_id: "sess-0002", cwd: repo }) }));
    const after = sessions();
    expect(after["sess-0002"]).toBe(hashAccount("fake-uuid-b", "salt"));
    expect(after["sess-0001"]).toBe(map["sess-0001"]); // earlier sessions are kept
  });

  it("never throws, whatever it is fed", async () => {
    ensureProjectFiles(repo);
    for (const stdin of ["", "not json", "null", "[]", '{"cwd": 5, "session_id": {}}', "x".repeat(100_000)]) {
      await expect(runHook(deps({ stdin, cwd: repo }))).resolves.toBeTypeOf("string");
    }
    // a launcher that blows up must not break the session either
    rmSync(join(repo, ".officebots", ".state", "start.lock"), { force: true });
    await expect(runHook(deps({ launch: () => { throw new Error("boom"); }, cwd: repo }))).resolves.toBe("skipped");
  });

  it("uses the process folder when the input has no cwd", async () => {
    ensureProjectFiles(repo);
    expect(await runHook(deps({ stdin: "", cwd: join(repo, "sub") }))).toBe("started");
  });
});

describe("launch helpers", () => {
  it("ensureProjectFiles creates the marker once and never overwrites a user's office.json", () => {
    expect(ensureProjectFiles(repo).created).toBe(true);
    expect(readFileSync(join(repo, ".officebots", ".gitignore"), "utf8")).toContain(".state/");
    writeFileSync(join(repo, ".officebots", "office.json"), '{"roles":{"Lead":"Mine"}}');
    expect(ensureProjectFiles(repo).created).toBe(false);
    expect(readFileSync(join(repo, ".officebots", "office.json"), "utf8")).toBe('{"roles":{"Lead":"Mine"}}');
  });

  it("the start lock admits one starter at a time", () => {
    ensureProjectFiles(repo);
    expect(acquireStartLock(repo)).toBe(true);
    expect(acquireStartLock(repo)).toBe(false);
  });
});
