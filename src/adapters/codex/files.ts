import { homedir } from "node:os";
import { basename, join } from "node:path";

/** ~/.codex/sessions, or $CODEX_HOME/sessions. */
export function codexSessionsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.CODEX_HOME || join(homedir(), ".codex"), "sessions");
}

// rollout-<ISO time with - or : separators>-<threadId>.jsonl, later compressed to .jsonl.zst
const NAME = /^rollout-(\d{4}-\d{2}-\d{2}T\d{2}[-:]\d{2}[-:]\d{2}(?:\.\d+)?Z?)-(.+?)\.jsonl(\.zst)?$/;

export const isRollout = (path: string) => NAME.test(basename(path));
export const isCompressed = (path: string) => path.endsWith(".zst");

/** The thread id from the file name: the same for the live file and its compressed successor. */
export function threadIdFromPath(path: string): string | undefined {
  return NAME.exec(basename(path))?.[2];
}
