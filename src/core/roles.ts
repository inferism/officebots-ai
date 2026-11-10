import type { Rule, Settings } from "./config.js";
import type { OfficeEvent } from "./schema.js";

/** Built-in role names (PLAN.md §8 #6). Renames and rules from office.json apply on top, at display time. */
export function defaultRole(tool: string, agent: OfficeEvent["agent"]): string {
  if (tool === "claude-code") {
    if (agent.kind === "main") return "Lead";
    if (agent.type === "Explore") return "Explorer";
    if (agent.type === "Plan") return "Planner";
    return "Assistant";
  }
  if (tool === "codex" && agent.kind === "main") return "Coder";
  return "Agent";
}

type Who = { tool: string; model: string; role: string; nickname: string | null };

const matchesText = (pattern: string, value: string) => (pattern.endsWith("*") ? value.startsWith(pattern.slice(0, -1)) : pattern === value);

function matches(rule: Rule, who: Who): boolean {
  if (rule.tool !== undefined && rule.tool !== who.tool) return false;
  if (rule.model !== undefined && !matchesText(rule.model, who.model)) return false;
  if (rule.role !== undefined && rule.role !== who.role) return false;
  if (rule.account !== undefined && rule.account !== who.nickname) return false;
  return true;
}

/** Display role and color override for a character. The first matching rule wins, per property. */
export function resolveStyle(who: Who, settings: Settings): { role: string; color?: string } {
  let role: string | undefined;
  let color: string | undefined;
  for (const rule of settings.rules) {
    if (!matches(rule, who)) continue;
    role ??= rule.name;
    color ??= rule.color;
    if (role !== undefined && color !== undefined) break;
  }
  return { role: role ?? settings.roles[who.role] ?? who.role, ...(color ? { color } : {}) };
}
