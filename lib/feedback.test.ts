import { describe, expect, it } from "vitest";
import { feedbackDayType, feedbackToPromptBlock, mergeFeedback, summariseFeedback } from "./feedback";
import type { RideFeedback } from "./types";

const fb = (over: Partial<RideFeedback> & { date: string }): RideFeedback => ({
  dayType: "interval",
  rpe: null,
  legs: null,
  intervalSensation: null,
  cognitiveFatigue: null,
  fuelComfort: null,
  hydrationMl: null,
  enjoyment: null,
  notes: null,
  createdAt: "2026-06-16T00:00:00.000Z",
  ...over,
});

describe("feedbackDayType", () => {
  it("splits interval vs endurance vs other", () => {
    expect(feedbackDayType("VO2max")).toBe("interval");
    expect(feedbackDayType("Threshold")).toBe("interval");
    expect(feedbackDayType("Z2")).toBe("endurance");
    expect(feedbackDayType("Recovery")).toBe("endurance");
    expect(feedbackDayType("Strength")).toBe("other");
    expect(feedbackDayType(null)).toBe("other");
  });
});

describe("mergeFeedback", () => {
  it("keeps one entry per date and lets a re-submission overwrite it", () => {
    const merged = mergeFeedback([fb({ date: "2026-06-15", rpe: 5 })], fb({ date: "2026-06-15", rpe: 8 }));
    expect(merged).toHaveLength(1);
    expect(merged[0].rpe).toBe(8);
  });
  it("appends and sorts new dates", () => {
    const merged = mergeFeedback([fb({ date: "2026-06-15" })], fb({ date: "2026-06-10" }));
    expect(merged.map((e) => e.date)).toEqual(["2026-06-10", "2026-06-15"]);
  });
});

describe("summariseFeedback", () => {
  it("averages the recent window and builds an RPE trend", () => {
    const s = summariseFeedback([
      fb({ date: "2026-06-10", rpe: 6, legs: 4, fuelComfort: 5 }),
      fb({ date: "2026-06-14", rpe: 8, legs: 2, fuelComfort: 3 }),
    ]);
    expect(s.count).toBe(2);
    expect(s.avgRpe).toBe(7);
    expect(s.avgLegs).toBe(3);
    expect(s.rpeTrend.map((p) => p.value)).toEqual([6, 8]);
  });
  it("is empty-safe", () => {
    expect(summariseFeedback([]).count).toBe(0);
    expect(summariseFeedback([]).avgRpe).toBeNull();
  });
});

describe("feedbackToPromptBlock", () => {
  it("is empty with no feedback and compact otherwise", () => {
    expect(feedbackToPromptBlock(summariseFeedback([]))).toBe("");
    const block = feedbackToPromptBlock(summariseFeedback([fb({ date: "2026-06-14", rpe: 8, legs: 2 })]));
    expect(block).toContain("avg RPE 8/10");
    expect(block).toContain("legs 2/5");
  });
});
