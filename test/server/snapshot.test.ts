import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { claudeCodeAdapter } from "../../src/adapters/index.js";
import { buildSnapshot, renderSnapshotHtml, scriptSafeJson } from "../../src/server/snapshot.js";
import type { Room } from "../../src/server/room.js";
import { appendLines, assistantLine } from "../helpers/fake-writer.js";

let base: string;
let repo: string;
let claude: string;
beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "officebots-snap-")));
  repo = join(base, "repo");
  mkdirSync(join(repo, ".git"), { recursive: true });
  mkdirSync(join(base, "other", ".git"), { recursive: true });
  claude = join(base, "claude", "projects");
  mkdirSync(claude, { recursive: true });
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

const room = (role: string): Room => ({
  project: { key: "abc", name: "demo" },
  characters: [
    {
      key: "k", tool: "t", model: "m", role, accountAlias: null, color: "#112233", accent: "#112233", status: "sleeping",
      lastActive: "2026-11-10T10:00:00.000Z", tokens: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, reasoning: 5, headline: 7 },
      interns: { active: 0, total: 0, byType: {} },
    },
  ],
  totals: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, reasoning: 5, headline: 7 },
});

const PAGE = {
  indexHtml: '<!doctype html><html><head><link rel="stylesheet" href="/style.css"></head><body><script src="/app.js"></script></body></html>',
  css: "body{color:red}",
  js: "console.log(1)",
  takenAt: new Date("2026-11-10T12:00:00Z"),
};

describe("standalone page", () => {
  it("inlines styles, app and room, and loads nothing from anywhere", () => {
    const html = renderSnapshotHtml({ ...PAGE, room: room("Lead") });
    expect(html).toContain("<style>");
    expect(html).toContain("window.__OFFICEBOTS_SNAPSHOT__");
    expect(html).toContain("console.log(1)");
    expect(html).not.toMatch(/\bsrc="|\bhref="/); // no external file references left
    expect(html).not.toContain("http");
  });

  it("room data that looks like HTML cannot break out of its script element", () => {
    const evil = '</script><script>alert(1)</script><!-- \u2028 ';
    const html = renderSnapshotHtml({ ...PAGE, js: 'var s="</script><b>"', css: "a{}</style><b>", room: room(evil) });
    expect(html.match(/<\/script>/gi)).toHaveLength(2); // exactly our two script elements
    expect(html.match(/<\/style>/gi)).toHaveLength(1);
    expect(html).not.toContain("<script>alert");
    // and the data still round-trips exactly
    const json = /window\.__OFFICEBOTS_SNAPSHOT__ = (.*?);<\/script>/s.exec(html)![1]!;
    expect(JSON.parse(json).room.characters[0].role).toBe(evil);
  });

  it("scriptSafeJson escapes angle brackets and line separators", () => {
    const raw = "<!--</script>" + String.fromCharCode(0x2028, 0x2029);
    const s = scriptSafeJson({ a: raw });
    expect(s).not.toContain("<");
    expect(s.includes(String.fromCharCode(0x2028)) || s.includes(String.fromCharCode(0x2029))).toBe(false);
    expect(JSON.parse(s).a).toBe(raw);
  });
});

describe("buildSnapshot", () => {
  it("builds the room for one project from the logs, with settings applied and other projects left out", async () => {
    appendLines(join(claude, "-p", "s.jsonl"), [
      assistantLine({ session: "s1", msgId: "m1", cwd: join(repo, "sub"), output: 100, time: new Date().toISOString() }),
      assistantLine({ session: "s2", msgId: "m2", cwd: join(base, "other"), output: 999, time: new Date().toISOString() }),
    ]);
    mkdirSync(join(repo, ".officebots"));
    writeFileSync(join(repo, ".officebots", "office.json"), JSON.stringify({ roles: { Lead: "Architect" } }));

    const snap = await buildSnapshot({
      root: repo,
      sources: [{ adapter: claudeCodeAdapter, root: claude }],
      hashAccount: (r) => r,
      personalConfigPath: join(base, "personal.json"),
      sinceMs: 24 * 3600 * 1000,
    });
    expect(snap.project.name).toBe("repo");
    expect(snap.characters).toHaveLength(1);
    expect(snap.characters[0]).toMatchObject({ role: "Architect", tokens: { output: 100 } });
    expect(snap.totals.output).toBe(100);
  });

  it("leaves out sessions older than the window", async () => {
    appendLines(join(claude, "-p", "old.jsonl"), [assistantLine({ session: "s1", msgId: "m1", cwd: repo, time: "2020-01-01T00:00:00.000Z" })]);
    const { utimesSync } = await import("node:fs");
    const old = new Date(Date.now() - 5 * 24 * 3600 * 1000);
    utimesSync(join(claude, "-p", "old.jsonl"), old, old);
    const snap = await buildSnapshot({
      root: repo,
      sources: [{ adapter: claudeCodeAdapter, root: claude }],
      hashAccount: (r) => r,
      personalConfigPath: join(base, "personal.json"),
      sinceMs: 24 * 3600 * 1000,
    });
    expect(snap.characters).toEqual([]);
  });
});
