import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildPing, parsePingArgs } from "../../src/cli/ping.js";
import { projectKey } from "../../src/core/project.js";
import { validateEvent } from "../../src/core/schema.js";
import { findOfficePort, postEvent } from "../../src/server/loopback.js";
import { startOffice, type Office } from "../../src/server/office.js";

let base: string;
let uiDir: string;
let office: Office | undefined;
beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "officebots-events-")));
  uiDir = join(base, "ui");
  mkdirSync(uiDir);
  writeFileSync(join(uiDir, "index.html"), "x");
});
afterEach(async () => {
  await office?.close();
  office = undefined;
  rmSync(base, { recursive: true, force: true });
});

const event = (over: Record<string, unknown> = {}) => ({
  v: 1,
  id: "http:test-1",
  time: new Date().toISOString(), // now, so the agent counts as active (a fixed time would go stale)
  source: "http",
  tool: "gemini-cli",
  model: "gemini-pro",
  account: null,
  session: "http:gemini-cli",
  agent: { kind: "main" },
  event: "ping",
  tokens: { input: 0, output: 1200, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
  ...over,
});

function post(port: number, body: string | object, headers: Record<string, string> = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  return new Promise<{ status: number; headers: Record<string, unknown>; body: string }>((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, path: "/events", method: "POST", headers: { "Content-Type": "application/json", ...headers } },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body: b }));
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

async function demoOffice() {
  office = await startOffice({ root: join(base, "proj"), uiDir, throttleMs: 20 });
  return office;
}

describe("POST /events", () => {
  it("accepts a valid event and shows a new character; project may be omitted", async () => {
    const o = await demoOffice();
    const r = await post(o.port, event());
    expect(r.status).toBe(202);
    const chars = o.snapshot().characters;
    expect(chars).toHaveLength(1);
    expect(chars[0]).toMatchObject({ tool: "gemini-cli", model: "gemini-pro", role: "Agent", status: "working", tokens: { output: 1200 } });
  });

  it("accepts the explicit project key and a batch, and ignores a repeated id", async () => {
    const o = await demoOffice();
    const key = o.snapshot().project.key;
    expect((await post(o.port, [event({ id: "a", project: key }), event({ id: "b", tool: "other-tool" })])).status).toBe(202);
    expect((await post(o.port, event({ id: "a" }))).status).toBe(202); // same id again: accepted, not counted twice
    const s = o.snapshot();
    expect(s.characters).toHaveLength(2);
    expect(s.totals.output).toBe(2400);
  });

  it("refuses a foreign Origin and creates nothing", async () => {
    const o = await demoOffice();
    for (const origin of ["https://evil.example", "null", "http://localhost:1"]) {
      const r = await post(o.port, event(), { Origin: origin });
      expect(r.status).toBe(403);
    }
    expect((await post(o.port, event(), { "Sec-Fetch-Site": "cross-site" })).status).toBe(403);
    expect(o.snapshot().characters).toEqual([]);
    // its own page is fine
    expect((await post(o.port, event(), { Origin: `http://127.0.0.1:${o.port}` })).status).toBe(202);
  });

  it("refuses a wrong Host header (DNS rebinding)", async () => {
    const o = await demoOffice();
    expect((await post(o.port, event(), { Host: "evil.example" })).status).toBe(403);
    expect(o.snapshot().characters).toEqual([]);
  });

  it("requires application/json, which also stops simple cross-site form posts", async () => {
    const o = await demoOffice();
    expect((await post(o.port, event(), { "Content-Type": "text/plain" })).status).toBe(415);
    expect((await post(o.port, event(), { "Content-Type": "application/x-www-form-urlencoded" })).status).toBe(415);
    expect((await post(o.port, event(), { "Content-Type": "application/json; charset=utf-8" })).status).toBe(202);
    const noType = await new Promise<number>((res) => {
      const req = request({ host: "127.0.0.1", port: o.port, path: "/events", method: "POST" }, (x) => {
        x.resume();
        res(x.statusCode!);
      });
      req.end("{}");
    });
    expect(noType).toBe(415);
  });

  it("rejects bad input without echoing it", async () => {
    const o = await demoOffice();
    const secret = "SECRET-PROMPT-TEXT";
    const cases: [string, string | object, number][] = [
      ["not json", `{"tool": "${secret}`, 400],
      ["wrong version", event({ v: 2, model: secret }), 400],
      ["raw account id", event({ account: "someone@example.com" }), 400],
      ["unhashed account", event({ account: secret }), 400],
      ["very long model", event({ model: secret.repeat(50) }), 400],
      ["negative tokens", event({ tokens: { input: -1, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 } }), 400],
      ["empty batch", [], 400],
      ["batch with one bad event", [event({ id: "ok" }), event({ id: "bad", event: secret })], 400],
      ["other project", event({ project: "000000000000" }), 409],
    ];
    for (const [name, body, status] of cases) {
      const r = await post(o.port, body);
      expect(r.status, name).toBe(status);
      expect(r.body, name).not.toContain(secret);
      expect(r.body, name).not.toContain("someone@");
    }
    expect(o.snapshot().characters).toEqual([]); // the batch with a bad event applied nothing
  });

  it("limits body size", async () => {
    const o = await demoOffice();
    const r = await post(o.port, JSON.stringify(event({ model: "x".repeat(40_000) })));
    expect(r.status).toBe(413);
    expect(o.snapshot().characters).toEqual([]);
  });

  it("answers no CORS preflight and only POST on /events", async () => {
    const o = await demoOffice();
    const pre = await new Promise<{ status: number; headers: Record<string, unknown> }>((res) => {
      const req = request({ host: "127.0.0.1", port: o.port, path: "/events", method: "OPTIONS", headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" } }, (x) => {
        x.resume();
        res({ status: x.statusCode!, headers: x.headers });
      });
      req.end();
    });
    expect(pre.status).toBe(405);
    expect(pre.headers["access-control-allow-origin"]).toBeUndefined();
    const get = await new Promise<number>((res) => {
      const req = request({ host: "127.0.0.1", port: o.port, path: "/events", method: "GET" }, (x) => {
        x.resume();
        res(x.statusCode!);
      });
      req.end();
    });
    expect(get).toBe(405);
  });
});

