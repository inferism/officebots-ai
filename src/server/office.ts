// One office per project: free loopback port, run file, single instance.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { basename, dirname, join } from "node:path";
import type { Source } from "../adapters/index.js";
import { emptySettings, loadSettings, projectConfigPath, type Settings } from "../core/config.js";
import { createAccountHasher, personalConfigPath } from "../core/identity.js";
import { createProjectResolver, projectKey } from "../core/project.js";
import type { OfficeEvent } from "../core/schema.js";
import { createIngest, type Ingest } from "../watcher/ingest.js";
import { watchFiles } from "../watcher/settings.js";
import { createHttpServer } from "./http.js";
import { ensureGitignore, stablePort, writeLauncher } from "./launcher.js";
import { findOfficePort } from "./loopback.js";
import { createRoom, type Room } from "./room.js";
import { attachWs } from "./ws.js";

export type OfficeOptions = {
  /** Project root folder. */
  root: string;
  /** Log folders to watch (Claude Code, Codex, ...). Omit for demo mode: no log reading, no files written. */
  logSources?: Source[];
  /** Personal config (nicknames, salt). Defaults to ~/.config/officebots/config.json. */
  personalConfigPath?: string;
  /** Hashes raw account ids found in logs. Defaults to a salted hash with the salt in the personal config. */
  hashAccount?: (raw: string) => string;
  /** Folder with the built UI (index.html plus assets). */
  uiDir: string;
  idleAfterSec?: number;
  recentMs?: number;
  now?: () => number;
  onProblem?: (msg: string) => void;
  /** Called when the project's .officebots/.state/run.json disappears (the folder was deleted): the office has nothing left to serve. */
  onOrphaned?: () => void;
  /** How often (ms) the settings files are checked for edits. Default 500. */
  settingsPollMs?: number;
  /** Max snapshot pushes per second is 1000 / throttleMs. Default 250 (4/s). */
  throttleMs?: number;
};

export type Office = {
  url: string;
  port: number;
  ingest: Ingest | undefined;
  /** Feed events straight into the room (used by the demo generator). */
  apply(events: OfficeEvent[]): void;
  snapshot(): Room;
  close(): Promise<void>;
};

export class AlreadyRunningError extends Error {
  constructor(public url: string) {
    super(`an office is already running for this project at ${url}`);
  }
}

const runFilePath = (root: string) => join(root, ".officebots", ".state", "run.json");

export async function startOffice(opts: OfficeOptions): Promise<Office> {
  const now = opts.now ?? Date.now;
  const runFile = runFilePath(opts.root);
  const live = opts.logSources !== undefined;
  const personalPath = opts.personalConfigPath ?? personalConfigPath();

  if (live) {
    const running = await findOfficePort(opts.root);
    if (running !== null) throw new AlreadyRunningError(`http://127.0.0.1:${running}`);
  }

  const key = projectKey(opts.root);
  const room = createRoom({ key, name: basename(opts.root) }, { idleAfterSec: opts.idleAfterSec });
  let port = 0;
  const server = createHttpServer({ uiDir: opts.uiDir, getPort: () => port, project: { key }, onEvents: (events) => apply(events) });
  let lastSent = "";
  let settings: Settings = emptySettings();
  const snapshotJson = () => JSON.stringify({ type: "room", room: room.snapshot(now(), settings) });
  const ws = attachWs(server, () => port, (send) => send(snapshotJson()));

  // Push at most once per throttleMs, only when the snapshot changed. The tick also catches
  // time-based changes (a character falling asleep) that no event announces.
  const throttleMs = opts.throttleMs ?? 250;
  let lastPush = 0;
  let timer: NodeJS.Timeout | undefined;
  const push = () => {
    timer = undefined;
    const json = snapshotJson();
    if (json === lastSent) return;
    lastSent = json;
    lastPush = Date.now();
    ws.broadcast(json);
  };
  const schedule = () => {
    if (timer) return;
    timer = setTimeout(push, Math.max(0, throttleMs - (Date.now() - lastPush)));
  };
  const tick = setInterval(schedule, 1000);
  const apply = (events: OfficeEvent[]) => {
    for (const e of events) room.apply(e);
    schedule();
  };

  let ingest: Ingest | undefined;
  if (opts.logSources) {
    const resolve = createProjectResolver();
    ingest = createIngest({
      sources: opts.logSources,
      hashAccount: opts.hashAccount ?? createAccountHasher(personalPath),
      project: (cwd) => (resolve(cwd) === key ? key : null),
      onEvents: apply,
      onProblem: opts.onProblem,
      recentMs: opts.recentMs,
      now,
    });
  }

  const listenOn = (p: number) =>
    new Promise<void>((res, rej) => {
      const onError = (e: Error) => rej(e);
      server.once("error", onError);
      server.listen(p, "127.0.0.1", () => {
        server.removeListener("error", onError);
        res();
      });
    });
  try {
    // a real office keeps the same address between runs, so bookmarks and .officebots/office.html keep working
    await listenOn(live ? stablePort(key) : 0);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EADDRINUSE") throw e;
    await listenOn(0); // something else has that port: any free one will do
  }
  port = (server.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}`;

  if (live) {
    mkdirSync(join(opts.root, ".officebots", ".state"), { recursive: true });
    ensureGitignore(opts.root);
    writeLauncher(opts.root, { port, key, name: basename(opts.root) });
    writeFileSync(runFile, JSON.stringify({ port, pid: process.pid, url, startedAt: new Date().toISOString() }));
    rmSync(join(opts.root, ".officebots", ".state", "start.lock"), { force: true }); // up now: release the start lock
  }

  // Role names, rules and nicknames: read now and again whenever either file changes, no restart needed.
  let settingsWatch: { close(): void } | undefined;
  if (live) {
    const reload = () => {
      const loaded = loadSettings(opts.root, personalPath);
      settings = loaded.value;
      for (const p of loaded.problems) opts.onProblem?.(`settings: ${p}`);
      schedule();
    };
    mkdirSync(dirname(personalPath), { recursive: true });
    reload();
    settingsWatch = watchFiles([projectConfigPath(opts.root), personalPath], reload, opts.settingsPollMs);
  }

  await ingest?.start();
  push();

  // If someone deletes .officebots while the office runs, notice and let the caller shut it down.
  let orphanTimer: NodeJS.Timeout | undefined;
  if (live && opts.onOrphaned) {
    let missing = 0;
    orphanTimer = setInterval(() => {
      missing = existsSync(runFile) ? 0 : missing + 1;
      if (missing >= 3) {
        clearInterval(orphanTimer);
        opts.onOrphaned!();
      }
    }, 1000);
    orphanTimer.unref();
  }

  return {
    url,
    port,
    ingest,
    apply,
    snapshot: () => room.snapshot(now(), settings),
    async close() {
      clearInterval(tick);
      clearInterval(orphanTimer);
      settingsWatch?.close();
      clearTimeout(timer);
      ingest?.close();
      ws.close();
      await new Promise<void>((r) => server.close(() => r()));
      if (!live) return;
      try {
        if (JSON.parse(readFileSync(runFile, "utf8")).port === port) rmSync(runFile);
      } catch {
        // already gone
      }
    },
  };
}
