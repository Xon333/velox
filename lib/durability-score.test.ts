import { describe, expect, it } from "vitest";
import { gradeDurabilityDelivery } from "./durability-score";
import type { ExecutedInterval } from "./types";

const FTP = 280;
const TOTAL = 9000; // 2.5 h ride
const iv = (over: Partial<ExecutedInterval>): ExecutedInterval => ({
  type: "WORK", durationSec: 0, avgWatts: null, npWatts: null, avgHr: null, startIndex: null, endIndex: null, ...over,
});

describe("gradeDurabilityDelivery", () => {
  it("returns null for template A / unknown / missing data (nothing to detect)", () => {
    expect(gradeDurabilityDelivery("A", [iv({ avgWatts: 180, durationSec: 600 })], FTP, TOTAL)).toBeNull();
    expect(gradeDurabilityDelivery("B", [], FTP, TOTAL)).toBeNull(); // no intervals
    expect(gradeDurabilityDelivery("B", [iv({ avgWatts: 266, durationSec: 600 })], 0, TOTAL)).toBeNull(); // no ftp
  });

  it("B: rewards a late threshold effort, penalises its absence, neutral when mis-placed", () => {
    const lateThreshold = iv({ avgWatts: 266, durationSec: 600, startIndex: 7200 }); // 95% FTP, 10 min, frac 0.8
    expect(gradeDurabilityDelivery("B", [lateThreshold], FTP, TOTAL)?.signal).toBe(2);

    const onlyZ2 = iv({ avgWatts: 180, durationSec: 600, startIndex: 7200 }); // not in the threshold band
    const absent = gradeDurabilityDelivery("B", [onlyZ2], FTP, TOTAL)!;
    expect(absent.signal).toBe(-2);
    expect(absent.delivered).toBe(false);

    const earlyThreshold = iv({ avgWatts: 266, durationSec: 600, startIndex: 600 }); // right effort, frac 0.067 (early)
    expect(gradeDurabilityDelivery("B", [earlyThreshold], FTP, TOTAL)?.signal).toBe(0);
  });

  it("E: rewards surges spread across the ride, neutral when all back-loaded", () => {
    const surge = (startIndex: number) => iv({ avgWatts: 280, durationSec: 60, startIndex }); // ~100% FTP, 1 min
    const spread = gradeDurabilityDelivery("E", [surge(900), surge(4500), surge(8100)], FTP, TOTAL)!; // fracs .1/.5/.9
    expect(spread.signal).toBe(2);

    const clustered = gradeDurabilityDelivery("E", [surge(7800), surge(8100), surge(8400)], FTP, TOTAL)!; // all late, no spread
    expect(clustered.signal).toBe(0);
  });
});
