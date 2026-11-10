import { existsSync } from "node:fs";
import { allAdapters } from "../adapters/index.js";
import { createIngest } from "../watcher/ingest.js";

/** Prints watched roots and counts only: record type names, event and error totals. Never content. */
export async function doctor(args: string[]): Promise<void> {
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const overrides: Record<string, string | undefined> = { "claude-code": flag("--claude-dir"), codex: flag("--codex-dir") };
  const day = 24 * 60 * 60 * 1000;

  for (const adapter of allAdapters) {
    const roots = overrides[adapter.name] ? [overrides[adapter.name]!] : adapter.roots(process.env);
    for (const root of roots) {
      console.log(`${adapter.name}: ${root}`);
      if (!existsSync(root)) {
        console.log("  not found (nothing to watch yet)");
        continue;
      }
      // Everything is counted as "ours" here, so no project filter hides unknown records.
      const ingest = createIngest({ sources: [{ adapter, root }], project: () => "doctor", hashAccount: () => "acct_doctor", onEvents: () => {}, recentMs: day, catchUpOld: false });
      await ingest.start(); // reads files changed in the last 24 h
      ingest.close();
      console.log(`  scanned (changed in last 24 h): events=${ingest.stats.events} parse errors=${ingest.stats.errors}`);
      console.log(`  events by type: ${Object.entries(ingest.stats.byEvent).map(([k, n]) => `${k}=${n}`).join(" ") || "none"}`);
      const unknown = Object.entries(ingest.stats.unknownTypes).sort((a, b) => b[1] - a[1]);
      if (unknown.length === 0) console.log("  unknown record types: none");
      else {
        console.log("  unknown record types:");
        for (const [name, n] of unknown) console.log(`    ${name}: ${n}`);
      }
    }
  }
}
