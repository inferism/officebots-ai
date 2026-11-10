import { existsSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectKey } from "../../src/core/project.js";
import { officeLaunchSpec, officeLogPath } from "../../src/server/launch.js";
import { startOffice, type Office } from "../../src/server/office.js";
import { watchFiles } from "../../src/watcher/settings.js";

let base: string;
let repo: string;
let ui: string;
let office: Office | undefined;
beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "officebots-nolock-")));
  repo = join(base, "repo");
  mkdirSync(join(repo, ".git"), { recursive: true });
  ui = join(base, "ui");
  mkdirSync(ui);
  writeFileSync(join(ui, "index.html"), "x");
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
const open = (extra = {}) =>
  startOffice({ root: repo, uiDir: ui, logSources: [], personalConfigPath: join(base, "cfg", "p.json"), throttleMs: 20, ...extra });

describe("a running office never blocks your files", () => {
  it(".officebots can be renamed and deleted while the office runs", async () => {
    office = await open();
    expect(existsSync(join(repo, ".officebots", "office.html"))).toBe(true);
    // On Windows these threw (permission denied) when the office held the folder open
    renameSync(join(repo, ".officebots"), join(repo, ".officebots-moved"));
    renameSync(join(repo, ".officebots-moved"), join(repo, ".officebots"));
    rmSync(join(repo, ".officebots"), { recursive: true });
    expect(existsSync(join(repo, ".officebots"))).toBe(false);
  });

  it("the whole project folder can be renamed while the office runs", async () => {
    office = await open();
    renameSync(repo, join(base, "repo-renamed"));
    expect(existsSync(join(base, "repo-renamed"))).toBe(true);
    renameSync(join(base, "repo-renamed"), repo); // put back so cleanup and close find it
  });

  it("an office whose .officebots was deleted notices and asks to be shut down", async () => {
    let orphaned = false;
    office = await open({ onOrphaned: () => (orphaned = true) });
    await sleep(1500);
    expect(orphaned).toBe(false); // nothing wrong while the folder is there
    rmSync(join(repo, ".officebots"), { recursive: true });
    await until(() => orphaned, 8000);
  });

  it("the background launcher runs from the temp folder and logs outside the project", () => {
    const spec = officeLaunchSpec(repo, "/x/cli.js");
    expect(spec.args).toEqual(["/x/cli.js", "start", "--project", repo]);
    expect(relative(repo, spec.cwd).startsWith("..")).toBe(true); // its working directory is not the project
    const log = officeLogPath(repo, join(base, "cfg", "p.json"));
    expect(relative(repo, log).startsWith("..")).toBe(true); // and its log is not inside the project
    expect(log).toContain(projectKey(repo));
  });
});

describe("watchFiles (settings reload without holding any folder open)", () => {
  it("notices a file being created, changed and removed, and stops when closed", async () => {
    const file = join(base, "watched.json");
    let calls = 0;
    const w = watchFiles([file], () => calls++, 50);
    await sleep(200);
    expect(calls).toBe(0);

    writeFileSync(file, "1");
    await until(() => calls >= 1);
    const afterCreate = calls;

    writeFileSync(file, "22");
    await until(() => calls > afterCreate);
    const afterChange = calls;

    rmSync(file);
    await until(() => calls > afterChange);

    w.close();
    const final = calls;
    writeFileSync(file, "333");
    await sleep(400);
    expect(calls).toBe(final);
  });

  it("does not fire when nothing changed", async () => {
    const file = join(base, "same.json");
    writeFileSync(file, "x");
    let calls = 0;
    const w = watchFiles([file], () => calls++, 50);
    await sleep(500);
    w.close();
    expect(calls).toBe(0);
  });
});
