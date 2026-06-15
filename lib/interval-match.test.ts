import { describe, expect, it } from "vitest";
import { matchPrescription } from "./interval-match";
import type { ExecutedInterval, PrescribedInterval } from "./types";

const presc = (reps: number, targetWatts: number): PrescribedInterval => ({
  reps,
  durationSec: 1200,
  targetPctFtp: 100,
  targetWatts,
  label: `${reps}×20m @ ${targetWatts}W`,
});
const ex = (type: string, np: number, durationSec = 1200): ExecutedInterval => ({
  type,
  durationSec,
  avgWatts: np - 3,
  npWatts: np,
  avgHr: 165,
  startIndex: null,
  endIndex: null,
});

describe("matchPrescription", () => {
  it("matches WORK efforts rep-by-rep and rolls up adherence", () => {
    const c = matchPrescription([presc(2, 288)], [ex("WORK", 287), ex("WORK", 291)]);
    expect(c).not.toBeNull();
    expect(c!.completed).toBe(2);
    expect(c!.total).toBe(2);
    expect(c!.reps.map((r) => r.adherencePct)).toEqual([100, 101]);
    expect(c!.avgAdherencePct).toBe(101);
  });

  it("ignores warmup/recovery when intervals are untyped (power-band fallback)", () => {
    const executed = [ex("", 150), ex("", 286), ex("", 120), ex("", 290)];
    const c = matchPrescription([presc(2, 288)], executed);
    expect(c!.reps.map((r) => r.actualWatts)).toEqual([286, 290]);
  });

  it("reports partial completion when fewer efforts executed", () => {
    const c = matchPrescription([presc(3, 300)], [ex("WORK", 298)]);
    expect(c!.completed).toBe(1);
    expect(c!.total).toBe(3);
  });

  it("returns null with no prescription", () => {
    expect(matchPrescription([], [ex("WORK", 290)])).toBeNull();
  });
});
