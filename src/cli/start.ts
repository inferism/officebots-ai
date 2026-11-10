import { fileURLToPath } from "node:url";
import { allAdapters, defaultSources } from "../adapters/index.js";
import { findProjectRoot } from "../core/project.js";
import { AlreadyRunningError, startOffice } from "../server/office.js";

export async function start(args: string[], usage: () => never): Promise<void> {
  // --claude-dir / --codex-dir override the default log folders (handy for trying it on copies)
  const flag = (name: string) => {
    const i = args.indexOf(name);
    if (i < 0) return undefined;
    if (!args[i + 1]) usage();
    return args[i + 1];
  };
  const env = { ...process.env };
  const claudeDir = flag("--claude-dir");
  const codexDir = flag("--codex-dir");
  const sources =
    claudeDir || codexDir
      ? [
          ...(claudeDir ? [{ adapter: allAdapters[0]!, root: claudeDir }] : []),
          ...(codexDir ? [{ adapter: allAdapters[1]!, root: codexDir }] : []),
        ]
      : defaultSources(env);
  const root = findProjectRoot(process.cwd()) ?? process.cwd();
  const uiDir = fileURLToPath(new URL("./ui/", import.meta.url));

  let office;
  try {
    office = await startOffice({ root, logSources: sources, uiDir, onProblem: (m) => console.error(`officebots: ${m}`) });
  } catch (e) {
    if (e instanceof AlreadyRunningError) {
      console.error(`officebots: ${e.message}. If that is stale, delete .officebots/.state/run.json.`);
      process.exit(1);
    }
    throw e;
  }
  console.log(`officebots: office for this project is open at ${office.url}`);
  console.log(`watching: ${sources.map((s) => s.adapter.name).join(", ") || "nothing found (no Claude Code or Codex logs)"}`);
  console.log("press Ctrl+C to stop");

  const stop = () => void office.close().then(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
