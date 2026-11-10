import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { readAgentType } from "../adapters/claude-code/files.js";
import { createClaudeCodeParser } from "../adapters/claude-code/parse.js";
import { isInside, projectKey } from "../core/project.js";

export function replay(args: string[], usage: () => never): void {
  const pi = args.indexOf("--project");
  let root = pi >= 0 ? args[pi + 1] : undefined;
  if (pi >= 0 && !root) usage();
  const file = (pi >= 0 ? args.filter((_, i) => i !== pi && i !== pi + 1) : args)[0];
  if (!file) usage();

  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    console.error(`officebots: cannot read ${file}`);
    process.exit(1);
  }

  // Without --project, the first cwd seen defines the project.
  const parser = createClaudeCodeParser({
    project: (cwd) => {
      root ??= cwd;
      return isInside(root, cwd) ? projectKey(root) : null;
    },
    agentType: readAgentType(file),
  });
  const { events, stats } = parser.parse(text.split("\n"));
  for (const e of events) console.log(JSON.stringify(e));
  for (const err of stats.errors) console.error(`${basename(file)}#${err.line}: ${err.kind}`);
  const unknown = Object.values(stats.unknownTypes).reduce((a, b) => a + b, 0);
  console.error(`${stats.events} events, ${stats.errors.length} errors, ${unknown} unknown records`);
}
