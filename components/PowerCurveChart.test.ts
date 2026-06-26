import { describe, expect, it } from "vitest";
import { scalePowerCurve } from "./PowerCurveChart";

describe("scalePowerCurve", () => {
  const curve = [
    { durationSec: 5, watts: 1200 },
    { durationSec: 60, watts: 600 },
    { durationSec: 3600, watts: 280 },
  ];

  it("returns [] below two usable points", () => {
    expect(scalePowerCurve([])).toEqual([]);
    expect(scalePowerCurve([{ durationSec: 5, watts: 1200 }])).toEqual([]);
  });

  it("log-scales x across the duration span (endpoints 0 → 1, sorted)", () => {
    const s = scalePowerCurve(curve);
    expect(s[0].x).toBeCloseTo(0, 5); // shortest duration at the left
    expect(s[s.length - 1].x).toBeCloseTo(1, 5); // longest at the right
    expect(s[1].x).toBeGreaterThan(s[0].x);
    expect(s[1].x).toBeLessThan(s[2].x); // strictly ascending
  });

  it("0-bases y inverted: max watts at the top (y=0), lower watts further down", () => {
    const s = scalePowerCurve(curve);
    expect(s[0].y).toBeCloseTo(0, 5); // 1200 W = max → top
    expect(s[2].y).toBeCloseTo(1 - 280 / 1200, 5); // 280 W → near the baseline
    expect(s[2].y).toBeGreaterThan(s[0].y);
  });

  it("drops non-positive points and sorts by duration", () => {
    const s = scalePowerCurve([
      { durationSec: 3600, watts: 280 },
      { durationSec: 0, watts: 999 }, // dropped
      { durationSec: 5, watts: 1200 },
    ]);
    expect(s.map((p) => p.durationSec)).toEqual([5, 3600]);
  });
});
