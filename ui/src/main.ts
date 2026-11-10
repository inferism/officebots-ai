import { renderSidebar } from "./sidebar.js";
import { OfficeScene } from "./scene/room.js";
import type { Layout } from "./scene/layout.js";
import type { Room } from "../../src/server/room.js";
import { connect } from "./socket.js";

const $ = (id: string) => document.getElementById(id)!;
let room: Room | null = null;
let layout: Layout | null = null;

const scene = new OfficeScene($("stage"), $("labels"), $("tip"), (l) => {
  layout = l;
  if (room) renderSidebar($("side"), room, l);
});

connect(
  (r) => {
    room = r;
    scene.setRoom(r); // triggers the layout callback, which renders the sidebar
    document.title = `${r.project.name} · officebots`;
    $("empty").hidden = r.characters.length > 0;
    if (layout) renderSidebar($("side"), r, layout);
  },
  (ok) => {
    $("status").textContent = ok ? "" : "disconnected, retrying…";
  },
);

if (new URLSearchParams(location.search).has("debug")) {
  const dbg = $("debug");
  dbg.hidden = false;
  setInterval(() => (dbg.textContent = scene.debug), 500);
}

if (new URLSearchParams(location.search).has("debug")) (window as unknown as { __scene: OfficeScene }).__scene = scene;
