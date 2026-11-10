// Fails if test fixtures contain anything that looks like private data.
// Usage: node scripts/check-fixtures.mjs [dir]   (default: test/fixtures)
// Findings print as file:line plus the rule name, never the matched text.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RULES = [
  ["email address", /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/],
  ["Windows home path", /[A-Za-z]:(?:\\|\/)+Users(?:\\|\/)+[^\\/\s"']+/i],
  ["macOS home path", /\/Users\/[^/\s"']+/],
  // /home/dev is the one allowed fake user
  ["Linux home path", /\/home\/(?!dev(?:[/\\"'\s]|$))[^/\s"']+/],
  ["API key", /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/],
  ["API key", /\b(?:ghp|gho|ghs|github_pat|xox[abp]|AKIA|AIza)[A-Za-z0-9_-]{16,}/],
  ["long token (base64/hex)", /[A-Za-z0-9+/_-]{40,}={0,2}/],
  ["UUID", /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i],
];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

/** Returns [{file, line, rule}] for every finding under dir. */
export function scanDir(dir) {
  const findings = [];
  for (const file of walk(dir)) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((text, i) => {
      for (const [rule, re] of RULES) {
        if (re.test(text)) findings.push({ file, line: i + 1, rule });
      }
    });
  }
  return findings;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = resolve(process.argv[2] ?? "test/fixtures");
  const findings = scanDir(dir);
  for (const f of findings) {
    console.error(`${relative(process.cwd(), f.file)}:${f.line}: ${f.rule}`);
  }
  if (findings.length > 0) {
    console.error(`check-fixtures: ${findings.length} problem(s) found`);
    process.exit(1);
  }
  console.log("check-fixtures: ok");
}
