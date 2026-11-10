// Synthetic event source for `officebots demo`. Reads no logs and makes up everything.
import type { OfficeEvent } from "../core/schema.js";

export type DemoOptions = {
  agents: number;
  /** Total subagents ("interns") spawned over the run. */
  interns: number;
  project: string;
  seed?: number;
  now?: () => number;
};

const MODELS: [tool: string, model: string][] = [
  ["claude-code", "claude-sonnet-5-5"],
  ["claude-code", "claude-opus-5-5"],
  ["codex", "gpt-6.1-sol"],
  ["claude-code", "claude-haiku-5-5"],
  ["gemini-cli", "gemini-pro"],
  ["mystery-tool", "foo-model-9"], // unknown model: must render with the default color and role "Agent"
];
const INTERN_TYPES = ["Explore", "Plan", "general-purpose"];

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Agent = { i: number; tool: string; model: string; account: string; session: string; phase: "new" | "working" | "waiting" | "quiet"; until: number };

/**
 * Call tick() every ~500 ms. Agents join one by one, work in bursts, finish, go quiet (so the
 * reducer puts them to sleep) and some wake up again later.
 */
export function createDemo(opts: DemoOptions) {
  const rand = rng(opts.seed ?? 1);
  const now = opts.now ?? Date.now;
  const agents: Agent[] = [];
  let n = 0;
  let internsLeft = opts.interns;
  let nextJoin = 0;
  let seq = 0;
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;

  const base = (a: Agent, t: number) => ({
    v: 1 as const,
    time: new Date(t).toISOString(),
    source: "manual" as const,
    tool: a.tool,
    model: a.model,
    account: a.account,
    session: a.session,
    project: opts.project,
  });
  const tokens = () => ({
    input: 1 + Math.floor(rand() * 8),
    output: 50 + Math.floor(rand() * 900),
    cacheRead: Math.floor(rand() * 50000),
    cacheWrite: Math.floor(rand() * 4000),
    reasoning: Math.floor(rand() * 300),
  });

  return {
    tick(): OfficeEvent[] {
      const t = now();
      const out: OfficeEvent[] = [];

      if (agents.length < opts.agents && t >= nextJoin) {
        const i = agents.length;
        const [tool, model] = MODELS[i % MODELS.length]!;
        // every agent gets its own account, so each is its own character even with the same model
        agents.push({ i, tool, model, account: `acct_${(i + 1).toString(16).padStart(8, "0")}`, session: `demo-${i}`, phase: "new", until: 0 });
        nextJoin = t + 700;
      }

      for (const a of agents) {
        const id = () => `demo:${a.session}:${n++}`;
        if (a.phase === "new" || (a.phase === "quiet" && t >= a.until)) {
          a.phase = "working";
          a.until = t + 4000 + rand() * 8000;
        }
        if (a.phase === "working") {
          out.push({ ...base(a, t), id: id(), agent: { kind: "main" }, event: "working", tokens: tokens() });
          if (internsLeft > 0 && rand() < 0.06) {
            internsLeft--;
            const aid = `agent-${seq++}`;
            const type = pick(INTERN_TYPES);
            const sub = { kind: "subagent" as const, id: aid, type, parentSession: a.session };
            out.push({ ...base(a, t), id: id(), agent: sub, event: "working", tokens: tokens() });
            out.push({ ...base(a, t + 3000), id: id(), agent: sub, event: "waiting" });
          }
          if (t >= a.until) {
            a.phase = "waiting";
            out.push({ ...base(a, t), id: id(), agent: { kind: "main" }, event: "waiting" });
            // stay quiet long enough to fall asleep; about a third wake up again
            a.until = rand() < 0.35 ? t + 25000 + rand() * 40000 : Infinity;
            a.phase = "quiet";
          }
        }
      }
      return out;
    },
  };
}
