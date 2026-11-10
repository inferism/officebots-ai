import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { claudeProjectsDir, isSessionFile } from "../adapters/claude-code/files.js";
import { createIngest } from "../watcher/ingest.js";

function* walk(dir: string): Generator<string> {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (isSessionFile(p)) yield p;
  }
}

/** Prints watched roots and counts only: file counts, record type names and error totals. */
export async function doctor(args: string[]): Promise<void> {
  const ci = args.indexOf("--claude-dir");
  const root = ci >= 0 && args[ci + 1] ? args[ci + 1]! : claudeProjectsDir();
  console.log(`watched root: ${root}`);
  if (!existsSync(root)) {
    console.log("  not found (nothing to watch yet)");
    return;
  }
  let files = 0;
  for (const _ of walk(root)) files++;
  console.log(`  session files: ${files}`);

  const day = 24 * 60 * 60 * 1000;
  const ingest = createIngest({ root, project: () => "doctor", onEvents: () => {}, recentMs: day });
  await ingest.start(); // reads files changed in the last 24 h, no watching needed
  ingest.close();
  console.log(`  scanned (changed in last 24 h): events=${ingest.stats.events} parse errors=${ingest.stats.errors}`);
  const unknown = Object.entries(ingest.stats.unknownTypes).sort((a, b) => b[1] - a[1]);
  if (unknown.length === 0) console.log("  unknown record types: none");
  else {
    console.log("  unknown record types:");
    for (const [name, n] of unknown) console.log(`    ${name}: ${n}`);
  }
}
