// One office per project: free loopback port, run file, single instance.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { basename, join } from "node:path";
import { createProjectResolver, projectKey } from "../core/project.js";
import type { OfficeEvent } from "../core/schema.js";
import { createIngest, type Ingest } from "../watcher/ingest.js";
import { createHttpServer } from "./http.js";
import { probeOffice } from "./probe.js";
import { createRoom, type Room } from "./room.js";
import { attachWs } from "./ws.js";

export type OfficeOptions = {
  /** Project root folder. */
  root: string;
  /** Directory holding Claude Code project logs. Omit for demo mode: no log reading, no files written. */
  claudeProjectsDir?: string;
  /** Folder with the built UI (index.html plus assets). */
  uiDir: string;
  idleAfterSec?: number;
  recentMs?: number;
  now?: () => number;
  onProblem?: (msg: string) => void;
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

function pidAlive(pid: unknown): boolean {
  if (typeof pid !== "number") return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function startOffice(opts: OfficeOptions): Promise<Office> {
  const now = opts.now ?? Date.now;
  const runFile = runFilePath(opts.root);
  const live = opts.claudeProjectsDir !== undefined;

  if (live && existsSync(runFile)) {
    try {
      const prev = JSON.parse(readFileSync(runFile, "utf8"));
      if (pidAlive(prev.pid) && typeof prev.port === "number" && (await probeOffice(prev.port))) {
        throw new AlreadyRunningError(`http://127.0.0.1:${prev.port}`);
      }
    } catch (e) {
      if (e instanceof AlreadyRunningError) throw e;
    }
  }

  const key = projectKey(opts.root);
  const room = createRoom({ key, name: basename(opts.root) }, { idleAfterSec: opts.idleAfterSec });
  let port = 0;
  const server = createHttpServer({ uiDir: opts.uiDir, getPort: () => port, project: { key } });
  let lastSent = "";
  const snapshotJson = () => JSON.stringify({ type: "room", room: room.snapshot(now()) });
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
  if (opts.claudeProjectsDir) {
    const resolve = createProjectResolver();
    ingest = createIngest({
      root: opts.claudeProjectsDir,
      project: (cwd) => (resolve(cwd) === key ? key : null),
      onEvents: apply,
      onProblem: opts.onProblem,
      recentMs: opts.recentMs,
      now,
    });
  }

  await new Promise<void>((res, rej) => {
    server.once("error", rej);
    server.listen(0, "127.0.0.1", res);
  });
  port = (server.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}`;

  if (live) {
    mkdirSync(join(opts.root, ".officebots", ".state"), { recursive: true });
    const ignore = join(opts.root, ".officebots", ".gitignore");
    if (!existsSync(ignore)) writeFileSync(ignore, ".state/\n");
    writeFileSync(runFile, JSON.stringify({ port, pid: process.pid, url, startedAt: new Date().toISOString() }));
  }

  await ingest?.start();
  push();

  return {
    url,
    port,
    ingest,
    apply,
    snapshot: () => room.snapshot(now()),
    async close() {
      clearInterval(tick);
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
