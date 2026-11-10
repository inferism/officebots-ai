// The office follows the viewer's local clock: night, dawn, day and dusk, blended smoothly.
// Pure functions only (no DOM, no three.js) so they can be tested.

export type RGB = [number, number, number];
export type PhaseName = "night" | "dawn" | "day" | "dusk";

export type Palette = {
  /** 0 = full daylight .. 1 = full night. Drives neon, glow, stars, the floor grid and the dock theme. */
  night: number;
  /** Window sky, top to horizon. */
  sky: [RGB, RGB, RGB];
  /** Page background gradient, top and bottom. */
  page: [RGB, RGB];
  ambient: { color: RGB; intensity: number };
  sun: { color: RGB; intensity: number; x: number; y: number; z: number };
  wallBack: RGB;
  wallLeft: RGB;
  base: RGB;
  slab: RGB;
  /** Multiplier (0-255) on the floor textures. */
  floorTint: RGB;
  /** Roster dock and header colors. */
  ui: { panel: RGB; text: RGB; soft: RGB; line: RGB; accent: RGB };
};

const P = (o: Palette): Palette => o;

const DAY: Palette = P({
  night: 0,
  sky: [[134, 205, 246], [195, 232, 252], [232, 246, 255]],
  page: [[247, 240, 228], [234, 217, 191]],
  ambient: { color: [255, 255, 255], intensity: 1.55 },
  sun: { color: [255, 247, 230], intensity: 1.6, x: -6, y: 14, z: 9 },
  wallBack: [244, 237, 223], wallLeft: [233, 224, 207], base: [196, 178, 148], slab: [196, 160, 112],
  floorTint: [255, 255, 255],
  ui: { panel: [255, 253, 248], text: [74, 55, 40], soft: [138, 117, 96], line: [229, 216, 196], accent: [217, 119, 87] },
});

const DAWN: Palette = P({
  night: 0.3,
  sky: [[88, 110, 190], [244, 160, 170], [255, 214, 150]],
  page: [[196, 182, 220], [252, 226, 196]],
  ambient: { color: [255, 226, 226], intensity: 1.4 },
  sun: { color: [255, 190, 150], intensity: 1.55, x: -9, y: 8, z: 7 },
  wallBack: [240, 226, 224], wallLeft: [226, 212, 214], base: [190, 168, 168], slab: [190, 150, 130],
  floorTint: [255, 232, 226],
  ui: { panel: [255, 250, 248], text: [86, 62, 64], soft: [150, 122, 122], line: [236, 214, 208], accent: [242, 128, 110] },
});

const DUSK: Palette = P({
  night: 0.58,
  sky: [[58, 40, 110], [214, 96, 120], [255, 170, 90]],
  page: [[92, 60, 120], [244, 176, 130]],
  ambient: { color: [255, 196, 170], intensity: 1.15 },
  sun: { color: [255, 150, 90], intensity: 1.45, x: 9, y: 8, z: 6 },
  wallBack: [214, 186, 178], wallLeft: [186, 158, 160], base: [148, 118, 120], slab: [140, 100, 90],
  floorTint: [226, 198, 190],
  ui: { panel: [48, 34, 70], text: [255, 236, 224], soft: [206, 176, 176], line: [120, 80, 110], accent: [255, 150, 90] },
});

const NIGHT: Palette = P({
  night: 1,
  sky: [[21, 11, 61], [90, 42, 140], [255, 95, 158]],
  page: [[10, 7, 20], [23, 16, 52]],
  ambient: { color: [160, 140, 255], intensity: 0.95 },
  sun: { color: [255, 130, 200], intensity: 1.0, x: 5, y: 10, z: 10 },
  wallBack: [74, 62, 130], wallLeft: [58, 48, 104], base: [92, 70, 160], slab: [30, 24, 56],
  floorTint: [120, 108, 190],
  ui: { panel: [20, 16, 46], text: [233, 230, 255], soft: [140, 136, 190], line: [96, 66, 170], accent: [55, 230, 255] },
});

export const PALETTES: Record<PhaseName, Palette> = { night: NIGHT, dawn: DAWN, day: DAY, dusk: DUSK };

