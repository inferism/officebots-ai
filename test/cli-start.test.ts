import { describe, expect, it } from "vitest";
import { parseSince } from "../src/cli/start.js";

const usage = (): never => {
  throw new Error("usage");
};

describe("start --since", () => {
  it("is off by default and converts hours to milliseconds", () => {
    expect(parseSince([], usage)).toBeUndefined();
    expect(parseSince(["--since", "6"], usage)).toBe(6 * 3600 * 1000);
    expect(parseSince(["--claude-dir", "x", "--since", "0.5"], usage)).toBe(1800 * 1000);
  });
  it("rejects nonsense", () => {
    for (const bad of [["--since"], ["--since", "abc"], ["--since", "-1"], ["--since", "0"], ["--since", "100000"]]) {
      expect(() => parseSince(bad, usage)).toThrow("usage");
    }
  });
});
