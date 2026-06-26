import { describe, expect, it } from "vitest";
import { aerobicEffPct, qualifyingPwHr, z2PwHrBaselineBefore, type PwHrRide } from "./aerobic";

const r = (date: string, powerHrZ2: number | null, powerHrZ2Mins = 30): PwHrRide => ({ date, powerHrZ2, powerHrZ2Mins });

describe("qualifyingPwHr", () => {
  it("returns the value only above the Z2-minutes floor", () => {
    expect(qualifyingPwHr(r("2026-06-01", 1.5, 30))).toBe(1.5);
    expect(qualifyingPwHr(r("2026-06-01", 1.5, 8))).toBeNull(); // too little Z2
    expect(qualifyingPwHr(r("2026-06-01", null, 60))).toBeNull(); // no reading
  });
});

describe("z2PwHrBaselineBefore", () => {
  const rides = [
    r("2026-06-01", 1.5),
    r("2026-06-10", 1.6),
    r("2026-06-15", 1.4),
    r("2026-06-20", 9.9), // the ride being scored — must be excluded (strictly-before)
  ];

  it("means qualifying rides strictly before the date, excluding the ride itself", () => {
    expect(z2PwHrBaselineBefore(rides, "2026-06-20")).toBeCloseTo(1.5, 5); // mean(1.5,1.6,1.4), not 9.9
  });

  it("returns null below the min-sample floor", () => {
    expect(z2PwHrBaselineBefore([r("2026-06-01", 1.5), r("2026-06-10", 1.6)], "2026-06-20")).toBeNull();
  });

  it("ignores thin-Z2 rides and anything outside the 90-day window", () => {
    const withNoise = [...rides, r("2026-06-18", 1.9, 5), r("2026-01-01", 2.0)]; // <15min + >90d back
    expect(z2PwHrBaselineBefore(withNoise, "2026-06-20")).toBeCloseTo(1.5, 5);
  });
});

describe("aerobicEffPct", () => {
  it("is the signed %Δ vs baseline (positive = above baseline = better)", () => {
    expect(aerobicEffPct(r("2026-06-20", 1.575), 1.5)).toBeCloseTo(5, 5);
    expect(aerobicEffPct(r("2026-06-20", 1.425), 1.5)).toBeCloseTo(-5, 5);
  });

  it("is null when the ride doesn't qualify or there's no baseline", () => {
    expect(aerobicEffPct(r("2026-06-20", 1.5, 8), 1.5)).toBeNull(); // thin Z2
    expect(aerobicEffPct(r("2026-06-20", 1.5), null)).toBeNull(); // no baseline
  });
});
