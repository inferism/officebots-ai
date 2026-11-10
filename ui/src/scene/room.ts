import * as THREE from "three";
import type { Character, Room } from "../../../src/server/room.js";
import { IsoCamera, type Insets } from "./camera.js";
import { Station } from "./character.js";
import { Environment } from "./env.js";
import { Interns } from "./interns.js";
import { Labels } from "./labels.js";
import { computeLayout, deskPosition, type Layout, loungeRect, roomSize, seatPosition } from "./layout.js";
import { atMinutes, type TimeInfo } from "./timeofday.js";

export const MAX_DESKS = 12;
export const LOUNGE_CAP = 8;

export class OfficeScene {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cam = new IsoCamera();
  private env: Environment;
  private stations = new Map<string, Station>();
  private interns: Interns;
  private labels: Labels;
  private layout!: Layout;
  private size = { w: 6, d: 6 };
  private sizeTarget = { w: 6, d: 6 };
  private raycaster = new THREE.Raycaster();
  private mouse: { x: number; y: number } | null = null;
  private hovered: string | null = null;
  private first = true;
  private last = performance.now();
  private elapsed = 0;
  private frames = 0;
  private fpsStart = performance.now();
  private timeAt = -1e9;
  private timeKey = NaN;
  private info!: TimeInfo;
  fps = 0;
  debug = "";

  /**
   * @param clock minutes since local midnight, read a few times a second (the real clock, or a preview clock)
   * @param onTime called when the time-of-day look changes, so the page can restyle itself too
   */
  constructor(
    private canvasHost: HTMLElement,
    labelRoot: HTMLElement,
    private tip: HTMLElement,
    private onLayout: (l: Layout) => void,
    private clock: () => number,
    private onTime: (info: TimeInfo) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0); // the page's own background shows through
    canvasHost.append(this.renderer.domElement);
    this.labels = new Labels(labelRoot);
    this.interns = new Interns(this.scene);
    this.env = new Environment(this.scene);

