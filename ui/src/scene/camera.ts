import * as THREE from "three";

const VIEW_HEIGHT = 20; // world units visible at zoom 1
const DIST = 80;

/** Isometric orthographic camera that eases toward a zoom and focus point that fit the room. */
export class IsoCamera {
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
  private dir = new THREE.Vector3(1, 1, 1).normalize();
  private focus = new THREE.Vector3(5, 0, 5);
  private focusTarget = new THREE.Vector3(5, 0, 5);
  private zoom = 1;
  private zoomTarget = 1;
  private aspect = 1;
  private right = new THREE.Vector3();
  private up = new THREE.Vector3();

  constructor() {
    this.apply();
    this.right.setFromMatrixColumn(this.camera.matrixWorld, 0);
    this.up.setFromMatrixColumn(this.camera.matrixWorld, 1);
  }

  resize(w: number, h: number): void {
    this.aspect = w / h;
    this.apply();
  }

  /** Fit a floor of the given size (plus wall height) into view, with room for labels above heads. */
  fit(w: number, d: number, snap = false): void {
    const corners = [
      [0, 0, 0], [w, 0, 0], [0, 0, d], [w, 0, d],
      [0, 5.5, 0], [w, 5.5, 0], [0, 5.5, d], [w, 5.5, d],
    ];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const p = new THREE.Vector3();
    for (const [x, y, z] of corners) {
      p.set(x!, y!, z!);
      const sx = p.dot(this.right);
      const sy = p.dot(this.up);
      minX = Math.min(minX, sx); maxX = Math.max(maxX, sx);
      minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
    }
    const bw = (maxX - minX) * 1.12;
    const bh = (maxY - minY) * 1.12;
    this.zoomTarget = Math.min((VIEW_HEIGHT * this.aspect) / bw, VIEW_HEIGHT / bh);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    this.focusTarget.copy(this.right).multiplyScalar(cx).addScaledVector(this.up, cy);
    if (snap) {
      this.zoom = this.zoomTarget;
      this.focus.copy(this.focusTarget);
      this.apply();
    }
  }

  /** Screen pixels per world unit at the current zoom, for a viewport of the given height. */
  pxPerUnit(viewportHeight: number): number {
    return viewportHeight / (VIEW_HEIGHT / this.zoom);
  }

  update(dt: number): void {
    const k = 1 - Math.exp(-dt * 3.5);
    this.zoom += (this.zoomTarget - this.zoom) * k;
    this.focus.lerp(this.focusTarget, k);
    this.apply();
  }

  private apply(): void {
    const c = this.camera;
    const h = VIEW_HEIGHT / this.zoom / 2;
    c.left = -h * this.aspect;
    c.right = h * this.aspect;
    c.top = h;
    c.bottom = -h;
    c.position.copy(this.focus).addScaledVector(this.dir, DIST);
    c.lookAt(this.focus);
    c.updateProjectionMatrix();
    c.updateMatrixWorld();
  }
}
