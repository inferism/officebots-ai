// A one-shot snapshot of a project's office: read the logs once, build the room, no server involved.
// Also builds the standalone HTML page that shows it.
import { createIngest } from "../watcher/ingest.js";
import type { Source } from "../adapters/index.js";
import { loadSettings } from "../core/config.js";
import { createProjectResolver, projectKey } from "../core/project.js";
import { basename } from "node:path";
import { createRoom, type Room } from "./room.js";

export type SnapshotOptions = {
  root: string;
  sources: Source[];
  hashAccount: (raw: string) => string;
  personalConfigPath: string;
  /** Sessions with log activity this recent are included. */
  sinceMs: number;
  idleAfterSec?: number;
  now?: () => number;
  onProblem?: (msg: string) => void;
};

export async function buildSnapshot(o: SnapshotOptions): Promise<Room> {
  const now = o.now ?? Date.now;
  const key = projectKey(o.root);
  const room = createRoom({ key, name: basename(o.root) }, { idleAfterSec: o.idleAfterSec });
  const resolve = createProjectResolver();
  const ingest = createIngest({
    sources: o.sources,
    project: (cwd) => (resolve(cwd) === key ? key : null),
    hashAccount: o.hashAccount,
    onEvents: (events) => events.forEach((e) => room.apply(e)),
    onProblem: o.onProblem,
    recentMs: o.sinceMs,
    now,
  });
  await ingest.start(); // reads everything in the window; the watchers are not needed
  ingest.close();
  return room.snapshot(now(), loadSettings(o.root, o.personalConfigPath).value);
}

/** JSON that is safe to put inside a <script> element: no "</script>" or HTML comment can end it early. */
export function scriptSafeJson(value: unknown): string {
  const lineSep = String.fromCharCode(0x2028);
  const paraSep = String.fromCharCode(0x2029);
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .split(lineSep).join("\\u2028")
    .split(paraSep).join("\\u2029");
}

/** One self-contained HTML file: styles, the app and the room are all inline, nothing loads from anywhere. */
export function renderSnapshotHtml(parts: { indexHtml: string; css: string; js: string; room: Room; takenAt: Date }): string {
  const data = scriptSafeJson({ room: parts.room, takenAt: parts.takenAt.toISOString() });
  const js = parts.js.replace(/<\/script/gi, "<\\/script");
  const css = parts.css.replace(/<\/style/gi, "<\\/style");
  return parts.indexHtml
    .replace('<link rel="stylesheet" href="/style.css">', () => `<style>\n${css}\n</style>`)
    .replace('<script src="/app.js"></script>', () => `<script>window.__OFFICEBOTS_SNAPSHOT__ = ${data};</script>\n<script>\n${js}\n</script>`);
}
