import { readFileSync } from "node:fs";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createCodexParser } from "../../src/adapters/codex/parse.js";
import { threadIdFromPath } from "../../src/adapters/codex/files.js";
import { hashAccount } from "../../src/core/identity.js";

const dir = join(import.meta.dirname, "..", "fixtures", "codex");
const LIVE1 = join(dir, "2026/11/10/rollout-2026-11-10T11-02-14-thread-0001.jsonl");
const LIVE2 = join(dir, "2026/11/10/rollout-2026-11-10T11-05-00-thread-0002.jsonl");
const ZST1 = join(dir, "compressed/rollout-2026-11-10T11-02-14-thread-0001.jsonl.zst");
const SALT = "test-salt-0123456789";

function parse(file: string, opts: { silent?: boolean; project?: (c: string) => string | null; text?: string } = {}) {
  const p = createCodexParser({
    project: opts.project ?? (() => "p"),
    hashAccount: (r) => hashAccount(r, SALT),
    threadHint: threadIdFromPath(file),
  });
  const text = opts.text ?? readFileSync(file, "utf8");
  return { p, ...p.parse(text.split("\n"), 1, opts.silent) };
}

describe("codex parser", () => {
  it("turns a rollout into working / tokens / waiting events with ids that do not depend on the path", () => {
    const { events } = parse(LIVE1);
    expect(events.map((e) => [e.id.split(":").slice(2).join(":"), e.event])).toEqual([
      ["2:task_started", "working"],
      ["4:token_count", "tokens"],
      ["6:task_complete", "waiting"],
      ["8:task_started", "working"],
      ["9:token_count", "tokens"],
      ["11:task_complete", "waiting"],
      ["13:task_started", "working"],
      ["14:token_count", "tokens"],
      ["15:turn_aborted", "waiting"],
    ]);
    expect(events.every((e) => e.tool === "codex" && e.session === "thread-0001" && e.agent.kind === "main" && e.project === "p")).toBe(true);
  });

  it("converts cumulative totals into deltas that add up to the final total, ignoring a repeated total", () => {
    const tok = parse(LIVE1).events.filter((e) => e.tokens);
    expect(tok.map((e) => e.tokens)).toEqual([
      { input: 600, output: 200, cacheRead: 400, cacheWrite: 0, reasoning: 50 },
      { input: 400, output: 300, cacheRead: 1100, cacheWrite: 100, reasoning: 70 },
      { input: 200, output: 400, cacheRead: 300, cacheWrite: 0, reasoning: 180 },
    ]);
    // final cumulative was input 3000 (1800 cached), cache write 100, output 900, reasoning 300
    const sum = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
    for (const e of tok) for (const k of Object.keys(sum) as (keyof typeof sum)[]) sum[k] += e.tokens![k];
    expect(sum).toEqual({ input: 1200, output: 900, cacheRead: 1800, cacheWrite: 100, reasoning: 300 });
  });

  it("follows the model per turn", () => {
    const models = parse(LIVE1).events.map((e) => e.model);
    expect(models.slice(0, 6).every((m) => m === "gpt-6.1-sol")).toBe(true);
    expect(models.slice(6)).toEqual(["gpt-6.1-mini", "gpt-6.1-mini", "gpt-6.1-mini"]);
  });

  it("hashes the account and never emits the raw ids", () => {
    const { events } = parse(LIVE1);
    const expected = hashAccount("fake-account-0001", SALT);
    expect(expected).toMatch(/^acct_[0-9a-f]{8}$/);
    expect(new Set(events.map((e) => e.account))).toEqual(new Set([expected]));
    const json = JSON.stringify(events);
    expect(json).not.toContain("fake-account");
    expect(json).not.toContain("fake-user");
  });

  it("has no account when no hasher is available", () => {
    const p = createCodexParser({ project: () => "p", threadHint: "thread-0001" });
    expect(p.parse(readFileSync(LIVE1, "utf8").split("\n")).events.every((e) => e.account === null)).toBe(true);
  });

  it("a forked subagent counts only its own tokens, not the history it inherited", () => {
    const { events } = parse(LIVE2);
    expect(events.map((e) => e.event)).toEqual(["working", "tokens", "waiting"]);
    expect(events[1]!.tokens).toEqual({ input: 300, output: 300, cacheRead: 100, cacheWrite: 0, reasoning: 50 });
    expect(events[0]).toMatchObject({
      session: "thread-0001",
      agent: { kind: "subagent", id: "thread-0002", type: "explorer", parentSession: "thread-0001" },
    });
    expect(events.map((e) => e.id).some((id) => /:[0-4]:/.test(id))).toBe(false); // nothing from ordinals 0-4
  });

  it("counts unknown record types and bad lines by name and position only", () => {
    const r = parse(LIVE1, { text: readFileSync(LIVE1, "utf8") + "{not json\n" });
    expect(r.stats.unknownTypes).toEqual({ future_record_type: 1 });
    expect(r.stats.errors).toEqual([{ line: 17, kind: "json" }]);
  });

  it("drops events from another project", () => {
    expect(parse(LIVE1, { project: () => null }).events).toEqual([]);
  });

  it("silent mode learns the folder and running totals but emits nothing, so later lines get correct deltas", () => {
    const { p, events } = parse(LIVE1, { silent: true });
    expect(events).toEqual([]);
    expect(p.cwd?.()).toBe("/home/dev/demo-project");
    const next = JSON.stringify({
      timestamp: "2026-11-10T12:00:00.000Z",
      ordinal: 16,
      type: "event_msg",
      payload: { type: "token_count", info: { total_token_usage: { input_tokens: 3500, cached_input_tokens: 1800, cache_write_input_tokens: 100, output_tokens: 1000, reasoning_output_tokens: 320, total_tokens: 4400 } } },
      metadata: {},
    });
    const r = p.parse([next], 17);
    expect(r.events).toHaveLength(1);
    expect(r.events[0]!.tokens).toEqual({ input: 500, output: 100, cacheRead: 0, cacheWrite: 0, reasoning: 20 });
    expect(r.events[0]!.model).toBe("gpt-6.1-mini");
  });

  it("treats a counter that goes backwards as a reset", () => {
    const rec = (ord: number, out: number, total: number) =>
      JSON.stringify({ timestamp: "2026-11-10T12:00:00.000Z", ordinal: ord, type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 10, output_tokens: out, total_tokens: total } } }, metadata: {} });
    const meta = JSON.stringify({ timestamp: "2026-11-10T12:00:00.000Z", ordinal: 0, type: "session_meta", payload: { id: "t", cwd: "/x" }, metadata: {} });
    const { events } = createCodexParser({ project: () => "p" }).parse([meta, rec(1, 100, 110), rec(2, 30, 40)]);
    expect(events.map((e) => e.tokens!.output)).toEqual([100, 30]);
  });
});

describe("codex fixtures", () => {
  it("the compressed fixture decompresses to exactly the live file", () => {
    expect(zstdDecompressSync(readFileSync(ZST1)).toString("utf8")).toBe(readFileSync(LIVE1, "utf8"));
  });

  it("thread id comes from the file name, live or compressed", () => {
    expect(threadIdFromPath(LIVE1)).toBe("thread-0001");
    expect(threadIdFromPath(ZST1)).toBe("thread-0001");
    expect(threadIdFromPath("/x/notes.jsonl")).toBeUndefined();
  });
});
