import type { Character, Room } from "../../src/server/room.js";
import type { Layout } from "./scene/layout.js";

const f = (n: number) => n.toLocaleString();

function row(c: Character): HTMLElement {
  const el = document.createElement("div");
  el.className = "item";
  const dot = document.createElement("span");
  dot.className = `dot ${c.status}`;
  const sw = document.createElement("span");
  sw.className = "swatch";
  sw.style.background = c.color;
  const main = document.createElement("div");
  main.className = "item-main";
  const name = document.createElement("b");
  name.textContent = c.role;
  if (c.accountAlias) {
    const acct = document.createElement("span");
    acct.className = "acct";
    acct.textContent = ` @${c.accountAlias}`;
    acct.style.color = c.accent;
    name.append(acct);
  }
  const sub = document.createElement("span");
  sub.className = "item-sub";
  sub.textContent = `${c.tool} · ${c.model}`;
  main.append(name, sub);
  const tok = document.createElement("span");
  tok.className = "item-tok";
  tok.textContent = f(c.tokens.headline);
  tok.title = `input ${f(c.tokens.input)}, output ${f(c.tokens.output)}, cache write ${f(c.tokens.cacheWrite)}, cache read ${f(c.tokens.cacheRead)}, reasoning ${f(c.tokens.reasoning)}`;
  el.append(dot, sw, main, tok);
  return el;
}

/** Plain list beside the scene: everyone, grouped by where they sit. Away characters appear only here. */
export function renderSidebar(root: HTMLElement, room: Room, layout: Layout): void {
  const by = new Map(room.characters.map((c) => [c.key, c]));
  const section = (title: string, keys: string[]) => {
    if (keys.length === 0) return [];
    const h = document.createElement("h3");
    h.textContent = `${title} (${keys.length})`;
    return [h, ...keys.map((k) => row(by.get(k)!))];
  };
  const order = (keys: Iterable<string>) =>
    [...keys].sort((a, b) => by.get(b)!.tokens.headline - by.get(a)!.tokens.headline);
  const title = document.createElement("div");
  title.className = "side-title";
  title.textContent = room.project.name;
  const total = document.createElement("div");
  total.className = "side-sub";
  total.textContent = `${f(room.totals.headline)} tokens (output + fresh input)`;
  root.replaceChildren(
    title,
    total,
    ...section("At desks", order(layout.desks.keys())),
    ...section("In the lounge", order(layout.lounge.keys())),
    ...section("Away", order(layout.away)),
  );
}
