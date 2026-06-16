import { describe, expect, it } from "vitest";
import { computeAcwr, computeIntensityDistribution, computeLoadRamp } from "./readiness";

// Build a date `n` days ago in YYYY-MM-DD (local), matching computeLoadRamp's basis.
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

describe("computeLoadRamp", () => {
  it("does not fire when the prior week is below the noise floor", () => {
    const activities = [
      { date: daysAgo(1), trainingLoad: 200 }, // this week
      { date: daysAgo(9), trainingLoad: 50 }, // last week, under floor
    ];
    const r = computeLoadRamp(activities);
    expect(r.triggered).toBe(false);
    expect(r.changePct).toBeNull();
  });

  it("does not fire when load is flat week-over-week", () => {
    const activities = [
      { date: daysAgo(1), trainingLoad: 200 },
      { date: daysAgo(3), trainingLoad: 100 }, // this week total 300
      { date: daysAgo(8), trainingLoad: 200 },
      { date: daysAgo(10), trainingLoad: 100 }, // last week total 300
    ];
    const r = computeLoadRamp(activities);
    expect(r.triggered).toBe(false);
    expect(r.changePct).toBe(0);
  });

  it("raises a caution between 10% and 30%", () => {
    const activities = [
      { date: daysAgo(1), trainingLoad: 250 }, // this week 250
      { date: daysAgo(9), trainingLoad: 200 }, // last week 200 → +25%
    ];
    const r = computeLoadRamp(activities);
    expect(r.triggered).toBe(true);
    expect(r.level).toBe("caution");
    expect(r.changePct).toBe(25);
  });

  it("raises a high alert above 30%", () => {
    const activities = [
      { date: daysAgo(2), trainingLoad: 400 }, // this week 400
      { date: daysAgo(9), trainingLoad: 200 }, // last week 200 → +100%
    ];
    const r = computeLoadRamp(activities);
    expect(r.triggered).toBe(true);
    expect(r.level).toBe("high");
    expect(r.changePct).toBe(100);
  });

  it("ignores activities with null training load", () => {
    const activities = [
      { date: daysAgo(1), trainingLoad: null },
      { date: daysAgo(9), trainingLoad: 200 },
    ];
    const r = computeLoadRamp(activities);
    expect(r.thisWeekTss).toBe(0);
    expect(r.lastWeekTss).toBe(200);
  });
});

describe("computeAcwr", () => {
  it("returns null without enough chronic base", () => {
    expect(computeAcwr([{ date: daysAgo(1), trainingLoad: 100 }])).toBeNull();
  });

  it("flags a load spike as danger", () => {
    // Steady ~60/day for 4 weeks, then a big recent block.
    const activities: Array<{ date: string; trainingLoad: number }> = [];
    for (let d = 27; d >= 7; d--) activities.push({ date: daysAgo(d), trainingLoad: 60 });
    for (let d = 6; d >= 0; d--) activities.push({ date: daysAgo(d), trainingLoad: 180 });
    const r = computeAcwr(activities)!;
    expect(r.ratio).toBeGreaterThan(1.5);
    expect(r.level).toBe("danger");
  });

  it("reads a steady block as optimal", () => {
    const activities = Array.from({ length: 28 }, (_, i) => ({ date: daysAgo(i), trainingLoad: 60 }));
    const r = computeAcwr(activities)!;
    expect(r.level).toBe("optimal");
  });
});

describe("computeIntensityDistribution", () => {
  it("splits training time by intensity band", () => {
    const activities = [
      { date: daysAgo(1), movingTimeSec: 8000, avgWatts: 150 }, // easy (<0.75 of 288)
      { date: daysAgo(2), movingTimeSec: 2000, avgWatts: 280 }, // hard (>0.90)
    ];
    const d = computeIntensityDistribution(activities, 288)!;
    expect(d.easyPct).toBe(80);
    expect(d.hardPct).toBe(20);
  });

  it("uses true time-in-zone so a threshold ride doesn't read as all-easy", () => {
    // Average power is sub-threshold (200/288 ≈ 0.69 → the old avg-power logic would log this
    // 100% easy), but the session has real Z4 work. Zone seconds: [Z1..Z7].
    const activities = [
      { date: daysAgo(1), movingTimeSec: 3600, avgWatts: 200, powerZoneTimes: [600, 2000, 100, 800, 60, 40, 0] },
    ];
    const d = computeIntensityDistribution(activities, 288)!;
    expect(d.easyPct).toBe(72); // Z1+Z2 = 2600/3600
    expect(d.moderatePct).toBe(3); // Z3 = 100/3600
    expect(d.hardPct).toBe(25); // Z4..Z7 = 900/3600
  });

  it("falls back to average power when a ride has no per-zone data", () => {
    const d = computeIntensityDistribution(
      [{ date: daysAgo(1), movingTimeSec: 3600, avgWatts: 280, powerZoneTimes: null }],
      288
    )!;
    expect(d.hardPct).toBe(100); // 280/288 > 0.90
  });

  it("returns null when FTP is unknown", () => {
    expect(computeIntensityDistribution([{ date: daysAgo(1), movingTimeSec: 100, avgWatts: 150 }], 0)).toBeNull();
  });
});
