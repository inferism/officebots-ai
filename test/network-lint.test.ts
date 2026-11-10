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
const ALLOWED_LOOPBACK = "server/loopback.ts";
// launcher.ts holds the page behind .officebots/office.html. Its browser-side script asks the office for /health; see the test below.
const ALLOWED_LAUNCHER = "server/launcher.ts";

describe("network lint", () => {
  it("src/ has no outbound network calls except the loopback helper", () => {
    const hits: string[] = [];
    for (const f of walk(src)) {
      const rel = f.slice(src.length + 1).replaceAll("\\", "/");
      if (rel === ALLOWED_LOOPBACK || rel === ALLOWED_LAUNCHER) continue;
      const text = readFileSync(f, "utf8");
      for (const [name, re] of FORBIDDEN) if (re.test(text)) hits.push(`${rel}: ${name}`);
    }
    expect(hits).toEqual([]);
  });

  it("the loopback helper only ever targets 127.0.0.1", () => {
    const text = readFileSync(join(src, "server", "loopback.ts"), "utf8");
    const hosts = text.match(/host: [^,]+/g) ?? [];
    expect(hosts.length).toBeGreaterThanOrEqual(2); // health check and event delivery
    expect(hosts.every((h) => h === 'host: "127.0.0.1"')).toBe(true);
  });

  it("the launcher page only ever asks the office's own loopback address", () => {
    const text = readFileSync(join(src, "server", "launcher.ts"), "utf8");
    const calls = text.match(/fetch\(([^)]*)\)/g) ?? [];
    expect(calls).toHaveLength(1); // one request in the page's script
    expect(calls[0]).toContain('target.url + "health"');
    // and target.url is only ever built from the loopback address plus the office's own port
    expect(text).toContain("url: `http://127.0.0.1:${o.port}/`");
    expect((text.match(/https?:\/\//g) ?? []).length).toBe(1);
  });

  it("servers bind to loopback only", () => {
    const text = readFileSync(join(src, "server", "office.ts"), "utf8");
    expect(text).toMatch(/\.listen\(\w+, "127\.0\.0\.1"/);
  });
});
