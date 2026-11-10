// Pure reducer: OfficeEvents in, Room snapshot out (PLAN.md §3.3).
import { createHash } from "node:crypto";
import { colorFor } from "../core/colors.js";
import { defaultRole } from "../core/roles.js";
import type { OfficeEvent, Tokens } from "../core/schema.js";

export type TokenSummary = Tokens & { headline: number };
export type Status = "working" | "waiting" | "sleeping";

export type Character = {
  key: string;
  tool: string;
  model: string;
  role: string;
  accountAlias: string | null;
  color: string;
  accent: string;
  status: Status;
  lastActive: string;
  tokens: TokenSummary;
  interns: { active: number; total: number; byType: Record<string, number> };
};

export type Room = {
  project: { key: string; name: string };
  characters: Character[];
  totals: TokenSummary;
};

type Intern = { type: string; status: "working" | "waiting"; lastActive: number };
type Internal = {
  key: string;
  tool: string;
  model: string;
  role: string;
  account: string | null;
  status: "working" | "waiting";
  lastActive: number;
  tokens: Tokens;
  interns: Map<string, Intern>;
};

const zero = (): Tokens => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 });
const add = (a: Tokens, b: Tokens) => {
  a.input += b.input;
  a.output += b.output;
  a.cacheRead += b.cacheRead;
  a.cacheWrite += b.cacheWrite;
  a.reasoning += b.reasoning;
};
// Headline = output + fresh input (input + cache writes); cache reads excluded.
const summary = (t: Tokens): TokenSummary => ({ ...t, headline: t.output + t.input + t.cacheWrite });

const MAX_SEEN = 100_000;

export function createRoom(project: { key: string; name: string }, opts: { idleAfterSec?: number } = {}) {
  const idleMs = (opts.idleAfterSec ?? 90) * 1000;
  const chars = new Map<string, Internal>();
  const sessionChar = new Map<string, string>(); // main session -> its current character
  const seen = new Set<string>();
  const totals = zero();
  const accounts: string[] = [];

  function character(ev: OfficeEvent, agent: OfficeEvent["agent"]): Internal {
    const role = defaultRole(ev.tool, agent);
    const key = createHash("sha256")
      .update([ev.tool, ev.model, ev.account ?? "", role].join("|"))
      .digest("hex")
      .slice(0, 12);
    let c = chars.get(key);
    if (!c) {
      c = { key, tool: ev.tool, model: ev.model, role, account: ev.account, status: "waiting", lastActive: 0, tokens: zero(), interns: new Map() };
      chars.set(key, c);
      if (ev.account && !accounts.includes(ev.account)) accounts.push(ev.account);
    }
    return c;
  }

  return {
    apply(ev: OfficeEvent): void {
      if (ev.project !== project.key || seen.has(ev.id)) return;
      seen.add(ev.id);
      if (seen.size > MAX_SEEN) seen.delete(seen.values().next().value!);
      const t = Date.parse(ev.time);

      let target: Internal;
      let intern: Intern | undefined;
      if (ev.agent.kind === "subagent") {
        const parent = ev.agent.parentSession ? chars.get(sessionChar.get(ev.agent.parentSession) ?? "") : undefined;
        // Subagent seen before its parent: seat it as a main-role character until the parent shows up.
        target = parent ?? character(ev, { kind: "main" });
        if (!parent && ev.agent.parentSession) sessionChar.set(ev.agent.parentSession, target.key);
        const id = ev.agent.id ?? ev.session;
        intern = target.interns.get(id) ?? { type: ev.agent.type ?? "agent", status: "waiting", lastActive: 0 };
        target.interns.set(id, intern);
      } else {
        target = character(ev, ev.agent);
        sessionChar.set(ev.session, target.key);
      }

      if (ev.tokens) {
        add(target.tokens, ev.tokens);
        add(totals, ev.tokens);
      }
      const status = ev.event === "working" || ev.event === "ping" ? "working" : ev.event === "waiting" ? "waiting" : undefined;
      if (t >= target.lastActive) {
        target.lastActive = t;
        if (status && !intern) target.status = status;
      }
      if (intern && t >= intern.lastActive) {
        intern.lastActive = t;
        if (status) intern.status = status;
        // an intern working keeps its desk awake
        if (status === "working") target.status = "working";
      }
    },

    snapshot(nowMs: number): Room {
      const characters: Character[] = [...chars.values()].map((c) => {
        const byType: Record<string, number> = {};
        let active = 0;
        for (const i of c.interns.values()) {
          byType[i.type] = (byType[i.type] ?? 0) + 1;
          if (i.status === "working" && nowMs - i.lastActive <= idleMs) active++;
        }
        const idx = c.account ? accounts.indexOf(c.account) : -1;
        return {
          key: c.key,
          tool: c.tool,
          model: c.model,
          role: c.role,
          accountAlias: idx >= 0 ? `account ${idx + 1}` : null,
          color: colorFor(c.key),
          accent: colorFor(c.account ?? c.key),
          status: nowMs - c.lastActive > idleMs ? "sleeping" : c.status,
          lastActive: new Date(c.lastActive).toISOString(),
          tokens: summary(c.tokens),
          interns: { active, total: c.interns.size, byType },
        };
      });
      return { project, characters, totals: summary(totals) };
    },
  };
}
