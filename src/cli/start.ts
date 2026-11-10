import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { claudeCodeAdapter, codexAdapter, defaultSources, type Source, withAccounts } from "../adapters/index.js";
import { createAccountHasher, personalConfigPath } from "../core/identity.js";
import { findProjectRoot } from "../core/project.js";
import { AlreadyRunningError, startOffice } from "../server/office.js";

/** Values of a flag that may be repeated, e.g. --claude-dir a --claude-dir b. */
export function flagValues(args: string[], name: string, usage: () => never): string[] {
  const out: string[] = [];
  args.forEach((a, i) => {
    if (a !== name) return;
    if (!args[i + 1]) usage();
    out.push(args[i + 1]!);
  });
  return out;
}

/** Log folders to watch: the flags if given, otherwise every Claude Code and Codex folder found on this machine. */
export function pickSources(args: string[], personalPath: string, usage: () => never): Source[] {
  const claudeDirs = flagValues(args, "--claude-dir", usage);
  const codexDirs = flagValues(args, "--codex-dir", usage);
  if (claudeDirs.length === 0 && codexDirs.length === 0) return defaultSources(process.env, personalPath);
  return [
    ...claudeDirs.map((root) => ({ adapter: claudeCodeAdapter, root })),
    ...codexDirs.map((root) => ({ adapter: codexAdapter, root })),
  ];
}

export async function start(args: string[], usage: () => never): Promise<void> {
  const personalPath = personalConfigPath();
  const root = findProjectRoot(process.cwd()) ?? process.cwd();
  const hash = createAccountHasher(personalPath);
  const sources = withAccounts(pickSources(args, personalPath, usage), {
    hash,
    personalPath,
    sessionFile: join(root, ".officebots", ".state", "sessions.json"),
  });
  const uiDir = fileURLToPath(new URL("./ui/", import.meta.url));

  let office;
  try {
    office = await startOffice({ root, logSources: sources, uiDir, personalConfigPath: personalPath, hashAccount: hash, onProblem: (m) => console.error(`officebots: ${m}`) });
  } catch (e) {
    if (e instanceof AlreadyRunningError) {
      console.error(`officebots: ${e.message}. If that is stale, delete .officebots/.state/run.json.`);
      process.exit(1);
    }
    throw e;
  }
  const count = (name: string) => sources.filter((s) => s.adapter.name === name).length;
  const watching = [count("claude-code") && `claude-code (${count("claude-code")} folder${count("claude-code") > 1 ? "s" : ""})`, count("codex") && "codex"].filter(Boolean);
  console.log(`officebots: office for this project is open at ${office.url}`);
  console.log(`watching: ${watching.join(", ") || "nothing found (no Claude Code or Codex logs)"}`);
  console.log("press Ctrl+C to stop");

  const stop = () => void office.close().then(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
