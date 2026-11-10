import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createClaudeCodeParser } from "./adapters/claude-code/parse.js";
import { isInside, projectKey } from "./core/project.js";

function usage(): never {
  console.error("usage: officebots replay <session.jsonl> [--project <dir>]");
  process.exit(2);
}

/** Only the agentType field is read from a subagent .meta.json. */
function agentTypeFor(file: string): string | undefined {
  const m = /^(agent-.+)\.jsonl$/.exec(basename(file));
  if (!m) return undefined;
  try {
    const meta = JSON.parse(readFileSync(join(dirname(file), `${m[1]}.meta.json`), "utf8"));
    return typeof meta?.agentType === "string" ? meta.agentType : undefined;
  } catch {
    return undefined;
  }
}

function replay(args: string[]): void {
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
    agentType: agentTypeFor(file),
  });
  const { events, stats } = parser.parse(text.split("\n"));
  for (const e of events) console.log(JSON.stringify(e));
  for (const err of stats.errors) console.error(`${basename(file)}#${err.line}: ${err.kind}`);
  const unknown = Object.values(stats.unknownTypes).reduce((a, b) => a + b, 0);
  console.error(`${stats.events} events, ${stats.errors.length} errors, ${unknown} unknown records`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "replay") replay(rest);
else usage();
