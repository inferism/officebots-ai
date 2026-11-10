import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createClaudeCodeParser } from "../src/adapters/claude-code/parse.js";

const dir = join(import.meta.dirname, "fixtures", "claude-code");

function* walk(d: string): Generator<string> {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (p.endsWith(".jsonl")) yield p;
  }
}

const TOP = ["v", "id", "time", "source", "tool", "model", "account", "session", "agent", "project", "event", "tokens"];
const AGENT = ["kind", "id", "type", "parentSession"];
const TOKENS = ["input", "output", "cacheRead", "cacheWrite", "reasoning"];
const subset = (keys: string[], allowed: string[]) => keys.every((k) => allowed.includes(k));

describe("privacy: parser output", () => {
  for (const file of walk(dir)) {
    it(`${file.slice(dir.length + 1)} yields only schema keys and no log content`, () => {
      const parser = createClaudeCodeParser({ project: () => "abc123def456", agentType: "Explore" });
      const { events, stats } = parser.parse(readFileSync(file, "utf8").split("\n"));
      for (const e of events) {
        expect(subset(Object.keys(e), TOP)).toBe(true);
        expect(subset(Object.keys(e.agent), AGENT)).toBe(true);
        if (e.tokens) expect(subset(Object.keys(e.tokens), TOKENS)).toBe(true);
        const s = JSON.stringify(e);
        expect(s).not.toContain("<redacted>");
        expect(s).not.toContain("/home/");
        expect(s).not.toContain("@");
      }
      // stats hold only counts, line numbers and type names
      expect(JSON.stringify(stats)).not.toContain("<redacted>");
    });
  }

  it("a poisoned record never leaks its content into events or stats", () => {
    const poison = "SECRET-PROMPT-TEXT";
    const lines = [
      JSON.stringify({ type: "assistant", sessionId: "s", timestamp: "2026-11-10T10:00:00.000Z", cwd: "/p", prompt: poison,
        message: { id: "m", model: "x", content: poison, usage: { input_tokens: 1, output_tokens: 1, extra: poison }, stop_reason: "end_turn" } }),
      JSON.stringify({ type: poison, a: poison }),
      `{"broken": "${poison}`,
    ];
    const r = createClaudeCodeParser({ project: () => "p" }).parse(lines);
    expect(r.events).toHaveLength(1);
    expect(JSON.stringify(r.events)).not.toContain(poison);
    expect(JSON.stringify(r.stats)).not.toContain(poison);
    expect(r.stats.unknownTypes).toEqual({ "(other)": 1 });
  });
});
