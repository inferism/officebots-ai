import * as THREE from "three";
import type { Character } from "../../../src/server/room.js";
import { box, canvasTexture, COLORS, glow, mat, noPick, radialTexture } from "./palette.js";
import type { Palette } from "./timeofday.js";

const S = 1.2; // robot scale
type Status = Character["status"];

const hexOf = (css: string) => parseInt(css.slice(1), 16);
const mix = (a: string, b: string, t: number) => new THREE.Color(a).lerp(new THREE.Color(b), t);
const cssOf = (c: THREE.Color) => "#" + c.getHexString();

/** Eye color: a soft mint by day, the model's own color at night, so the robots glow with it. */
function eyeColor(status: Status, model: string, night: number): string {
  if (status === "waiting") return "#ffcf6b";
  if (status === "sleeping") return cssOf(mix("#8f9bb3", "#6b6b9a", night));
  return cssOf(mix("#7ff0cf", cssOf(new THREE.Color(model).lerp(new THREE.Color("#ffffff"), 0.3)), night));
}

const faceCache = new Map<string, THREE.CanvasTexture>();
/** The robot's face screen: ^ ^ while working, dots while waiting, - - asleep. */
function faceTexture(status: Status, eye: string): THREE.CanvasTexture {
  const key = status + eye;
  let t = faceCache.get(key);
  if (!t) {
    t = canvasTexture(128, 64, (c, w, h) => {
      c.fillStyle = "#12141c";
      c.fillRect(0, 0, w, h);
      c.strokeStyle = c.fillStyle = eye;
      c.lineWidth = 7;
      c.lineCap = c.lineJoin = "round";
      c.shadowColor = eye;
      c.shadowBlur = 8;
      const ey = h * 0.46, lx = w * 0.32, rx = w * 0.68, r = w * 0.08;
      if (status === "working") {
        for (const x of [lx, rx]) {
          c.beginPath();
          c.moveTo(x - r, ey + r * 0.6);
          c.lineTo(x, ey - r * 0.7);
          c.lineTo(x + r, ey + r * 0.6);
          c.stroke();
        }
      } else if (status === "waiting") {
        for (const x of [lx, rx]) {
          c.beginPath();
          c.arc(x, ey, r * 0.85, 0, 7);
          c.fill();
        }
        c.beginPath();
        c.moveTo(w * 0.42, h * 0.74);
        c.lineTo(w * 0.58, h * 0.74);
        c.stroke();
      } else {
        for (const x of [lx, rx]) {
          c.beginPath();
          c.moveTo(x - r, ey);
          c.lineTo(x + r, ey);
          c.stroke();
        }
      }
    });
    faceCache.set(key, t);
  }
  return t;
}

const statusLight = { working: 0x39ff88, waiting: 0xffb02e, sleeping: 0x6b6b8f } as const;

/**
 * One workstation: a robot, its desk, nameplate and monitor, plus a sofa used instead of the desk when it
 * sits in the lounge. The robot faces +z (toward the viewer's side of the desk).
 */
export class Station {
  readonly group = new THREE.Group();
  readonly key: string;
  /** 0 awake .. 1 asleep, eased every frame. */
  sleep = 0;
  /** Appear/disappear scale, 0..1. */
  grow = 0;
  fading = false;
  mode: "desk" | "lounge" = "desk";
  target = new THREE.Vector3();
  data: Character;

  private deskParts = new THREE.Group();
  private sofaParts = new THREE.Group();
  private robot = new THREE.Group();
  private headG = new THREE.Group();
  private arms: THREE.Group[] = [];
  private body: THREE.Mesh;
  private plate: THREE.Mesh;
  private ball: THREE.Mesh;
  private visor: THREE.Mesh;
  private led: THREE.Mesh;
  private halo: THREE.Sprite;
  private pool: THREE.Mesh;
  private poolMat: THREE.MeshBasicMaterial;
  private nameMat: THREE.MeshBasicMaterial;
  private night = 0;
  private nightQ = -1;
  private plateKey = "";
  private phase = Math.random() * 6.28;

