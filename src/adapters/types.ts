import type { OfficeEvent } from "../core/schema.js";

export type ParseContext = {
  /** Maps a working directory to a project key, or null if it is not in the watched project. */
  project: (cwd: string) => string | null;
  /** Already-hashed account id (acct_xxxxxxxx), or null when unknown. */
  account?: string | null;
  /** Subagent type hint, e.g. from agent-<id>.meta.json. */
  agentType?: string;
};

/** Counts only. Never contains log content, only record type names and file positions. */
export type ParseStats = {
  lines: number;
  events: number;
  unknownTypes: Record<string, number>;
  errors: { line: number; kind: string }[];
};

export type ParseResult = { events: OfficeEvent[]; stats: ParseStats };

/** A parser keeps dedupe state, so feed it one file's lines in order. */
export type LineParser = {
  parse(lines: string[], firstLine?: number): ParseResult;
};
