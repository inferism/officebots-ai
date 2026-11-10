// OfficeEvent v1 (PLAN.md §3.1). There are deliberately no content fields:
// prompt text, tool inputs and file paths have nowhere to go.

export type Source = "adapter" | "cli" | "http" | "hook" | "manual";
export type EventName =
  | "session_start"
  | "working"
  | "waiting"
  | "tokens"
  | "session_end"
  | "ping";

export type Tokens = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
};

export type OfficeEvent = {
  v: 1;
  id: string;
  time: string;
  source: Source;
  tool: string;
  model: string;
  account: string | null;
  session: string;
  agent: {
    kind: "main" | "subagent";
    id?: string;
    type?: string;
    parentSession?: string;
  };
  project: string;
  event: EventName;
  tokens?: Tokens;
};

const SOURCES: readonly string[] = ["adapter", "cli", "http", "hook", "manual"];
const EVENTS: readonly string[] = [
  "session_start",
  "working",
  "waiting",
  "tokens",
  "session_end",
  "ping",
];
const TOKEN_KEYS = ["input", "output", "cacheRead", "cacheWrite", "reasoning"] as const;

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

// Free-text fields come from logs and from POST /events. Capping their length, and allowing only the
// hashed account form, keeps prompt text or raw ids from riding along in a "model" or "account" field.
export const MAX_FIELD_LENGTH = 200;
export const ACCOUNT_PATTERN = /^acct_[0-9a-f]{8}$/;
const isStr = (x: unknown): x is string => typeof x === "string" && x.length <= MAX_FIELD_LENGTH;

// ISO-8601 date-time that Date can actually parse.
function isIsoTime(x: unknown): x is string {
  return (
    isStr(x) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(x) &&
    !Number.isNaN(Date.parse(x))
  );
}

function cleanTokens(x: unknown): Tokens | null {
  if (!isObject(x)) return null;
  const out = {} as Tokens;
  for (const k of TOKEN_KEYS) {
    const n = x[k];
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
    out[k] = n;
  }
  return out;
}

function cleanAgent(x: unknown): OfficeEvent["agent"] | null {
  if (!isObject(x)) return null;
  if (x.kind !== "main" && x.kind !== "subagent") return null;
  const agent: OfficeEvent["agent"] = { kind: x.kind };
  for (const k of ["id", "type", "parentSession"] as const) {
    const val = x[k];
    if (val === undefined) continue;
    if (!isStr(val)) return null;
    agent[k] = val;
  }
  return agent;
}

/** Returns a clean copy containing only known keys, or null if anything is off. */
export function validateEvent(input: unknown): OfficeEvent | null {
  if (!isObject(input)) return null;
  if (input.v !== 1) return null;
  const { id, time, source, tool, model, account, session, project, event } = input;
  if (!isStr(id) || id === "") return null;
  if (!isIsoTime(time)) return null;
  if (!isStr(source) || !SOURCES.includes(source)) return null;
  if (!isStr(tool) || tool === "") return null;
  if (!isStr(model)) return null;
  if (account !== null && !(isStr(account) && ACCOUNT_PATTERN.test(account))) return null;
  if (!isStr(session) || session === "") return null;
  if (!isStr(project)) return null;
  if (!isStr(event) || !EVENTS.includes(event)) return null;
  const agent = cleanAgent(input.agent);
  if (!agent) return null;

  const clean: OfficeEvent = {
    v: 1,
    id,
    time,
    source: source as Source,
    tool,
    model,
    account,
    session,
    agent,
    project,
    event: event as EventName,
  };
  if (input.tokens !== undefined) {
    const tokens = cleanTokens(input.tokens);
    if (!tokens) return null;
    clean.tokens = tokens;
  }
  return clean;
}
