import { existsSync } from "node:fs";
import { claudeProjectsDir, isSessionFile, readAgentType } from "./claude-code/files.js";
import { createClaudeCodeParser } from "./claude-code/parse.js";
import { codexSessionsDir, isCompressed, isRollout, threadIdFromPath } from "./codex/files.js";
import { createCodexParser } from "./codex/parse.js";
import type { Adapter } from "./types.js";

export const claudeCodeAdapter: Adapter = {
  name: "claude-code",
  roots: (env) => [claudeProjectsDir(env)],
  matches: isSessionFile,
  createParser(file, ctx) {
    const sub = /[\/]agent-[^\/]+\.jsonl$/.test(file);
    return createClaudeCodeParser({ ...ctx, agentType: sub ? () => readAgentType(file) : undefined });
  },
};

export const codexAdapter: Adapter = {
  name: "codex",
  roots: (env) => [codexSessionsDir(env)],
  matches: isRollout,
  compressed: isCompressed,
  threadKey: threadIdFromPath,
  needsHead: true, // rollouts are not grouped by project; the folder is only known from session_meta
  createParser: (file, ctx) => createCodexParser({ ...ctx, threadHint: threadIdFromPath(file) }),
};

export const allAdapters: Adapter[] = [claudeCodeAdapter, codexAdapter];

export type Source = { adapter: Adapter; root: string };

/** Every tool whose log folder exists on this machine. */
export function defaultSources(env: NodeJS.ProcessEnv = process.env): Source[] {
  return allAdapters.flatMap((adapter) => adapter.roots(env).filter((r) => existsSync(r)).map((root) => ({ adapter, root })));
}
