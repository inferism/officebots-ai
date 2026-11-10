import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { AlreadyRunningError, startOffice, type Office } from "../../src/server/office.js";
import type { Room } from "../../src/server/room.js";
import { appendLines, assistantLine } from "../helpers/fake-writer.js";

let base: string;
let claude: string;
const offices: Office[] = [];
let uiDir: string;
beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "officebots-office-")));
  claude = join(base, "claude", "projects");
  mkdirSync(claude, { recursive: true });
  uiDir = join(base, "ui");
  mkdirSync(uiDir);
  writeFileSync(join(uiDir, "index.html"), "<html>ui</html>");
  writeFileSync(join(uiDir, "app.js"), "// app");
});
afterEach(async () => {
  for (const o of offices.splice(0)) await o.close();
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
const repo = (name: string) => {
  mkdirSync(join(base, name, ".git"), { recursive: true });
  mkdirSync(join(base, name, "sub"), { recursive: true });
  return join(base, name);
};
async function open(root: string, extra = {}) {
  const o = await startOffice({ root, claudeProjectsDir: claude, uiDir, throttleMs: 20, ...extra });
  offices.push(o);
  return o;
}
function listen(port: number) {
  const rooms: Room[] = [];
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  ws.on("message", (d) => rooms.push(JSON.parse(String(d)).room));
  return { rooms, last: () => rooms.at(-1), close: () => ws.close() };
}
function get(port: number, path: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, headers }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode!, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("office server", () => {
  it("shows a session from this project (subfolder and worktree), ignores another project", async () => {
    const a = repo("a");
    const b = repo("b");
    // a worktree of a
    const gitdir = join(a, ".git", "worktrees", "wt");
    mkdirSync(gitdir, { recursive: true });
    writeFileSync(join(gitdir, "commondir"), "../..");
    const wt = join(base, "wt");
    mkdirSync(wt);
    writeFileSync(join(wt, ".git"), `gitdir: ${gitdir}`);

    const office = await open(a);
    const c = listen(office.port);
    await until(() => c.rooms.length > 0);
    expect(c.last()!.characters).toEqual([]);

    const log = join(claude, "-proj", "sess.jsonl");
    appendLines(log, [assistantLine({ session: "s-sub", msgId: "m1", cwd: join(a, "sub"), stop: "tool_use", output: 100 })]);
    await until(() => c.last()!.characters.length === 1);
    expect(c.last()!.characters[0]).toMatchObject({ role: "Lead", status: "working", tokens: { output: 100 } });

    appendLines(log, [
      assistantLine({ session: "s-b", msgId: "m2", cwd: b, output: 999 }), // other project
      assistantLine({ session: "s-wt", msgId: "m3", cwd: wt, output: 1, stop: "end_turn" }),
    ]);
    await until(() => c.last()!.totals.output === 101);
    expect(c.last()!.totals.output).toBe(101); // 999 from the other project never counted
    c.close();
  });

  it("goes waiting after end_turn and sleeping after the idle window", async () => {
    const a = repo("a");
    let clock = Date.parse("2026-11-10T10:00:00.000Z");
    const office = await open(a, { now: () => clock, idleAfterSec: 90 });
    const c = listen(office.port);
    appendLines(join(claude, "-p", "s.jsonl"), [
      assistantLine({ session: "s", msgId: "m1", cwd: a, time: "2026-11-10T10:00:00.000Z", stop: "end_turn" }),
    ]);
    await until(() => c.last()?.characters[0]?.status === "waiting");
    clock += 91_000;
    await until(() => c.last()?.characters[0]?.status === "sleeping", 5000);
    c.close();
  });

  it("runs one office per project on different ports and records run.json", async () => {
    const a = repo("a");
    const b = repo("b");
    const oa = await open(a);
    const ob = await open(b);
    expect(oa.port).not.toBe(ob.port);
    expect(JSON.parse(readFileSync(join(a, ".officebots", ".state", "run.json"), "utf8"))).toMatchObject({ port: oa.port, pid: process.pid });
    expect(readFileSync(join(a, ".officebots", ".gitignore"), "utf8")).toContain(".state/");
    await expect(open(a)).rejects.toBeInstanceOf(AlreadyRunningError);
    await oa.close();
    expect(existsSync(join(a, ".officebots", ".state", "run.json"))).toBe(false);
  });

  it("serves the page and health on loopback, and refuses wrong Host, wrong Origin and POST", async () => {
    const office = await open(repo("a"));
    expect((await get(office.port, "/")).body).toContain("ui");
    expect((await get(office.port, "/health")).status).toBe(200);
    expect((await get(office.port, "/app.js")).status).toBe(200);
    expect((await get(office.port, "/nope")).status).toBe(404);
    expect((await get(office.port, "/..%2f..%2fpackage.json")).status).toBe(404);
    expect((await get(office.port, "/%2e%2e/secret.html")).status).toBe(404);
    expect((await get(office.port, "/", { Host: "evil.example" })).status).toBe(403);

    const bad = new WebSocket(`ws://127.0.0.1:${office.port}/ws`, { origin: "https://evil.example" });
    const result = await new Promise<string>((res) => {
      bad.on("open", () => res("open"));
      bad.on("error", () => res("rejected"));
      bad.on("unexpected-response", () => res("rejected"));
    });
    expect(result).toBe("rejected");

    const good = new WebSocket(`ws://127.0.0.1:${office.port}/ws`, { origin: `http://127.0.0.1:${office.port}` });
    await new Promise<void>((res, rej) => {
      good.on("open", () => res());
      good.on("error", rej);
    });
    good.close();

    const post = await new Promise<number>((res) => {
      const r = request({ host: "127.0.0.1", port: office.port, path: "/events", method: "POST" }, (x) => {
        x.resume();
        res(x.statusCode!);
      });
      r.end("{}");
    });
    expect(post).toBe(405);
  });
});
