import { describe, expect, it } from "vitest";
import { synthesizeCoachingDirectives } from "./synthesis";
import type { Insight, ValidationSummary } from "./types";

const insight = (dimension: string, title: string): Insight => ({
  dimension,
  severity: "alert",
  title,
  evidence: "ev",
  suggestion: "do x",
});

const validation = (over: Partial<ValidationSummary> = {}): ValidationSummary => ({
  byDimension: [],
  evaluated: 0,
  pending: 0,
  ...over,
});

describe("synthesizeCoachingDirectives", () => {
  it("is empty with no insights", () => {
    expect(synthesizeCoachingDirectives([], validation())).toBe("");
  });

  it("emits one ranked block from the insights", () => {
    const out = synthesizeCoachingDirectives([insight("VO2max", "VO2max weak")], validation());
    expect(out).toContain("COACHING DIRECTIVES");
    expect(out).toContain("VO2max weak: ev → do x");
    expect(out).not.toContain("worked"); // no track record yet
  });

  it("annotates an insight with its validation track record", () => {
    const out = synthesizeCoachingDirectives(
      [insight("VO2max", "VO2max weak")],
      validation({ evaluated: 4, byDimension: [{ dimension: "VO2max", validated: 3, refuted: 1, inconclusive: 0, hitRate: 0.75 }] })
    );
    expect(out).toContain("past VO2max nudges worked 75% of the time");
  });
});
