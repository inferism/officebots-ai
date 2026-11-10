import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createCodexParser } from "../src/adapters/codex/parse.js";
import { threadIdFromPath } from "../src/adapters/codex/files.js";
import { hashAccount } from "../src/core/identity.js";

const dir = join(import.meta.dirname, "fixtures", "codex");
function* walk(d: string): Generator<string> {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

const TOP = ["v", "id", "time", "source", "tool", "model", "account", "session", "agent", "project", "event", "tokens"];
const AGENT = ["kind", "id", "type", "parentSession"];
const TOKENS = ["input", "output", "cacheRead", "cacheWrite", "reasoning"];
const subset = (keys: string[], allowed: string[]) => keys.every((k) => allowed.includes(k));

describe("privacy: codex parser output", () => {
  for (const file of walk(dir)) {
    it(`${file.slice(dir.length + 1).replaceAll("\\", "/")} yields only schema keys, no content, no raw account ids`, () => {
      const raw = readFileSync(file);
      const text = (file.endsWith(".zst") ? zstdDecompressSync(raw) : raw).toString("utf8");
      const p = createCodexParser({ project: () => "abc123def456", hashAccount: (r) => hashAccount(r, "s"), threadHint: threadIdFromPath(file) });
      const { events } = p.parse(text.split("\n"));
      expect(events.length).toBeGreaterThan(0);
      for (const e of events) {
        expect(subset(Object.keys(e), TOP)).toBe(true);
        expect(subset(Object.keys(e.agent), AGENT)).toBe(true);
        if (e.tokens) expect(subset(Object.keys(e.tokens), TOKENS)).toBe(true);
        const s = JSON.stringify(e);
        for (const bad of ["<redacted>", "/home/", "@", "fake-account", "fake-user", "Codex Desktop", "0.167"]) expect(s).not.toContain(bad);
      }
    });
  }

  it("a poisoned rollout never leaks its content into events or stats", () => {
    const poison = "SECRET-PROMPT-TEXT";
    const l = (o: object) => JSON.stringify(o);
    const lines = [
      l({ timestamp: "2026-11-10T10:00:00.000Z", ordinal: 0, type: "session_meta", payload: { id: "t", cwd: "/p", creator_account_id: poison, prompt: poison }, metadata: { note: poison } }),
      l({ timestamp: "2026-11-10T10:00:01.000Z", ordinal: 1, type: "turn_context", payload: { model: "m", cwd: "/p", instructions: poison } }),
      l({ timestamp: "2026-11-10T10:00:02.000Z", ordinal: 2, type: "event_msg", payload: { type: "task_started", message: poison } }),
      l({ timestamp: "2026-11-10T10:00:03.000Z", ordinal: 3, type: poison, payload: { a: poison } }),
      `{"broken": "${poison}`,
    ];
    const r = createCodexParser({ project: () => "p", hashAccount: (x) => hashAccount(x, "s") }).parse(lines);
    expect(r.events).toHaveLength(1);
    expect(JSON.stringify(r.events)).not.toContain(poison);
    expect(JSON.stringify(r.stats)).not.toContain(poison);
    expect(r.stats.unknownTypes).toEqual({ "(other)": 1 });
  });
});
