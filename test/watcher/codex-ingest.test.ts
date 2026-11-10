import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { codexAdapter } from "../../src/adapters/index.js";
import type { OfficeEvent } from "../../src/core/schema.js";
import { createIngest } from "../../src/watcher/ingest.js";

const fx = join(import.meta.dirname, "..", "fixtures", "codex");
const N1 = "rollout-2026-11-10T11-02-14-thread-0001.jsonl";
const N2 = "rollout-2026-11-10T11-05-00-thread-0002.jsonl";
const LIVE1 = join(fx, "2026/11/10", N1);
const LIVE2 = join(fx, "2026/11/10", N2);
const ZST1 = join(fx, "compressed", N1 + ".zst");

let root: string;
let day: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "officebots-codex-"));
  day = join(root, "2026", "11", "10");
  mkdirSync(day, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 8000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timeout");
    await sleep(25);
  }
}

function make(extra: { recentMs?: number; project?: (cwd: string) => string | null } = {}) {
  const events: OfficeEvent[] = [];
  const ingest = createIngest({
    sources: [{ adapter: codexAdapter, root }],
    project: extra.project ?? ((cwd) => (cwd.startsWith("/home/dev/demo-project") ? "p" : null)),
    hashAccount: (r) => "acct_" + r.length.toString(16).padStart(8, "0"),
    onEvents: (e) => events.push(...e),
    recentMs: extra.recentMs,
  });
  return { events, ingest };
}
const outputSum = (evs: OfficeEvent[]) => evs.reduce((n, e) => n + (e.tokens?.output ?? 0), 0);

describe("codex ingest", () => {
  it("live file renamed to .jsonl.zst: no double count", async () => {
    copyFileSync(LIVE1, join(day, N1));
    const { events, ingest } = make();
    await ingest.start();
    expect(events).toHaveLength(9);
    expect(outputSum(events)).toBe(900);

    // Codex compresses the finished rollout in place: the .zst appears and the .jsonl goes away
    copyFileSync(ZST1, join(day, N1 + ".zst"));
    unlinkSync(join(day, N1));
    await sleep(700);
    await ingest.idle();
    ingest.close();
    expect(events).toHaveLength(9);
    expect(outputSum(events)).toBe(900);
    expect(new Set(events.map((e) => e.id)).size).toBe(9);
  });

  it("a compressed copy fills in lines the live read had not reached yet, without repeating the rest", async () => {
    const lines = readFileSync(LIVE1, "utf8").split("\n").filter(Boolean);
    writeFileSync(join(day, N1), lines.slice(0, 9).join("\n") + "\n"); // up to ordinal 8
    const { events, ingest } = make();
    await ingest.start();
    const before = events.length;
    expect(before).toBeGreaterThan(0);
    expect(before).toBeLessThan(9);

    copyFileSync(ZST1, join(day, N1 + ".zst"));
    unlinkSync(join(day, N1));
    await until(() => events.length === 9);
    await sleep(300);
    ingest.close();
    expect(events).toHaveLength(9);
    expect(new Set(events.map((e) => e.id)).size).toBe(9);
    expect(outputSum(events)).toBe(900);
  });

  it("reads a recent compressed file that was never seen live, exactly once", async () => {
    copyFileSync(ZST1, join(day, N1 + ".zst"));
    const { events, ingest } = make();
    await ingest.start();
    await sleep(300);
    ingest.close();
    expect(events).toHaveLength(9);
    expect(outputSum(events)).toBe(900);
  });

  it("a forked subagent file adds only its own tokens", async () => {
    copyFileSync(LIVE1, join(day, N1));
    copyFileSync(LIVE2, join(day, N2));
    const { events, ingest } = make();
    await ingest.start();
    ingest.close();
    const sub = events.filter((e) => e.agent.kind === "subagent");
    expect(sub).toHaveLength(3);
    expect(outputSum(sub)).toBe(300);
    expect(outputSum(events)).toBe(1200); // 900 (main) + 300 (own work), not 900 + inherited 900 + 300
  });

  it("keeps rollouts of other folders out", async () => {
    copyFileSync(LIVE1, join(day, N1));
    const { events, ingest } = make({ project: () => null });
    await ingest.start();
    ingest.close();
    expect(events).toEqual([]);
  });

  it("an old rollout of this project is caught up silently, so new lines get correct deltas", async () => {
    const file = join(day, N1);
    copyFileSync(LIVE1, file);
    const old = new Date(Date.now() - 5 * 3600 * 1000);
    utimesSync(file, old, old);
    const { events, ingest } = make({ recentMs: 3600 * 1000 });
    await ingest.start();
    expect(events).toEqual([]); // history is not replayed into the office

    const next = {
      timestamp: new Date().toISOString(),
      ordinal: 16,
      type: "event_msg",
      payload: { type: "token_count", info: { total_token_usage: { input_tokens: 3500, cached_input_tokens: 1800, cache_write_input_tokens: 100, output_tokens: 1000, reasoning_output_tokens: 320, total_tokens: 4400 } } },
      metadata: {},
    };
    appendFileSync(file, JSON.stringify(next) + "\n");
    await until(() => events.length === 1);
    ingest.close();
    expect(events[0]!.tokens).toEqual({ input: 500, output: 100, cacheRead: 0, cacheWrite: 0, reasoning: 20 });
    expect(events[0]!.model).toBe("gpt-6.1-mini");
  });

  it("an old rollout of another folder is ignored even when it grows", async () => {
    const file = join(day, N1);
    writeFileSync(file, readFileSync(LIVE1, "utf8").replaceAll("/home/dev/demo-project", "/home/dev/elsewhere"));
    const old = new Date(Date.now() - 5 * 3600 * 1000);
    utimesSync(file, old, old);
    const { events, ingest } = make({ recentMs: 3600 * 1000 });
    await ingest.start();
    appendFileSync(file, JSON.stringify({ timestamp: new Date().toISOString(), ordinal: 16, type: "event_msg", payload: { type: "task_started" }, metadata: {} }) + "\n");
    await sleep(500);
    ingest.close();
    expect(events).toEqual([]);
  });
});
