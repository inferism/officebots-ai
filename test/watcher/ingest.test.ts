import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createIngest } from "../../src/watcher/ingest.js";
import { appendLines, assistantLine } from "../helpers/fake-writer.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "officebots-ingest-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 20_000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timeout");
    await sleep(25);
  }
}

describe("ingest (real fs.watch)", () => {
  it("stress: 10k lines in bursts across 50 files, some torn, zero missed or duplicated", async () => {
    const counts = new Map<string, number>();
    const ingest = createIngest({
      root,
      project: () => "p",
      onEvents: (evs) => evs.forEach((e) => counts.set(e.id, (counts.get(e.id) ?? 0) + 1)),
    });
    await ingest.start();

    const FILES = 50;
    const PER_FILE = 200;
    for (let burst = 0; burst < 10; burst++) {
      for (let f = 0; f < FILES; f++) {
        const file = join(root, `-proj-${f % 5}`, `sess-${f}.jsonl`);
        const lines: string[] = [];
        for (let i = 0; i < PER_FILE / 10; i++) {
          lines.push(assistantLine({ session: `sess-${f}`, msgId: `msg_${f}_${burst}_${i}`, cwd: "/home/dev/demo-project" }));
        }
        if ((f + burst) % 7 === 0) {
          // write the last line in two pieces to exercise the torn-line buffer
          const last = lines.pop()! + "\n";
          appendLines(file, lines);
          appendFileSync(file, last.slice(0, 40));
          await sleep(5);
          appendFileSync(file, last.slice(40));
        } else {
          appendLines(file, lines);
        }
      }
      await sleep(20);
    }

    await until(() => counts.size === FILES * PER_FILE);
    await sleep(500); // give any duplicate delivery time to show up
    await ingest.idle();
    ingest.close();

    expect(counts.size).toBe(10_000);
    expect([...counts.values()].filter((n) => n !== 1)).toEqual([]);
    expect(ingest.stats.errors).toBe(0);
  }, 60_000);

  it("reads recent files from the start, skips old ones, and still follows old ones when they grow", async () => {
    const now = Date.now();
    const recent = join(root, "-p", "recent.jsonl");
    const old = join(root, "-p", "old.jsonl");
    appendLines(recent, [assistantLine({ session: "r", msgId: "m_recent_1", cwd: "/x" })]);
    appendLines(old, [assistantLine({ session: "o", msgId: "m_old_1", cwd: "/x" })]);
    const ids: string[] = [];
    const ingest = createIngest({
      root,
      project: () => "p",
      onEvents: (evs) => ids.push(...evs.map((e) => e.id)),
      recentMs: 1000,
      // pretend it is 5 minutes later, so both files look old... then touch `recent` again below
      now: () => now + 0,
    });
    // make `old` look old by backdating its mtime
    const { utimesSync } = await import("node:fs");
    utimesSync(old, new Date(now - 3_600_000), new Date(now - 3_600_000));
    await ingest.start();
    expect(ids).toEqual(["claude-code:r:m_recent_1"]);

    appendLines(old, [assistantLine({ session: "o", msgId: "m_old_2", cwd: "/x" })]);
    await until(() => ids.includes("claude-code:o:m_old_2"));
    expect(ids).not.toContain("claude-code:o:m_old_1");
    ingest.close();
  });

  it("drops records outside the project and reports problems without content", async () => {
    const problems: string[] = [];
    const ids: string[] = [];
    const file = join(root, "-p", "s.jsonl");
    mkdirSync(join(root, "-p"));
    appendFileSync(file, assistantLine({ session: "s", msgId: "in", cwd: "/in/x" }) + "\n");
    appendFileSync(file, assistantLine({ session: "s", msgId: "out", cwd: "/out/x" }) + "\n");
    appendFileSync(file, '{"broken": "SECRET-TEXT\n');
    const ingest = createIngest({
      root,
      project: (cwd) => (cwd.startsWith("/in") ? "p" : null),
      onEvents: (evs) => ids.push(...evs.map((e) => e.id)),
      onProblem: (m) => problems.push(m),
    });
    await ingest.start();
    ingest.close();
    expect(ids).toEqual(["claude-code:s:in"]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/s\.jsonl#3: json$/);
    expect(problems[0]).not.toContain("SECRET");
  });
});
