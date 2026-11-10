import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectKey } from "../../src/core/project.js";
import { ensureGitignore, renderLauncherHtml, stablePort } from "../../src/server/launcher.js";
import { startOffice, type Office } from "../../src/server/office.js";

let base: string;
let repo: string;
let ui: string;
let office: Office | undefined;
let blocker: Server | undefined;
beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "officebots-launcher-")));
  repo = join(base, "repo");
  mkdirSync(join(repo, ".git"), { recursive: true });
  ui = join(base, "ui");
  mkdirSync(ui);
  writeFileSync(join(ui, "index.html"), "x");
});
afterEach(async () => {
  await office?.close();
  office = undefined;
  await new Promise<void>((r) => (blocker ? blocker.close(() => r()) : r()));
  blocker = undefined;
  rmSync(base, { recursive: true, force: true });
});

const open = (extra = {}) =>
  startOffice({ root: repo, uiDir: ui, logSources: [], personalConfigPath: join(base, "p.json"), throttleMs: 20, ...extra });
const launcher = () => readFileSync(join(repo, ".officebots", "office.html"), "utf8");
const get = (port: number, path: string) =>
  new Promise<{ status: number; headers: Record<string, unknown> }>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path }, (res) => {
      res.resume();
      resolve({ status: res.statusCode!, headers: res.headers });
    });
    req.on("error", reject);
    req.end();
  });

describe("stable address", () => {
  it("is the same for the same project, in range, and spread across projects", () => {
    const ports = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const key = projectKey(`/projects/p${i}`);
      const p = stablePort(key);
      expect(stablePort(key)).toBe(p);
      expect(p).toBeGreaterThanOrEqual(49200);
      expect(p).toBeLessThan(59200);
      ports.add(p);
    }
    expect(ports.size).toBeGreaterThan(150); // few collisions between projects
  });

  it("an office starts on its project's stable port, again and again", async () => {
    const want = stablePort(projectKey(repo));
    office = await open();
    expect(office.port).toBe(want);
    await office.close();
    office = await open();
    expect(office.port).toBe(want); // same address after a restart, so bookmarks keep working
  });

  it("falls back to a free port when the stable one is taken", async () => {
    const want = stablePort(projectKey(repo));
    blocker = createServer();
    await new Promise<void>((res, rej) => {
      blocker!.once("error", rej);
      blocker!.listen(want, "127.0.0.1", res);
    });
    office = await open();
    expect(office.port).not.toBe(want);
    expect(launcher()).toContain(`http://127.0.0.1:${office.port}/`); // the launcher follows the port actually used
  });
});

describe(".officebots/office.html", () => {
  it("is written when the office starts and points at it, with the project key to check it is the right one", async () => {
    office = await open();
    const html = launcher();
    expect(html).toContain(`http://127.0.0.1:${office.port}/`);
    expect(html).toContain(projectKey(repo));
    expect(html).toContain("The office is not running"); // the fallback for when it is not
  });

  it("cannot be broken by an odd project name", () => {
    const evil = `</script><script>alert(1)</script><img src=x onerror=alert(1)>`;
    const html = renderLauncherHtml({ port: 49500, key: "abc123def456", name: evil });
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img");
    expect(html.match(/<\/script>/g)).toHaveLength(1); // only its own script element
    const json = /const target = (.*?);\n/s.exec(html)![1]!;
    expect(JSON.parse(json).name).toBe(evil); // still shown exactly, as text
  });

  it("loads nothing from anywhere but the office itself", () => {
    const html = renderLauncherHtml({ port: 49500, key: "k", name: "demo" });
    expect(html).not.toMatch(/\bsrc=|<link/);
    expect([...html.matchAll(/https?:\/\/[^"'\s<]+/g)].every((m) => m[0].startsWith("http://127.0.0.1:"))).toBe(true);
  });

  it("the launcher can read /health from a file page, and nothing else is opened up", async () => {
    office = await open();
    const health = await get(office.port, "/health");
    expect(health.status).toBe(200);
    expect(health.headers["access-control-allow-origin"]).toBe("*");
    for (const path of ["/", "/events"]) {
      expect((await get(office.port, path)).headers["access-control-allow-origin"]).toBeUndefined();
    }
  });
});

describe(".officebots/.gitignore", () => {
  const file = () => join(repo, ".officebots", ".gitignore");

  it("keeps runtime files and the launcher out of git", async () => {
    office = await open();
    const lines = readFileSync(file(), "utf8").split("\n");
    expect(lines).toContain(".state/");
    expect(lines).toContain("office.html");
  });

  it("adds what is missing to an older file without touching the rest, and is idempotent", () => {
    mkdirSync(join(repo, ".officebots"));
    writeFileSync(file(), "# mine\n.state/\nextra.txt");
    ensureGitignore(repo);
    expect(readFileSync(file(), "utf8")).toBe("# mine\n.state/\nextra.txt\noffice.html\n");
    ensureGitignore(repo);
    expect(readFileSync(file(), "utf8")).toBe("# mine\n.state/\nextra.txt\noffice.html\n");
  });
});
