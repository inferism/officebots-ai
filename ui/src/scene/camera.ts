import * as THREE from "three";

const VIEW_HEIGHT = 20; // world units visible at zoom 1
const DIST = 80;

export type Insets = { top: number; bottom: number; left: number; right: number };

/** Isometric orthographic camera that eases toward a zoom and focus point that fit the room. */
export class IsoCamera {
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
  private dir = new THREE.Vector3(1, 1, 1).normalize();
  private focus = new THREE.Vector3(5, 0, 5);
  private focusTarget = new THREE.Vector3(5, 0, 5);
  private zoom = 1;
  private zoomTarget = 1;
  private aspect = 1;
  private viewW = 1;
  private viewH = 1;
  private insets: Insets = { top: 0, bottom: 0, left: 0, right: 0 };
  private right = new THREE.Vector3();
  private up = new THREE.Vector3();

  constructor() {
    this.apply();
    this.right.setFromMatrixColumn(this.camera.matrixWorld, 0);
    this.up.setFromMatrixColumn(this.camera.matrixWorld, 1);
  }

  resize(w: number, h: number): void {
    this.viewW = w;
    this.viewH = h;
    this.aspect = w / h;
    this.apply();
  }

  /** Pixels at the edges of the view that something else (header, dock) covers; the room is centered in the rest. */
  setInsets(i: Insets): void {
    this.insets = i;
  }

  /** Fit a floor of the given size (plus wall height) into the uncovered part of the view. */
  fit(w: number, d: number, snap = false): void {
    const corners = [
      [0, 0, 0], [w, 0, 0], [0, 0, d], [w, 0, d],
      [0, 4.7, 0], [w, 4.7, 0], [0, 4.7, d], [w, 4.7, d],
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
    const bw = (maxX - minX) * 1.08;
    const bh = (maxY - minY) * 1.08;
    const { top, bottom, left, right } = this.insets;
    const freeW = Math.max(50, this.viewW - left - right);
    const freeH = Math.max(50, this.viewH - top - bottom);
    // zoom so the room fits the free area (VIEW_HEIGHT world units span the full view height at zoom 1)
    this.zoomTarget = Math.min((freeW / this.viewW) * VIEW_HEIGHT * this.aspect / bw, (freeH / this.viewH) * VIEW_HEIGHT / bh);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    // shift the focus so the room's center lands in the middle of the free area, not the middle of the view
    const ppu = this.viewH / (VIEW_HEIGHT / this.zoomTarget);
    const shiftX = (left - right) / 2 / ppu; // content moves right when the left inset is larger
    const shiftY = (top - bottom) / 2 / ppu; // content moves down when the top inset is larger
    this.focusTarget.copy(this.right).multiplyScalar(cx - shiftX).addScaledVector(this.up, cy + shiftY);
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
