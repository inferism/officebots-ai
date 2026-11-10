import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { claudeCodeAdapter, codexAdapter } from "../../src/adapters/index.js";
import { hashAccount } from "../../src/core/identity.js";
import { startOffice, type Office } from "../../src/server/office.js";
import type { Room } from "../../src/server/room.js";
import { appendLines, assistantLine } from "../helpers/fake-writer.js";

const fx = join(import.meta.dirname, "..", "fixtures", "codex", "2026/11/10");
let base: string;
let office: Office | undefined;
beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "officebots-two-")));
});
afterEach(async () => {
  await office?.close();
  office = undefined;
  rmSync(base, { recursive: true, force: true });
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 8000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timeout");
    await sleep(25);
  }
}
const fwd = (p: string) => p.replaceAll("\\", "/");

describe("a Claude Code session and a Codex session in the same repo", () => {
  it("show up as two different characters, each with its own tokens", async () => {
    const repo = join(base, "repo");
    mkdirSync(join(repo, ".git"), { recursive: true });
    mkdirSync(join(repo, "sub"));
    const other = join(base, "other");
    mkdirSync(join(other, ".git"), { recursive: true });
    const claude = join(base, "claude", "projects");
    const codex = join(base, "codex", "sessions", "2026", "11", "10");
    mkdirSync(claude, { recursive: true });
    mkdirSync(codex, { recursive: true });
    const ui = join(base, "ui");
    mkdirSync(ui);
    writeFileSync(join(ui, "index.html"), "x");

    office = await startOffice({
      root: repo,
      uiDir: ui,
      throttleMs: 20,
      hashAccount: (r) => hashAccount(r, "salt"),
      logSources: [
        { adapter: claudeCodeAdapter, root: claude },
        { adapter: codexAdapter, root: join(base, "codex", "sessions") },
      ],
    });
    const seen: Room[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${office.port}/ws`);
    ws.on("message", (d) => seen.push(JSON.parse(String(d)).room));

    // Claude Code works in a subfolder of the repo
    appendLines(join(claude, "-p", "s.jsonl"), [assistantLine({ session: "sess-1", msgId: "m1", cwd: join(repo, "sub"), stop: "tool_use", output: 111 })]);
    // Codex works in the repo root (hand-written fixture with the folder swapped in)
    const swap = (file: string, to: string) => readFileSync(join(fx, file), "utf8").replaceAll("/home/dev/demo-project", fwd(to));
    writeFileSync(join(codex, "rollout-2026-11-10T11-02-14-thread-0001.jsonl"), swap("rollout-2026-11-10T11-02-14-thread-0001.jsonl", repo));
    // a Codex thread in a different repo must not appear
    writeFileSync(join(codex, "rollout-2026-11-10T11-06-00-thread-0009.jsonl"), swap("rollout-2026-11-10T11-02-14-thread-0001.jsonl", other));

    await until(() => (seen.at(-1)?.characters.length ?? 0) >= 2);
    await sleep(300);
    ws.close();
    const room = seen.at(-1)!;

    // the Codex thread switches model mid-way (gpt-6.1-sol -> gpt-6.1-mini), so its work shows on two desks
    expect(room.characters).toHaveLength(3);
    const cc = room.characters.filter((c) => c.tool === "claude-code");
    const cx = room.characters.filter((c) => c.tool === "codex");
    expect(cc).toHaveLength(1);
    expect(cx.map((c) => c.model).sort()).toEqual(["gpt-6.1-mini", "gpt-6.1-sol"]);
    expect(cc[0]!.role).toBe("Lead");
    expect(cx.every((c) => c.role === "Coder")).toBe(true);
    expect(cx.every((c) => c.color !== cc[0]!.color)).toBe(true); // different tool and model, different color
    expect(cc[0]!.tokens.output).toBe(111);
    expect(cx.reduce((n, c) => n + c.tokens.output, 0)).toBe(900); // only the thread in this repo
    expect(JSON.stringify(room)).not.toContain("fake-account");
  });
});
