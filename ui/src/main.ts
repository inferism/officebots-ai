import { renderSidebar } from "./sidebar.js";
import { OfficeScene } from "./scene/room.js";
import type { Layout } from "./scene/layout.js";
import type { Room } from "../../src/server/room.js";
import { connect } from "./socket.js";

const $ = (id: string) => document.getElementById(id)!;
let room: Room | null = null;
let layout: Layout | null = null;

// `officebots export` writes a standalone page with the room embedded; it has no server to talk to.
const snapshot = (window as unknown as { __OFFICEBOTS_SNAPSHOT__?: { room: Room; takenAt: string } }).__OFFICEBOTS_SNAPSHOT__;

const scene = new OfficeScene($("stage"), $("labels"), $("tip"), (l) => {
  layout = l;
  if (room) renderSidebar($("side"), room, l);
});

function show(r: Room): void {
  room = r;
  scene.setRoom(r); // triggers the layout callback, which renders the sidebar
  document.title = `${r.project.name} · officebots`;
  $("empty").hidden = r.characters.length > 0;
  if (layout) renderSidebar($("side"), r, layout);
}

if (snapshot) {
  $("empty").textContent = "No agents in this snapshot.";
  $("status").textContent = `Snapshot taken ${new Date(snapshot.takenAt).toLocaleString()}. Not live: run "officebots open" for the live office.`;
  $("status").style.color = "#8b90a0";
  show(snapshot.room);
} else {
  connect(show, (ok) => {
    $("status").textContent = ok ? "" : "disconnected, retrying…";
  });
}

if (new URLSearchParams(location.search).has("debug")) {
  const dbg = $("debug");
  dbg.hidden = false;
  setInterval(() => (dbg.textContent = scene.debug), 500);
  (window as unknown as { __scene: OfficeScene }).__scene = scene;
}
