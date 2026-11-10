import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import type { Adapter, LineParser, ParseContext } from "../adapters/types.js";
import type { Source } from "../adapters/index.js";
import type { OfficeEvent } from "../core/schema.js";
import { readHead, Tailer } from "./tail.js";
import { watchRoot } from "./watch.js";

export type IngestOptions = {
  /** Log folders to watch, each with the adapter that understands it. */
  sources: Source[];
  /** cwd -> project key, or null to drop the record. */
  project: (cwd: string) => string | null;
  hashAccount?: (raw: string) => string;
  onEvents: (events: OfficeEvent[], file: string) => void;
  /** Receives "file#line: kind" strings only, never log content. */
  onProblem?: (msg: string) => void;
  /** Replay old matching files silently so running totals are right. Off for read-only scans like doctor. */
  catchUpOld?: boolean;
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
  stats: { unknownTypes: Record<string, number>; errors: number; events: number; byEvent: Record<string, number> };
};

function* walk(dir: string, adapter: Adapter): Generator<string> {
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
    if (isDir) yield* walk(p, adapter);
    else if (adapter.matches(p)) yield p;
  }
}

export function createIngest(opts: IngestOptions): Ingest {
  const tailer = new Tailer();
  const parsers = new Map<string, LineParser>();
  const queue = new Map<string, Promise<void>>();
  const adapterOf = new Map<string, Adapter>();
  // who the logs under each source belong to (Claude Code logs carry no account themselves)
  const accountOf = new Map<string, Pick<ParseContext, "account" | "accountFor">>();
  // Per conversation (thread key): ids emitted from its live file, so a later compressed copy adds
  // only what was missed; and threads we caught up on silently, whose compressed copy is skipped.
  const liveIds = new Map<string, Set<string>>();
  const silentKeys = new Set<string>();
  const doneCompressed = new Set<string>();
  const stats: Ingest["stats"] = { unknownTypes: {}, errors: 0, events: 0, byEvent: {} };
  const recentMs = opts.recentMs ?? 2 * 60 * 60 * 1000;
  const now = opts.now ?? Date.now;
  let ready: Promise<void> = Promise.resolve();
  const watchers: { close(): void }[] = [];
  let closed = false;

  const newParser = (file: string, adapter: Adapter) =>
    adapter.createParser(file, { project: opts.project, hashAccount: opts.hashAccount, ...accountOf.get(file) });

  function parserFor(file: string, adapter: Adapter): LineParser {
    let p = parsers.get(file);
    if (!p) {
      p = newParser(file, adapter);
      parsers.set(file, p);
    }
    return p;
  }

  function account(r: ReturnType<LineParser["parse"]>, file: string): void {
    for (const [k, n] of Object.entries(r.stats.unknownTypes)) stats.unknownTypes[k] = (stats.unknownTypes[k] ?? 0) + n;
    for (const e of r.stats.errors) {
      stats.errors++;
      opts.onProblem?.(`${file}#${e.line}: ${e.kind}`);
    }
  }

  function emit(events: OfficeEvent[], file: string): void {
    if (!events.length) return;
    stats.events += events.length;
    for (const e of events) stats.byEvent[e.event] = (stats.byEvent[e.event] ?? 0) + 1;
    opts.onEvents(events, file);
  }

  async function processFile(file: string): Promise<void> {
    const adapter = adapterOf.get(file);
    if (closed || !adapter || !existsSync(file)) return;
    const key = adapter.threadKey?.(file);
    try {
      if (adapter.compressed?.(file)) return processCompressed(file, adapter, key);
      for await (const { lines, firstLine } of tailer.read(file)) {
        const r = parserFor(file, adapter).parse(lines, firstLine);
        account(r, file);
        if (key) {
          const ids = liveIds.get(key) ?? new Set<string>();
          for (const e of r.events) ids.add(e.id);
          liveIds.set(key, ids);
        }
        emit(r.events, file);
      }
    } catch (err) {
      opts.onProblem?.(`${file}: ${(err as NodeJS.ErrnoException).code ?? "read error"}`);
    }
  }

  function processCompressed(file: string, adapter: Adapter, key: string | undefined): void {
    if (doneCompressed.has(file) || (key && silentKeys.has(key))) return;
    let lines: string[];
    try {
      lines = zstdDecompressSync(readFileSync(file)).toString("utf8").split("\n");
    } catch {
      opts.onProblem?.(`${file}: zstd error`); // may still be mid-compression; a later change retries
      return;
    }
    const r = newParser(file, adapter).parse(lines);
    account(r, file);
    const seen = key ? liveIds.get(key) : undefined;
    emit(seen ? r.events.filter((e) => !seen.has(e.id)) : r.events, file);
    doneCompressed.add(file);
    if (key) liveIds.delete(key);
  }

  function enqueue(file: string): void {
    const prev = queue.get(file) ?? Promise.resolve();
    const next = prev.then(() => ready).then(() => processFile(file));
    queue.set(file, next);
    void next.finally(() => {
      if (queue.get(file) === next) queue.delete(file);
    });
  }

  /** Old live file of a tool that needs its head: keep it only if it belongs to this project. */
  async function catchUp(file: string, adapter: Adapter, size: number): Promise<void> {
    const key = adapter.threadKey?.(file);
    try {
      const probe = newParser(file, adapter);
      probe.parse(await readHead(file), 1, true);
      const cwd = probe.cwd?.();
      if (!cwd || !opts.project(cwd)) return tailer.skipToEnd(file, size);
      // Ours: replay silently so running totals are right when new lines arrive, without counting history.
      const parser = parserFor(file, adapter);
      for await (const { lines, firstLine } of tailer.read(file)) parser.parse(lines, firstLine, true);
      if (key) silentKeys.add(key);
    } catch {
      tailer.skipToEnd(file, size);
    }
  }

  /** Register every existing log. On the first scan, old files are skipped to their end. */
  function scan(initial: boolean): void {
    for (const { adapter, root, account, accountFor } of opts.sources) {
      for (const file of walk(root, adapter)) {
        adapterOf.set(file, adapter);
        accountOf.set(file, { account, accountFor });
        if (tailer.has(file) || doneCompressed.has(file)) {
          if (!initial) enqueue(file);
          continue;
        }
        let st;
        try {
          st = statSync(file);
        } catch {
          continue;
        }
        const old = initial && now() - st.mtimeMs > recentMs;
        if (!old) enqueue(file);
        else if (adapter.compressed?.(file)) doneCompressed.add(file);
        else if (adapter.needsHead && opts.catchUpOld !== false) {
          const p = catchUp(file, adapter, st.size);
          queue.set(file, p);
          void p.finally(() => queue.get(file) === p && queue.delete(file));
        } else tailer.skipToEnd(file, st.size);
      }
    }
  }

  return {
    stats,
    async start() {
      let release!: () => void;
      ready = new Promise((r) => (release = r));
      for (const src of opts.sources) {
        if (!existsSync(src.root)) {
          opts.onProblem?.("watch root does not exist");
          continue;
        }
        watchers.push(
          watchRoot(
            src.root,
            (f) => {
              adapterOf.set(f, src.adapter);
              accountOf.set(f, { account: src.account, accountFor: src.accountFor });
              enqueue(f);
            },
            (err) => {
              opts.onProblem?.(`watcher error: ${err.name}`);
              scan(false); // reconcile after a watcher failure
            },
            opts.debounceMs,
            src.adapter.matches,
          ),
        );
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
      for (const w of watchers) w.close();
    },
  };
}
