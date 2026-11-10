import { describe, expect, it } from "vitest";
import { validateEvent } from "../../src/core/schema.js";

const good = () => ({
  v: 1,
  id: "claude-code:sess-0001:msg_test_01",
  time: "2026-11-10T11:02:14.120Z",
  source: "adapter",
  tool: "claude-code",
  model: "claude-sonnet-5-5",
  account: "acct_3f9a1c07",
  session: "sess-0001",
  agent: { kind: "main" },
  project: "9b1e44d0c2aa",
  event: "working",
  tokens: { input: 4, output: 853, cacheRead: 45928, cacheWrite: 27686, reasoning: 303 },
});

describe("validateEvent", () => {
  it("accepts a good event unchanged", () => {
    expect(validateEvent(good())).toEqual(good());
  });

  it("accepts null account, subagent fields and no tokens", () => {
    const e: Record<string, unknown> = good();
    e.account = null;
    e.agent = { kind: "subagent", id: "agent-0001", type: "Explore", parentSession: "sess-0001" };
    delete e.tokens;
    expect(validateEvent(e)).toEqual(e);
  });

  it("drops unknown top-level, agent and tokens keys", () => {
    const e = good() as Record<string, any>;
    e.prompt = "secret";
    e.content = "secret";
    e.agent.cwd = "/home/dev/x";
    e.tokens.total = 5;
    const out = validateEvent(e)!;
    expect(out).toEqual(good());
    expect(JSON.stringify(out)).not.toContain("secret");
    expect(Object.keys(out.agent)).toEqual(["kind"]);
    expect(Object.keys(out.tokens!)).toEqual(["input", "output", "cacheRead", "cacheWrite", "reasoning"]);
  });

  it("does not mutate its input", () => {
    const e = good() as Record<string, any>;
    e.extra = 1;
    validateEvent(e);
    expect(e.extra).toBe(1);
  });

  it.each([
    ["wrong version", { v: 2 }],
    ["missing version", { v: undefined }],
    ["bad source", { source: "other" }],
    ["bad event name", { event: "typing" }],
    ["non-string id", { id: 5 }],
    ["empty session", { session: "" }],
    ["bad time", { time: "yesterday" }],
    ["undefined account", { account: undefined }],
    ["numeric account", { account: 12 }],
    ["bad agent kind", { agent: { kind: "boss" } }],
    ["non-string agent id", { agent: { kind: "main", id: 3 } }],
    ["non-object agent", { agent: "main" }],
    ["string token", { tokens: { input: "4", output: 1, cacheRead: 0, cacheWrite: 0, reasoning: 0 } }],
    ["negative token", { tokens: { input: -1, output: 1, cacheRead: 0, cacheWrite: 0, reasoning: 0 } }],
    ["NaN token", { tokens: { input: NaN, output: 1, cacheRead: 0, cacheWrite: 0, reasoning: 0 } }],
    ["missing token key", { tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } }],
    ["tokens not an object", { tokens: 5 }],
  ])("rejects %s", (_name, patch) => {
    expect(validateEvent({ ...good(), ...patch })).toBeNull();
  });

  it.each([null, undefined, 5, "x", [], [good()]])("rejects non-object input %#", (x) => {
    expect(validateEvent(x)).toBeNull();
  });
});
