import { readFileSync } from "node:fs";
import { claudeProjectsDir } from "../adapters/claude-code/files.js";
import { findProjectRoot } from "../core/project.js";
import { AlreadyRunningError, startOffice } from "../server/office.js";

export async function start(args: string[], usage: () => never): Promise<void> {
  const ci = args.indexOf("--claude-dir");
  const dir = ci >= 0 ? args[ci + 1] : claudeProjectsDir();
  if (!dir) usage();
  const root = findProjectRoot(process.cwd()) ?? process.cwd();
  const uiHtml = readFileSync(new URL("./ui/index.html", import.meta.url), "utf8");

  let office;
  try {
    office = await startOffice({ root, claudeProjectsDir: dir, uiHtml, onProblem: (m) => console.error(`officebots: ${m}`) });
  } catch (e) {
    if (e instanceof AlreadyRunningError) {
      console.error(`officebots: ${e.message}. If that is stale, delete .officebots/.state/run.json.`);
      process.exit(1);
    }
    throw e;
  }
  console.log(`officebots: office for this project is open at ${office.url}`);
  console.log("press Ctrl+C to stop");

  const stop = () => void office.close().then(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
