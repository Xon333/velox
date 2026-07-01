import { describe, expect, it } from "vitest";
import { SEASON_CONSTANTS, defaultBuildOrder, addWeeks, needsBaseGate, nextBuildFocus, draftSeasonArc, applyDeloadCadence, assignLoadTargets, type SeasonDraftInput } from "./season";

describe("season constants + helpers", () => {
  it("encodes the KB deload cadence (3:1 default, 2:1 tight)", () => {
    expect(SEASON_CONSTANTS.deloadEveryWeeks).toBe(4);
    expect(SEASON_CONSTANTS.deloadTightEveryWeeks).toBe(3);
  });
  it("rotates threshold → vo2max → durability by default (KB variety)", () => {
    expect(defaultBuildOrder()).toEqual(["threshold", "vo2max", "durability"]);
  });
  it("adds whole weeks UTC-safe", () => {
    expect(addWeeks("2026-07-01", 3)).toBe("2026-07-22");
  });
});

const baseInput = (over: Partial<SeasonDraftInput> = {}): SeasonDraftInput => ({
  objective: "get faster", events: [], ctl: 60, ftp: 280, recentWeeklyTss: 420,
  limiter: { system: null, confidence: "low" }, recentFocuses: ["aerobic-base", "threshold"], heavyFatigue: false, ...over,
});

describe("draftSeasonArc — Mode-C", () => {
  it("base-gates when no aerobic-base sits in the recent window", () => {
    expect(needsBaseGate([])).toBe(true); // first-ever draft leads with base
    expect(needsBaseGate(["threshold", "vo2max", "durability", "threshold"])).toBe(true);
    expect(needsBaseGate(["aerobic-base", "threshold"])).toBe(false);
  });

  it("picks the weakest system first when the limiter is confident, else default rotation", () => {
    expect(nextBuildFocus({ system: "vo2max", confidence: "high" }, ["threshold"])).toBe("vo2max");
    // low-confidence limiter → default order, skipping a back-to-back repeat
    expect(nextBuildFocus({ system: null, confidence: "low" }, ["threshold"])).toBe("vo2max");
  });

  it("never repeats a focus back-to-back", () => {
    expect(nextBuildFocus({ system: "threshold", confidence: "high" }, ["threshold"])).not.toBe("threshold");
  });

  it("drafts base(if gated) → rotating build periods → a realize week, dated contiguously", () => {
    const arc = draftSeasonArc(baseInput({ recentFocuses: [] }), "2026-07-01");
    expect(arc[0].focus).toBe("aerobic-base");
    expect(arc[0].startDate).toBe("2026-07-01");
    expect(arc[1].startDate).toBe(addWeeksExpected(arc[0])); // contiguous
    expect(arc.some((p) => p.focus === "sharpen")).toBe(true); // realize week present
    expect(arc.every((p) => p.source === "derived")).toBe(true);
  });
});

function addWeeksExpected(p: { startDate: string; plannedWeeks: number }): string {
  return new Date(Date.parse(p.startDate) + p.plannedWeeks * 7 * 86_400_000).toISOString().slice(0, 10);
}

describe("load envelope", () => {
  const p = (): import("./types").FocusPeriod => ({
    focus: "threshold", phase: "build", startDate: "2026-07-01", plannedWeeks: 3,
    intensitySplit: "80/20", targetWeeklyTss: null, deloadWeek: false, rationale: "", source: "derived", confidence: "medium",
  });
  it("ramps ~+6% off the seed, capped by ACWR", () => {
    const out = assignLoadTargets([p(), p(), p()], 400, 1.3);
    expect(out[0].targetWeeklyTss).toBe(424); // 400 * 1.06
    expect(out[1].targetWeeklyTss!).toBeGreaterThan(out[0].targetWeeklyTss!);
    // never a jump beyond the ACWR ceiling vs the seed-derived chronic
    expect(out[2].targetWeeklyTss! / 400).toBeLessThanOrEqual(1.3 + 0.001);
  });
  it("withholds targets when there is no seed (no FTP/CTL)", () => {
    expect(assignLoadTargets([p()], null, 1.3)[0].targetWeeklyTss).toBeNull();
  });
});

describe("deload cadence", () => {
  const p = (weeks: number): import("./types").FocusPeriod => ({
    focus: "threshold", phase: "build", startDate: "2026-07-01", plannedWeeks: weeks,
    intensitySplit: "80/20", targetWeeklyTss: null, deloadWeek: false, rationale: "", source: "derived", confidence: "medium",
  });
  it("flags a deload after ~3 loading weeks (3:1 default)", () => {
    const out = applyDeloadCadence([p(2), p(2), p(2)], false); // cumulative 2,4,6 wk
    expect(out[0].deloadWeek).toBe(false); // 2 wk in
    expect(out[1].deloadWeek).toBe(true); // crosses the 4-week (3:1) boundary
    expect(out[2].deloadWeek).toBe(false); // counter reset after the deload — next period is only 2 wk in
  });
  it("tightens to 2:1 under heavy fatigue", () => {
    const out = applyDeloadCadence([p(2), p(2)], true); // boundary at 3 wk
    expect(out[0].deloadWeek).toBe(true);
    expect(out[1].deloadWeek).toBe(true); // after reset, the next 2-wk period hits the 2:1 boundary again
  });
});
