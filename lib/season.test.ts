import { describe, expect, it } from "vitest";
import { SEASON_CONSTANTS, defaultBuildOrder, addWeeks, needsBaseGate, nextBuildFocus, draftSeasonArc, applyDeloadCadence, assignLoadTargets, backwardScheduleFromEvent, replanSeasonArc, type SeasonDraftInput } from "./season";
import type { SeasonPlan } from "./types";

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
  it("does not advance the ramp base past a deload — resumes the ramp from the pre-deload target", () => {
    const periods = [
      { ...p(), deloadWeek: false },
      { ...p(), deloadWeek: false },
      { ...p(), deloadWeek: true }, // deload — must not become the new ramp base
      { ...p(), deloadWeek: false },
      { ...p(), deloadWeek: false },
    ];
    const out = assignLoadTargets(periods, 400, 1.3);
    expect(out[0].targetWeeklyTss).toBe(424); // 400 * 1.06
    expect(out[1].targetWeeklyTss).toBe(449); // 424 * 1.06, rounded
    expect(out[2].targetWeeklyTss).toBe(269); // deload: 449 * 0.6, rounded — prev stays 449
    expect(out[3].targetWeeklyTss).toBe(476); // resumes from 449 (pre-deload), NOT 269: 449 * 1.06, rounded
    expect(out[4].targetWeeklyTss).toBe(505); // 476 * 1.06, rounded
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

describe("event-anchored mode (dormant until an A-event exists)", () => {
  it("back-fills taper → peak ending on the A-date, build/base before", () => {
    const ev = { name: "Gran Fondo", date: "2026-10-01", priority: "A" as const };
    const arc = backwardScheduleFromEvent(ev, baseInput(), "2026-07-01");
    const last = arc[arc.length - 1];
    expect(last.phase).toBe("taper");
    // taper ends on (or just before) the event date
    expect(new Date(addWeeksExpected(last)).getTime()).toBeGreaterThanOrEqual(Date.parse("2026-09-29"));
    expect(arc.some((p) => p.phase === "peak")).toBe(true);
    expect(arc[0].startDate).toBe("2026-07-01");
  });
  it("clamps to a taper-only when the runway is too short", () => {
    const ev = { name: "KOM", date: "2026-07-10", priority: "A" as const };
    const arc = backwardScheduleFromEvent(ev, baseInput(), "2026-07-01");
    expect(arc.every((p) => p.phase === "taper" || p.phase === "peak")).toBe(true);
  });
  it("draftSeasonArc routes to the event scheduler only for a future A-event", () => {
    const arc = draftSeasonArc(baseInput({ events: [{ name: "X", date: "2026-10-01", priority: "A" }] }), "2026-07-01");
    expect(arc.some((p) => p.phase === "taper")).toBe(true);
  });
  it("never applies deload cadence to the event-anchored tail — peak/taper are exempt", () => {
    // 13-week runway: build 3wk → build 4wk → peak 5wk → taper 1wk — this is the exact shape that
    // previously crossed the 3:1 deload boundary on the peak block (Task 5 review finding).
    const ev = { name: "Gran Fondo", date: "2026-10-01", priority: "A" as const };
    const direct = backwardScheduleFromEvent(ev, baseInput(), "2026-07-01");
    expect(direct.some((p) => p.deloadWeek)).toBe(false);
    expect(direct.every((p) => p.deloadWeek === false)).toBe(true);
    // Also verify via draftSeasonArc's routing into event mode with the same runway.
    const routed = draftSeasonArc(baseInput({ events: [{ name: "Gran Fondo", date: "2026-10-01", priority: "A" }] }), "2026-07-01");
    expect(routed.some((p) => p.deloadWeek)).toBe(false);
  });
});

const planWith = (periods: SeasonPlan["periods"]): SeasonPlan => ({ objective: "get faster", events: [], periods, updatedAt: "" });

describe("replanSeasonArc", () => {
  const achieved = () => 400;
  it("freezes elapsed periods with achievedTss and never re-drafts them", () => {
    const past = { focus: "aerobic-base" as const, phase: "base" as const, startDate: "2026-06-01", plannedWeeks: 3, intensitySplit: "90/10", targetWeeklyTss: 380, deloadWeek: false, rationale: "", source: "derived" as const, confidence: "medium" as const };
    const out = replanSeasonArc(planWith([past]), baseInput(), achieved, "2026-07-01");
    const frozen = out.periods.find((p) => p.startDate === "2026-06-01")!;
    expect(frozen.achievedTss).toBe(400);
  });
  it("preserves a future override period", () => {
    const ovr = { focus: "durability" as const, phase: "build" as const, startDate: "2026-07-15", plannedWeeks: 3, intensitySplit: "80/20", targetWeeklyTss: null, deloadWeek: false, rationale: "mine", source: "override" as const, confidence: "high" as const };
    const out = replanSeasonArc(planWith([ovr]), baseInput(), achieved, "2026-07-01");
    expect(out.periods.some((p) => p.source === "override" && p.rationale === "mine")).toBe(true);
  });
  it("is idempotent on unchanged inputs", () => {
    const a = replanSeasonArc(planWith([]), baseInput({ recentFocuses: [] }), achieved, "2026-07-01");
    const b = replanSeasonArc(a, baseInput({ recentFocuses: [] }), achieved, "2026-07-01");
    expect(b.periods.map((p) => p.focus + p.startDate)).toEqual(a.periods.map((p) => p.focus + p.startDate));
  });
});