  constructor(data: Character) {
    this.key = data.key;
    this.data = data;
    const g = this.group;
    g.userData.key = data.key;

    // ---- desk ----
    const d = this.deskParts;
    d.add(box(2.0, 0.08, 1.0, mat(COLORS.desk), 0, 0.78, 0.82));
    for (const sx of [-0.92, 0.92]) for (const sz of [0.42, 1.22]) d.add(box(0.1, 0.74, 0.1, mat(COLORS.deskLeg), sx, 0.37, sz));
    d.add(box(0.6, 0.03, 0.22, mat(COLORS.key), 0.25, 0.835, 0.74));
    d.add(box(0.16, 0.16, 0.16, mat(COLORS.mug), 0.85, 0.9, 0.92));
    // monitor to the robot's right so its face stays visible; we see its back and a status light
    d.add(box(0.24, 0.1, 0.1, mat(COLORS.stand), -0.62, 0.87, 0.6));
    d.add(box(1.0, 0.55, 0.07, mat(COLORS.monitor), -0.62, 1.2, 0.58));
    this.led = box(0.12, 0.12, 0.04, glow(statusLight.working), -0.24, 1.42, 0.63);
    d.add(this.led);
    // nameplate on the desk edge
    d.add(box(0.9, 0.26, 0.05, mat(0xfaf6ec), 0.2, 0.95, 1.2));
    this.nameMat = new THREE.MeshBasicMaterial({ transparent: true });
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.22), this.nameMat);
    plate.position.set(0.2, 0.95, 1.2 + 0.03);
    d.add(plate);
    // a pool of light under the desk, in the robot's color (shows at night)
    this.poolMat = new THREE.MeshBasicMaterial({ map: radialTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 });
    this.pool = noPick(new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.5), this.poolMat));
    this.pool.rotation.x = -Math.PI / 2;
    this.pool.position.set(0, 0.02, 0.8);
    g.add(this.pool);
    g.add(d);

    // ---- sofa (lounge) ----
    const s = this.sofaParts;
    s.add(box(1.6, 0.32, 0.85, mat(COLORS.sofa), 0, 0.16, 0.05));
    s.add(box(1.6, 0.5, 0.22, mat(COLORS.sofaBack), 0, 0.57, -0.34));
    for (const sx of [-0.84, 0.84]) s.add(box(0.16, 0.52, 0.85, mat(COLORS.sofaArm), sx, 0.26, 0.05));
    s.visible = false;
    g.add(s);

    // ---- robot ----
    const r = this.robot;
    r.add(box(0.56 * S, 0.16 * S, 0.44 * S, mat(COLORS.robotBase), 0, 0.08 * S, 0));
    this.body = box(0.62 * S, 0.8 * S, 0.5 * S, mat(0xffffff), 0, 0.56 * S, 0);
    r.add(this.body);
    this.plate = new THREE.Mesh(new THREE.PlaneGeometry(0.38 * S, 0.17 * S), glow(0xffffff));
    this.plate.position.set(0, 0.66 * S, 0.25 * S + 0.005);
    r.add(this.plate);
    for (const sx of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(sx * 0.47 * S, 0.9 * S, 0);
      arm.add(box(0.15 * S, 0.44 * S, 0.22 * S, mat(0xffffff), 0, -0.2 * S, 0));
      r.add(arm);
      this.arms.push(arm);
    }
    this.headG.position.set(0, 0.96 * S, 0);
    this.headG.add(box(0.7 * S, 0.5 * S, 0.54 * S, mat(COLORS.robotHead), 0, 0.25 * S, 0));
    this.visor = new THREE.Mesh(new THREE.PlaneGeometry(0.56 * S, 0.3 * S), new THREE.MeshBasicMaterial({ map: faceTexture("working", "#7ff0cf") }));
    this.visor.position.set(0, 0.25 * S, 0.27 * S + 0.004);
    this.headG.add(this.visor);
    this.headG.add(box(0.06 * S, 0.2 * S, 0.06 * S, mat(COLORS.robotBase), 0, 0.6 * S, 0));
    this.ball = box(0.14 * S, 0.14 * S, 0.14 * S, glow(0xffffff), 0, 0.77 * S, 0);
    this.headG.add(this.ball);
    this.halo = noPick(new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 })));
    this.halo.scale.set(1.1, 1.1, 1);
    this.halo.position.set(0, 0.77 * S, 0);
    this.headG.add(this.halo);
    r.add(this.headG);
    g.add(r);
    g.scale.setScalar(0);
    this.update(data);
  }

  update(data: Character): void {
    const colorChanged = data.color !== this.data.color;
    const statusChanged = data.status !== this.data.status;
    this.data = data;
    if (colorChanged || this.plateKey === "") {
      const body = new THREE.Color(data.color).lerp(new THREE.Color("#ffffff"), 0.12);
      this.body.material = mat(body.getHex());
      for (const a of this.arms) (a.children[0] as THREE.Mesh).material = mat(new THREE.Color(data.color).lerp(new THREE.Color("#000000"), 0.12).getHex());
      this.plate.material = glow(new THREE.Color(data.color).lerp(new THREE.Color("#ffffff"), 0.15).getHex());
      this.ball.material = glow(hexOf(data.color));
      (this.halo.material as THREE.SpriteMaterial).color.set(data.color);
      this.poolMat.color.set(data.color);
    }
    if (statusChanged || this.plateKey === "") this.led.material = glow(statusLight[data.status]);
    this.refreshFace();
    this.refreshNameplate();
  }

  private refreshFace(): void {
    const q = Math.max(0, this.nightQ) / 4;
    (this.visor.material as THREE.MeshBasicMaterial).map = faceTexture(this.data.status, eyeColor(this.data.status, this.data.color, q));
  }

  private refreshNameplate(): void {
    const dark = this.night > 0.5;
    const key = `${this.data.role}|${this.data.color}|${dark}`;
    if (key === this.plateKey) return;
    this.plateKey = key;
    const old = this.nameMat.map;
    this.nameMat.map = canvasTexture(256, 64, (c, w, h) => {
      c.fillStyle = dark ? "#0b0818" : "#faf6ec";
      c.fillRect(0, 0, w, h);
      c.fillStyle = this.data.color;
      c.shadowColor = dark ? this.data.color : "transparent";
      c.shadowBlur = dark ? 10 : 0;
      c.fillRect(0, h - 12, w, 9);
      c.shadowBlur = 0;
      c.fillStyle = dark ? "#e9e6ff" : "#4a3728";
      c.font = `bold 34px ${dark ? "Consolas, monospace" : '"Trebuchet MS", system-ui, sans-serif'}`;
      c.textAlign = "center";
      c.fillText(dark ? this.data.role.toUpperCase() : this.data.role, w / 2, 36);
    });
    this.nameMat.needsUpdate = true;
    old?.dispose();
  }

  /** The time-of-day look changed: re-tint the parts that change with it. */
  applyEnv(p: Palette): void {
    this.night = p.night;
    const q = Math.round(p.night * 4);
    if (q !== this.nightQ) {
      this.nightQ = q;
      this.refreshFace();
    }
    this.refreshNameplate();
  }

  setMode(mode: "desk" | "lounge"): void {
    this.mode = mode;
    this.deskParts.visible = mode === "desk";
    this.sofaParts.visible = mode === "lounge";
    this.pool.visible = mode === "desk";
  }

  /** Per-frame animation. dt in seconds, t = elapsed seconds. */
  tick(dt: number, t: number): void {
    this.group.position.lerp(this.target, 1 - Math.exp(-dt * 4));
    const sleeping = this.data.status === "sleeping" ? 1 : 0;
    this.sleep += (sleeping - this.sleep) * (1 - Math.exp(-dt * 6));
    this.grow += ((this.fading ? 0 : 1) - this.grow) * (1 - Math.exp(-dt * 5));
    this.group.scale.setScalar(Math.max(0.0001, this.grow));

    const lounge = this.mode === "lounge";
    this.robot.position.set(0, lounge ? 0.3 : 0, lounge ? 0.05 : 0);
    const working = this.data.status === "working";
    // working: arms out typing and a little nod; waiting: head tilted, antenna blinking; asleep: head dropped
    for (const [i, arm] of this.arms.entries()) {
      arm.rotation.x = (1 - this.sleep) * (working ? -1.15 + Math.sin(t * 15 + i * 2 + this.phase) * 0.14 : -0.15) + this.sleep * -0.1;
    }
    this.headG.rotation.x = this.sleep * 0.5 + (working ? Math.sin(t * 3 + this.phase) * 0.04 : 0);
    this.headG.rotation.z = this.data.status === "waiting" ? Math.sin(t * 1.3 + this.phase) * 0.07 : 0;
    this.robot.rotation.x = this.sleep * (lounge ? -0.08 : 0.06);
    const blink = this.data.status === "waiting" ? (Math.sin(t * 4 + this.phase) > 0 ? 1 : 0.35) : this.data.status === "sleeping" ? 0.5 : 1;
    this.ball.scale.setScalar(0.14 * S * blink);

    // night glow: halo on the antenna, light pool under the desk
    const awake = 1 - this.sleep;
    (this.halo.material as THREE.SpriteMaterial).opacity = this.night * awake * 0.8 * blink;
    this.poolMat.opacity = this.night * (0.2 + 0.4 * awake);
  }

  /** World point above the head, for the HTML label. */
  headPoint(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.group.position.x, 2.35 * this.group.scale.y + this.group.position.y, this.group.position.z + 0.1);
  }
}
