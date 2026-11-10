import type { OfficeEvent } from "./schema.js";

/** Default role names (PLAN.md §8 #6). Per-project overrides arrive with .officebots/office.json. */
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
