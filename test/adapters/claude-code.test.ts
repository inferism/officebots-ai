import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createClaudeCodeParser } from "../../src/adapters/claude-code/parse.js";
import { isInside, projectKey } from "../../src/core/project.js";

const dir = join(import.meta.dirname, "..", "fixtures", "claude-code");
const ROOT = "/home/dev/demo-project";
const KEY = projectKey(ROOT);

function run(file: string, agentType?: string, root = ROOT) {
  const text = readFileSync(join(dir, file), "utf8");
  const p = createClaudeCodeParser({
    project: (cwd) => (isInside(root, cwd) ? projectKey(root) : null),
    agentType,
  });
  return p.parse(text.split("\n"));
}

describe("claude-code parser", () => {
  it("dedupes repeated message.id and matches the hand-computed token total", () => {
    const { events } = run("session-basic.jsonl");
    expect(events.map((e) => [e.id, e.event])).toEqual([
      ["claude-code:sess-0001:msg_test_01", "working"],
      ["claude-code:sess-0001:msg_test_03", "waiting"],
    ]);
    const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
    for (const e of events) for (const k of Object.keys(total) as (keyof typeof total)[]) total[k] += e.tokens![k];
    // msg_test_01 (4/853/45928/27686/303) counted once + msg_test_03 (6/120/73614/310/0)
    expect(total).toEqual({ input: 10, output: 973, cacheRead: 119542, cacheWrite: 27996, reasoning: 303 });
    expect(events[0]).toMatchObject({ tool: "claude-code", model: "claude-sonnet-5-5", account: null, session: "sess-0001", agent: { kind: "main" }, project: KEY });
  });

  it("parses a subagent file with type from meta", () => {
    const { events } = run("sess-0001/subagents/agent-0001.jsonl", "general-purpose");
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      id: "claude-code:sess-0001:agent-0001:msg_test_02",
      model: "claude-opus-5-5",
      session: "sess-0001",
      agent: { kind: "subagent", id: "agent-0001", type: "general-purpose", parentSession: "sess-0001" },
      event: "working",
      tokens: { input: 2, output: 147, cacheRead: 0, cacheWrite: 59358, reasoning: 0 },
    });
    expect(events[1]!.event).toBe("waiting");
  });

  it("follows a mid-session model switch", () => {
    const { events } = run("session-model-switch.jsonl");
    expect(events.map((e) => e.model)).toEqual(["claude-sonnet-5-5", "claude-opus-5-5"]);
    expect(events[1]!.tokens!.reasoning).toBe(90);
  });

  it("keeps a session whose cwd moves into a subfolder, and drops one outside the project", () => {
    expect(run("session-cwd-change.jsonl").events.map((e) => e.event)).toEqual(["working", "waiting"]);
    expect(run("session-cwd-change.jsonl", undefined, "/home/dev/other").events).toEqual([]);
    // only the second half is inside packages/api
    const sub = run("session-cwd-change.jsonl", undefined, ROOT + "/packages/api");
    expect(sub.events.map((e) => e.id)).toEqual(["claude-code:sess-0003:msg_test_22"]);
  });

  it("ignores unknown record types and counts only future ones", () => {
    const { events, stats } = run("session-unknown-types.jsonl");
    expect(events).toHaveLength(1);
    expect(stats.unknownTypes).toEqual({ "future-record-type-9": 1 });
    expect(stats.errors).toEqual([]);
  });

  it("reports a torn last line by position and kind only", () => {
    const { events, stats } = run("session-torn.jsonl");
    expect(events).toHaveLength(1);
    expect(stats.errors).toEqual([{ line: 3, kind: "json" }]);
  });

  it("emits the turn end from a later block of an already counted response", () => {
    const rec = (stop: string | null) =>
      JSON.stringify({
        type: "assistant", sessionId: "s", timestamp: "2026-11-10T10:00:00.000Z", cwd: ROOT,
        message: { id: "m1", model: "x", usage: { input_tokens: 1, output_tokens: 2 }, stop_reason: stop },
      });
    const { events } = createClaudeCodeParser({ project: () => "p" }).parse([rec(null), rec(null), rec("end_turn")]);
    expect(events.map((e) => [e.id, e.event, e.tokens?.output])).toEqual([
      ["claude-code:s:m1", "working", 2],
      ["claude-code:s:m1:stop", "waiting", undefined],
    ]);
  });
});
