import * as THREE from "three";
import type { Room } from "../../../src/server/room.js";
import { box, canvasTexture, COLORS, mat, noPick, radialTexture } from "./palette.js";
import { type Palette, type RGB, rgbCss, sunMoon, type TimeInfo } from "./timeofday.js";

export const WALL_H = 3.3;
const CYAN = 0x37e6ff;
const PINK = 0xff4fa3;

const smoothstep = (x: number, a: number, b: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const mixRGB = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const setRGB = (c: THREE.Color, v: RGB) => c.setRGB(v[0] / 255, v[1] / 255, v[2] / 255, THREE.SRGBColorSpace);
const rand = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const MONO = "Consolas, 'Courier New', monospace";
const UI = "'Trebuchet MS', 'Segoe UI', system-ui, sans-serif";

export type LoungeRect = { x0: number; x1: number; z0: number; z1: number } | null;

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

// ---------- textures ----------
function woodTexture(): THREE.CanvasTexture {
  const t = canvasTexture(256, 256, (c, w, h) => {
    const tones = ["#dcb98a", "#d4ae7c", "#e0bf92", "#d8b383"];
    const planks = 4;
    for (let i = 0; i < planks; i++) {
      const y = (i * h) / planks;
      c.fillStyle = tones[i]!;
      c.fillRect(0, y, w, h / planks);
      c.fillStyle = "rgba(110,72,30,.22)";
      c.fillRect(0, y, w, 2);
      c.fillRect((i * 83) % w, y, 2, h / planks);
      c.fillStyle = "rgba(255,255,255,.07)";
      for (let k = 0; k < 6; k++) c.fillRect(rand(i * 9 + k) * w, y + 6 + rand(i * 5 + k) * (h / planks - 12), 30 + rand(k + i) * 50, 1);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function gridTexture(): THREE.CanvasTexture {
  const t = canvasTexture(128, 128, (c, w, h) => {
    c.fillStyle = "#ff4fa3";
    c.fillRect(0, 0, 3, h);
    c.fillRect(0, 0, w, 3);
    c.fillStyle = "#37e6ff";
    c.fillRect(w / 2, 0, 2, h);
    c.fillRect(0, h / 2, w, 2);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function rugTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 256, (c, w, h) => {
    c.fillStyle = "#f4e9d4";
    roundRect(c, 0, 0, w, h, 18);
    c.fill();
    c.fillStyle = "#5e9fa0";
    roundRect(c, 12, 12, w - 24, h - 24, 12);
    c.fill();
    c.strokeStyle = "rgba(255,255,255,.55)";
    c.lineWidth = 4;
    roundRect(c, 32, 32, w - 64, h - 64, 8);
    c.stroke();
  });
}

function drawWindow(c: CanvasRenderingContext2D, w: number, h: number, p: Palette, hours: number): void {
  const night = p.night;
  const sky = c.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, rgbCss(p.sky[0]));
  sky.addColorStop(0.55, rgbCss(p.sky[1]));
  sky.addColorStop(1, rgbCss(p.sky[2]));
  c.fillStyle = sky;
  c.fillRect(0, 0, w, h);
  // stars, only really visible at night
  c.fillStyle = `rgba(255,255,255,${(night * night * 0.85).toFixed(3)})`;
  for (let i = 0; i < 70; i++) c.fillRect(rand(i + 7) * w, rand(i + 5) * h * 0.55, 1.6, 1.6);
  const { sun, moon } = sunMoon(hours);
  const arc = (f: number) => [w * (0.08 + 0.84 * f), h * (0.78 - 0.62 * Math.sin(Math.PI * f))] as const;
  if (sun !== null) {
    const [x, y] = arc(sun);
    const g = c.createRadialGradient(x, y, 2, x, y, h * 0.55);
    g.addColorStop(0, "rgba(255,246,196,1)");
    g.addColorStop(0.2, "rgba(255,226,160,.75)");
    g.addColorStop(1, "rgba(255,226,160,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  }
  if (moon !== null) {
    const [x, y] = arc(moon);
    const g = c.createRadialGradient(x, y, 4, x, y, h * 0.4);
    g.addColorStop(0, `rgba(255,236,246,${0.2 + night * 0.7})`);
    g.addColorStop(1, "rgba(255,160,210,0)");
    c.fillStyle = g;
    c.beginPath();
    c.arc(x, y, h * 0.4, 0, 7);
    c.fill();
    c.fillStyle = `rgba(255,250,236,${0.3 + night * 0.7})`;
    c.beginPath();
    c.arc(x, y, h * 0.1, 0, 7);
    c.fill();
  }
  // clouds by day
  c.fillStyle = `rgba(255,255,255,${(1 - night) * 0.9})`;
  for (const [x, y, r] of [[0.16, 0.3, 0.07], [0.24, 0.26, 0.09], [0.33, 0.32, 0.065], [0.6, 0.5, 0.06], [0.68, 0.46, 0.08]] as const) {
    c.beginPath();
    c.ellipse(x * w, y * h, r * w, r * w * 0.42, 0, 0, 7);
    c.fill();
  }
  // the city: pale by day, dark with lit windows at night
  const far: RGB = mixRGB([150, 190, 214], [42, 20, 88], night);
  const near: RGB = mixRGB([120, 168, 150], [23, 10, 56], night);
  for (const [layer, col, hMin, hVar, lit] of [[0, far, 0.22, 0.28, 0.16], [1, near, 0.14, 0.34, 0.32]] as const) {
    let x = -10;
    for (let i = 0; x < w; i++) {
      const bw = w * (0.035 + rand(i + layer * 31) * 0.04);
      const bh = h * (hMin + rand(i * 3 + layer * 17) * hVar);
      c.fillStyle = rgbCss(col);
      c.fillRect(x, h - bh, bw, bh);
      c.fillStyle = layer ? `rgba(255,216,107,${night})` : `rgba(55,230,255,${night})`;
      for (let wy = h - bh + 8; wy < h - 6; wy += 11) for (let wx = x + 5; wx < x + bw - 5; wx += 9) if (rand(wx * 7 + wy * 13 + layer) < lit) c.fillRect(wx, wy, 3, 4.5);
      x += bw + 2;
    }
  }
}

function drawClock(c: CanvasRenderingContext2D, w: number, p: Palette, hours: number): void {
  const night = p.night;
  c.clearRect(0, 0, w, w);
  c.fillStyle = night > 0.5 ? "#0b0818" : "#ffffff";
  c.beginPath();
  c.arc(w / 2, w / 2, w / 2 - 2, 0, 7);
  c.fill();
  c.strokeStyle = night > 0.5 ? "#37e6ff" : "#8a7560";
  c.lineWidth = 6;
  c.stroke();
  c.strokeStyle = night > 0.5 ? "#c9f6ff" : "#4a3728";
  c.lineCap = "round";
  const hand = (frac: number, len: number, lw: number) => {
    const a = frac * Math.PI * 2 - Math.PI / 2;
    c.lineWidth = lw;
    c.beginPath();
    c.moveTo(w / 2, w / 2);
    c.lineTo(w / 2 + Math.cos(a) * len, w / 2 + Math.sin(a) * len);
    c.stroke();
  };
  hand((hours % 12) / 12, w * 0.24, 7);
  hand((hours * 60) % 60 / 60, w * 0.36, 5);
}

type BoardData = { total: number; agents: number; interns: number; bars: { v: number; color: string }[] };

function drawBoard(c: CanvasRenderingContext2D, w: number, h: number, night: number, d: BoardData): void {
  const dark = night > 0.5;
  c.clearRect(0, 0, w, h);
  c.fillStyle = dark ? "#c9b79b" : "#c9b79b";
  roundRect(c, 0, 0, w, h, 14);
  c.fill();
  c.fillStyle = dark ? "#07060f" : "#fbfaf6";
  roundRect(c, 8, 8, w - 16, h - 16, 10);
  c.fill();
  if (dark) {
    c.strokeStyle = "#37e6ff";
    c.lineWidth = 3;
    c.shadowColor = "#37e6ff";
    c.shadowBlur = 12;
    roundRect(c, 8, 8, w - 16, h - 16, 10);
    c.stroke();
    c.shadowBlur = 0;
  }
  const ink = dark ? "#c9f6ff" : "#4a3728";
  const soft = dark ? "#7fe9ff" : "#8a7560";
  c.fillStyle = soft;
  c.font = `bold 19px ${dark ? MONO : UI}`;
  c.fillText(dark ? "TOKENS TODAY" : "TODAY IN THE OFFICE", 34, 46);
  c.fillStyle = ink;
  c.shadowColor = dark ? "#37e6ff" : "transparent";
  c.shadowBlur = dark ? 14 : 0;
  c.font = `bold 78px ${dark ? MONO : UI}`;
  c.fillText(d.total.toLocaleString("en-US"), 34, 128);
  c.shadowBlur = 0;
  c.fillStyle = soft;
  c.font = `21px ${dark ? MONO : UI}`;
  c.fillText(`tokens  ·  ${d.agents} agent${d.agents === 1 ? "" : "s"}  ·  ${d.interns} intern${d.interns === 1 ? "" : "s"}`, 36, 168);
  const max = Math.max(1, ...d.bars.map((b) => b.v));
  const bw = 30, gap = 10, x0 = w - 36 - d.bars.length * (bw + gap);
  d.bars.forEach((b, i) => {
    const bh = 20 + (b.v / max) * 100;
    c.fillStyle = b.color;
    roundRect(c, x0 + i * (bw + gap), h - 40 - bh, bw, bh, 5);
    c.fill();
  });
}

function signTexture(): THREE.CanvasTexture {
  return canvasTexture(512, 72, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.font = `bold 58px ${MONO}`;
    c.textBaseline = "middle";
    c.shadowColor = "#ff4fa3";
    c.shadowBlur = 22;
    c.fillStyle = "#ffd3ea";
    c.fillText("OFFICEBOTS", 14, h / 2 + 2);
    c.shadowBlur = 0;
    c.strokeStyle = "#ff4fa3";
    c.lineWidth = 4;
    c.beginPath();
    c.moveTo(16, h - 6);
    c.lineTo(w - 90, h - 6);
    c.stroke();
  });
}

function rackFace(): THREE.CanvasTexture {
  return canvasTexture(64, 192, (c, w, h) => {
    c.fillStyle = "#14122a";
    c.fillRect(0, 0, w, h);
    const cols = ["#37e6ff", "#39ff88", "#ff4fa3"];
    for (let r = 0; r < 7; r++) for (let k = 0; k < 4; k++) {
      const on = rand(r * 9 + k) > 0.35;
      c.fillStyle = on ? cols[k % 3]! : "#2a2748";
      c.fillRect(6 + k * 14, 10 + r * 25, 8, 5);
    }
  });
}

function vendingFace(): THREE.CanvasTexture {
  return canvasTexture(96, 192, (c, w, h) => {
    c.fillStyle = "#1a1434";
    c.fillRect(0, 0, w, h);
    c.fillStyle = "rgba(255,79,163,.9)";
    roundRect(c, 8, 10, w - 16, h - 60, 6);
    c.fill();
    const cols = ["#ffd86b", "#37e6ff", "#9a7bff"];
    for (let r = 0; r < 4; r++) for (let k = 0; k < 3; k++) {
      c.fillStyle = cols[(r + k) % 3]!;
      c.fillRect(16 + k * 24, 20 + r * 28, 15, 18);
    }
    c.fillStyle = "#0a0716";
    c.fillRect(14, h - 40, w - 28, 26);
  });
}

type Neon = { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; k: number };

/** Everything around the robots: the room shell, floor, window, clock, whiteboard, props and the lights. */
export class Environment {
  readonly group = new THREE.Group();
  readonly ambient = new THREE.AmbientLight(0xffffff, 1.5);
  readonly sun = new THREE.DirectionalLight(0xffffff, 1.6);

  private matBack = new THREE.MeshLambertMaterial();
  private matLeft = new THREE.MeshLambertMaterial();
  private matBase = new THREE.MeshLambertMaterial();
  private matSlab = new THREE.MeshLambertMaterial();
  private matFrame = new THREE.MeshLambertMaterial();
  private wood = woodTexture();
  private grid = gridTexture();
  private matWood = new THREE.MeshLambertMaterial({ map: this.wood });
  private matGrid = new THREE.MeshBasicMaterial({ map: this.grid, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 });
  private matRug = new THREE.MeshLambertMaterial({ map: rugTexture() });
  private slab = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.matSlab);
  private floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.matWood);
  private gridMesh = noPick(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.matGrid));
  private rug = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.matRug);
  private wallBack = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.matBack);
  private wallLeft = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.matLeft);
  private baseBack = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.matBase);
  private baseLeft = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.matBase);
  private neon: { name: string; item: Neon }[] = [];
  private windowGroup = new THREE.Group();
  private frames: THREE.Mesh[] = [];
  private glass: THREE.Mesh;
  private glassMat: THREE.MeshBasicMaterial;
  private clock: THREE.Mesh;
  private clockMat: THREE.MeshBasicMaterial;
  private board: THREE.Mesh;
  private boardMat: THREE.MeshBasicMaterial;
  private sign: THREE.Mesh;
  private signMat: THREE.MeshBasicMaterial;
  private plants: THREE.Group[] = [];
  private rack = new THREE.Group();
  private vending = new THREE.Group();
  private lamp = new THREE.Group();
  private lampGlow: THREE.Sprite;

  private w = 6;
  private d = 6;
  private lounge: LoungeRect = null;
  private night = 0;
  private hours = 12;
  private info?: TimeInfo;
  private windowKey = "";
  private windowAt = 0;
  private clockKey = -1;
  private boardKey = "";
  private boardData: BoardData = { total: 0, agents: 0, interns: 0, bars: [] };
  private boardDirty = true;

  constructor(scene: THREE.Scene) {
    const g = this.group;
    this.floor.rotation.x = -Math.PI / 2;
    this.gridMesh.rotation.x = -Math.PI / 2;
    this.gridMesh.position.y = 0.012;
    this.rug.rotation.x = -Math.PI / 2;
    this.rug.position.y = 0.01;
    this.rug.visible = false;
    g.add(this.slab, this.floor, this.gridMesh, this.rug, this.wallBack, this.wallLeft, this.baseBack, this.baseLeft);

    const neon = (name: string, color: number, k: number, glowBoost = true) => {
      const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0 });
      const mesh = noPick(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), m));
      g.add(mesh);
      this.neon.push({ name, item: { mesh, mat: m, k } });
      if (glowBoost) {
        const hm = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
        const halo = noPick(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), hm));
        g.add(halo);
        this.neon.push({ name: name + "-halo", item: { mesh: halo, mat: hm, k: k * 0.28 } });
      }
    };
    for (const n of ["topBack", "topLeft"]) neon(n, CYAN, 1);
    for (const n of ["baseBack", "baseLeft", "floorFront", "floorRight"]) neon(n, PINK, 1);

    // window: glass with a drawn sky and city, a frame on top
    this.glassMat = new THREE.MeshBasicMaterial();
    this.glass = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.glassMat);
    this.windowGroup.add(this.glass);
    for (let i = 0; i < 6; i++) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.matFrame);
      this.frames.push(f);
      this.windowGroup.add(f);
    }
    g.add(this.windowGroup);

    this.clockMat = new THREE.MeshBasicMaterial();
    this.clock = new THREE.Mesh(new THREE.CircleGeometry(0.3, 40), this.clockMat);
    g.add(this.clock);

    this.boardMat = new THREE.MeshBasicMaterial({ transparent: true });
    this.board = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.boardMat);
    this.board.rotation.y = Math.PI / 2;
    g.add(this.board);
    this.signMat = new THREE.MeshBasicMaterial({ map: signTexture(), transparent: true, opacity: 0, depthWrite: false });
    this.sign = noPick(new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.48), this.signMat));
    this.sign.rotation.y = Math.PI / 2;
    g.add(this.sign);

    // props
    for (let i = 0; i < 3; i++) {
      const p = new THREE.Group();
      p.add(box(0.42, 0.4, 0.42, mat(COLORS.plantPot), 0, 0.2, 0));
      [[COLORS.plantA, 0.82, 0.3], [COLORS.plantB, 0.58, 0.55], [COLORS.plantC, 0.44, 0.78]].forEach(([col, s, y]) => p.add(box(s!, 0.34, s!, mat(col!), 0, y!, 0)));
      this.plants.push(p);
      g.add(p);
    }
    this.rack.add(box(0.8, 1.9, 0.6, mat(0x14122a), 0, 0.95, 0));
    const rf = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.7), new THREE.MeshBasicMaterial({ map: rackFace() }));
    rf.position.set(0, 0.95, 0.305);
    this.rack.add(rf);
    this.vending.add(box(0.8, 2.0, 0.7, mat(0x1a1434), 0, 1.0, 0));
    const vf = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.8), new THREE.MeshBasicMaterial({ map: vendingFace() }));
    vf.position.set(0, 1.0, 0.355);
    this.vending.add(vf);
    this.lamp.add(box(0.1, 1.45, 0.1, mat(0x3c385a), 0, 0.72, 0));
    this.lamp.add(box(0.34, 0.25, 0.34, new THREE.MeshBasicMaterial({ color: 0xffd682 }), 0, 1.55, 0));
    this.lampGlow = noPick(new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture(), color: 0xffd27a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 })));
    this.lampGlow.scale.set(3.2, 3.2, 1);
    this.lampGlow.position.set(0, 1.5, 0);
    this.lamp.add(this.lampGlow);
    g.add(this.rack, this.vending, this.lamp);

    scene.add(g, this.ambient, this.sun);
    this.layout(6, 6, null);
  }

  /** Called every frame with the room's (eased) size. */
  layout(w: number, d: number, lounge: LoungeRect): void {
    this.flushBoard();
    this.w = w;
    this.d = d;
    this.lounge = lounge;
    const H = WALL_H;
    this.slab.scale.set(w + 0.3, 0.5, d + 0.3);
    this.slab.position.set((w - 0.3) / 2, -0.27, (d - 0.3) / 2);
    this.floor.scale.set(w, d, 1);
    this.floor.position.set(w / 2, 0, d / 2);
    this.wood.repeat.set(w / 2.4, d / 2.4);
    this.gridMesh.scale.set(w, d, 1);
    this.gridMesh.position.set(w / 2, 0.012, d / 2);
    this.grid.repeat.set(w / 2, d / 2);
    this.wallBack.scale.set(w, H, 0.3);
    this.wallBack.position.set(w / 2, H / 2, -0.15);
    this.wallLeft.scale.set(0.3, H, d);
    this.wallLeft.position.set(-0.15, H / 2, d / 2);
    this.baseBack.scale.set(w, 0.16, 0.06);
    this.baseBack.position.set(w / 2, 0.08, 0.03);
    this.baseLeft.scale.set(0.06, 0.16, d);
    this.baseLeft.position.set(0.03, 0.08, d / 2);
    const place = (name: string, sx: number, sy: number, sz: number, x: number, y: number, z: number) => {
      const alongX = sx >= sz;
      for (const { name: n, item } of this.neon) {
        if (n !== name && n !== name + "-halo") continue;
        const t = n.endsWith("-halo") ? 3.2 : 1; // the halo is a fatter copy of the same strip
        item.mesh.scale.set(alongX ? sx : sx * t, sy * t, alongX ? sz * t : sz);
        item.mesh.position.set(x, y, z);
      }
    };
    place("topBack", w, 0.05, 0.05, w / 2, H, 0.04);
    place("topLeft", 0.05, 0.05, d, 0.04, H, d / 2);
    place("baseBack", w, 0.04, 0.04, w / 2, 0.2, 0.05);
    place("baseLeft", 0.04, 0.04, d, 0.05, 0.2, d / 2);
    place("floorFront", w, 0.05, 0.05, w / 2, 0.03, d);
    place("floorRight", 0.05, 0.05, d, w, 0.03, d / 2);

    // window, centered on the back wall; clock to its left
    const ww = Math.max(2.2, Math.min(5.2, w * 0.5));
    this.windowGroup.position.set(w / 2, 1.95, 0.02);
    this.glass.scale.set(ww, 1.9, 1);
    const fr = (i: number, sx: number, sy: number, x: number, y: number) => {
      this.frames[i]!.scale.set(sx, sy, 0.08);
      this.frames[i]!.position.set(x, y, 0.03);
    };
    fr(0, ww + 0.16, 0.1, 0, 0.95);
    fr(1, ww + 0.16, 0.1, 0, -0.95);
    fr(2, 0.1, 1.9, -ww / 2, 0);
    fr(3, 0.1, 1.9, ww / 2, 0);
    fr(4, 0.07, 1.9, -ww / 6, 0);
    fr(5, 0.07, 1.9, ww / 6, 0);
    this.clock.position.set(Math.max(0.9, w / 2 - ww / 2 - 0.7), 2.55, 0.03);
    this.clock.visible = w >= 5;
    this.windowGroup.visible = w >= 4;

    // whiteboard and sign on the left wall
    const bw = Math.max(2.4, Math.min(5.0, d * 0.6));
    this.board.scale.set(bw, 1.75, 1);
    this.board.position.set(0.02, 1.8, d / 2);
    this.sign.position.set(0.025, 3.0, d / 2);
    this.board.visible = d >= 4;
    this.sign.visible = d >= 4;

    // lounge rug
    this.rug.visible = !!lounge;
    if (lounge) {
      this.rug.scale.set(lounge.x1 - lounge.x0, lounge.z1 - lounge.z0, 1);
      this.rug.position.set((lounge.x0 + lounge.x1) / 2, 0.01, (lounge.z0 + lounge.z1) / 2);
    }

    // props, only where the room is big enough for them
    const big = w >= 8 && d >= 7;
    this.plants[0]!.position.set(0.45, 0, Math.max(2.6, d * 0.5 + 1.6));
    this.plants[0]!.visible = d >= 5;
    this.plants[1]!.position.set(0.5, 0, d - 0.6);
    this.plants[1]!.visible = d >= 5;
    this.plants[2]!.position.set(w - 0.55, 0, d - 0.55);
    this.plants[2]!.visible = !lounge && w >= 6;
    this.rack.position.set(0.75, 0, 0.5);
    this.rack.visible = big && this.showNightProps;
    this.vending.position.set(w - 0.7, 0, 0.55);
    this.vending.visible = big && this.showNightProps;
    this.lamp.position.set(w - 0.5, 0, d - 0.5);
    this.lamp.visible = !!lounge;
  }

  setTotals(room: Room): void {
    const bars = [...room.characters].sort((a, b) => b.tokens.headline - a.tokens.headline).slice(0, 7).map((c) => ({ v: c.tokens.headline, color: c.color }));
    const interns = room.characters.reduce((n, c) => n + c.interns.total, 0);
    const key = `${room.totals.headline}|${room.characters.length}|${interns}|${bars.map((b) => b.v + b.color).join(",")}`;
    if (key === this.boardKey) return;
    this.boardKey = key;
    this.boardData = { total: room.totals.headline, agents: room.characters.length, interns, bars };
    this.boardDirty = true;
    this.flushBoard();
  }

  /** Redraw the whiteboard if its data or style changed, at most about 3 times a second. */
  private flushBoard(): void {
    const dark = this.night > 0.5;
    if (!this.boardDirty && dark === this.boardDark) return;
    const now = performance.now();
    if (now - this.boardAt < 350) return;
    this.boardAt = now;
    this.boardDirty = false;
    this.boardDark = dark;
    const old = this.boardMat.map;
    this.boardMat.map = canvasTexture(640, 224, (c, w, h) => drawBoard(c, w, h, this.night, this.boardData));
    this.boardMat.needsUpdate = true;
    old?.dispose();
  }

  /** The time-of-day look changed: re-tint everything that follows it. */
  apply(info: TimeInfo): void {
    this.info = info;
    const p = info.palette;
    const night = p.night;
    this.night = night;
    this.showNightProps = night > 0.25;
    this.hours = info.hours;
    setRGB(this.ambient.color, p.ambient.color);
    this.ambient.intensity = p.ambient.intensity;
    setRGB(this.sun.color, p.sun.color);
    this.sun.intensity = p.sun.intensity;
    this.sun.position.set(p.sun.x, p.sun.y, p.sun.z);
    setRGB(this.matBack.color, p.wallBack);
    setRGB(this.matLeft.color, p.wallLeft);
    setRGB(this.matBase.color, p.base);
    setRGB(this.matSlab.color, p.slab);
    setRGB(this.matWood.color, p.floorTint);
    setRGB(this.matRug.color, p.floorTint);
    setRGB(this.matFrame.color, mixRGB([255, 255, 255], [14, 9, 36], night));

    const neon = smoothstep(night, 0.3, 0.85);
    for (const { item } of this.neon) item.mat.opacity = neon * item.k * (item.k < 1 ? 0.9 : 0.95);
    this.matGrid.opacity = smoothstep(night, 0.35, 0.9) * 0.9;
    this.signMat.opacity = neon;
    (this.lampGlow.material as THREE.SpriteMaterial).opacity = smoothstep(night, 0.25, 0.7) * 0.8;

    // textures that depend on the time: redrawn only when they would visibly change
    const key = `${Math.round(this.hours * 30)}|${Math.round(night * 20)}`;
    if (key !== this.windowKey && performance.now() - this.windowAt > 200) {
      this.windowKey = key;
      this.windowAt = performance.now();
      const old = this.glassMat.map;
      this.glassMat.map = canvasTexture(512, 192, (c, w, h) => drawWindow(c, w, h, p, this.hours));
      this.glassMat.needsUpdate = true;
      old?.dispose();
    }
    const minute = Math.floor(this.hours * 60);
    if (minute !== this.clockKey) {
      this.clockKey = minute;
      const old = this.clockMat.map;
      this.clockMat.map = canvasTexture(128, 128, (c, w) => drawClock(c, w, p, this.hours));
      this.clockMat.needsUpdate = true;
      old?.dispose();
    }
    this.flushBoard();
  }

  private boardDark = false;
  private boardAt = 0;
  private showNightProps = false;
}
