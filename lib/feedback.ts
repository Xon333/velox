// Pure helpers for the post-ride structured feedback log. Deterministic + defensive — the
// trend engine and generation read uniform summaries from these, so nothing here calls AI.

import type { FeedbackDayType, FeedbackSummary, RideFeedback, WorkoutType } from "./types";

// Which survey to show: interval efforts vs. steady endurance vs. everything else.
export function feedbackDayType(type: WorkoutType | string | null | undefined): FeedbackDayType {
  switch (type) {
    case "Threshold":
    case "VO2max":
    case "SIT":
      return "interval";
    case "Z2":
    case "Recovery":
      return "endurance";
    default:
      return "other";
  }
}

// One entry per date; feedback is editable (subjective), so a fresh submission for a date
// replaces the old one — unlike the immutable score ledger.
export function mergeFeedback(existing: RideFeedback[], entry: RideFeedback): RideFeedback[] {
  const byDate = new Map(existing.map((e) => [e.date, e]));
  byDate.set(entry.date, entry);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

const round1 = (n: number) => Math.round(n * 10) / 10;
function avg(xs: Array<number | null>): number | null {
  const v = xs.filter((x): x is number => x !== null && Number.isFinite(x));
  return v.length ? round1(v.reduce((s, x) => s + x, 0) / v.length) : null;
}

// Recent window (default 56 days, anchored to the latest entry so it survives a layoff).
export function summariseFeedback(entries: RideFeedback[], windowDays = 56): FeedbackSummary {
  if (entries.length === 0) {
    return { count: 0, avgRpe: null, avgLegs: null, avgFuelComfort: null, rpeTrend: [] };
  }
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted[sorted.length - 1].date;
  const cutoff = new Date(Date.parse(latest) - (windowDays - 1) * 86_400_000).toISOString().slice(0, 10);
  const recent = sorted.filter((e) => e.date >= cutoff);
  return {
    count: recent.length,
    avgRpe: avg(recent.map((e) => e.rpe)),
    avgLegs: avg(recent.map((e) => e.legs)),
    avgFuelComfort: avg(recent.map((e) => e.fuelComfort)),
    rpeTrend: recent.filter((e) => e.rpe !== null).map((e) => ({ date: e.date, value: e.rpe as number })),
  };
}

// Compact directive line injected into block generation so the brain factors recent subjective
// state (high RPE / poor gut comfort) alongside the objective ledger. "" when there's nothing.
export function feedbackToPromptBlock(summary: FeedbackSummary): string {
  if (summary.count === 0) return "";
  const parts: string[] = [];
  if (summary.avgRpe !== null) parts.push(`avg RPE ${summary.avgRpe}/10`);
  if (summary.avgLegs !== null) parts.push(`legs ${summary.avgLegs}/5`);
  if (summary.avgFuelComfort !== null) parts.push(`gut comfort ${summary.avgFuelComfort}/5`);
  if (parts.length === 0) return "";
  return `\nRECENT SUBJECTIVE FEEL (athlete-reported, last ${summary.count} rides — weigh against the objective load)\n- ${parts.join(" · ")}`;
}
