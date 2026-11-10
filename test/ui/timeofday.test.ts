import { describe, expect, it } from "vitest";
import { atMinutes, minutesOf, parseClockOverride, PALETTES, sunMoon } from "../../ui/src/scene/timeofday.js";

const at = (h: number, m = 0) => atMinutes(h * 60 + m);

describe("time of day", () => {
  it("names the four looks around the clock", () => {
    expect(at(0).phase).toBe("night");
    expect(at(3).phase).toBe("night");
    expect(at(6, 15).phase).toBe("dawn");
    expect(at(12).phase).toBe("day");
    expect(at(16).phase).toBe("day");
    expect(at(18, 45).phase).toBe("dusk");
    expect(at(22).phase).toBe("night");
    expect(at(23, 59).phase).toBe("night");
  });

  it("is exactly the approved day and night look at their fullest", () => {
    expect(at(12).palette).toEqual(PALETTES.day);
    expect(at(1).palette).toEqual(PALETTES.night);
    expect(at(6, 15).palette).toEqual(PALETTES.dawn);
    expect(at(18, 45).palette).toEqual(PALETTES.dusk);
  });

  it("night level rises through dusk, falls through dawn, and stays put at midday and midnight", () => {
    expect(at(12).palette.night).toBe(0);
    expect(at(2).palette.night).toBe(1);
    const dusk = [17, 17.5, 18, 18.75, 19.5, 20.25].map((h) => atMinutes(h * 60).palette.night);
    expect([...dusk].sort((a, b) => a - b)).toEqual(dusk);
    const dawn = [4.75, 5.5, 6.25, 7, 8].map((h) => atMinutes(h * 60).palette.night);
    expect([...dawn].sort((a, b) => b - a)).toEqual(dawn);
  });

  it("never jumps: neighbouring minutes of the whole day look almost the same", () => {
    let worst = 0;
    for (let m = 0; m < 24 * 60; m++) {
      const a = atMinutes(m).palette;
      const b = atMinutes(m + 1).palette;
      worst = Math.max(worst, Math.abs(a.night - b.night), Math.abs(a.sky[0][0] - b.sky[0][0]) / 255, Math.abs(a.ambient.intensity - b.ambient.intensity));
    }
    expect(worst).toBeLessThan(0.05);
  });

  it("wraps around midnight and accepts out-of-range minutes", () => {
    expect(atMinutes(-60).phase).toBe("night");
    expect(atMinutes(24 * 60 + 12 * 60).phase).toBe("day");
    expect(atMinutes(24 * 60).palette).toEqual(atMinutes(0).palette);
  });

  it("uses the viewer's local clock", () => {
    expect(minutesOf(new Date(2026, 10, 10, 14, 30, 30))).toBeCloseTo(14 * 60 + 30.5, 5);
  });

  it("puts the sun up by day and the moon up by night", () => {
    expect(sunMoon(12).sun).toBeCloseTo(0.48, 1);
    expect(sunMoon(12).moon).toBeNull();
    expect(sunMoon(2).sun).toBeNull();
    expect(sunMoon(2).moon).toBeCloseTo(8 / 12, 5);
    expect(sunMoon(6.5).sun).toBeGreaterThan(0);
    expect(sunMoon(23).moon).toBeCloseTo(5 / 12, 5);
  });
});

describe("clock override for previewing", () => {
  it("follows the real clock by default", () => {
    expect(parseClockOverride("")).toBeNull();
    expect(parseClockOverride("?debug")).toBeNull();
  });

  it("fixes the time with ?time= or ?phase=", () => {
    expect(parseClockOverride("?time=18:45")).toEqual({ startMinutes: 18 * 60 + 45, speed: 0, fixed: true });
    expect(parseClockOverride("?time=5:05")).toEqual({ startMinutes: 5 * 60 + 5, speed: 0, fixed: true });
    expect(parseClockOverride("?phase=dusk")?.startMinutes).toBe(18.75 * 60);
    expect(parseClockOverride("?phase=day")?.fixed).toBe(true);
  });

  it("runs the clock fast with ?speed=, from now or from a start time", () => {
    expect(parseClockOverride("?speed=600")).toEqual({ startMinutes: null, speed: 600, fixed: false });
    expect(parseClockOverride("?time=05:00&speed=300")).toEqual({ startMinutes: 300, speed: 300, fixed: false });
  });

  it("ignores nonsense", () => {
    for (const bad of ["?time=25:00", "?time=12:60", "?time=noon", "?phase=lunch", "?speed=-5", "?speed=abc", "?speed=99999"]) {
      expect(parseClockOverride(bad)).toBeNull();
    }
  });
});
