import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zstdCompressSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

const script = join(import.meta.dirname, "..", "..", "scripts", "check-fixtures.mjs");
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

// Always runs against a temp dir, never the real fixtures.
function run(content: string) {
  const d = mkdtempSync(join(tmpdir(), "officebots-fx-"));
  dirs.push(d);
  mkdirSync(join(d, "sub"));
  writeFileSync(join(d, "sub", "x.jsonl"), content);
  return spawnSync(process.execPath, [script, d], { encoding: "utf8" });
}

describe("check-fixtures", () => {
  it("passes on clean content", () => {
    const r = run('{"cwd":"/home/dev/demo-project","text":"<redacted>"}\n');
    expect(r.status).toBe(0);
  });

  it("fails on a planted email, reporting file:line without echoing it", () => {
    const r = run('{"a":1}\n{"userEmail":"someone@example.com"}\n');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/x\.jsonl:2: email address/);
    expect(r.stderr).not.toContain("someone@example.com");
  });

  it("looks inside compressed fixtures", () => {
    const d = mkdtempSync(join(tmpdir(), "officebots-fx-"));
    dirs.push(d);
    writeFileSync(join(d, "x.jsonl.zst"), zstdCompressSync(Buffer.from('{"userEmail":"someone@example.com"}\n')));
    const r = spawnSync(process.execPath, [script, d], { encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/x\.jsonl\.zst:1: email address/);
    writeFileSync(join(d, "x.jsonl.zst"), Buffer.from("not zstd"));
    expect(spawnSync(process.execPath, [script, d], { encoding: "utf8" }).stderr).toContain("undecodable");
  });

  it.each([
    ["Windows home path", '{"p":"C:\\\\Users\\\\bob\\\\proj"}'],
    ["macOS home path", '{"p":"/Users/bob/proj"}'],
    ["Linux home path", '{"p":"/home/bob/proj"}'],
    ["API key", '{"k":"sk-abcdefghijklmnopqrstuvwx"}'],
    ["long token", '{"k":"' + "a1B2".repeat(12) + '"}'],
    ["UUID", '{"id":"123e4567-e89b-42d3-a456-426614174000"}'],
  ])("fails on %s", (rule, line) => {
    const r = run(line + "\n");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(rule.split(" ")[0]);
  });
});
