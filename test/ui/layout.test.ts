import { describe, expect, it } from "vitest";
import { computeLayout, deskPosition, INTERN_REACH, type LayoutChar, roomSize, seatPosition } from "../../ui/src/scene/layout.js";

const T = Date.parse("2026-11-10T10:00:00.000Z");
const ch = (key: string, status: LayoutChar["status"], agoSec = 0): LayoutChar => ({
  key,
  status,
  lastActive: new Date(T - agoSec * 1000).toISOString(),
});
const OPTS = { maxDesks: 12, loungeCap: 8 };

describe("computeLayout", () => {
  it("seats everyone at desks on a ceil(sqrt(n)) grid when under maxDesks", () => {
    const l = computeLayout(Array.from({ length: 5 }, (_, i) => ch(`c${i}`, "working")), undefined, OPTS);
    expect(l.deskCount).toBe(5);
    expect(l.cols).toBe(3);
    expect(l.rows).toBe(2);
    expect(l.lounge.size).toBe(0);
    expect(new Set(l.desks.values()).size).toBe(5);
  });

  it("with 40 agents: awake keep desks, most recent sleepers fill the rest, then lounge, then away", () => {
    const chars = [
      ...Array.from({ length: 10 }, (_, i) => ch(`awake${i}`, "working")),
      ...Array.from({ length: 30 }, (_, i) => ch(`sleep${i}`, "sleeping", 100 + i * 10)), // sleep0 most recent
    ];
    const l = computeLayout(chars, undefined, OPTS);
    expect(l.desks.size).toBe(12);
    expect([...l.desks.keys()].filter((k) => k.startsWith("awake"))).toHaveLength(10);
    expect(l.desks.has("sleep0") && l.desks.has("sleep1")).toBe(true);
    expect([...l.lounge.keys()].sort()).toEqual(["sleep2", "sleep3", "sleep4", "sleep5", "sleep6", "sleep7", "sleep8", "sleep9"]);
    expect(l.away).toHaveLength(20);
    expect(l.away).toContain("sleep29"); // longest asleep fades out first
    expect(l.away).toContain("sleep10"); // first to go away: just past the lounge
    expect(l.away).not.toContain("sleep9");
  });

  it("a sleeper that wakes gets a desk again and the lounge makes room", () => {
    const sleepers = Array.from({ length: 14 }, (_, i) => ch(`s${i}`, "sleeping", 100 + i * 10));
    const before = computeLayout(sleepers, undefined, OPTS);
    expect(before.lounge.has("s13")).toBe(true);
    const woke = sleepers.map((c) => (c.key === "s13" ? ch("s13", "working") : c));
    const after = computeLayout(woke, before, OPTS);
    expect(after.desks.has("s13")).toBe(true);
    expect(after.lounge.has("s13")).toBe(false);
  });

  it("seats every awake agent even beyond maxDesks", () => {
    const l = computeLayout(Array.from({ length: 30 }, (_, i) => ch(`a${i}`, i % 2 ? "working" : "waiting")), undefined, OPTS);
    expect(l.desks.size).toBe(30);
    expect(l.cols).toBe(6);
  });

  it("keeps existing desk slots when someone joins", () => {
    const base = ["a", "b", "c"].map((k) => ch(k, "working"));
    const first = computeLayout(base, undefined, OPTS);
    const second = computeLayout([...base, ch("d", "working")], first, OPTS);
    for (const k of ["a", "b", "c"]) expect(second.desks.get(k)).toBe(first.desks.get(k));
    expect(new Set(second.desks.values()).size).toBe(4);
  });

  it("room gets wider when a lounge exists", () => {
    const noLounge = roomSize(computeLayout([ch("a", "working")], undefined, OPTS));
    const chars = [...Array.from({ length: 12 }, (_, i) => ch(`a${i}`, "working")), ch("z", "sleeping")];
    const withLounge = roomSize(computeLayout(chars, undefined, OPTS));
    expect(withLounge.w).toBeGreaterThan(noLounge.w);
  });

  it("the floor always has room for every desk, its interns and every sofa, in whole tiles", () => {
    for (let n = 0; n <= 45; n++) {
      for (const sleepers of [0, Math.floor(n / 2), n]) {
        const chars = Array.from({ length: n }, (_, i) => ch(`c${i}`, i < sleepers ? "sleeping" : "working", i * 10));
        const l = computeLayout(chars, undefined, OPTS);
        const { w, d } = roomSize(l);
        expect(w % 2).toBe(0);
        expect(d % 2).toBe(0);
        for (const slot of l.desks.values()) {
          const p = deskPosition(slot, l.cols);
          expect(p.x - INTERN_REACH.x).toBeGreaterThanOrEqual(0);
          expect(p.x + INTERN_REACH.x).toBeLessThanOrEqual(w);
          expect(p.z + INTERN_REACH.front).toBeLessThanOrEqual(d);
        }
        for (const seat of l.lounge.values()) {
          const p = seatPosition(seat, l.cols);
          expect(p.x + 1).toBeLessThanOrEqual(w);
          expect(p.z + 1).toBeLessThanOrEqual(d);
        }
      }
    }
  });

  it("handles an empty office", () => {
    const l = computeLayout([], undefined, OPTS);
    expect(l.deskCount).toBe(0);
    expect(l.cols).toBe(1);
    expect(roomSize(l).w).toBeGreaterThan(0);
  });
});