/** Local hour at which each look is at its fullest. Between two of these, the looks blend. */
const KEYFRAMES: { h: number; p: PhaseName }[] = [
  { h: 0, p: "night" },
  { h: 4.75, p: "night" },
  { h: 6.25, p: "dawn" },
  { h: 8, p: "day" },
  { h: 17, p: "day" },
  { h: 18.75, p: "dusk" },
  { h: 20.25, p: "night" },
  { h: 24, p: "night" },
];

const smooth = (t: number) => t * t * (3 - 2 * t);
// exact at the endpoints, so a keyframe time gives the keyframe look with no rounding noise
const lerp = (a: number, b: number, t: number) => (t <= 0 ? a : t >= 1 ? b : a + (b - a) * t);

function lerpAny<T>(a: T, b: T, t: number): T {
  if (typeof a === "number") return lerp(a, b as number, t) as T;
  if (Array.isArray(a)) return a.map((v, i) => lerpAny(v, (b as unknown[])[i], t)) as T;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(a as object)) out[k] = lerpAny((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], t);
  return out as T;
}

/** Minutes since local midnight for a Date, in the viewer's own time zone. */
export const minutesOf = (d: Date): number => d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;

export type TimeInfo = { palette: Palette; phase: PhaseName; label: string; hours: number };

/** The palette for a time of day, given as minutes since midnight (wraps around 24 h). */
export function atMinutes(minutes: number): TimeInfo {
  const h = ((minutes / 60) % 24 + 24) % 24;
  let i = KEYFRAMES.findIndex((k, idx) => idx < KEYFRAMES.length - 1 && h >= k.h && h <= KEYFRAMES[idx + 1]!.h);
  if (i < 0) i = 0;
  const a = KEYFRAMES[i]!;
  const b = KEYFRAMES[i + 1]!;
  const t = b.h === a.h ? 0 : smooth((h - a.h) / (b.h - a.h));
  const palette = lerpAny(PALETTES[a.p], PALETTES[b.p], t);
  const phase = t < 0.5 ? a.p : b.p;
  return { palette, phase, label: phase[0]!.toUpperCase() + phase.slice(1), hours: h };
}

/** Where the sun (0 = sunrise, 1 = sunset) and the moon are in the window, for the sky drawing. Null when below the horizon. */
export function sunMoon(hours: number): { sun: number | null; moon: number | null } {
  const sun = hours >= 6 && hours <= 18.5 ? (hours - 6) / 12.5 : null;
  const m = hours >= 18 ? hours - 18 : hours + 6; // moon: 18:00 .. 06:00
  const moon = m >= 0 && m <= 12 ? m / 12 : null;
  return { sun, moon };
}

const CANON: Record<PhaseName, number> = { night: 23 * 60, dawn: 6.25 * 60, day: 12 * 60, dusk: 18.75 * 60 };

/**
 * Preview controls from the page's query string, for trying the looks without waiting for them:
 *   ?time=18:45          fix the clock
 *   ?phase=dusk          fix the clock at the middle of that look
 *   ?speed=600           make the clock run 600x faster (starting from ?time or now)
 * Returns null when the page should simply follow the real clock.
 */
export function parseClockOverride(search: string): { startMinutes: number | null; speed: number; fixed: boolean } | null {
  const q = new URLSearchParams(search);
  const time = q.get("time");
  const phase = q.get("phase");
  const speed = Number(q.get("speed") ?? "");
  let start: number | null = null;
  if (time && /^\d{1,2}:\d{2}$/.test(time)) {
    const [hh, mm] = time.split(":").map(Number) as [number, number];
    if (hh <= 23 && mm <= 59) start = hh * 60 + mm;
  } else if (phase && phase in CANON) start = CANON[phase as PhaseName];
  const sp = Number.isFinite(speed) && speed > 0 && speed <= 20000 ? speed : 0;
  if (start === null && sp === 0) return null;
  return { startMinutes: start, speed: sp, fixed: sp === 0 };
}

export const rgbCss = (c: RGB, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
export const rgbHex = (c: RGB) => (Math.round(c[0]) << 16) | (Math.round(c[1]) << 8) | Math.round(c[2]);
