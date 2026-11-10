// Starting an office in the background, and opening it, for the hook, `officebots open` and the /officebots skill.
import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { projectConfigPath } from "../core/config.js";
import { personalConfigPath } from "../core/identity.js";
import { projectKey } from "../core/project.js";
import { ensureGitignore } from "./launcher.js";
import { findOfficePort } from "./loopback.js";

const stateDir = (root: string) => join(root, ".officebots", ".state");
const LOCK_FRESH_MS = 15_000;

/** The folder marker: .officebots/office.json plus a .gitignore for the runtime files. Never overwrites. */
export function ensureProjectFiles(root: string): { created: boolean } {
  const dir = join(root, ".officebots");
  mkdirSync(join(dir, ".state"), { recursive: true });
  ensureGitignore(root);
  const cfg = projectConfigPath(root);
  if (existsSync(cfg)) return { created: false };
  writeFileSync(cfg, JSON.stringify({ roles: {}, rules: [] }, null, 2) + "\n");
  return { created: true };
}

/** Only one process at a time should start an office; the lock expires on its own after a few seconds. */
export function acquireStartLock(root: string): boolean {
  const lock = join(stateDir(root), "start.lock");
  mkdirSync(stateDir(root), { recursive: true });
  try {
    writeFileSync(lock, String(process.pid), { flag: "wx" });
    return true;
  } catch {
    try {
      if (Date.now() - statSync(lock).mtimeMs < LOCK_FRESH_MS) return false;
      writeFileSync(lock, String(process.pid)); // stale: take it over
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Where a background office writes its log. Next to the personal config, not inside the project:
 * an open file in .officebots would stop Windows from deleting that folder while the office runs.
 */
export function officeLogPath(root: string, personalPath = personalConfigPath()): string {
  return join(dirname(personalPath), "logs", `${projectKey(root)}.log`);
}

/**
 * How to run an office in the background. It runs from the temp folder, not the project: a process's
 * working directory counts as "in use" on Windows and would stop the project folder being renamed or deleted.
 */
export function officeLaunchSpec(root: string, cliPath: string): { args: string[]; cwd: string } {
  return { args: [cliPath, "start", "--project", root], cwd: tmpdir() };
}

/** Runs `officebots start` for this project detached, with output going to the office log. */
export function launchOffice(root: string, cliPath: string): void {
  const logFile = officeLogPath(root);
  mkdirSync(dirname(logFile), { recursive: true });
  const log = openSync(logFile, "w");
  try {
    const spec = officeLaunchSpec(root, cliPath);
    const child = spawn(process.execPath, spec.args, {
      cwd: spec.cwd,
      detached: true,
      stdio: ["ignore", log, log],
      windowsHide: true,
    });
    child.on("error", () => {});
    child.unref();
  } finally {
    closeSync(log);
  }
}

/** Port of the project's office, starting one in the background if needed. Waits up to waitMs. */
export async function ensureOffice(root: string, o: { cliPath: string; waitMs: number }): Promise<number | null> {
  let port = await findOfficePort(root);
  if (port !== null) return port;
  if (acquireStartLock(root)) launchOffice(root, o.cliPath);
  const end = Date.now() + o.waitMs;
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, 150));
    port = await findOfficePort(root);
    if (port !== null) return port;
  }
  return null;
}

/** Opens a URL or a local file in the default browser. */
export function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === "win32" ? ["cmd", ["/c", "start", '""', url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // no browser available: the URL is printed anyway
  }
}
