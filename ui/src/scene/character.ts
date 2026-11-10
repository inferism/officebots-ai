import * as THREE from "three";
import type { Character } from "../../../src/server/room.js";
import { box, COLORS, glow, mat } from "./palette.js";

/**
 * One workstation: desk, chair, monitor and a voxel character, plus a sofa used instead of the desk
 * when the character is in the lounge. The character faces +z (toward the viewer's side of the desk).
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
  private torso = new THREE.Group();
  private head = new THREE.Group();
  private arms: THREE.Group[] = [];
  private screen: THREE.Mesh;
  private light: THREE.Mesh;
  private phase = Math.random() * 6.28;

  constructor(data: Character) {
    this.key = data.key;
    this.data = data;
    const g = this.group;
    g.userData.key = data.key;

    // desk, in front of (+z of) the seat
    const d = this.deskParts;
    d.add(box(2.3, 0.12, 1.1, mat(COLORS.deskTop), 0, 1.05, 1.15));
    for (const sx of [-1, 1]) d.add(box(0.12, 1.0, 0.9, mat(COLORS.desk), sx * 1.05, 0.5, 1.15));
    // chair behind the seat
    d.add(box(0.9, 0.12, 0.8, mat(COLORS.chair), 0, 0.62, -0.05));
    d.add(box(0.9, 0.9, 0.12, mat(COLORS.chair), 0, 1.1, -0.5));
    // monitor on the desk: back faces the viewer, status light on top
    d.add(box(0.2, 0.25, 0.2, mat(COLORS.chair), 0, 1.24, 1.25));
    this.screen = box(1.1, 0.7, 0.08, glow(COLORS.screenOff), 0, 1.7, 1.12);
    d.add(this.screen);
    d.add(box(1.16, 0.76, 0.06, mat(COLORS.chair), 0, 1.7, 1.2));
    this.light = box(0.16, 0.16, 0.16, glow(COLORS.lightSleep), 0.45, 2.15, 1.2);
    d.add(this.light);
    g.add(d);

    // sofa for the lounge
    const s = this.sofaParts;
    s.add(box(1.7, 0.45, 1.0, mat(COLORS.sofa), 0, 0.25, 0));
    s.add(box(1.7, 0.8, 0.3, mat(COLORS.sofa), 0, 0.7, -0.5));
    s.add(box(0.25, 0.65, 1.0, mat(COLORS.sofa), -0.9, 0.5, 0));
    s.add(box(0.25, 0.65, 1.0, mat(COLORS.sofa), 0.9, 0.5, 0));
    s.visible = false;
    g.add(s);

    // character, seated: legs forward, torso pivots at the hips
    const shirt = mat(data.color);
    const c = new THREE.Group();
    for (const sx of [-0.2, 0.2]) {
      c.add(box(0.3, 0.3, 0.8, mat(COLORS.pants), sx, 0.72, 0.35));
      c.add(box(0.3, 0.7, 0.3, mat(COLORS.pants), sx, 0.35, 0.7));
    }
    this.torso.position.set(0, 0.85, 0);
    this.torso.add(box(0.8, 0.9, 0.4, shirt, 0, 0.45, 0));
    for (const sx of [-0.55, 0.55]) {
      const arm = new THREE.Group();
      arm.position.set(sx, 0.8, 0);
      arm.add(box(0.22, 0.75, 0.22, shirt, 0, -0.35, 0));
      arm.add(box(0.2, 0.2, 0.2, mat(COLORS.skin), 0, -0.78, 0));
      this.torso.add(arm);
      this.arms.push(arm);
    }
    this.head.position.set(0, 1.0, 0);
    this.head.add(box(0.55, 0.55, 0.55, mat(COLORS.skin), 0, 0.3, 0));
    this.head.add(box(0.58, 0.18, 0.58, mat(COLORS.hair), 0, 0.57, -0.02));
    if (data.accent !== data.color) this.head.add(box(0.6, 0.12, 0.6, mat(data.accent), 0, 0.46, 0)); // account cap band
    this.torso.add(this.head);
    c.add(this.torso);
    g.add(c);
    g.scale.setScalar(0);
  }

  update(data: Character): void {
    this.data = data;
    const mats = { working: [COLORS.screenWork, COLORS.lightWork], waiting: [COLORS.screenWait, COLORS.lightWait], sleeping: [COLORS.screenOff, COLORS.lightSleep] } as const;
    const [screen, light] = mats[data.status];
    this.screen.material = glow(screen);
    this.light.material = glow(light);
  }

  setMode(mode: "desk" | "lounge"): void {
    this.mode = mode;
    this.deskParts.visible = mode === "desk";
    this.sofaParts.visible = mode === "lounge";
  }

  /** Per-frame animation. dt in seconds, t = elapsed seconds. */
  tick(dt: number, t: number): void {
    const k = 1 - Math.exp(-dt * 6);
    this.group.position.lerp(this.target, 1 - Math.exp(-dt * 4));
    const sleeping = this.data.status === "sleeping" ? 1 : 0;
    this.sleep += (sleeping - this.sleep) * k;
    this.grow += ((this.fading ? 0 : 1) - this.grow) * (1 - Math.exp(-dt * 5));
    this.group.scale.setScalar(Math.max(0.0001, this.grow));

    const working = this.data.status === "working";
    const type = working ? Math.sin(t * 14 + this.phase) * 0.06 : 0;
    const lean = this.mode === "lounge" ? -0.5 : 1.0; // head down on the desk, or slumped back on the sofa
    this.torso.rotation.x = 0.12 + (lean - 0.12) * this.sleep + (working ? Math.sin(t * 3 + this.phase) * 0.03 : 0);
    this.head.rotation.x = 0.35 * this.sleep * (this.mode === "lounge" ? -1 : 1) + type;
    for (const [i, arm] of this.arms.entries()) {
      arm.rotation.x = -1.35 * (1 - this.sleep) + -1.5 * this.sleep + (working ? Math.sin(t * 16 + i * 2 + this.phase) * 0.12 : 0);
    }
  }

  /** World point above the head, for the HTML label. */
  headPoint(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.group.position.x, 3.0 * this.group.scale.y + this.group.position.y, this.group.position.z + 0.3);
  }
}
