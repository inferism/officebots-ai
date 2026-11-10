import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applySetup, applyUninstall, planSetup, planUninstall, type SetupPaths } from "../../src/setup/setup.js";

let base: string;
let p: SetupPaths;
const SKILL = "---\nname: officebots\ndescription: test\n---\nbody\n";
const settings = () => join(p.claudeDir, "settings.json");
const skill = () => join(p.claudeDir, "skills", "officebots", "SKILL.md");
const listing = () => readdirSync(p.claudeDir).sort();

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "officebots-setup-"));
  mkdirSync(join(base, "claude"));
  writeFileSync(join(base, "SKILL.md"), SKILL);
  p = {
    claudeDir: join(base, "claude"),
    statePath: join(base, "cfg", "setup.json"),
    skillSource: join(base, "SKILL.md"),
    now: () => new Date("2026-11-10T12:30:45.678Z"),
  };
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

const original = JSON.stringify({ model: "m", theme: "dark", hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "x" }] }] } }, null, 2) + "\n";

function install() {
  const plan = planSetup(p);
  if (!plan.ok) throw new Error(plan.reason);
  return { plan, result: applySetup(plan, p) };
}

describe("setup", () => {
  it("planning writes nothing, and shows a diff that adds only the hook", () => {
    writeFileSync(settings(), original);
    const plan = planSetup(p);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.settingsChanged).toBe(true);
    expect(plan.skillAction).toBe("install");
    expect(plan.diff).toContain("+");
    expect(plan.diff).toContain("officebots hook claude-session-start");
    expect(plan.diff.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---"))).toEqual([]); // nothing removed
    // dry run: nothing on disk changed
    expect(readFileSync(settings(), "utf8")).toBe(original);
    expect(existsSync(skill())).toBe(false);
    expect(existsSync(p.statePath)).toBe(false);
    expect(listing()).toEqual(["settings.json"]);
  });

  it("installs the skill and hook, with a timestamped backup that is a byte-exact copy", () => {
    writeFileSync(settings(), original);
    const { result } = install();
    expect(result.backupPath).toMatch(/settings\.json\.officebots-backup-20261110T123045Z$/);
    expect(readFileSync(result.backupPath!)).toEqual(Buffer.from(original));
    expect(readFileSync(skill(), "utf8")).toBe(SKILL);
    expect(JSON.parse(readFileSync(settings(), "utf8")).hooks.SessionStart).toHaveLength(1);
    expect(JSON.parse(readFileSync(settings(), "utf8")).hooks.PreToolUse).toBeDefined();
  });

  it("is idempotent", () => {
    writeFileSync(settings(), original);
    install();
    const again = planSetup(p);
    expect(again.ok && again.settingsChanged).toBe(false);
    expect(again.ok && again.skillAction).toBe("same");
  });

  it("works when settings.json does not exist yet", () => {
    const { plan, result } = install();
    expect(plan.ok && plan.diff).toContain("--- /dev/null");
    expect(result.backupPath).toBeNull();
    expect(existsSync(settings())).toBe(true);
  });

  it("leaves a settings file it cannot edit alone", () => {
    writeFileSync(settings(), "{ // comment\n}");
    const plan = planSetup(p);
    expect(plan.ok).toBe(false);
    expect(readFileSync(settings(), "utf8")).toBe("{ // comment\n}");
  });
});

describe("uninstall", () => {
  it("restores settings.json byte-for-byte and removes the skill", () => {
    writeFileSync(settings(), original);
    const { result } = install();
    const plan = planUninstall(p);
    expect(plan.settings).toBe("restore-backup");
    expect(plan.skill).toBe("remove");
    applyUninstall(plan, p);
    expect(readFileSync(settings())).toEqual(readFileSync(result.backupPath!)); // identical to the backup
    expect(readFileSync(settings(), "utf8")).toBe(original);
    expect(existsSync(join(p.claudeDir, "skills", "officebots"))).toBe(false);
    expect(existsSync(p.statePath)).toBe(false);
    expect(listing()).toContain("settings.json");
  });

  it("deletes a settings file that setup itself created", () => {
    install();
    const plan = planUninstall(p);
    expect(plan.settings).toBe("delete-file");
    applyUninstall(plan, p);
    expect(existsSync(settings())).toBe(false);
  });

  it("when the user changed settings.json afterwards, removes only the hook and keeps their edits", () => {
    writeFileSync(settings(), original);
    install();
    const edited = JSON.parse(readFileSync(settings(), "utf8"));
    edited.theme = "light";
    edited.newSetting = true;
    writeFileSync(settings(), JSON.stringify(edited, null, 2) + "\n");

    const plan = planUninstall(p);
    expect(plan.settings).toBe("remove-hook");
    expect(plan.notes.join(" ")).toMatch(/changed after setup/);
    applyUninstall(plan, p);
    const after = JSON.parse(readFileSync(settings(), "utf8"));
    expect(after).toEqual({ model: "m", theme: "light", hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "x" }] }] }, newSetting: true });
  });

  it("leaves a skill the user edited", () => {
    install();
    writeFileSync(skill(), SKILL + "my edits\n");
    const plan = planUninstall(p);
    expect(plan.skill).toBe("leave-modified");
    applyUninstall(plan, p);
    expect(readFileSync(skill(), "utf8")).toContain("my edits");
  });

  it("does nothing when nothing was installed", () => {
    writeFileSync(settings(), original);
    const plan = planUninstall(p);
    expect(plan.settings).toBe("none");
    expect(plan.skill).toBe("none");
    expect(readFileSync(settings(), "utf8")).toBe(original);
  });

  it("removes the hook even if the state record was lost", () => {
    writeFileSync(settings(), original);
    install();
    rmSync(p.statePath);
    const plan = planUninstall(p);
    expect(plan.settings).toBe("remove-hook");
    expect(plan.skill).toBe("remove"); // the skill matches the packaged one
    applyUninstall(plan, p);
    expect(JSON.parse(readFileSync(settings(), "utf8")).hooks.SessionStart).toBeUndefined();
  });
});
