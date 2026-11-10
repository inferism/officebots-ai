import { fileURLToPath } from "node:url";
import { findProjectRoot } from "../core/project.js";
import { ensureOffice, ensureProjectFiles, openBrowser } from "../server/launch.js";
import { findOfficePort } from "../server/loopback.js";

const cliPath = () => process.argv[1] ?? fileURLToPath(new URL("./cli.js", import.meta.url));
const projectRoot = () => findProjectRoot(process.cwd()) ?? process.cwd();

/** `officebots open`: make sure the project has an office, start it if needed, and open it. */
export async function open(args: string[]): Promise<void> {
  const root = projectRoot();
  const made = ensureProjectFiles(root);
  if (made.created) console.log("created .officebots/ in this project");
  const port = await ensureOffice(root, { cliPath: cliPath(), waitMs: 8000 });
  if (port === null) {
    console.error("officebots: the office did not start. See .officebots/.state/office.log");
    process.exit(1);
  }
  const url = `http://127.0.0.1:${port}`;
  if (!args.includes("--no-open")) openBrowser(url);
  console.log(`officebots: office for this project is open at ${url}`);
  console.log("next time: double-click .officebots/office.html in the project, or bookmark that address");
}

export async function status(): Promise<void> {
  const port = await findOfficePort(projectRoot());
  console.log(port === null ? "officebots: no office is running for this project" : `officebots: office is running at http://127.0.0.1:${port}`);
  process.exitCode = port === null ? 1 : 0;
}

export async function stop(): Promise<void> {
  const { readFileSync, rmSync } = await import("node:fs");
  const { join } = await import("node:path");
  const file = join(projectRoot(), ".officebots", ".state", "run.json");
  let pid: unknown;
  try {
    pid = JSON.parse(readFileSync(file, "utf8")).pid;
  } catch {
    console.log("officebots: no office is running for this project");
    return;
  }
  try {
    if (typeof pid === "number") process.kill(pid);
  } catch {
    // already gone
  }
  rmSync(file, { force: true }); // an office that was killed outright cannot clean up after itself
  console.log("officebots: office stopped");
}
