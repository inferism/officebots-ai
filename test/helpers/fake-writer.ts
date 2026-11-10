import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** One hand-built assistant record: fake ids and no text. */
export function assistantLine(o: {
  session: string;
  msgId: string;
  cwd: string;
  time?: string;
  model?: string;
  stop?: string | null;
  output?: number;
  agentId?: string;
}): string {
  return JSON.stringify({
    type: "assistant",
    uuid: `rec-${o.msgId}`,
    sessionId: o.session,
    timestamp: o.time ?? new Date().toISOString(),
    cwd: o.cwd,
    ...(o.agentId ? { agentId: o.agentId, isSidechain: true } : {}),
    message: {
      id: o.msgId,
      role: "assistant",
      model: o.model ?? "claude-sonnet-5-5",
      usage: { input_tokens: 1, output_tokens: o.output ?? 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      stop_reason: o.stop === undefined ? "end_turn" : o.stop,
      content: [{ type: "text", text: "<redacted>" }],
    },
  });
}

/** Appends lines (each newline-terminated) to a file, creating folders as needed. */
export function appendLines(file: string, lines: string[]): void {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, lines.map((l) => l + "\n").join(""));
}
