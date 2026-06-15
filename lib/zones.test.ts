import { describe, expect, it } from "vitest";
import { bucketZones, type Zone } from "./zones";

// Mirrors the md HR zones: Z1 <120, Z2 120-152, Z3 152-170, Z4 170-182, Z5 182-194, Z6 >194.
const ZONES: Zone[] = [
  { name: "Z1", lo: 0, hi: 120 },
  { name: "Z2", lo: 120, hi: 152 },
  { name: "Z3", lo: 152, hi: 170 },
  { name: "Z4", lo: 170, hi: 182 },
  { name: "Z5", lo: 182, hi: 194 },
  { name: "Z6", lo: 194, hi: null },
];

describe("bucketZones", () => {
  it("buckets samples into the right zones", () => {
    const samples = [110, 130, 140, 160, 175, 190, 200];
    expect(bucketZones(samples, ZONES)).toEqual([1, 2, 1, 1, 1, 1]);
  });

  it("treats lower bound as inclusive and upper as exclusive", () => {
    // 120 → Z2 (not Z1), 152 → Z3 (not Z2), 194 → Z6 (open top)
    expect(bucketZones([120, 152, 194], ZONES)).toEqual([0, 1, 1, 0, 0, 1]);
  });

  it("ignores zero and non-finite samples (dropouts)", () => {
    const samples = [0, NaN, 130, 0, Infinity, 130];
    expect(bucketZones(samples, ZONES)).toEqual([0, 2, 0, 0, 0, 0]);
  });

  it("returns all-zero when there are no valid samples", () => {
    expect(bucketZones([], ZONES)).toEqual([0, 0, 0, 0, 0, 0]);
  });
});
