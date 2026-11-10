// A stable address for each project's office, and a double-clickable file that goes to it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scriptSafeJson } from "./snapshot.js";

/** The IGNORE lines kept in .officebots/.gitignore: runtime files and the launcher (it holds a port). */
const IGNORED = [".state/", "office.html"];

/** Same project, same port, every time, so a bookmark keeps working. Range 49200-59199; the office falls back to any free port if it is taken. */
export function stablePort(projectKey: string): number {
  return 49200 + (parseInt(projectKey.slice(0, 6), 16) % 10000);
}

/** Creates .officebots/.gitignore, or adds any missing lines to ours. Never touches anything else. */
export function ensureGitignore(root: string): void {
  const dir = join(root, ".officebots");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, ".gitignore");
  const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
  const have = new Set(existing.split(/\r?\n/).map((l) => l.trim()));
  const missing = IGNORED.filter((l) => !have.has(l));
  if (missing.length === 0) return;
  const sep = existing === "" || existing.endsWith("\n") ? "" : "\n";
  writeFileSync(file, existing + sep + missing.join("\n") + "\n");
}

/**
 * The page behind .officebots/office.html. Opened from disk it asks the office at the recorded address
 * whether it is this project's (by project key), goes there if so, and otherwise explains how to start it.
 * It wears the same time-of-day colors as the office itself (a small copy of the palettes lives in its script).
 */
export function renderLauncherHtml(o: { port: number; key: string; name: string }): string {
  const data = scriptSafeJson({ url: `http://127.0.0.1:${o.port}/`, key: o.key, name: o.name });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>officebots</title>
<style>
  :root { --top: #f7f0e4; --bottom: #ead9bf; --panel: #fffdf8; --text: #4a3728; --soft: #8a7560; --line: #e5d8c4; --accent: #d97757; --accent-rgb: 217,119,87; --night: 0; --ui: "Trebuchet MS", "Segoe UI", system-ui, sans-serif; }
  html.mono { --ui: Consolas, "Courier New", monospace; }
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; }
  body { min-height: 100vh; display: grid; place-items: center; padding: 24px; font: 15px/1.55 var(--ui); color: var(--text); background: linear-gradient(var(--top), var(--bottom)) fixed; }
  main { width: min(34rem, 100%); padding: 30px 32px 28px; border-radius: 22px; background: var(--panel); border: 1px solid var(--line); box-shadow: 0 14px 40px rgba(0,0,0,.16), 0 0 calc(var(--night) * 30px) rgba(var(--accent-rgb), calc(var(--night) * .4)); }
  .brand { display: flex; align-items: center; gap: 14px; margin-bottom: 18px; }
  .brand b { display: block; font-size: 26px; line-height: 1.05; letter-spacing: .01em; }
  html.mono .brand b { text-transform: uppercase; letter-spacing: .12em; font-size: 22px; text-shadow: 0 0 calc(var(--night) * 14px) rgba(var(--accent-rgb), .8); }
  h1 { font-size: 20px; margin: 0 0 6px; }
  p { margin: 10px 0; color: var(--soft); }
  .who { display: inline-block; margin: 2px 0 6px; padding: 3px 12px; border-radius: 14px; border: 1px solid var(--line); color: var(--text); font-weight: 700; }
  code { padding: 1px 7px; border-radius: 6px; background: var(--line); color: var(--text); font-family: Consolas, "Courier New", monospace; font-size: .92em; }
  .addr { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--line); font-size: 13.5px; }
  #off { display: none; }
</style>
</head>
<body>
<main>
  <div class="brand">
    <svg viewBox="0 0 54 50" width="54" height="50" aria-hidden="true">
      <rect x="1" y="12" width="52" height="36" rx="11" fill="#f4efe6"/>
      <rect x="9" y="19" width="36" height="22" rx="6" fill="#27303f"/>
      <path d="M16 33 L20 27 L24 33 M30 33 L34 27 L38 33" fill="none" stroke="#7ff0cf" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M27 12 V4" stroke="#d97757" stroke-width="3" stroke-linecap="round"/>
      <circle cx="27" cy="4" r="3.6" fill="#d97757"/>
    </svg>
    <b>officebots</b>
  </div>
  <div id="on"><h1>Opening the office…</h1><p>One moment.</p></div>
  <div id="off">
    <h1>The office is not running</h1>
    <span class="who" id="who"></span>
    <p>It starts by itself when you open Claude Code in this project. To start it right now, run <code>officebots open</code> in the project folder (or type <code>/officebots</code> in Claude Code), then reload this page.</p>
    <p class="addr">Prefer a bookmark? The office uses the same address every time:<br><code id="addr"></code></p>
  </div>
