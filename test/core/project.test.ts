import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProjectResolver, findProjectRoot, projectKey } from "../../src/core/project.js";

let base: string;
beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "officebots-proj-")));
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

describe("project root", () => {
  it("finds a git root from a subfolder", () => {
    mkdirSync(join(base, "repo", ".git"), { recursive: true });
    mkdirSync(join(base, "repo", "a", "b"), { recursive: true });
    expect(findProjectRoot(join(base, "repo", "a", "b"))).toBe(join(base, "repo"));
  });

  it("maps a git worktree to its main checkout", () => {
    const main = join(base, "main");
    const gitdir = join(main, ".git", "worktrees", "wt1");
    mkdirSync(gitdir, { recursive: true });
    writeFileSync(join(gitdir, "commondir"), "../..\n");
    const wt = join(base, "wt1");
    mkdirSync(wt);
    writeFileSync(join(wt, ".git"), `gitdir: ${gitdir}\n`);
    expect(findProjectRoot(wt)).toBe(main);
  });

  it("falls back to the folder holding .officebots, and null when there is none", () => {
    mkdirSync(join(base, "plain", ".officebots"), { recursive: true });
    mkdirSync(join(base, "plain", "sub"));
    expect(findProjectRoot(join(base, "plain", "sub"))).toBe(join(base, "plain"));
    mkdirSync(join(base, "nothing"));
    // base is under the OS temp dir; make sure no .git / .officebots exists above it for this check
    const r = findProjectRoot(join(base, "nothing"));
    expect(r === null || !r.startsWith(base)).toBe(true);
  });

  it("resolver gives the same key for subfolders and worktrees, a different key for another repo", () => {
    mkdirSync(join(base, "a", ".git", "worktrees", "w"), { recursive: true });
    writeFileSync(join(base, "a", ".git", "worktrees", "w", "commondir"), "../..");
    mkdirSync(join(base, "a", "sub"));
    mkdirSync(join(base, "w"));
    writeFileSync(join(base, "w", ".git"), `gitdir: ${join(base, "a", ".git", "worktrees", "w")}`);
    mkdirSync(join(base, "b", ".git"), { recursive: true });
    const resolve = createProjectResolver();
    const keyA = projectKey(join(base, "a"));
    expect(resolve(join(base, "a"))).toBe(keyA);
    expect(resolve(join(base, "a", "sub"))).toBe(keyA);
    expect(resolve(join(base, "w"))).toBe(keyA);
    expect(resolve(join(base, "b"))).toBe(projectKey(join(base, "b")));
    expect(resolve(join(base, "b"))).not.toBe(keyA);
  });
});
