// Claude Code SessionStart hook. It must be fast, silent and harmless:
//  - stdout is added to Claude's context for SessionStart hooks, so it prints nothing, ever;
//  - it never throws and always exits 0, so it can never fail or delay a session;
//  - it does nothing in projects that have no .officebots/office.json.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readLoginAccount } from "../adapters/claude-code/account.js";
import { projectConfigPath } from "../core/config.js";
import { createAccountHasher } from "../core/identity.js";
import { findProjectRoot } from "../core/project.js";
import { acquireStartLock, launchOffice } from "../server/launch.js";
import { findOfficePort } from "../server/loopback.js";

export type HookDeps = {
  /** What Claude Code sent on stdin (JSON with session_id and cwd). */
  stdin: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  home?: string;
  /** Path of the officebots CLI to launch for a background start. */
  cliPath: string;
  hash?: (raw: string) => string;
  /** Overridable for tests. */
  launch?: (root: string, cliPath: string) => void;
};

export type HookOutcome = "skipped" | "running" | "started" | "waiting-for-other-start";

const MAX_SESSIONS = 500;

/** Remember which account a session started under, so the office can tell accounts apart. */
function recordSessionAccount(root: string, sessionId: string, d: HookDeps): void {
  const home = d.home ?? homedir();
  const configDir = d.env.CLAUDE_CONFIG_DIR || join(home, ".claude");
  const raw = readLoginAccount(configDir, home);
  if (!raw) return;
  const id = (d.hash ?? createAccountHasher())(raw);
  const dir = join(root, ".officebots", ".state");
  const file = join(dir, "sessions.json");
  let map: Record<string, string> = {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) map = parsed;
  } catch {
    // no file yet
  }
  delete map[sessionId];
  map[sessionId] = id; // newest last
  const keys = Object.keys(map);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_SESSIONS))) delete map[k];
  mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(map));
  renameSync(tmp, file);
}

export async function runHook(d: HookDeps): Promise<HookOutcome> {
  try {
    let input: { session_id?: unknown; cwd?: unknown } = {};
    try {
      const parsed = JSON.parse(d.stdin);
      if (typeof parsed === "object" && parsed !== null) input = parsed;
    } catch {
      // no usable input: fall back to the process folder
    }
    const cwd = typeof input.cwd === "string" && input.cwd ? input.cwd : d.cwd;
    const root = findProjectRoot(cwd);
    if (!root || !existsSync(projectConfigPath(root))) return "skipped";

    const session = typeof input.session_id === "string" && input.session_id.length <= 200 ? input.session_id : undefined;
    if (session) {
      try {
        recordSessionAccount(root, session, d);
      } catch {
        // the account tag is a nicety; never let it get in the way
      }
    }

    if ((await findOfficePort(root, 150)) !== null) return "running";
    if (!acquireStartLock(root)) return "waiting-for-other-start";
    (d.launch ?? launchOffice)(root, d.cliPath);
    return "started";
  } catch {
    return "skipped";
  }
}

/** Reads stdin without waiting forever (a hook can be started with no stdin attached). */
function readStdin(timeoutMs = 300): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve("");
    let data = "";
    const done = () => resolve(data);
    const timer = setTimeout(done, timeoutMs);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => {
      clearTimeout(timer);
      done();
    });
    process.stdin.on("error", done);
  });
}

/** Entry point for `officebots hook claude-session-start`. Always exits 0 and prints nothing. */
export async function main(cliPath: string): Promise<void> {
  try {
    await runHook({ stdin: await readStdin(), cwd: process.cwd(), env: process.env, cliPath });
  } catch {
    // never fail the session
  }
  process.exit(0);
}
