import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = join(import.meta.dirname, "..", "fixtures", "claude-code");

function* walk(d: string): Generator<string> {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

const rel = (f: string) => f.slice(dir.length + 1).replaceAll("\\", "/");
const files = [...walk(dir)];
const jsonl = files.filter((f) => f.endsWith(".jsonl")).map((f) => [rel(f), f] as const);

describe("claude-code fixtures", () => {
  it("has the expected scenarios", () => {
    expect(files.map(rel)).toEqual(
      expect.arrayContaining([
        "session-basic.jsonl",
        "session-model-switch.jsonl",
        "session-cwd-change.jsonl",
        "session-unknown-types.jsonl",
        "session-torn.jsonl",
        "sess-0001/subagents/agent-0001.jsonl",
        "sess-0001/subagents/agent-0001.meta.json",
      ]),
    );
  });

  it.each(jsonl)("%s parses as JSONL (torn last line excepted)", (name, file) => {
    const raw = readFileSync(file, "utf8");
    const lines = raw.split("\n");
    const endsClean = raw.endsWith("\n");
    if (endsClean) lines.pop();
    const torn = name === "session-torn.jsonl";
    expect(endsClean).toBe(!torn);
    lines.forEach((line, i) => {
      if (torn && i === lines.length - 1) expect(() => JSON.parse(line)).toThrow();
      else expect(() => JSON.parse(line), `${name}:${i + 1}`).not.toThrow();
    });
  });

  it("meta file is valid JSON", () => {
    const meta = JSON.parse(readFileSync(join(dir, "sess-0001/subagents/agent-0001.meta.json"), "utf8"));
    expect(meta.agentType).toBe("general-purpose");
  });

  it("basic session repeats one message.id across blocks", () => {
    const recs = readFileSync(join(dir, "session-basic.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const ids = recs.filter((r) => r.type === "assistant").map((r) => r.message.id);
    expect(ids.filter((i) => i === "msg_test_01")).toHaveLength(3);
    expect(new Set(ids).size).toBe(2);
  });
});
