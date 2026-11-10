import * as THREE from "three";
import type { Station } from "./character.js";

// Where interns stand around a desk, relative to the seat: (x, z).
const SPOTS: [number, number][] = [
  [-1.9, 0.6],
  [1.9, 0.6],
  [-1.9, 1.9],
  [1.9, 1.9],
  [-0.8, 2.6],
  [0.8, 2.6],
];
export const MAX_INTERNS_SHOWN = SPOTS.length;
const CAPACITY = 800;

/** Up to six tiny figures per desk, drawn with two InstancedMeshes in total. */
export class Interns {
  readonly body: THREE.InstancedMesh;
  readonly headMesh: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private grey = new THREE.Color(0x5a5f70);
  private tmp = new THREE.Color();

  constructor(scene: THREE.Scene) {
    const white = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.body = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 0.55, 0.28), white, CAPACITY);
    this.headMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshLambertMaterial({ color: 0xf4f2ec }), CAPACITY);
    this.body.count = this.headMesh.count = 0;
    this.body.frustumCulled = this.headMesh.frustumCulled = false;
    scene.add(this.body, this.headMesh);
  }

  /** Reposition every intern. Cheap enough to run each frame. */
  update(stations: Iterable<Station>, t: number): number {
    let n = 0;
    for (const st of stations) {
      if (st.mode !== "desk" || st.grow < 0.05) continue;
      const total = Math.min(st.data.interns.total, MAX_INTERNS_SHOWN);
      for (let i = 0; i < total && n < CAPACITY; i++) {
        const active = i < st.data.interns.active;
        const bob = active ? Math.abs(Math.sin(t * 6 + i * 1.7)) * 0.12 : 0;
        const [ox, oz] = SPOTS[i]!;
        const g = st.group.position;
        const s = st.grow;
        this.s.setScalar(s);
        this.v.set(g.x + ox * s, 0.3 * s + bob, g.z + oz * s);
        this.m.compose(this.v, this.q, this.s);
        this.body.setMatrixAt(n, this.m);
        this.v.set(g.x + ox * s, 0.85 * s + bob, g.z + oz * s);
        this.m.compose(this.v, this.q, this.s);
        this.headMesh.setMatrixAt(n, this.m);
        this.tmp.set(st.data.color);
        if (!active) this.tmp.lerp(this.grey, 0.7);
        this.body.setColorAt(n, this.tmp);
        n++;
      }
    }
    this.body.count = this.headMesh.count = n;
    this.body.instanceMatrix.needsUpdate = this.headMesh.instanceMatrix.needsUpdate = true;
    if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
    return n;
  }
}
