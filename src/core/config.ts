// Settings. Two files, both strictly validated: anything unknown or malformed is dropped and reported.
//  - Project: <project>/.officebots/office.json  (role names and colors; safe to commit)
//  - Personal: ~/.config/officebots/config.json   (account nicknames, hashing salt; never in a project)
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ACCOUNT_PATTERN } from "./schema.js";

export type Rule = { tool?: string; model?: string; role?: string; account?: string; color?: string; name?: string };

/** What the room needs to label a character. Everything here is safe to show in the UI. */
export type Settings = {
  /** Renames of the built-in roles, e.g. { Lead: "Architect" }. */
  roles: Record<string, string>;
  /** First matching rule wins, separately for role and for color. */
  rules: Rule[];
  /** Hashed account id -> nickname. */
  nicknames: Record<string, string>;
};

export const emptySettings = (): Settings => ({ roles: {}, rules: [], nicknames: {} });

export type PersonalConfig = {
  accounts: Record<string, string>;
  claudeConfigDirs: string[];
  /** Claude Code projects folder -> account that was logged in when the folder was first seen. */
  roots: Record<string, string>;
};

const MAX_NAME = 40;
const MAX_NICKNAME = 24;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const cleanName = (x: unknown, max: number): string | undefined => {
  if (typeof x !== "string") return undefined;
  const s = x.trim();
  // no control characters, bounded length
  return s.length > 0 && s.length <= max && !/[\u0000-\u001f\u007f]/.test(s) ? s : undefined;
};

export type Loaded<T> = { value: T; problems: string[] };

/** Parses the contents of office.json. Never throws. */
export function parseProjectConfig(text: string | undefined): Loaded<Pick<Settings, "roles" | "rules">> {
  const out = { roles: {} as Record<string, string>, rules: [] as Rule[] };
  const problems: string[] = [];
  if (text === undefined) return { value: out, problems };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { value: out, problems: ["office.json is not valid JSON, using defaults"] };
  }
  if (!isObj(raw)) return { value: out, problems: ["office.json must be an object, using defaults"] };

  if (raw.roles !== undefined) {
    if (!isObj(raw.roles)) problems.push('"roles" must be an object');
    else {
      for (const [k, v] of Object.entries(raw.roles)) {
        const name = cleanName(v, MAX_NAME);
        if (name && k.length <= MAX_NAME) out.roles[k] = name;
        else problems.push(`ignored role entry "${k.slice(0, 20)}"`);
      }
    }
  }
  if (raw.rules !== undefined) {
    if (!Array.isArray(raw.rules)) problems.push('"rules" must be a list');
    else {
      raw.rules.slice(0, 100).forEach((r, i) => {
        if (!isObj(r)) return problems.push(`rule ${i + 1} is not an object`);
        const rule: Rule = {};
        for (const k of ["tool", "model", "role", "account"] as const) {
          if (r[k] === undefined) continue;
          const v = cleanName(r[k], 200);
          if (v) rule[k] = v;
          else problems.push(`rule ${i + 1}: bad "${k}"`);
        }
        if (typeof r.name === "string") rule.name = cleanName(r.name, MAX_NAME);
        if (r.color !== undefined) {
          if (typeof r.color === "string" && HEX_COLOR.test(r.color)) rule.color = r.color.toLowerCase();
          else problems.push(`rule ${i + 1}: "color" must look like #aabbcc`);
        }
        // "name" is what the rule gives the character; match fields narrow it. A rule needs an effect.
        if (rule.name === undefined && rule.color === undefined) return problems.push(`rule ${i + 1} sets neither "name" nor "color"`);
        out.rules.push(rule);
      });
    }
  }
  return { value: out, problems };
}

export function parsePersonalConfig(text: string | undefined): Loaded<PersonalConfig> {
  const out: PersonalConfig = { accounts: {}, claudeConfigDirs: [], roots: {} };
  const problems: string[] = [];
  if (text === undefined) return { value: out, problems };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { value: out, problems: ["personal config is not valid JSON, ignoring it"] };
  }
  if (!isObj(raw)) return { value: out, problems: ["personal config must be an object, ignoring it"] };
  if (isObj(raw.accounts)) {
    for (const [id, nick] of Object.entries(raw.accounts)) {
      const n = cleanName(nick, MAX_NICKNAME);
      if (ACCOUNT_PATTERN.test(id) && n) out.accounts[id] = n;
      else problems.push("ignored a bad account nickname entry");
    }
  }
  if (Array.isArray(raw.claudeConfigDirs)) {
    for (const d of raw.claudeConfigDirs.slice(0, 20)) if (typeof d === "string" && d.length > 0 && d.length < 500) out.claudeConfigDirs.push(d);
  }
  if (isObj(raw.roots)) {
    for (const [root, id] of Object.entries(raw.roots)) if (typeof id === "string" && ACCOUNT_PATTERN.test(id)) out.roots[root] = id;
  }
  return { value: out, problems };
}

const read = (path: string): string | undefined => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
};

export const projectConfigPath = (root: string) => join(root, ".officebots", "office.json");

/** Reads both files into the settings the room uses. */
export function loadSettings(root: string, personalPath: string): Loaded<Settings> {
  const project = parseProjectConfig(read(projectConfigPath(root)));
  const personal = parsePersonalConfig(read(personalPath));
  return {
    value: { roles: project.value.roles, rules: project.value.rules, nicknames: personal.value.accounts },
    problems: [...project.problems, ...personal.problems],
  };
}

export const loadPersonalConfig = (path: string): PersonalConfig => parsePersonalConfig(read(path)).value;

/** Read-modify-write of the personal file, keeping keys this version does not know about. */
export function updatePersonalConfig(path: string, change: (cfg: Record<string, unknown>) => void): void {
  let cfg: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (isObj(parsed)) cfg = parsed;
  } catch {
    // start a new file
  }
  change(cfg);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // not supported on every platform
  }
}

/** Sets (or, with an empty nickname, removes) the nickname of a hashed account id. Returns an error message or null. */
export function setNickname(path: string, id: string, nickname: string): string | null {
  if (!ACCOUNT_PATTERN.test(id)) return "the account id must look like acct_ followed by 8 hex characters (see `officebots accounts`)";
  const name = nickname.trim() === "" ? undefined : cleanName(nickname, MAX_NICKNAME);
  if (nickname.trim() !== "" && !name) return `nicknames must be 1 to ${MAX_NICKNAME} characters`;
  updatePersonalConfig(path, (cfg) => {
    const accounts = isObj(cfg.accounts) ? { ...cfg.accounts } : {};
    if (name) accounts[id] = name;
    else delete accounts[id];
    cfg.accounts = accounts;
  });
  return null;
}
