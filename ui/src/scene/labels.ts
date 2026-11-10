import * as THREE from "three";
import type { Station } from "./character.js";

const LABEL_CAP = 40; // hard cap; labels that would cover a busier character's label are skipped as well

type Entry = { el: HTMLDivElement; name: HTMLElement; state: HTMLElement; dot: HTMLElement; badge: HTMLElement; shown: boolean; w: number; h: number };

const STATE_TEXT = { working: "typing…", waiting: "your turn", sleeping: "zZ" } as const;

/** Small speech bubbles above each robot, projected from 3D so the text stays crisp. */
export class Labels {
  private entries = new Map<string, Entry>();
  private v = new THREE.Vector3();
  private order: string[] = [];

  constructor(private root: HTMLElement) {}

  /** Called when a snapshot arrives: create/remove labels, refresh text, choose which are shown. */
  sync(stations: Map<string, Station>): void {
    for (const [key, e] of this.entries) {
      if (!stations.has(key)) {
        e.el.remove();
        this.entries.delete(key);
      }
    }
    const rank = (s: Station) => (s.data.status === "working" ? 0 : s.data.status === "waiting" ? 1 : 2) + (s.mode === "lounge" ? 3 : 0);
    this.order = [...stations.values()].filter((s) => !s.fading).sort((a, b) => rank(a) - rank(b)).map((s) => s.key);

    for (const st of stations.values()) {
      let e = this.entries.get(st.key);
      if (!e) {
        e = this.create();
        this.entries.set(st.key, e);
      }
      const c = st.data;
      // the account if it has a name, otherwise the role; the nameplate on the desk always shows the role
      e.name.textContent = c.accountAlias ? `@${c.accountAlias}` : c.role;
      e.name.style.color = c.accountAlias ? c.accent : "";
      e.state.textContent = STATE_TEXT[c.status];
      e.dot.className = `dot ${c.status}`;
      e.el.style.borderColor = c.color;
      e.badge.textContent = c.interns.total > 0 ? `×${c.interns.total}` : "";
      e.badge.hidden = c.interns.total === 0;
      e.el.classList.toggle("asleep", c.status === "sleeping");
      e.el.hidden = false; // measure at natural size (offsetWidth ignores transforms, so the label stays where it is)
      e.w = e.el.offsetWidth;
      e.h = e.el.offsetHeight;
      e.shown = true; // visible now; position() hides it again if it does not fit
    }
  }

  private create(): Entry {
    const el = document.createElement("div");
    el.className = "label";
    const dot = document.createElement("span");
    const name = document.createElement("b");
    const state = document.createElement("span");
    state.className = "state";
    const badge = document.createElement("span");
    badge.className = "badge";
    el.append(dot, name, state, badge);
    el.style.transform = "translate(-9999px, -9999px)"; // until the first frame places it, never show it in the corner
    this.root.append(el);
    return { el, name, state, dot, badge, shown: true, w: 120, h: 28 };
  }

  /**
   * Per frame: move each label to its robot's projected head position. Labels are placed in
   * priority order (hovered, then busiest) and skipped if they would overlap one already placed.
   */
  position(stations: Map<string, Station>, camera: THREE.Camera, w: number, h: number, hovered: string | null, scale: number): void {
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const keys = hovered ? [hovered, ...this.order.filter((k) => k !== hovered)] : this.order;
    const show = new Set<string>();
    let count = 0;
    for (const key of keys) {
      const e = this.entries.get(key);
      const st = stations.get(key);
      if (!e || !st || st.grow < 0.5 || st.fading) continue;
      st.headPoint(this.v).project(camera);
      const x = (this.v.x * 0.5 + 0.5) * w;
      const y = (-this.v.y * 0.5 + 0.5) * h;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const lw = e.w * scale;
      const lh = e.h * scale;
      const r = { x0: x - lw / 2 - 2, x1: x + lw / 2 + 2, y0: y - lh - 2, y1: y + 2 };
      const isHover = key === hovered;
      if (!isHover && (count >= LABEL_CAP || placed.some((p) => r.x0 < p.x1 && r.x1 > p.x0 && r.y0 < p.y1 && r.y1 > p.y0))) continue;
      placed.push(r);
      count++;
      show.add(key);
      e.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%) scale(${scale.toFixed(3)})`;
      e.el.classList.toggle("hover", isHover);
    }
    for (const [key, e] of this.entries) {
      const on = show.has(key);
      if (on !== e.shown) {
        e.el.hidden = !on;
        e.shown = on;
      }
    }
  }
}
