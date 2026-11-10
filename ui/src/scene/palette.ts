import * as THREE from "three";

// Fixed colors of objects in the room. Lighting and the time-of-day palette do the rest.
export const COLORS = {
  desk: 0xeed3a4,
  deskLeg: 0x966c48,
  key: 0x60626c,
  mug: 0xf4f2ec,
  stand: 0x4a4c56,
  monitor: 0x3c404e,
  robotHead: 0xf4f2ec,
  robotBase: 0x585660,
  sofa: 0xd6866a,
  sofaBack: 0xc4745a,
  sofaArm: 0xe2967c,
  plantPot: 0xc97654,
  plantA: 0x46965c,
  plantB: 0x58a868,
  plantC: 0x3c8656,
  white: 0xffffff,
};

const mats = new Map<string, THREE.MeshLambertMaterial>();
/** Shared lit material per color. */
export function mat(color: number | string): THREE.MeshLambertMaterial {
  const key = String(color);
  let m = mats.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color });
    mats.set(key, m);
  }
  return m;
}

const emissive = new Map<number, THREE.MeshBasicMaterial>();
/** Shared unlit material, for lights and screens. */
export function glow(color: number): THREE.MeshBasicMaterial {
  let m = emissive.get(color);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color });
    emissive.set(color, m);
  }
  return m;
}

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
/** A box mesh of the given size, centered at (x, y, z) in its parent. */
export function box(w: number, h: number, d: number, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(boxGeo, material);
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  return m;
}

/** A texture drawn with the 2D canvas API. */
export function canvasTexture(w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext("2d")!, w, h);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

let radial: THREE.CanvasTexture | undefined;
/** White soft round glow, for additive light pools and halos. Tint it with the material color. */
export function radialTexture(): THREE.CanvasTexture {
  radial ??= canvasTexture(128, 128, (c, w, h) => {
    const g = c.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.35, "rgba(255,255,255,.45)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  });
  return radial;
}

/** Make a mesh invisible to hover picking (glows, light pools). */
export function noPick<T extends THREE.Object3D>(o: T): T {
  o.raycast = () => {};
  return o;
}
