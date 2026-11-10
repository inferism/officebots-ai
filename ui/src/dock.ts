import type { Character, Room } from "../../src/server/room.js";
import type { Layout } from "./scene/layout.js";

const f = (n: number) => n.toLocaleString();
const ORDER = { working: 0, waiting: 1, sleeping: 2 } as const;

function chip(c: Character, away: boolean): HTMLElement {
  const el = document.createElement("div");
  el.className = "chip" + (away ? " away" : "");
  const t = c.tokens;
  el.title = `input ${f(t.input)}, output ${f(t.output)}, cache write ${f(t.cacheWrite)}, cache read ${f(t.cacheRead)}, reasoning ${f(t.reasoning)}`;
  const bar = document.createElement("span");
  bar.className = "bar";
  bar.style.background = c.color;
  const body = document.createElement("div");
  const l1 = document.createElement("div");
  l1.className = "l1";
  const dot = document.createElement("span");
  dot.className = `dot ${c.status}`;
  const name = document.createElement("span");
  name.textContent = c.role;
  l1.append(dot, name);
  if (c.accountAlias) {
    const acct = document.createElement("span");
    acct.className = "acct";
    acct.textContent = `@${c.accountAlias}`;
    acct.style.color = c.accent;
    l1.append(acct);
  }
  const l2 = document.createElement("div");
  l2.className = "l2";
  l2.textContent = `${c.tool} · ${c.model}`;
  const l3 = document.createElement("div");
  l3.className = "l3";
  l3.textContent = `${f(t.headline)} tokens`;
  body.append(l1, l2, l3);
  el.append(bar, body);
  return el;
}

/** The roster along the bottom: everyone, busiest first. Characters that faded out of the room are dimmed. */
export function renderDock(root: HTMLElement, room: Room, layout: Layout): void {
  const away = new Set(layout.away);
  const sorted = [...room.characters].sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.tokens.headline - a.tokens.headline);
  root.replaceChildren(...sorted.map((c) => chip(c, away.has(c.key))));
}