</main>
<script>
  const target = ${data};
  // the same four looks as the office, blended by the local time (add ?time=18:45 to preview one)
  const P = {
    night: { top: [10, 7, 20], bottom: [23, 16, 52], panel: [20, 16, 46], text: [233, 230, 255], soft: [140, 136, 190], line: [96, 66, 170], accent: [55, 230, 255], n: 1 },
    dawn: { top: [196, 182, 220], bottom: [252, 226, 196], panel: [255, 250, 248], text: [86, 62, 64], soft: [150, 122, 122], line: [236, 214, 208], accent: [242, 128, 110], n: 0.3 },
    day: { top: [247, 240, 228], bottom: [234, 217, 191], panel: [255, 253, 248], text: [74, 55, 40], soft: [138, 117, 96], line: [229, 216, 196], accent: [217, 119, 87], n: 0 },
    dusk: { top: [92, 60, 120], bottom: [244, 176, 130], panel: [48, 34, 70], text: [255, 236, 224], soft: [206, 176, 176], line: [120, 80, 110], accent: [255, 150, 90], n: 0.58 },
  };
  const K = [[0, "night"], [4.75, "night"], [6.25, "dawn"], [8, "day"], [17, "day"], [18.75, "dusk"], [20.25, "night"], [24, "night"]];
  const mix = (a, b, t) => (Array.isArray(a) ? a.map((v, i) => mix(v, b[i], t)) : a + (b - a) * t);
  function look(h) {
    let i = 0;
    while (i < K.length - 2 && h > K[i + 1][0]) i++;
    const t0 = (h - K[i][0]) / (K[i + 1][0] - K[i][0] || 1), t = Math.min(1, Math.max(0, t0));
    const s = t * t * (3 - 2 * t), a = P[K[i][1]], b = P[K[i + 1][1]], out = {};
    for (const k in a) out[k] = mix(a[k], b[k], s);
    return out;
  }
  (function paint() {
    const tq = new URLSearchParams(location.search).get("time");
    const m = tq && /^([0-9]{1,2}):([0-9]{2})$/.exec(tq);
    const now = new Date();
    const hours = m ? +m[1] + +m[2] / 60 : now.getHours() + now.getMinutes() / 60;
    const p = look(hours % 24), css = (c) => "rgb(" + c.map(Math.round).join(",") + ")", set = (k, v) => document.documentElement.style.setProperty(k, v);
    set("--top", css(p.top)); set("--bottom", css(p.bottom)); set("--panel", css(p.panel)); set("--text", css(p.text));
    set("--soft", css(p.soft)); set("--line", css(p.line)); set("--accent", css(p.accent)); set("--accent-rgb", p.accent.map(Math.round).join(","));
    set("--night", String(p.n));
    document.documentElement.classList.toggle("mono", p.n > 0.5);
  })();
  const off = () => {
    document.getElementById("on").style.display = "none";
    document.getElementById("off").style.display = "block";
    document.getElementById("who").textContent = target.name;
    document.getElementById("addr").textContent = target.url;
  };
  fetch(target.url + "health", { cache: "no-store" })
    .then((r) => r.json())
    .then((j) => (j && j.project === target.key ? location.replace(target.url) : off()))
    .catch(off);
</script>
</body>
</html>
`;
}

/** Writes .officebots/office.html for the office that just started. */
export function writeLauncher(root: string, o: { port: number; key: string; name: string }): void {
  mkdirSync(join(root, ".officebots"), { recursive: true });
  writeFileSync(join(root, ".officebots", "office.html"), renderLauncherHtml(o));
}
