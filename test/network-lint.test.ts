import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = join(import.meta.dirname, "..", "src");
function* walk(d: string): Generator<string> {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (p.endsWith(".ts")) yield p;
  }
}

// PLAN.md §3.4 rule 5: nothing in src/ may open outbound connections.
const FORBIDDEN: [string, RegExp][] = [
  ["fetch()", /\bfetch\s*\(/],
  ["https/tls/dns/dgram import", /from\s+["'](?:node:)?(?:https|tls|dns|dgram|http2)["']/],
  ["net.connect", /\b(?:net\.)?(?:connect|createConnection)\s*\(\s*(?:\{|\d)/],
  ["WebSocket client", /new\s+WebSocket\s*\(/],
  ["http client call", /\bhttp\.(?:request|get)\s*\(|\b(?:request|get)\s*\(\s*\{\s*host/],
];
const ALLOWED_PROBE = "server/probe.ts";

describe("network lint", () => {
  it("src/ has no outbound network calls except the loopback probe", () => {
    const hits: string[] = [];
    for (const f of walk(src)) {
      const rel = f.slice(src.length + 1).replaceAll("\\", "/");
      if (rel === ALLOWED_PROBE) continue;
      const text = readFileSync(f, "utf8");
      for (const [name, re] of FORBIDDEN) if (re.test(text)) hits.push(`${rel}: ${name}`);
    }
    expect(hits).toEqual([]);
  });

  it("the probe only ever targets 127.0.0.1", () => {
    const text = readFileSync(join(src, "server", "probe.ts"), "utf8");
    expect(text).toContain('host: "127.0.0.1"');
    expect(text.match(/host:/g)).toHaveLength(1);
  });

  it("servers bind to loopback only", () => {
    const text = readFileSync(join(src, "server", "office.ts"), "utf8");
    expect(text).toContain('listen(0, "127.0.0.1"');
  });
});
