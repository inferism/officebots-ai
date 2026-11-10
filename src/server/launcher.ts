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
  :root { color-scheme: dark light; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #14161c; color: #e8eaf0; font: 15px/1.5 system-ui, sans-serif; }
  main { max-width: 34rem; padding: 2rem; }
  h1 { font-size: 1.3rem; margin: 0 0 .5rem; }
  p { margin: .6rem 0; color: #b4b9c8; }
  code { background: #232733; padding: .1rem .4rem; border-radius: 4px; color: #e8eaf0; }
  #off { display: none; }
</style>
</head>
<body>
<main>
  <div id="on"><h1>Opening the office…</h1></div>
  <div id="off">
    <h1>The office is not running</h1>
    <p id="who"></p>
    <p>It starts by itself when you open Claude Code in this project. To start it now, run <code>officebots open</code> in the project folder (or type <code>/officebots</code> in Claude Code), then reload this page.</p>
    <p>Prefer a bookmark? The office uses the same address every time: <code id="addr"></code></p>
  </div>
</main>
<script>
  const target = ${data};
  const off = () => {
    document.getElementById("on").style.display = "none";
    document.getElementById("off").style.display = "block";
    document.getElementById("who").textContent = "Project: " + target.name;
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
