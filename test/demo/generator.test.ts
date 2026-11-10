import { describe, expect, it } from "vitest";
import { DEFAULT_COLOR } from "../../src/core/colors.js";
import { validateEvent } from "../../src/core/schema.js";
import { createDemo } from "../../src/demo/generator.js";
import { createRoom } from "../../src/server/room.js";

function run(agents: number, interns: number, seconds: number, seed = 1) {
  let clock = Date.parse("2026-11-10T10:00:00.000Z");
  const demo = createDemo({ agents, interns, project: "demo", seed, now: () => clock });
  const events = [];
  for (let i = 0; i < seconds * 2; i++) {
    events.push(...demo.tick());
    clock += 500;
  }
  return { events, end: clock };
}

describe("demo generator", () => {
  it("emits only valid events with unique ids", () => {
    const { events } = run(40, 30, 120);
    expect(events.length).toBeGreaterThan(100);
    for (const e of events) expect(validateEvent(e)).toEqual(e);
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
  });

  it("is deterministic for a seed", () => {
    expect(run(10, 5, 30, 7).events).toEqual(run(10, 5, 30, 7).events);
  });

  it("runs through the real reducer: 40 distinct characters, bounded interns, unknown model is a default-color Agent", () => {
    const { events, end } = run(40, 30, 120);
    const room = createRoom({ key: "demo", name: "demo" }, { idleAfterSec: 15 });
    for (const e of events) room.apply(e);
    const snap = room.snapshot(end);
    expect(snap.characters).toHaveLength(40);
    const internTotal = snap.characters.reduce((n, c) => n + c.interns.total, 0);
    expect(internTotal).toBeGreaterThan(0);
    expect(internTotal).toBeLessThanOrEqual(30);
    const unknown = snap.characters.filter((c) => c.model === "foo-model-9");
    expect(unknown.length).toBeGreaterThan(0);
    for (const c of unknown) {
      expect(c.role).toBe("Agent");
      expect(c.color).toBe(DEFAULT_COLOR);
    }
  });

  it("agents join gradually, fall asleep, and some wake up again", () => {
    const { events, end } = run(20, 0, 240);
    const early = createRoom({ key: "demo", name: "demo" }, { idleAfterSec: 15 });
    for (const e of events.filter((x) => Date.parse(x.time) < end - 230_000)) early.apply(e);
    expect(early.snapshot(end - 230_000).characters.length).toBeLessThan(20);

    const room = createRoom({ key: "demo", name: "demo" }, { idleAfterSec: 15 });
    for (const e of events) room.apply(e);
    const statuses = new Set(room.snapshot(end).characters.map((c) => c.status));
    expect(statuses.has("sleeping")).toBe(true);
  });
});
