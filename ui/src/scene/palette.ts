import * as THREE from "three";

// Room colors follow the mockup. Character colors come from the server (model family / account).
export const COLORS = {
  bg: 0x14161c,
  floorA: 0x3a3e4e,
  floorB: 0x32364a,
  wallRight: 0x5c627c, // wall behind, seen on the right
  wallLeft: 0x4a4f66,
  baseboard: 0x3c4054,
  desk: 0x8a6a4a,
  deskTop: 0xa98863,
  chair: 0x2b2e3a,
  sofa: 0x5b4b7a,
  skin: 0xe8c39e,
  hair: 0x2a2a30,
  pants: 0x2f3345,
  screenOff: 0x15171d,
  screenWork: 0x6be59a,
  screenWait: 0xf0c15a,
  lightWork: 0x4ade80,
  lightWait: 0xf0b429,
  lightSleep: 0x6b7280,
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
/** Shared unlit material, for screens and status lights. */
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
