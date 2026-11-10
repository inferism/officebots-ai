import { describe, expect, it } from "vitest";
import { accentFor, colorFor, DEFAULT_COLOR } from "../../src/core/colors.js";

describe("colors", () => {
  it("colors known model families", () => {
    expect(colorFor("claude-opus-5-5")).toBe("#966edc");
    expect(colorFor("claude-sonnet-5-5")).toBe("#d97757");
    expect(colorFor("claude-haiku-5-5")).toBe("#e6be46");
    expect(colorFor("gpt-6.1-sol")).toBe("#10a37f");
    expect(colorFor("gemini-pro")).toBe("#508ceb");
  });

  it("gives an unknown model the default color", () => {
    expect(colorFor("foo-model-9")).toBe(DEFAULT_COLOR);
    expect(colorFor("")).toBe(DEFAULT_COLOR);
  });

  it("accent is the base color without an account, and a stable distinct hex with one", () => {
    expect(accentFor(null, "#123456")).toBe("#123456");
    const a = accentFor("acct_aaaaaaaa", "#123456");
    expect(a).toMatch(/^#[0-9a-f]{6}$/);
    expect(accentFor("acct_aaaaaaaa", "#123456")).toBe(a);
    expect(accentFor("acct_bbbbbbbb", "#123456")).not.toBe(a);
  });
});
