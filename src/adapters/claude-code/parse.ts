// Pure Claude Code log parser (PLAN.md §1.1). Reads allowlisted fields only.
// Raw lines are parsed, picked from and dropped: never stored, logged or put in errors.
import { type OfficeEvent, type Tokens, validateEvent } from "../../core/schema.js";
import type { LineParser, ParseContext, ParseResult } from "../types.js";

const KNOWN_TYPES = new Set([
  "user",
  "assistant",
  "attachment",
  "queue-operation",
  "last-prompt",
  "file-history-snapshot",
  "api-request-shape",
  "api-request-blob",
  "api-request",
  "atis-latch",
]);

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
const str = (x: unknown): string | undefined => (typeof x === "string" && x !== "" ? x : undefined);
const num = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : 0);

function tokensFrom(usage: Obj): Tokens {
  const details = isObj(usage.output_tokens_details) ? usage.output_tokens_details : {};
  return {
    input: num(usage.input_tokens),
    output: num(usage.output_tokens),
    cacheRead: num(usage.cache_read_input_tokens),
    cacheWrite: num(usage.cache_creation_input_tokens),
    reasoning: num(details.thinking_tokens),
  };
}

// tool_use and null (streaming block) mean the agent is still going; any other stop reason ends the turn.
const isTurnEnd = (stop: unknown) => typeof stop === "string" && stop !== "tool_use";

export function createClaudeCodeParser(ctx: ParseContext): LineParser {
  const seen = new Map<string, boolean>(); // message.id -> turn already ended
  let lastCwd: string | undefined;

  return {
    parse(lines, firstLine = 1): ParseResult {
      const events: OfficeEvent[] = [];
      const stats: ParseResult["stats"] = { lines: 0, events: 0, unknownTypes: {}, errors: [] };

      lines.forEach((line, i) => {
        if (line.trim() === "") return;
        const lineNo = firstLine + i;
        stats.lines++;
        let rec: unknown;
        try {
          rec = JSON.parse(line);
        } catch {
          stats.errors.push({ line: lineNo, kind: "json" });
          return;
        }
        if (!isObj(rec) || typeof rec.type !== "string") {
          stats.errors.push({ line: lineNo, kind: "shape" });
          return;
        }
        if (!KNOWN_TYPES.has(rec.type)) {
          // Only record-type-shaped names are echoed; anything else is bucketed so content can't leak via a name.
          const name = /^[a-z][a-z0-9_-]{0,40}$/.test(rec.type) ? rec.type : "(other)";
          stats.unknownTypes[name] = (stats.unknownTypes[name] ?? 0) + 1;
          return;
        }
        if (typeof rec.cwd === "string" && rec.cwd !== "") lastCwd = rec.cwd;
        if (rec.type !== "assistant") return;

        const ev = fromAssistant(rec);
        if (ev === "skip") return;
        if (ev === "bad") {
          stats.errors.push({ line: lineNo, kind: "invalid_record" });
          return;
        }
        for (const e of ev) {
          const clean = validateEvent(e);
          if (clean) events.push(clean);
          else stats.errors.push({ line: lineNo, kind: "invalid_event" });
        }
      });

      stats.events = events.length;
      return { events, stats };
    },
  };

  function fromAssistant(rec: Obj): OfficeEvent[] | "skip" | "bad" {
    const msg = rec.message;
    if (!isObj(msg)) return "bad";
    const msgId = str(msg.id);
    const model = str(msg.model);
    const session = str(rec.sessionId);
    const time = str(rec.timestamp);
    if (!msgId || !model || !session || !time || !isObj(msg.usage)) return "bad";
    if (model.startsWith("<")) return "skip"; // e.g. "<synthetic>" placeholder responses

    const ended = isTurnEnd(msg.stop_reason);
    const already = seen.get(msgId);
    seen.set(msgId, (already ?? false) || ended);

    const agentId = str(rec.agentId);
    const sub = rec.isSidechain === true && agentId !== undefined;
    const agent: OfficeEvent["agent"] = sub
      ? { kind: "subagent", id: `agent-${agentId}`, parentSession: session }
      : { kind: "main" };
    const agentType = typeof ctx.agentType === "function" ? ctx.agentType() : ctx.agentType;
    if (sub && agentType) agent.type = agentType;

    const cwd = str(rec.cwd) ?? lastCwd;
    if (!cwd) return "skip";
    const project = ctx.project(cwd);
    if (!project) return "skip";

    const baseId = sub ? `claude-code:${session}:agent-${agentId}:${msgId}` : `claude-code:${session}:${msgId}`;
    const common = {
      v: 1 as const,
      time,
      source: "adapter" as const,
      tool: "claude-code",
      model,
      account: ctx.accountFor?.(session) ?? ctx.account ?? null,
      session,
      agent,
      project,
    };

    if (already === undefined) {
      return [{ ...common, id: baseId, event: ended ? "waiting" : "working", tokens: tokensFrom(msg.usage) }];
    }
    // Later content block of a response we already counted: no tokens, but it may carry the turn end.
    if (ended && !already) return [{ ...common, id: `${baseId}:stop`, event: "waiting" }];
    return "skip";
  }
}
