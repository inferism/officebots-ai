// `officebots setup` / `officebots uninstall`. Everything takes explicit paths so tests never touch a real
// ~/.claude. Nothing is written until apply* is called, and apply* is only called after the user agrees.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { unifiedDiff } from "../core/diff.js";
import { addHook, removeHook } from "./settings-edit.js";

export type SetupPaths = {
  /** The Claude Code config folder (~/.claude, or $CLAUDE_CONFIG_DIR). */
  claudeDir: string;
  /** Where setup records what it did, so uninstall can undo exactly that. */
  statePath: string;
  /** The skill file shipped in the package. */
  skillSource: string;
  now?: () => Date;
};

type State = {
  version: 1;
  settingsPath: string;
  backupPath: string | null;
  createdFile: boolean;
  /** Hash of settings.json as setup left it; if it still matches at uninstall, the backup can be restored as is. */
  afterHash: string | null;
  skill: { file: string; hash: string } | null;
  at: string;
};

const sha = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const settingsFile = (p: SetupPaths) => join(p.claudeDir, "settings.json");
const skillFile = (p: SetupPaths) => join(p.claudeDir, "skills", "officebots", "SKILL.md");

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

function atomicWrite(path: string, data: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

function readState(p: SetupPaths): State | undefined {
  try {
    const s = JSON.parse(readFileSync(p.statePath, "utf8"));
    return s?.version === 1 && typeof s.settingsPath === "string" ? (s as State) : undefined;
  } catch {
    return undefined;
  }
}

// ---------- setup ----------

export type SetupPlan =
  | { ok: false; reason: string }
  | {
      ok: true;
      settingsPath: string;
      before: string | undefined;
      after: string;
      settingsChanged: boolean;
      diff: string;
      skillDest: string;
      skillAction: "install" | "update" | "same";
      skillContent: string;
    };

export function planSetup(p: SetupPaths): SetupPlan {
  const settingsPath = settingsFile(p);
  const before = readText(settingsPath);
  const edit = addHook(before);
  if (!edit.ok) return { ok: false, reason: edit.reason };

  let skillContent: string;
  try {
    skillContent = readFileSync(p.skillSource, "utf8");
  } catch {
    return { ok: false, reason: "the skill file is missing from this installation" };
  }
  const existing = readText(skillFile(p));
  return {
    ok: true,
    settingsPath,
    before,
    after: edit.text,
    settingsChanged: edit.changed,
    diff: unifiedDiff(before ?? "", edit.text, before === undefined ? "/dev/null" : settingsPath, settingsPath),
    skillDest: skillFile(p),
    skillAction: existing === undefined ? "install" : existing === skillContent ? "same" : "update",
    skillContent,
  };
}

/** Writes the backup, the new settings, the skill, and the state file. Returns the backup path, if any. */
export function applySetup(plan: Extract<SetupPlan, { ok: true }>, p: SetupPaths): { backupPath: string | null } {
  const prev = readState(p);
  const state: State = prev ?? { version: 1, settingsPath: plan.settingsPath, backupPath: null, createdFile: false, afterHash: null, skill: null, at: "" };
  const stamp = (p.now?.() ?? new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");

  if (plan.settingsChanged) {
    let backupPath: string | null = null;
    if (plan.before !== undefined) {
      backupPath = `${plan.settingsPath}.officebots-backup-${stamp}`;
      copyFileSync(plan.settingsPath, backupPath);
    }
    atomicWrite(plan.settingsPath, plan.after);
    state.settingsPath = plan.settingsPath;
    state.backupPath = backupPath;
    state.createdFile = plan.before === undefined;
    state.afterHash = sha(plan.after);
  }
  if (plan.skillAction !== "same") {
    atomicWrite(plan.skillDest, plan.skillContent);
    state.skill = { file: plan.skillDest, hash: sha(plan.skillContent) };
  }
  state.at = (p.now?.() ?? new Date()).toISOString();
  if (plan.settingsChanged || plan.skillAction !== "same") atomicWrite(p.statePath, JSON.stringify(state, null, 2) + "\n");
  return { backupPath: state.backupPath && plan.settingsChanged ? state.backupPath : null };
}

// ---------- uninstall ----------

export type UninstallPlan = {
  settingsPath: string;
  /** What happens to settings.json. */
  settings: "none" | "restore-backup" | "delete-file" | "remove-hook";
  after: string | undefined;
  backupBytes?: Buffer;
  diff: string;
  skill: "remove" | "leave-modified" | "none";
  skillFile: string;
  notes: string[];
};

export function planUninstall(p: SetupPaths): UninstallPlan {
  const state = readState(p);
  const settingsPath = state?.settingsPath ?? settingsFile(p);
  const current = readText(settingsPath);
  const notes: string[] = [];
  let settings: UninstallPlan["settings"] = "none";
  let after: string | undefined = current;
  let backupBytes: Buffer | undefined;

  if (current !== undefined) {
    const untouched = state?.afterHash !== null && state?.afterHash !== undefined && sha(current) === state.afterHash;
    if (untouched && state!.createdFile) {
      settings = "delete-file";
      after = undefined;
    } else if (untouched && state!.backupPath && existsSync(state!.backupPath)) {
      settings = "restore-backup";
      backupBytes = readFileSync(state!.backupPath);
      after = backupBytes.toString("utf8");
    } else {
      const edit = removeHook(current);
      if (!edit.ok) notes.push(`could not edit settings.json: ${edit.reason}`);
      else if (edit.changed) {
        settings = "remove-hook";
        after = edit.text;
        if (state?.afterHash) notes.push("settings.json was changed after setup, so only the officebots hook is removed (the backup is not restored)");
      }
    }
  }

  const skillPath = state?.skill?.file ?? skillFile(p);
  const skillText = readText(skillPath);
  let skill: UninstallPlan["skill"] = "none";
  if (skillText !== undefined) {
    let shipped: string | undefined;
    try {
      shipped = readFileSync(p.skillSource, "utf8");
    } catch {
      // package copy unavailable: fall back to the recorded hash
    }
    const ours = state?.skill ? sha(skillText) === state.skill.hash : shipped !== undefined && skillText === shipped;
    skill = ours ? "remove" : "leave-modified";
    if (!ours) notes.push(`${skillPath} was edited or is not ours, so it was left in place`);
  }

  const diff = settings === "none" || current === undefined ? "" : unifiedDiff(current, after ?? "", settingsPath, after === undefined ? "/dev/null" : settingsPath);
  return { settingsPath, settings, after, backupBytes, diff, skill, skillFile: skillPath, notes };
}

export function applyUninstall(plan: UninstallPlan, p: SetupPaths): void {
  if (plan.settings === "delete-file") rmSync(plan.settingsPath, { force: true });
  else if (plan.settings === "restore-backup" && plan.backupBytes) atomicWrite(plan.settingsPath, plan.backupBytes);
  else if (plan.settings === "remove-hook" && plan.after !== undefined) atomicWrite(plan.settingsPath, plan.after);

  if (plan.skill === "remove") {
    rmSync(plan.skillFile, { force: true });
    try {
      rmdirSync(dirname(plan.skillFile)); // only succeeds if the folder is now empty
    } catch {
      // not empty: leave it
    }
  }
  rmSync(p.statePath, { force: true });
}
