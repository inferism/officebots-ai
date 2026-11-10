import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { withAccounts } from "../adapters/index.js";
import { createAccountHasher, personalConfigPath } from "../core/identity.js";
import { findProjectRoot } from "../core/project.js";
import { openBrowser } from "../server/launch.js";
import { buildSnapshot, renderSnapshotHtml } from "../server/snapshot.js";
import { DEFAULT_SINCE_MS, parseSince, pickSources } from "./start.js";

/**
 * `officebots export`: write a standalone HTML file showing this project's office as it is now.
 * It needs no server and no network, so it can be opened from anywhere or shared. It is a snapshot, not live.
 */
export async function exportHtml(args: string[], usage: () => never): Promise<void> {
  const oi = args.indexOf("--out");
  if (oi >= 0 && !args[oi + 1]) usage();
  const root = findProjectRoot(process.cwd()) ?? process.cwd();
  const out = resolve(oi >= 0 ? args[oi + 1]! : join(root, ".officebots", ".state", "office.html"));

  const personalPath = personalConfigPath();
  const hash = createAccountHasher(personalPath);
  const sources = withAccounts(pickSources(args, personalPath, usage), { hash, personalPath });
  const takenAt = new Date();
  const room = await buildSnapshot({
    root,
    sources,
    hashAccount: hash,
    personalConfigPath: personalPath,
    sinceMs: parseSince(args, usage) ?? DEFAULT_SINCE_MS,
    now: () => takenAt.getTime(),
  });

  const ui = fileURLToPath(new URL("./ui/", import.meta.url));
  const html = renderSnapshotHtml({
    indexHtml: readFileSync(join(ui, "index.html"), "utf8"),
    css: readFileSync(join(ui, "style.css"), "utf8"),
    js: readFileSync(join(ui, "app.js"), "utf8"),
    room,
    takenAt,
  });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  console.log(`officebots: wrote ${out}`);
  console.log(`${room.characters.length} character${room.characters.length === 1 ? "" : "s"}, ${room.totals.headline.toLocaleString()} tokens (a snapshot, not live)`);
  if (!args.includes("--no-open")) openBrowser(out);
}
