import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { isSessionFile, readAgentType } from "../adapters/claude-code/files.js";
import { createClaudeCodeParser } from "../adapters/claude-code/parse.js";
import type { LineParser } from "../adapters/types.js";
import type { OfficeEvent } from "../core/schema.js";
import { Tailer } from "./tail.js";
import { watchRoot } from "./watch.js";

export type IngestOptions = {
  root: string;
  /** cwd -> project key, or null to drop the record. */
  project: (cwd: string) => string | null;
  onEvents: (events: OfficeEvent[], file: string) => void;
  /** Receives "file#line: kind" strings only, never log content. */
  onProblem?: (msg: string) => void;
  /** At startup, files changed within this window are read from the start; older ones only from now on. */
  recentMs?: number;
  now?: () => number;
  debounceMs?: number;
};

export type Ingest = {
  start(): Promise<void>;
  /** Resolves when all queued file reads have finished. */
  idle(): Promise<void>;
  close(): void;
  stats: { unknownTypes: Record<string, number>; errors: number; events: number };
};

function* walk(dir: string): Generator<string> {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const n of names) {
    const p = join(dir, n);
    let isDir = false;
    try {
      isDir = statSync(p).isDirectory();
    } catch {
      continue;
    }
    if (isDir) yield* walk(p);
    else if (isSessionFile(p)) yield p;
  }
}

export function createIngest(opts: IngestOptions): Ingest {
  const tailer = new Tailer();
  const parsers = new Map<string, LineParser>();
  const queue = new Map<string, Promise<void>>();
  const stats: Ingest["stats"] = { unknownTypes: {}, errors: 0, events: 0 };
  const recentMs = opts.recentMs ?? 2 * 60 * 60 * 1000;
  const now = opts.now ?? Date.now;
  let ready: Promise<void> = Promise.resolve();
  let watcher: { close(): void } | undefined;
  let closed = false;

  function parserFor(file: string): LineParser {
    let p = parsers.get(file);
    if (!p) {
      const sub = /[\\/]agent-[^\\/]+\.jsonl$/.test(file);
      p = createClaudeCodeParser({
        project: opts.project,
        agentType: sub ? () => readAgentType(file) : undefined,
      });
      parsers.set(file, p);
    }
    return p;
  }

  async function processFile(file: string): Promise<void> {
    if (closed || !existsSync(file)) return;
    try {
      for await (const { lines, firstLine } of tailer.read(file)) {
        const r = parserFor(file).parse(lines, firstLine);
        for (const [k, n] of Object.entries(r.stats.unknownTypes)) {
          stats.unknownTypes[k] = (stats.unknownTypes[k] ?? 0) + n;
        }
        for (const e of r.stats.errors) {
          stats.errors++;
          opts.onProblem?.(`${file}#${e.line}: ${e.kind}`);
        }
        if (r.events.length) {
          stats.events += r.events.length;
          opts.onEvents(r.events, file);
        }
      }
    } catch (err) {
      opts.onProblem?.(`${file}: ${(err as NodeJS.ErrnoException).code ?? "read error"}`);
    }
  }

  function enqueue(file: string): void {
    const prev = queue.get(file) ?? Promise.resolve();
    const next = prev.then(() => ready).then(() => processFile(file));
    queue.set(file, next);
    void next.finally(() => {
      if (queue.get(file) === next) queue.delete(file);
    });
  }

  /** Register every existing log. On the first scan, old files are skipped to their end. */
  function scan(initial: boolean): void {
    for (const file of walk(opts.root)) {
      if (tailer.has(file)) {
        if (!initial) enqueue(file);
        continue;
      }
      let st;
      try {
        st = statSync(file);
      } catch {
        continue;
      }
      if (initial && now() - st.mtimeMs > recentMs) tailer.skipToEnd(file, st.size);
      else enqueue(file);
    }
  }

  return {
    stats,
    async start() {
      let release!: () => void;
      ready = new Promise((r) => (release = r));
      if (existsSync(opts.root)) {
        watcher = watchRoot(
          opts.root,
          (f) => enqueue(f),
          (err) => {
            opts.onProblem?.(`watcher error: ${err.name}`);
            scan(false); // reconcile after a watcher failure
          },
          opts.debounceMs,
        );
      } else {
        opts.onProblem?.("watch root does not exist");
      }
      scan(true);
      release();
      await this.idle();
    },
    async idle() {
      while (queue.size > 0) await Promise.allSettled([...queue.values()]);
    },
    close() {
      closed = true;
      watcher?.close();
    },
  };
}
