import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./anthropic-api";
import type { BlockParams } from "./types";

const params: BlockParams = {
  lengthWeeks: 4,
  goal: "Build threshold",
  weakpoints: ["VO2max"],
  startDate: "2026-06-01",
};

describe("buildSystemPrompt cache split (P1)", () => {
  const { cached, dynamic } = buildSystemPrompt(
    "KB-REFERENCE-TEXT",
    "SEEDS+DIRECTIVES",
    "ATHLETE-DATA",
    params
  );

  it("puts the stable reference (persona + syntax + KB) in the cached prefix", () => {
    expect(cached).toContain("KB-REFERENCE-TEXT");
    expect(cached).toContain("INTERVALS.ICU WORKOUT SYNTAX");
    expect(cached).toContain("expert cycling coach");
  });

  it("keeps per-block dynamic content OUT of the cached prefix (or the cache never hits)", () => {
    expect(cached).not.toContain("Build threshold"); // goal changes every block
    expect(cached).not.toContain("SEEDS+DIRECTIVES");
    expect(cached).not.toContain("ATHLETE-DATA");
  });

  it("puts seeds/directives, athlete data, and block params in the dynamic half", () => {
    expect(dynamic).toContain("SEEDS+DIRECTIVES");
    expect(dynamic).toContain("ATHLETE-DATA");
    expect(dynamic).toContain("Build threshold");
    expect(dynamic).toContain("VO2max");
  });
});
