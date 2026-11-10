import { describe, expect, it } from "vitest";
import { unifiedDiff } from "../../src/core/diff.js";
import { addHook, HOOK_COMMAND, removeHook } from "../../src/setup/settings-edit.js";

const ok = (r: ReturnType<typeof addHook>) => {
  if (!r.ok) throw new Error(r.reason);
  return r;
};

describe("addHook", () => {
  it("creates a settings file from nothing", () => {
    const r = ok(addHook(undefined));
    expect(r.changed).toBe(true);
    expect(JSON.parse(r.text)).toEqual({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: HOOK_COMMAND, timeout: 5 }] }] } });
    expect(r.text.endsWith("\n")).toBe(true);
  });

  it("keeps every other setting, key order, indent and trailing newline", () => {
    const before = JSON.stringify({ model: "m", theme: "dark", permissions: { allow: ["Bash(ls)"] } }, null, 4) + "\n";
    const r = ok(addHook(before));
    const after = JSON.parse(r.text);
    expect(after.model).toBe("m");
    expect(after.permissions).toEqual({ allow: ["Bash(ls)"] });
    expect(Object.keys(after)).toEqual(["model", "theme", "permissions", "hooks"]);
    expect(r.text).toMatch(/^\{\n {4}"model"/); // 4-space indent kept
    expect(r.text.endsWith("}\n")).toBe(true);
  });

  it("keeps CRLF line endings and no trailing newline when that is the file's style", () => {
    const before = '{\r\n  "theme": "dark"\r\n}';
    const r = ok(addHook(before));
    expect(r.text).toContain("\r\n");
    expect(r.text.replace(/\r\n/g, "").includes("\n")).toBe(false);
    expect(r.text.endsWith("}")).toBe(true);
  });

  it("adds next to the user's own hooks without touching them", () => {
    const mine = { SessionStart: [{ matcher: "startup", hooks: [{ type: "command", command: "echo hi" }] }], PreToolUse: [{ hooks: [{ type: "command", command: "x" }] }] };
    const r = ok(addHook(JSON.stringify({ hooks: mine }, null, 2) + "\n"));
    const after = JSON.parse(r.text);
    expect(after.hooks.PreToolUse).toEqual(mine.PreToolUse);
    expect(after.hooks.SessionStart[0]).toEqual(mine.SessionStart[0]);
    expect(after.hooks.SessionStart).toHaveLength(2);
  });

  it("is idempotent: an existing officebots hook means no change", () => {
    const once = ok(addHook(undefined)).text;
    const twice = ok(addHook(once));
    expect(twice.changed).toBe(false);
    expect(twice.text).toBe(once);
  });

  it("refuses files it cannot safely edit", () => {
    expect(addHook("{ // comment\n}").ok).toBe(false);
    expect(addHook("[1,2]").ok).toBe(false);
    expect(addHook(JSON.stringify({ hooks: [] })).ok).toBe(false);
    expect(addHook(JSON.stringify({ hooks: { SessionStart: {} } })).ok).toBe(false);
  });
});

describe("removeHook", () => {
  it("removes only our entry and cleans up containers it leaves empty", () => {
    const added = ok(addHook(JSON.stringify({ theme: "dark" }, null, 2) + "\n")).text;
    const r = ok(removeHook(added));
    expect(r.changed).toBe(true);
    expect(JSON.parse(r.text)).toEqual({ theme: "dark" });
  });

  it("leaves the user's own hooks, even when they share an entry with ours", () => {
    const text = JSON.stringify({
      hooks: { SessionStart: [{ hooks: [{ type: "command", command: "echo hi" }, { type: "command", command: HOOK_COMMAND, timeout: 5 }] }, { hooks: [{ type: "command", command: "other" }] }] },
    }, null, 2);
    const after = JSON.parse(ok(removeHook(text)).text);
    expect(after.hooks.SessionStart).toEqual([{ hooks: [{ type: "command", command: "echo hi" }] }, { hooks: [{ type: "command", command: "other" }] }]);
  });

  it("reports no change when our hook is absent", () => {
    const text = JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "echo hi" }] }] } });
    const r = ok(removeHook(text));
    expect(r.changed).toBe(false);
    expect(r.text).toBe(text);
    expect(ok(removeHook("{}")).changed).toBe(false);
  });
});

describe("unifiedDiff", () => {
  it("is empty for identical text", () => {
    expect(unifiedDiff("a\nb\n", "a\nb\n", "x", "y")).toBe("");
  });

  it("shows an insertion with context and correct hunk numbers", () => {
    const before = ["{", '  "a": 1,', '  "b": 2', "}", ""].join("\n");
    const after = ["{", '  "a": 1,', '  "b": 2,', '  "c": 3', "}", ""].join("\n");
    expect(unifiedDiff(before, after, "old", "new")).toBe(
      ["--- old", "+++ new", "@@ -1,4 +1,5 @@", " {", '   "a": 1,', '-  "b": 2', '+  "b": 2,', '+  "c": 3', " }", ""].join("\n"),
    );
  });

  it("diffs against nothing for a new file", () => {
    expect(unifiedDiff("", "x\ny\n", "/dev/null", "new")).toBe(["--- /dev/null", "+++ new", "@@ -0,0 +1,2 @@", "+x", "+y", ""].join("\n"));
  });

  it("splits far-apart changes into separate hunks", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line${i}`);
    const changed = [...lines];
    changed[2] = "CHANGED2";
    changed[27] = "CHANGED27";
    const d = unifiedDiff(lines.join("\n") + "\n", changed.join("\n") + "\n", "a", "b");
    expect(d.match(/^@@/gm)).toHaveLength(2);
    expect(d).toContain("-line2");
    expect(d).toContain("+CHANGED27");
  });
});
