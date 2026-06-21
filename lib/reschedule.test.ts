import { describe, expect, it } from "vitest";
import { applyProactiveReschedule, suggestProactiveReschedule, suggestReschedule, type DispositionByDate } from "./reschedule";
import type { CurrentBlock, CurrentBlockDay, WorkoutType } from "./types";

const day = (date: string, type: WorkoutType, durationMin: number): CurrentBlockDay => ({
  date,
  name: `${type} session`,
  type,
  durationMin,
});

// today = 2026-06-17 for these fixtures
const TODAY = "2026-06-17";
const block = (days: CurrentBlockDay[]): CurrentBlock => ({
  goal: "g",
  lengthWeeks: 2,
  startDate: days[0].date,
  endDate: days[days.length - 1].date,
  overview: "",
  createdAt: "2026-06-15T00:00:00.000Z",
  days,
});

describe("suggestReschedule", () => {
  it("returns null with no block", () => {
    expect(suggestReschedule(null, new Set(), {}, TODAY)).toBeNull();
  });

  it("flags a missed (no-ride) quality day and offers the next clear rest day", () => {
    const b = block([
      day("2026-06-16", "Threshold", 75), // yesterday, no ride logged → missed
      day("2026-06-17", "Z2", 90), // today
      day("2026-06-18", "Rest", 0), // future rest, neighbours are Z2/Z2 → valid slot
      day("2026-06-19", "Z2", 60),
    ]);
    const s = suggestReschedule(b, new Set([]), {}, TODAY)!;
    expect(s.from).toBe("2026-06-16");
    expect(s.fromType).toBe("Threshold");
    expect(s.reason).toBe("missed");
    expect(s.to).toBe("2026-06-18");
  });

  it("treats a compromised day as not-delivered even if a ride exists", () => {
    const b = block([day("2026-06-16", "VO2max", 70), day("2026-06-18", "Rest", 0)]);
    const disp: DispositionByDate = { "2026-06-16": "compromised" };
    const s = suggestReschedule(b, new Set(["2026-06-16"]), disp, TODAY)!;
    expect(s.reason).toBe("compromised");
    expect(s.to).toBe("2026-06-18");
  });

  it("does not flag a delivered quality day", () => {
    const b = block([day("2026-06-16", "Threshold", 75), day("2026-06-18", "Rest", 0)]);
    expect(suggestReschedule(b, new Set(["2026-06-16"]), {}, TODAY)).toBeNull();
  });

  it("won't put the make-up next to another quality day; to=null if no clear rest slot", () => {
    const b = block([
      day("2026-06-16", "Threshold", 75), // missed
      day("2026-06-18", "VO2max", 70), // future quality
      day("2026-06-19", "Rest", 0), // rest but flanked by the VO2max on the 18th
    ]);
    const s = suggestReschedule(b, new Set([]), {}, TODAY)!;
    expect(s.from).toBe("2026-06-16");
    expect(s.to).toBeNull(); // no rest day clear of adjacent quality → carry forward
  });
});

describe("suggestProactiveReschedule / applyProactiveReschedule", () => {
  it("returns null when today isn't a quality day", () => {
    const b = block([day("2026-06-17", "Z2", 90), day("2026-06-18", "Rest", 0)]);
    expect(suggestProactiveReschedule(b, TODAY)).toBeNull();
    expect(suggestProactiveReschedule(null, TODAY)).toBeNull();
  });

  it("targets the next rest day and downgrades today to recovery", () => {
    const b = block([
      day("2026-06-17", "VO2max", 70), // today, quality
      day("2026-06-18", "Rest", 0), // earliest slot; prev=today(from), next=Z2 → clear
      day("2026-06-19", "Z2", 60),
    ]);
    const s = suggestProactiveReschedule(b, TODAY)!;
    expect(s).toMatchObject({ from: TODAY, fromType: "VO2max", to: "2026-06-18", toWasRest: true });

    const applied = applyProactiveReschedule(b, TODAY)!;
    expect(applied.deferred).toBeNull(); // a slot was found — nothing dropped
    const byDate = Object.fromEntries(applied.days.map((d) => [d.date, d]));
    expect(byDate[TODAY]).toMatchObject({ type: "Recovery" });
    expect(byDate[TODAY].name).toContain("downgraded from VO2max");
    expect(byDate["2026-06-18"]).toMatchObject({ type: "VO2max", durationMin: 70 });
  });

  it("swaps with the next easy day (load-preserving) when no rest day is free", () => {
    const todayQuality: CurrentBlockDay = { date: "2026-06-17", name: "VO2 6x3", type: "VO2max", durationMin: 70, workoutText: "6x3m @ 320W" };
    const b = block([
      todayQuality, // today, quality
      day("2026-06-18", "Z2", 120), // easy → earliest slot (no rest day at all)
      day("2026-06-19", "Strength", 45),
    ]);
    const s = suggestProactiveReschedule(b, TODAY)!;
    expect(s).toMatchObject({ to: "2026-06-18", toWasRest: false });

    const applied = applyProactiveReschedule(b, TODAY)!;
    const byDate = Object.fromEntries(applied.days.map((d) => [d.date, d]));
    // The quality work (with its workout) lands on the 18th…
    expect(byDate["2026-06-18"]).toMatchObject({ type: "VO2max", durationMin: 70, workoutText: "6x3m @ 320W" });
    // …and today takes the easy ride that was there (a true swap — weekly load preserved).
    expect(byDate[TODAY]).toMatchObject({ type: "Z2", durationMin: 120 });
  });

  it("downgrades today to recovery with no target when no slot is left (carry forward)", () => {
    const b = block([day("2026-06-17", "VO2max", 70), day("2026-06-18", "Threshold", 75)]);
    const s = suggestProactiveReschedule(b, TODAY)!;
    expect(s.to).toBeNull();
    const applied = applyProactiveReschedule(b, TODAY)!;
    expect(applied.to).toBeNull();
    expect(applied.deferred).toContain("VO2max"); // CR-6: the dropped stimulus is carried, not lost
    const byDate = Object.fromEntries(applied.days.map((d) => [d.date, d]));
    expect(byDate[TODAY]).toMatchObject({ type: "Recovery" });
    expect(byDate["2026-06-18"]).toMatchObject({ type: "Threshold", durationMin: 75 }); // untouched
  });
});
