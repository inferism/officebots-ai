// Pure layout: which character sits at a desk, on a lounge sofa, or is away. No three.js in here.

export type LayoutChar = { key: string; status: "working" | "waiting" | "sleeping"; lastActive: string };

export type Layout = {
  desks: Map<string, number>; // key -> desk slot
  lounge: Map<string, number>; // key -> sofa seat
  away: string[]; // faded out, listed in the sidebar only
  deskCount: number;
  cols: number;
  rows: number;
};

export type LayoutState = Pick<Layout, "desks" | "lounge">;

export const PITCH_X = 4.4;
export const PITCH_Z = 4.0;
export const SEAT_PITCH = 2.2;
export const LOUNGE_COLS = 2;

/**
 * Everyone awake gets a desk. Sleepers keep desks up to maxDesks (most recently active first); the
 * rest go to the lounge (most recent first), and whoever has slept longest beyond loungeCap is away.
 * Slots stay stable between calls so characters do not shuffle.
 */
export function computeLayout(
  chars: LayoutChar[],
  prev: LayoutState | undefined,
  opts: { maxDesks: number; loungeCap: number },
): Layout {
  const awake = chars.filter((c) => c.status !== "sleeping");
  const sleepers = chars
    .filter((c) => c.status === "sleeping")
    .sort((a, b) => Date.parse(b.lastActive) - Date.parse(a.lastActive) || a.key.localeCompare(b.key));

  const deskRoom = Math.max(0, opts.maxDesks - awake.length);
  const atDesk = [...awake.map((c) => c.key), ...sleepers.slice(0, deskRoom).map((c) => c.key)];
  const rest = sleepers.slice(deskRoom).map((c) => c.key);
  const inLounge = rest.slice(0, opts.loungeCap);
  const away = rest.slice(opts.loungeCap);

  const desks = assignSlots(atDesk, prev?.desks, atDesk.length);
  const lounge = assignSlots(inLounge, prev?.lounge, inLounge.length);
  const cols = Math.max(1, Math.ceil(Math.sqrt(atDesk.length)));
  return { desks, lounge, away, deskCount: atDesk.length, cols, rows: Math.max(1, Math.ceil(atDesk.length / cols)) };
}

/** Keep a previous slot if it is still in range, otherwise take the lowest free one. */
function assignSlots(keys: string[], prev: Map<string, number> | undefined, count: number): Map<string, number> {
  const out = new Map<string, number>();
  const used = new Set<number>();
  for (const k of keys) {
    const s = prev?.get(k);
    if (s !== undefined && s < count && !used.has(s)) {
      out.set(k, s);
      used.add(s);
    }
  }
  let next = 0;
  for (const k of keys) {
    if (out.has(k)) continue;
    while (used.has(next)) next++;
    out.set(k, next);
    used.add(next);
  }
  return out;
}

/** Desk slot -> world position of the character's seat (x right, z toward the viewer). */
export function deskPosition(slot: number, cols: number): { x: number; z: number } {
  return { x: 2.2 + (slot % cols) * PITCH_X, z: 2.0 + Math.floor(slot / cols) * PITCH_Z };
}

/** Sofa seat -> world position, in a block to the right of the desk area. */
export function seatPosition(seat: number, cols: number): { x: number; z: number } {
  const left = cols * PITCH_X + 1.5;
  return { x: left + 1 + (seat % LOUNGE_COLS) * SEAT_PITCH, z: 2.0 + Math.floor(seat / LOUNGE_COLS) * SEAT_PITCH };
}

/** How far interns stand from a seat position (see interns.ts), including their body: sideways and toward the viewer. */
export const INTERN_REACH = { x: 2.1, front: 2.8 };

/** Round up to a whole number of 2x2 floor tiles, so the checkerboard is never cut off mid-tile at an edge. */
const wholeTiles = (n: number) => 2 * Math.ceil(n / 2);

/** Floor size in world units for a layout. Everything placed by deskPosition/seatPosition, interns included, fits inside. */
export function roomSize(l: Layout): { w: number; d: number } {
  const deskW = wholeTiles(l.cols * PITCH_X + 0.6);
  const deskD = wholeTiles(2 + (l.rows - 1) * PITCH_Z + INTERN_REACH.front + 0.5);
  if (l.lounge.size === 0) return { w: deskW, d: deskD };
  const seatRows = Math.ceil(l.lounge.size / LOUNGE_COLS);
  const loungeW = LOUNGE_COLS * SEAT_PITCH + 2;
  return { w: wholeTiles(deskW + 1.5 + loungeW), d: Math.max(deskD, wholeTiles(seatRows * SEAT_PITCH + 3)) };
}

/** The rug under the lounge sofas, in world units, or null when there is no lounge. */
export function loungeRect(l: Layout, roomW: number): { x0: number; x1: number; z0: number; z1: number } | null {
  if (l.lounge.size === 0) return null;
  const left = l.cols * PITCH_X + 1.5;
  const seatRows = Math.ceil(l.lounge.size / LOUNGE_COLS);
  return {
    x0: left - 0.1,
    x1: Math.min(roomW - 0.1, left + 4.3),
    z0: 1.1,
    z1: 2.0 + (seatRows - 1) * SEAT_PITCH + 1.4,
  };
}
