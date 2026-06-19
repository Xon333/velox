import { describe, expect, it } from "vitest";
import { validateSchedule } from "./schedule-validate";
import { DEFAULT_BLOCK_SETTINGS, type BlockSettings, type PlannedDay, type WorkoutType } from "./types";

// Budget of 2 quality sessions/loading week (the default).
const SETTINGS: BlockSettings = { ...DEFAULT_BLOCK_SETTINGS, qualitySessionsPerLoadingWeek: 2 };

function day(date: string, type: WorkoutType, weekNumber = 1): PlannedDay {
  return {
    date,
    weekNumber,
    weekTheme: "test",
    name: `${type} session`,
    type,
    durationMin: type === "Rest" ? 0 : 60,
    workoutText: type === "Rest" ? "" : "- 60m 80%",
    description: "x",
  };
}

describe("validateSchedule — back-to-back hard days", () => {
  it("flags two quality sessions on consecutive dates", () => {
    const w = validateSchedule([day("2026-06-20", "Threshold"), day("2026-06-21", "VO2max")], SETTINGS);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/back-to-back hard days/);
    expect(w[0]).toMatch(/Threshold on 2026-06-20 then VO2max on 2026-06-21/);
  });

  it("counts RaceSim as a hard day", () => {
    const w = validateSchedule([day("2026-06-20", "SIT"), day("2026-06-21", "RaceSim")], SETTINGS);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/back-to-back hard days/);
  });

  it("passes when a rest day separates two quality sessions", () => {
    const w = validateSchedule(
      [day("2026-06-20", "Threshold"), day("2026-06-21", "Rest"), day("2026-06-22", "VO2max")],
      SETTINGS
    );
    expect(w).toEqual([]);
  });

  it("does not treat Z2/Recovery/Strength as hard", () => {
    const w = validateSchedule(
      [day("2026-06-20", "Strength"), day("2026-06-21", "Threshold"), day("2026-06-22", "Z2")],
      SETTINGS
    );
    expect(w).toEqual([]);
  });

  it("does not pair quality days that are two calendar days apart", () => {
    // Same array positions, but a gap in dates (a missing day) must not false-flag.
    const w = validateSchedule([day("2026-06-20", "Threshold"), day("2026-06-22", "VO2max")], SETTINGS);
    expect(w).toEqual([]);
  });

  it("catches a back-to-back pair across the week boundary (Sat → Sun)", () => {
    const w = validateSchedule(
      [day("2026-06-20", "VO2max", 1), day("2026-06-21", "SIT", 2)],
      SETTINGS
    );
    expect(w.some((m) => /back-to-back/.test(m))).toBe(true);
  });
});

describe("validateSchedule — weekly quality budget", () => {
  it("flags a week with more quality sessions than the budget", () => {
    const w = validateSchedule(
      [
        day("2026-06-15", "Threshold", 1),
        day("2026-06-17", "VO2max", 1),
        day("2026-06-19", "SIT", 1),
      ],
      SETTINGS
    );
    const budget = w.find((m) => /over the 2\/week budget/.test(m));
    expect(budget).toBeDefined();
    expect(budget).toMatch(/week 1 has 3 quality sessions/);
  });

  it("passes a week exactly at budget", () => {
    const w = validateSchedule(
      [day("2026-06-15", "Threshold", 1), day("2026-06-17", "VO2max", 1)],
      SETTINGS
    );
    expect(w.some((m) => /budget/.test(m))).toBe(false);
  });

  it("does not flag a recovery week that sits under budget", () => {
    const w = validateSchedule([day("2026-07-06", "Threshold", 4)], SETTINGS);
    expect(w).toEqual([]);
  });
});

describe("validateSchedule — edges", () => {
  it("returns [] for an empty block", () => {
    expect(validateSchedule([], SETTINGS)).toEqual([]);
  });

  it("returns [] for an all-easy week", () => {
    const w = validateSchedule(
      [day("2026-06-15", "Z2"), day("2026-06-16", "Recovery"), day("2026-06-17", "Rest")],
      SETTINGS
    );
    expect(w).toEqual([]);
  });
});
