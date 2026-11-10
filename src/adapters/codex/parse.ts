// Pure Codex rollout parser (PLAN.md §1.2). Reads allowlisted fields only; raw lines are never kept.
// Assumptions that still need checking against real logs are marked VERIFY.
import { type EventName, type OfficeEvent, type Tokens, validateEvent } from "../../core/schema.js";
import type { LineParser, ParseContext, ParseResult } from "../types.js";

const KNOWN_TYPES = new Set(["session_meta", "turn_context", "event_msg", "response_item", "token_usage_record", "compacted"]);

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
const str = (x: unknown): string | undefined => (typeof x === "string" && x !== "" ? x : undefined);
const num = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : 0);

/** Cumulative counters as logged by Codex. */
type Raw = { input: number; cached: number; cacheWrite: number; output: number; reasoning: number; total: number };
const rawFrom = (u: Obj): Raw => ({
  input: num(u.input_tokens),
  cached: num(u.cached_input_tokens),
  cacheWrite: num(u.cache_write_input_tokens),
  output: num(u.output_tokens),
  reasoning: num(u.reasoning_output_tokens),
  total: num(u.total_tokens),
});

/**
 * input_tokens already includes cached_input_tokens, so fresh input = input - cached. Checked on 323
 * real token records (Codex CLI 0.167.0-alpha): cached <= input and total = input + output in all of
 * them, reasoning <= output, and cumulative totals never decreased. cache_write_input_tokens was 0 in
 * every record, so how it relates to input_tokens is still VERIFY (treated as separate). output_tokens
 * is kept whole, with reasoning shown for information, as for Claude's thinking tokens.
 */
function toTokens(d: Raw): Tokens {
  return {
    input: Math.max(0, d.input - d.cached),
    output: d.output,
    cacheRead: d.cached,
    cacheWrite: d.cacheWrite,
    reasoning: d.reasoning,
  };
}

export function createCodexParser(ctx: ParseContext): LineParser {
  let thread = ctx.threadHint;
  let cwd: string | undefined;
  let model: string | undefined;
  let account: string | null = null;
  let agent: OfficeEvent["agent"] = { kind: "main" };
  let session: string | undefined = thread;
  let historyStart: number | undefined; // ordinals below this are history inherited from the parent thread
  let prev: Raw | undefined;

  const hash = (raw: string) => (ctx.hashAccount ? ctx.hashAccount(raw) : null);

  function sessionMeta(p: Obj): void {
    thread = str(p.id) ?? thread;
    cwd = str(p.cwd) ?? cwd;
    const acct = str(p.creator_account_id) ?? str(p.creator_user_id);
    if (acct) account = hash(acct);
    const cm = isObj(p.collaboration_mode) && isObj(p.collaboration_mode.settings) ? p.collaboration_mode.settings : undefined;
    model ??= str(cm?.model);

    const spawn = isObj(p.source) && isObj(p.source.subagent) && isObj(p.source.subagent.thread_spawn) ? p.source.subagent.thread_spawn : undefined;
    if (spawn) {
      const parent = str(spawn.parent_thread_id);
      agent = { kind: "subagent", id: thread, ...(str(spawn.agent_role) ? { type: str(spawn.agent_role) } : {}), ...(parent ? { parentSession: parent } : {}) };
      session = parent ?? thread; // like Claude subagents, the session is the parent's
    } else {
      agent = { kind: "main" };
      session = thread;
    }
  }

  return {
    cwd: () => cwd,
    parse(lines, firstLine = 1, silent = false): ParseResult {
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
          const name = /^[a-z][a-z0-9_-]{0,40}$/.test(rec.type) ? rec.type : "(other)";
          stats.unknownTypes[name] = (stats.unknownTypes[name] ?? 0) + 1;
          return;
        }

        const meta = isObj(rec.metadata) ? rec.metadata : undefined;
        if (meta && typeof meta.subagent_history_start_ordinal === "number") historyStart = meta.subagent_history_start_ordinal;
        const ordinal = typeof rec.ordinal === "number" ? rec.ordinal : undefined;
        const inherited = historyStart !== undefined && ordinal !== undefined && ordinal < historyStart;
        const payload = isObj(rec.payload) ? rec.payload : undefined;
        if (!payload) return;

        if (rec.type === "session_meta") return sessionMeta(payload);
        if (rec.type === "turn_context") {
          model = str(payload.model) ?? model;
          cwd = str(payload.cwd) ?? cwd;
          return;
        }
        if (rec.type !== "event_msg") return;

        const kind = str(payload.type);
        const idBase = `codex:${thread ?? "unknown"}:${ordinal ?? `L${lineNo}`}`;
        let event: EventName | undefined;
        let tokens: Tokens | undefined;

        if (kind === "token_count") {
          const info = isObj(payload.info) ? payload.info : undefined;
          const total = info && isObj(info.total_token_usage) ? rawFrom(info.total_token_usage) : undefined;
          if (!total) return;
          // Cumulative -> delta, so replaying a file gives the same events. A drop means a counter reset.
          const base = prev && total.total >= prev.total ? prev : undefined;
          const d: Raw = {
            input: total.input - (base?.input ?? 0),
            cached: total.cached - (base?.cached ?? 0),
            cacheWrite: total.cacheWrite - (base?.cacheWrite ?? 0),
            output: total.output - (base?.output ?? 0),
            reasoning: total.reasoning - (base?.reasoning ?? 0),
            total: total.total - (base?.total ?? 0),
          };
          for (const k of Object.keys(d) as (keyof Raw)[]) d[k] = Math.max(0, d[k]);
          prev = total; // inherited records still move the baseline, they just are not counted
          if (d.input + d.cached + d.cacheWrite + d.output === 0) return; // repeated total, nothing new
          event = "tokens";
          tokens = toTokens(d);
        } else if (kind === "task_started") event = "working";
        else if (kind === "task_complete" || kind === "turn_aborted") event = "waiting";
        else return;

        if (silent || inherited) return;
        if (!thread || !session || !cwd) return;
        const project = ctx.project(cwd);
        if (!project) return;
        const ev = validateEvent({
          v: 1,
          id: `${idBase}:${kind}`,
          time: rec.timestamp,
          source: "adapter",
          tool: "codex",
          model: model ?? "unknown",
          account,
          session,
          agent,
          project,
          event,
          ...(tokens ? { tokens } : {}),
        });
        if (ev) events.push(ev);
        else stats.errors.push({ line: lineNo, kind: "invalid_event" });
      });

      stats.events = events.length;
      return { events, stats };
    },
  };
}
