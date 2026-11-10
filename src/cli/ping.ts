import { randomUUID } from "node:crypto";
import { findProjectRoot, projectKey } from "../core/project.js";
import type { EventName, OfficeEvent, Tokens } from "../core/schema.js";
import { findOfficePort, postEvent } from "../server/loopback.js";

export type PingOptions = {
  tool: string;
  model: string;
  event: EventName;
  tokens?: Tokens;
};

const FLAGS: Record<string, keyof Tokens> = {
  "--tokens-in": "input",
  "--tokens-out": "output",
  "--cache-read": "cacheRead",
  "--cache-write": "cacheWrite",
  "--reasoning": "reasoning",
};
const EVENTS = ["ping", "working", "waiting", "session_start", "session_end", "tokens"];

/** Parses `ping` flags. Returns an error message instead of throwing so the CLI can print it. */
export function parsePingArgs(args: string[]): PingOptions | string {
  let tool: string | undefined;
  let model = "unknown";
  let event: EventName = "ping";
  const tokens: Tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
  let anyTokens = false;
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i]!;
    const value = args[i + 1];
    if (value === undefined) return `missing value for ${flag}`;
    if (flag === "--tool") tool = value;
    else if (flag === "--model") model = value;
    else if (flag === "--event") {
      if (!EVENTS.includes(value)) return `--event must be one of: ${EVENTS.join(", ")}`;
      event = value as EventName;
    } else if (flag in FLAGS) {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 0) return `${flag} must be a whole number, 0 or more`;
      tokens[FLAGS[flag]!] = n;
      anyTokens = true;
    } else return `unknown option ${flag}`;
  }
  if (!tool) return "--tool is required";
  return { tool, model, event, ...(anyTokens ? { tokens } : {}) };
}

/** The event a ping sends: no log content, just who and how many tokens. */
export function buildPing(o: PingOptions, project: string, now = new Date()): OfficeEvent {
  return {
    v: 1,
    id: `cli:${randomUUID()}`,
    time: now.toISOString(),
    source: "cli",
    tool: o.tool,
    model: o.model,
    account: null,
    session: `cli:${o.tool}`,
    agent: { kind: "main" },
    project,
    event: o.event,
    ...(o.tokens ? { tokens: o.tokens } : {}),
  };
}

export async function ping(args: string[]): Promise<void> {
  const opts = parsePingArgs(args);
  if (typeof opts === "string") {
    console.error(`officebots ping: ${opts}`);
    process.exit(2);
  }
  const root = findProjectRoot(process.cwd()) ?? process.cwd();
  const port = await findOfficePort(root);
  if (port === null) {
    console.error("officebots ping: no office is running for this project. Start one with `officebots start`.");
    process.exit(1);
  }
  const ev = buildPing(opts, projectKey(root));
  const status = await postEvent(port, ev);
  if (status !== 202) {
    console.error(`officebots ping: the office refused the event (HTTP ${status || "no response"})`);
    process.exit(1);
  }
  console.log(`sent: ${opts.tool}${opts.model !== "unknown" ? ` / ${opts.model}` : ""}`);
}