    addEventListener("resize", () => this.resize());
    this.renderer.domElement.addEventListener("pointermove", (e) => {
      const r = this.renderer.domElement.getBoundingClientRect();
      this.mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
    });
    this.renderer.domElement.addEventListener("pointerleave", () => (this.mouse = null));
    this.updateTime(true);
    this.resize();
    this.applyLayout(computeLayout([], undefined, { maxDesks: MAX_DESKS, loungeCap: LOUNGE_CAP }));
    this.cam.fit(this.sizeTarget.w, this.sizeTarget.d, true);
    requestAnimationFrame((t) => this.frame(t));
  }

  /** Space covered by the header and dock, so the room is centered in what is left. */
  setInsets(i: Insets): void {
    this.cam.setInsets(i);
    this.cam.fit(this.sizeTarget.w, this.sizeTarget.d);
  }

  private resize(): void {
    const w = this.canvasHost.clientWidth || 1;
    const h = this.canvasHost.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.cam.resize(w, h);
    this.cam.fit(this.sizeTarget.w, this.sizeTarget.d, true);
  }

  /** Re-read the clock a few times a second and restyle only when the look has visibly moved on. */
  private updateTime(force = false): void {
    const now = performance.now();
    if (!force && now - this.timeAt < 250) return;
    this.timeAt = now;
    const minutes = this.clock();
    const key = Math.round(minutes * 4);
    if (!force && key === this.timeKey) return;
    this.timeKey = key;
    this.info = atMinutes(minutes);
    this.env.apply(this.info);
    for (const st of this.stations.values()) st.applyEnv(this.info.palette);
    this.onTime(this.info);
  }

  /** New snapshot from the server. */
  setRoom(room: Room): void {
    const layout = computeLayout(room.characters, this.layout, { maxDesks: MAX_DESKS, loungeCap: LOUNGE_CAP });
    const byKey = new Map(room.characters.map((c) => [c.key, c]));
    const present = new Set<string>([...layout.desks.keys(), ...layout.lounge.keys()]);

    for (const key of present) {
      const data = byKey.get(key)!;
      let st = this.stations.get(key);
      if (!st) {
        st = new Station(data);
        st.applyEnv(this.info.palette);
        const lounge = layout.lounge.has(key);
        const p = lounge ? seatPosition(layout.lounge.get(key)!, layout.cols) : deskPosition(layout.desks.get(key)!, layout.cols);
        st.group.position.set(p.x, 0, p.z);
        this.stations.set(key, st);
        this.scene.add(st.group);
      }
      st.fading = false;
      st.update(data);
    }
    for (const [key, st] of this.stations) if (!present.has(key)) st.fading = true;
    this.applyLayout(layout);
    this.env.setTotals(room);
    this.labels.sync(this.stations);
    if (this.first && room.characters.length > 0) {
      this.first = false;
      this.cam.fit(this.sizeTarget.w, this.sizeTarget.d, true);
    }
  }

  private applyLayout(layout: Layout): void {
    this.layout = layout;
    for (const [key, st] of this.stations) {
      if (layout.lounge.has(key)) {
        st.setMode("lounge");
        const p = seatPosition(layout.lounge.get(key)!, layout.cols);
        st.target.set(p.x, 0, p.z);
      } else if (layout.desks.has(key)) {
        st.setMode("desk");
        const p = deskPosition(layout.desks.get(key)!, layout.cols);
        st.target.set(p.x, 0, p.z);
      }
    }
    this.sizeTarget = roomSize(layout);
    this.cam.fit(this.sizeTarget.w, this.sizeTarget.d);
    this.onLayout(layout);
  }

  private frame(now: number): void {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.elapsed += dt;
    this.updateTime();

    // ease the room size, then the camera
    const k = 1 - Math.exp(-dt * 4);
    this.size.w += (this.sizeTarget.w - this.size.w) * k;
    this.size.d += (this.sizeTarget.d - this.size.d) * k;
    this.env.layout(this.size.w, this.size.d, loungeRect(this.layout, this.size.w));
    this.cam.update(dt);

    for (const [key, st] of this.stations) {
      st.tick(dt, this.elapsed);
      if (st.fading && st.grow < 0.02) {
        this.scene.remove(st.group);
        this.stations.delete(key);
        this.labels.sync(this.stations);
      }
    }
    const internCount = this.interns.update(this.stations.values(), this.elapsed);
    this.pick();
    this.labels.position(this.stations, this.cam.camera, this.canvasHost.clientWidth, this.canvasHost.clientHeight, this.hovered, Math.max(0.6, Math.min(1, this.cam.pxPerUnit(this.canvasHost.clientHeight) / 30)));
    this.renderer.render(this.scene, this.cam.camera);

    this.frames++;
    if (now - this.fpsStart >= 1000) {
      this.fps = (this.frames * 1000) / (now - this.fpsStart);
      this.frames = 0;
      this.fpsStart = now;
      this.debug = `${this.fps.toFixed(0)} fps · ${this.stations.size} bots · ${internCount} interns · ${this.renderer.info.render.calls} draws · ${this.info.label} ${Math.floor(this.info.hours)}:${String(Math.floor((this.info.hours % 1) * 60)).padStart(2, "0")}`;
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  /** Hover: raycast against visible parts of each station and show a tooltip. */
  private pick(): void {
    if (!this.mouse) {
      this.setHover(null, 0, 0);
      return;
    }
    const w = this.canvasHost.clientWidth;
    const h = this.canvasHost.clientHeight;
    this.raycaster.setFromCamera(new THREE.Vector2((this.mouse.x / w) * 2 - 1, -(this.mouse.y / h) * 2 + 1), this.cam.camera);
    const hits = this.raycaster.intersectObjects([...this.stations.values()].map((s) => s.group), true);
    let key: string | null = null;
    for (const hit of hits) {
      let o: THREE.Object3D | null = hit.object;
      let visible = true;
      while (o && o.userData.key === undefined) {
        if (!o.visible) visible = false;
        o = o.parent;
      }
      if (visible && o) {
        key = o.userData.key as string;
        break;
      }
    }
    this.setHover(key, this.mouse.x, this.mouse.y);
  }

  private setHover(key: string | null, x: number, y: number): void {
    if (key !== this.hovered) {
      this.hovered = key;
      this.renderer.domElement.style.cursor = key ? "pointer" : "default";
      const st = key ? this.stations.get(key) : undefined;
      if (st) this.fillTip(st.data);
    }
    this.tip.hidden = !this.hovered;
    if (this.hovered) {
      // keep the tooltip inside the stage: flip to the other side of the pointer near the edges
      const tw = this.tip.offsetWidth;
      const th = this.tip.offsetHeight;
      const px = x + 14 + tw > this.canvasHost.clientWidth ? x - 14 - tw : x + 14;
      const py = y + 14 + th > this.canvasHost.clientHeight ? y - 14 - th : y + 14;
      this.tip.style.transform = `translate(${Math.max(0, px)}px, ${Math.max(0, py)}px)`;
    }
  }

  private fillTip(c: Character): void {
    const f = (n: number) => n.toLocaleString();
    const t = c.tokens;
    const rows: [string, string][] = [
      ["status", c.status],
      ["input", f(t.input)],
      ["output", f(t.output)],
      ["cache write", f(t.cacheWrite)],
      ["cache read", f(t.cacheRead)],
      ["reasoning", f(t.reasoning)],
    ];
    const types = Object.entries(c.interns.byType).map(([k, n]) => `${k} ${n}`).join(", ");
    if (c.interns.total) rows.push(["interns", `${c.interns.active} active of ${c.interns.total}${types ? ` (${types})` : ""}`]);
    this.tip.replaceChildren();
    const title = document.createElement("div");
    title.className = "tip-title";
    title.textContent = `${c.role} · ${c.tool}`;
    const model = document.createElement("div");
    model.className = "tip-sub";
    model.textContent = c.model + (c.accountAlias ? ` · @${c.accountAlias}` : "");
    this.tip.append(title, model);
    for (const [k, v] of rows) {
      const r = document.createElement("div");
      r.className = "tip-row";
      const a = document.createElement("span");
      a.textContent = k;
      const b = document.createElement("b");
      b.textContent = v;
      r.append(a, b);
      this.tip.append(r);
    }
  }
}
