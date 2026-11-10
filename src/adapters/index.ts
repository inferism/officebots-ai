import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadPersonalConfig } from "../core/config.js";
import { createSessionAccountLookup, resolveRootAccount } from "./claude-code/account.js";
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
    const sub = /[\\/]agent-[^\\/]+\.jsonl$/.test(file);
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

export type Source = {
  adapter: Adapter;
  root: string;
  /** Hashed account the logs in this folder belong to, when the tool does not record it. */
  account?: string | null;
  /** Per-session account, consulted before `account`. */
  accountFor?: (session: string) => string | undefined;
};

/**
 * Every tool whose log folder exists on this machine. Claude Code can have several config folders
 * (one per account): $CLAUDE_CONFIG_DIR, ~/.claude, and any listed in the personal config.
 */
export function defaultSources(env: NodeJS.ProcessEnv = process.env, personalPath?: string): Source[] {
  const extra = personalPath ? loadPersonalConfig(personalPath).claudeConfigDirs.map((d) => join(d, "projects")) : [];
  const claudeRoots = [...new Set([...claudeCodeAdapter.roots(env), ...extra])];
  const sources: Source[] = [
    ...claudeRoots.map((root) => ({ adapter: claudeCodeAdapter, root })),
    ...codexAdapter.roots(env).map((root) => ({ adapter: codexAdapter, root })),
  ];
  return sources.filter((s) => existsSync(s.root));
}

/** Attaches the account to Claude Code sources: from the session record if there is one, else the folder's account. */
export function withAccounts(
  sources: Source[],
  o: { hash: (raw: string) => string; personalPath: string; sessionFile?: string; home?: string },
): Source[] {
  const lookup = o.sessionFile ? createSessionAccountLookup(o.sessionFile) : undefined;
  return sources.map((s) =>
    s.adapter === claudeCodeAdapter
      ? { ...s, account: resolveRootAccount({ root: s.root, hash: o.hash, personalPath: o.personalPath, home: o.home }), accountFor: lookup }
      : s,
  );
}