describe("officebots ping", () => {
  it("parses flags and reports mistakes", () => {
    expect(parsePingArgs(["--tool", "gemini-cli", "--model", "gemini-pro", "--tokens-out", "1200"])).toEqual({
      tool: "gemini-cli",
      model: "gemini-pro",
      event: "ping",
      tokens: { input: 0, output: 1200, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
    });
    expect(parsePingArgs(["--tool", "x"])).toEqual({ tool: "x", model: "unknown", event: "ping" });
    expect(parsePingArgs(["--tool", "x", "--event", "waiting"])).toMatchObject({ event: "waiting" });
    expect(parsePingArgs([])).toMatch(/--tool is required/);
    expect(parsePingArgs(["--tool"])).toMatch(/missing value/);
    expect(parsePingArgs(["--tool", "x", "--tokens-out", "-5"])).toMatch(/whole number/);
    expect(parsePingArgs(["--tool", "x", "--tokens-out", "1.5"])).toMatch(/whole number/);
    expect(parsePingArgs(["--tool", "x", "--bogus", "1"])).toMatch(/unknown option/);
    expect(parsePingArgs(["--tool", "x", "--event", "dance"])).toMatch(/--event must be/);
  });

  it("builds a valid event with no content fields", () => {
    const ev = buildPing({ tool: "gemini-cli", model: "gemini-pro", event: "ping" }, "abc123def456", new Date("2026-11-10T12:00:00Z"));
    expect(validateEvent(ev)).toEqual(ev);
    expect(ev).toMatchObject({ source: "cli", session: "cli:gemini-cli", account: null, project: "abc123def456" });
    expect(ev.id).toMatch(/^cli:[0-9a-f-]{36}$/);
  });

  it("finds the project's office through its run file and creates a character", async () => {
    const repo = join(base, "repo");
    mkdirSync(join(repo, ".git"), { recursive: true });
    expect(await findOfficePort(repo)).toBeNull(); // nothing running yet

    office = await startOffice({ root: repo, uiDir, logSources: [], personalConfigPath: join(base, "personal.json"), throttleMs: 20 });
    const port = await findOfficePort(repo);
    expect(port).toBe(office.port);

    const ev = buildPing({ tool: "gemini-cli", model: "gemini-pro", event: "ping", tokens: { input: 0, output: 1200, cacheRead: 0, cacheWrite: 0, reasoning: 0 } }, projectKey(repo));
    expect(await postEvent(port!, ev)).toBe(202);
    expect(office.snapshot().characters).toHaveLength(1);
    expect(office.snapshot().characters[0]).toMatchObject({ tool: "gemini-cli", model: "gemini-pro", role: "Agent", status: "working" });

    // an event for another project key is refused
    expect(await postEvent(port!, { ...ev, id: "cli:other", project: projectKey(join(base, "elsewhere")) })).toBe(409);

    await office.close();
    office = undefined;
    expect(await findOfficePort(repo)).toBeNull(); // run file removed on close
  });

  it("reports an unreachable office as status 0", async () => {
    expect(await postEvent(1, {})).toBe(0);
  });
});
