import { describe, expect, it } from "vitest";
import type { OfficeEvent } from "../../src/core/schema.js";
import { createRoom } from "../../src/server/room.js";

const P = { key: "proj", name: "demo" };
const T0 = Date.parse("2026-11-10T10:00:00.000Z");
const ev = (o: Partial<OfficeEvent> & { id: string }): OfficeEvent => ({
  v: 1,
  time: "2026-11-10T10:00:00.000Z",
  source: "adapter",
  tool: "claude-code",
  model: "claude-sonnet-5-5",
  account: null,
  session: "s1",
  agent: { kind: "main" },
  project: "proj",
  event: "working",
  ...o,
});
const tok = (output: number, input = 0, cacheWrite = 0, cacheRead = 0) => ({ input, output, cacheRead, cacheWrite, reasoning: 0 });

describe("room reducer", () => {
  it("goes working -> waiting -> sleeping on its own clock", () => {
    const r = createRoom(P, { idleAfterSec: 90 });
    r.apply(ev({ id: "1", event: "working" }));
    expect(r.snapshot(T0 + 5_000).characters[0]!.status).toBe("working");
    r.apply(ev({ id: "2", event: "waiting", time: "2026-11-10T10:00:10.000Z" }));
    expect(r.snapshot(T0 + 20_000).characters[0]!.status).toBe("waiting");
    expect(r.snapshot(T0 + 10_000 + 91_000).characters[0]!.status).toBe("sleeping");
    // next event wakes the same character
    r.apply(ev({ id: "3", event: "working", time: "2026-11-10T10:05:00.000Z" }));
    const snap = r.snapshot(Date.parse("2026-11-10T10:05:01.000Z"));
    expect(snap.characters).toHaveLength(1);
    expect(snap.characters[0]!.status).toBe("working");
  });

  it("headline is output + fresh input + cache writes, never cache reads", () => {
    const r = createRoom(P);
    r.apply(ev({ id: "1", tokens: tok(100, 5, 20, 9999) }));
    r.apply(ev({ id: "2", tokens: tok(1, 0, 0, 1) }));
    const s = r.snapshot(T0);
    expect(s.characters[0]!.tokens).toMatchObject({ headline: 126, cacheRead: 10000 });
    expect(s.totals.headline).toBe(126);
  });

  it("ignores a repeated event id and events for another project", () => {
    const r = createRoom(P);
    r.apply(ev({ id: "1", tokens: tok(10) }));
    r.apply(ev({ id: "1", tokens: tok(10) }));
    r.apply(ev({ id: "2", project: "other", tokens: tok(10) }));
    expect(r.snapshot(T0).totals.output).toBe(10);
    expect(r.snapshot(T0).characters).toHaveLength(1);
  });

  it("separates characters by tool and model, with default roles", () => {
    const r = createRoom(P);
    r.apply(ev({ id: "1" }));
    r.apply(ev({ id: "2", model: "claude-opus-5-5", session: "s2" }));
    r.apply(ev({ id: "3", tool: "codex", model: "gpt-x", session: "s3" }));
    r.apply(ev({ id: "4", tool: "mystery", model: "foo-model-9", session: "s4" }));
    const roles = r.snapshot(T0).characters.map((c) => [c.tool, c.model, c.role]);
    expect(roles).toEqual([
      ["claude-code", "claude-sonnet-5-5", "Lead"],
      ["claude-code", "claude-opus-5-5", "Lead"],
      ["codex", "gpt-x", "Coder"],
      ["mystery", "foo-model-9", "Agent"],
    ]);
  });

  it("attaches subagents to the parent's character as interns", () => {
    const r = createRoom(P);
    r.apply(ev({ id: "1", tokens: tok(10) }));
    const sub = (id: string, agent: string, type: string, e: OfficeEvent["event"], extra = {}) =>
      ev({ id, model: "claude-opus-5-5", agent: { kind: "subagent", id: agent, type, parentSession: "s1" }, event: e, ...extra });
    r.apply(sub("2", "agent-1", "Explore", "working", { tokens: tok(5) }));
    r.apply(sub("3", "agent-2", "general-purpose", "waiting"));
    const s = r.snapshot(T0 + 1000);
    expect(s.characters).toHaveLength(1);
    expect(s.characters[0]!.interns).toEqual({ active: 1, total: 2, byType: { Explore: 1, "general-purpose": 1 } });
    expect(s.characters[0]!.tokens.output).toBe(15);
  });

  it("labels extra accounts without exposing the raw id", () => {
    const r = createRoom(P);
    r.apply(ev({ id: "1", account: "acct_aaaaaaaa" }));
    r.apply(ev({ id: "2", account: "acct_bbbbbbbb", session: "s2" }));
    const s = r.snapshot(T0);
    expect(s.characters.map((c) => c.accountAlias)).toEqual(["account 1", "account 2"]);
    expect(JSON.stringify(s)).not.toContain("acct_");
  });
});
