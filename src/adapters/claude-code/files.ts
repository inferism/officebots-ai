import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

/** ~/.claude/projects, or $CLAUDE_CONFIG_DIR/projects. */
export function claudeProjectsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "projects");
}

/** Session logs only: *.jsonl, not tool outputs. */
export function isSessionFile(path: string): boolean {
  return path.endsWith(".jsonl") && !/[\\/]tool-results[\\/]/.test(path);
}

/** Reads only the agentType field of agent-<id>.meta.json next to a subagent log. */
export function readAgentType(file: string): string | undefined {
  const m = /^(agent-.+)\.jsonl$/.exec(basename(file));
  if (!m) return undefined;
  try {
    const meta = JSON.parse(readFileSync(join(dirname(file), `${m[1]}.meta.json`), "utf8"));
    return typeof meta?.agentType === "string" ? meta.agentType : undefined;
  } catch {
    return undefined;
  }
}
