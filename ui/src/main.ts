import { renderDock } from "./dock.js";
import { OfficeScene } from "./scene/room.js";
import type { Layout } from "./scene/layout.js";
import { minutesOf, parseClockOverride, rgbCss, type TimeInfo } from "./scene/timeofday.js";
import type { Room } from "../../src/server/room.js";
import { connect } from "./socket.js";

const $ = (id: string) => document.getElementById(id)!;
const root = document.documentElement;
let room: Room | null = null;
let layout: Layout | null = null;

// The office follows the viewer's own clock. ?time=18:45, ?phase=dusk and ?speed=600 let you preview the other looks.
const override = parseClockOverride(location.search);
const startedAt = performance.now();
function clock(): number {
  if (!override) return minutesOf(new Date());
  const base = override.startMinutes ?? minutesOf(new Date());
  return base + (override.fixed ? 0 : (((performance.now() - startedAt) / 1000) * override.speed) / 60);
}

/** The sky changed: restyle the page around the scene to match. */
function onTime(info: TimeInfo): void {
  const p = info.palette;
  const set = (k: string, v: string) => root.style.setProperty(k, v);
  set("--page-top", rgbCss(p.page[0]));
  set("--page-bottom", rgbCss(p.page[1]));
  set("--panel", rgbCss(p.ui.panel, p.night > 0.5 ? 0.86 : 0.96));
  set("--text", rgbCss(p.ui.text));
  set("--soft", rgbCss(p.ui.soft));
  set("--line", rgbCss(p.ui.line));
  set("--accent", rgbCss(p.ui.accent));
  set("--accent-rgb", p.ui.accent.map(Math.round).join(","));
  set("--night", p.night.toFixed(3));
  root.classList.toggle("mono", p.night > 0.5);
  const h = Math.floor(info.hours);
  const m = Math.floor((info.hours % 1) * 60);
  $("phase").textContent = `${info.label} · ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// snapshot pages (`officebots export`) have the room built in and no server to talk to
const snapshot = (window as unknown as { __OFFICEBOTS_SNAPSHOT__?: { room: Room; takenAt: string } }).__OFFICEBOTS_SNAPSHOT__;

const scene = new OfficeScene(
  $("stage"),
  $("labels"),
  $("tip"),
  (l) => {
    layout = l;
    if (room) renderDock($("chips"), room, l);
  },
  clock,
  onTime,
);

function insets(): void {
  const narrow = innerWidth <= 720;
  scene.setInsets({ top: narrow ? 64 : 88, bottom: narrow ? 112 : 126, left: 0, right: 0 });
}
insets();
addEventListener("resize", insets);

function show(r: Room): void {
  room = r;
  scene.setRoom(r); // triggers the layout callback
  document.title = `${r.project.name} · officebots`;
  $("project").textContent = r.project.name;
  $("counts").textContent = `${r.characters.length} agent${r.characters.length === 1 ? "" : "s"} · ${r.totals.headline.toLocaleString()} tokens`;
  $("empty").hidden = r.characters.length > 0;
  if (layout) renderDock($("chips"), r, layout);
}

if (snapshot) {
  $("empty").textContent = "No agents in this snapshot.";
  $("status").textContent = `Snapshot taken ${new Date(snapshot.takenAt).toLocaleString()}. Not live: run "officebots open" for the live office.`;
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
