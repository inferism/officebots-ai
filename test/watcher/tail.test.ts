import { appendFileSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Tailer } from "../../src/watcher/tail.js";

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "officebots-tail-"));
  file = join(dir, "a.jsonl");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function all(t: Tailer) {
  const out: { lines: string[]; firstLine: number }[] = [];
  for await (const b of t.read(file)) out.push(b);
  return out;
}

describe("Tailer", () => {
  it("returns only complete lines and keeps a torn one until finished", async () => {
    const t = new Tailer();
    writeFileSync(file, "one\ntwo\nthr");
    expect(await all(t)).toEqual([{ lines: ["one", "two"], firstLine: 1 }]);
    appendFileSync(file, "ee\nfour\n");
    expect(await all(t)).toEqual([{ lines: ["three", "four"], firstLine: 3 }]);
    expect(await all(t)).toEqual([]);
  });

  it("does not split a multi-byte character across reads", async () => {
    const t = new Tailer();
    const bytes = Buffer.from("héllo\n");
    writeFileSync(file, bytes.subarray(0, 2)); // cuts é in half
    expect(await all(t)).toEqual([]);
    appendFileSync(file, bytes.subarray(2));
    expect((await all(t))[0]!.lines).toEqual(["héllo"]);
  });

  it("strips CR from CRLF lines", async () => {
    const t = new Tailer();
    writeFileSync(file, "a\r\nb\r\n");
    expect((await all(t))[0]!.lines).toEqual(["a", "b"]);
  });

  it("starts over when the file is truncated", async () => {
    const t = new Tailer();
    writeFileSync(file, "aaaa\nbbbb\n");
    await all(t);
    truncateSync(file, 0);
    appendFileSync(file, "c\n");
    expect(await all(t)).toEqual([{ lines: ["c"], firstLine: 1 }]);
  });

  it("skipToEnd ignores existing content", async () => {
    const t = new Tailer();
    writeFileSync(file, "old\n");
    t.skipToEnd(file, 4);
    appendFileSync(file, "new\n");
    expect((await all(t))[0]!.lines).toEqual(["new"]);
  });
});
