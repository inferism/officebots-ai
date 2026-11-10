// Pure edits of a Claude Code settings.json: add or remove exactly our SessionStart hook.
// Nothing here touches the disk.

/** The command setup registers. Matching on this exact string is how uninstall finds its own entry. */
export const HOOK_COMMAND = "officebots hook claude-session-start";
const HOOK_TIMEOUT_SECONDS = 5;

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);

export const isOurHook = (h: unknown): boolean => isObj(h) && h.type === "command" && h.command === HOOK_COMMAND;

/** Keep the file's own style when it is rewritten: indent width, line endings, trailing newline. */
function detectStyle(text: string): { indent: string | number; eol: string; finalNewline: boolean } {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const m = /^[{[]\r?\n([ \t]+)\S/.exec(text);
  const indent = m ? (m[1]!.includes("\t") ? "\t" : m[1]!.length) : 2;
  return { indent, eol, finalNewline: /\n$/.test(text) };
}

function serialize(obj: unknown, style: ReturnType<typeof detectStyle>): string {
  let out = JSON.stringify(obj, null, style.indent);
  if (style.eol === "\r\n") out = out.replace(/\n/g, "\r\n");
  return out + (style.finalNewline ? style.eol : "");
}

export type EditResult = { ok: true; text: string; changed: boolean } | { ok: false; reason: string };

function parse(text: string | undefined): { ok: true; obj: Obj } | { ok: false; reason: string } {
  if (text === undefined || text.trim() === "") return { ok: true, obj: {} };
  try {
    const raw = JSON.parse(text.replace(/^﻿/, ""));
    if (!isObj(raw)) return { ok: false, reason: "settings.json is not a JSON object" };
    return { ok: true, obj: raw };
  } catch {
    return { ok: false, reason: "settings.json is not plain JSON (comments or a syntax error?), so it was left alone" };
  }
}

/** Returns the settings text with our hook added. `text` is undefined when the file does not exist yet. */
export function addHook(text: string | undefined): EditResult {
  const p = parse(text);
  if (!p.ok) return p;
  const obj = p.obj;
  if (obj.hooks !== undefined && !isObj(obj.hooks)) return { ok: false, reason: 'the "hooks" setting is not an object' };
  const hooks = (obj.hooks as Obj | undefined) ?? {};
  if (hooks.SessionStart !== undefined && !Array.isArray(hooks.SessionStart)) return { ok: false, reason: 'the "SessionStart" hook list is not an array' };
  const list = (hooks.SessionStart as unknown[] | undefined) ?? [];

  const already = list.some((e) => isObj(e) && Array.isArray(e.hooks) && e.hooks.some(isOurHook));
  const style = detectStyle(text ?? "");
  if (already) return { ok: true, text: text!, changed: false };

  list.push({ hooks: [{ type: "command", command: HOOK_COMMAND, timeout: HOOK_TIMEOUT_SECONDS }] });
  hooks.SessionStart = list;
  obj.hooks = hooks;
  return { ok: true, text: serialize(obj, text === undefined ? { indent: 2, eol: "\n", finalNewline: true } : style), changed: true };
}

/** Returns the settings text with our hook removed (and any container that this leaves empty). */
export function removeHook(text: string): EditResult {
  const p = parse(text);
  if (!p.ok) return p;
  const obj = p.obj;
  const hooks = obj.hooks;
  if (!isObj(hooks) || !Array.isArray(hooks.SessionStart)) return { ok: true, text, changed: false };

  let changed = false;
  const kept: unknown[] = [];
  for (const entry of hooks.SessionStart) {
    if (!isObj(entry) || !Array.isArray(entry.hooks)) {
      kept.push(entry);
      continue;
    }
    const inner = entry.hooks.filter((h) => !isOurHook(h));
    if (inner.length === entry.hooks.length) kept.push(entry);
    else {
      changed = true;
      if (inner.length > 0) kept.push({ ...entry, hooks: inner });
    }
  }
  if (!changed) return { ok: true, text, changed: false };
  if (kept.length > 0) hooks.SessionStart = kept;
  else delete hooks.SessionStart;
  if (Object.keys(hooks).length === 0) delete obj.hooks;
  return { ok: true, text: serialize(obj, detectStyle(text)), changed: true };
}
