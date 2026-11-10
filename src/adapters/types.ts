import type { OfficeEvent } from "../core/schema.js";

export type ParseContext = {
  /** Maps a working directory to a project key, or null if it is not in the watched project. */
  project: (cwd: string) => string | null;
  /** Already-hashed account id (acct_xxxxxxxx), or null when unknown. */
  account?: string | null;
  /** Per-session account (e.g. recorded by a SessionStart hook). Takes priority over `account`. */
  accountFor?: (session: string) => string | undefined;
  /** Hashes a raw account id found in a log. Adapters must never emit the raw id. */
  hashAccount?: (raw: string) => string;
  /** Subagent type hint, e.g. from agent-<id>.meta.json. */
  agentType?: string | (() => string | undefined);
  /** Conversation id guessed from the file name, used until the log says otherwise. */
  threadHint?: string;
};

/** Counts only. Never contains log content, only record type names and file positions. */
export type ParseStats = {
  lines: number;
  events: number;
  unknownTypes: Record<string, number>;
  errors: { line: number; kind: string }[];
};

export type ParseResult = { events: OfficeEvent[]; stats: ParseStats };

/** A parser keeps state (dedupe, running totals), so feed it one file's lines in order. */
export type LineParser = {
  /** silent = update internal state only and return no events (used to catch up on old content). */
  parse(lines: string[], firstLine?: number, silent?: boolean): ParseResult;
  /** Latest working directory seen so far, if the parser tracks one. */
  cwd?(): string | undefined;
};

/** One supported AI tool: where its logs live and how to read them. */
export type Adapter = {
  name: string;
  /** Candidate log roots for this machine. */
  roots(env: NodeJS.ProcessEnv): string[];
  /** Is this path one of the tool's session logs? */
  matches(path: string): boolean;
  /** Final, compressed logs are read once as a whole instead of tailed. */
  compressed?(path: string): boolean;
  /** Stable id of the conversation across live and compressed copies of its file. */
  threadKey?(path: string): string | undefined;
  /** True if events cannot be placed in a project without reading the start of the file. */
  needsHead?: boolean;
  createParser(file: string, ctx: ParseContext): LineParser;
};
