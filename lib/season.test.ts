import { describe, expect, it } from "vitest";
import { SEASON_CONSTANTS, defaultBuildOrder, addWeeks } from "./season";

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
