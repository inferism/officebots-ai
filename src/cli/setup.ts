import { createHash } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { personalConfigPath } from "../core/identity.js";
import { normalizePath } from "../core/project.js";
import { HOOK_COMMAND } from "../setup/settings-edit.js";
import { applySetup, applyUninstall, planSetup, planUninstall, StalePlanError, type SetupPaths } from "../setup/setup.js";

function paths(args: string[]): SetupPaths {
  const i = args.indexOf("--config-dir");
  const claudeDir = i >= 0 && args[i + 1] ? args[i + 1]! : process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  return {
    claudeDir,
    // one record per Claude config folder, so a second folder (or a test folder) never touches the real one
    statePath: join(dirname(personalConfigPath()), `setup-${createHash("sha256").update(normalizePath(claudeDir)).digest("hex").slice(0, 8)}.json`),
    skillSource: fileURLToPath(new URL("../skill/officebots/SKILL.md", import.meta.url)),
  };
}

async function confirm(question: string, yes: boolean): Promise<boolean> {
  if (yes) return true;
  if (!process.stdin.isTTY) {
    console.error("officebots: not running in a terminal, so I cannot ask. Re-run with --yes to approve, or --dry-run to only look.");
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim());
  } finally {
    rl.close();
  }
}

/**
 * Installs the /officebots skill and registers the SessionStart hook. Shows exactly what would change,
 * writes a timestamped backup, and only writes after a "y". With --dry-run it never writes.
 */
export async function setup(args: string[]): Promise<void> {
  const p = paths(args);
  const plan = planSetup(p);
  if (!plan.ok) {
    console.error(`officebots setup: ${plan.reason}`);
    process.exit(1);
  }
  const skillText = { install: "install the /officebots skill", update: "update the /officebots skill (the installed copy differs)", same: "the /officebots skill is already installed" }[plan.skillAction];
  console.log(`1. ${skillText}\n   ${plan.skillDest}`);
  console.log(plan.settingsChanged ? `2. register the SessionStart hook in ${plan.settingsPath}:\n` : `2. the SessionStart hook is already registered in ${plan.settingsPath}`);
  if (plan.settingsChanged) console.log(plan.diff);
  if (!plan.settingsChanged && plan.skillAction === "same") {
    console.log("\nNothing to do.");
    return;
  }
  console.log(`The hook runs \`${HOOK_COMMAND}\`. It does nothing in projects without .officebots/office.json.`);
  if (args.includes("--dry-run")) {
    console.log("\n(dry run: nothing was written)");
    return;
  }
  if (plan.settingsChanged && plan.before !== undefined) console.log("A timestamped backup of settings.json will be written next to it.");
  if (!(await confirm("\nApply these changes?", args.includes("--yes")))) {
    console.log("No changes made.");
    process.exitCode = 1;
    return;
  }
  let backupPath: string | null;
  try {
    ({ backupPath } = applySetup(plan, p));
  } catch (e) {
    if (!(e instanceof StalePlanError)) throw e;
    console.error(`officebots setup: ${e.message}`);
    process.exit(1);
  }
  if (backupPath) console.log(`backup: ${backupPath}`);
  console.log("done. Restart Claude Code sessions to pick up the hook. Run `officebots uninstall` to undo.");
}

export async function uninstall(args: string[]): Promise<void> {
  const p = paths(args);
  const plan = planUninstall(p);
  for (const n of plan.notes) console.log(`note: ${n}`);
  const what = {
    none: "settings.json: nothing to change",
    "restore-backup": `settings.json: restore the backup taken at setup (${plan.settingsPath})`,
    "delete-file": `settings.json: delete it (setup created it) (${plan.settingsPath})`,
    "remove-hook": `settings.json: remove the officebots hook (${plan.settingsPath})`,
  }[plan.settings];
  console.log(`1. ${what}`);
  if (plan.diff) console.log(plan.diff);
  console.log(`2. skill: ${{ remove: `remove ${plan.skillFile}`, "leave-modified": "leave it (not ours)", none: "nothing installed" }[plan.skill]}`);
  if (plan.settings === "none" && plan.skill !== "remove") {
    console.log("\nNothing to do.");
    return;
  }
  if (args.includes("--dry-run")) {
    console.log("\n(dry run: nothing was changed)");
    return;
  }
  if (!(await confirm("\nApply these changes?", args.includes("--yes")))) {
    console.log("No changes made.");
    process.exitCode = 1;
    return;
  }
  try {
    applyUninstall(plan, p);
  } catch (e) {
    if (!(e instanceof StalePlanError)) throw e;
    console.error(`officebots uninstall: ${e.message}`);
    process.exit(1);
  }
  console.log("done.");
}
