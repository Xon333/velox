// The learning "second brain": turn the accumulating per-ride score log into a
// recency-weighted athlete model, then derive coaching insights from it. Pure +
// deterministic so it's testable and cheap to recompute on demand (no persistence).

import type { AthleteModel, AthleteTypeStat, Insight, RideScoreEntry, WorkoutType } from "./types";

const round1 = (n: number) => Math.round(n * 10) / 10;
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0);

// Exponentially-weighted mean over chronologically-ordered values: recent rides count
// more, so the model adapts as the athlete changes and old data fades.
function ewma(values: number[], alpha = 0.35): number {
  if (values.length === 0) return 0;
  let e = values[0];
  for (let i = 1; i < values.length; i++) e = alpha * values[i] + (1 - alpha) * e;
  return e;
}

function trendOf(values: number[]): "up" | "down" | "flat" {
  if (values.length < 4) return "flat";
  const mid = Math.floor(values.length / 2);
  const a = mean(values.slice(0, mid));
  const b = mean(values.slice(mid));
  const eps = Math.max(Math.abs(a) * 0.05, 0.3);
  return b - a > eps ? "up" : b - a < -eps ? "down" : "flat";
}

export function buildAthleteModel(scores: RideScoreEntry[]): AthleteModel {
  const sorted = [...scores].sort((a, b) => a.date.localeCompare(b.date));
  const byTypeMap = new Map<WorkoutType, RideScoreEntry[]>();
  for (const s of sorted) {
    const arr = byTypeMap.get(s.plannedType) ?? [];
    arr.push(s);
    byTypeMap.set(s.plannedType, arr);
  }

  const byType: AthleteTypeStat[] = [];
  for (const [type, entries] of byTypeMap) {
    const execs = entries.map((e) => e.executionScore);
    const comps = entries.map((e) => e.compliancePct).filter((v): v is number => v !== null);
    byType.push({
      type,
      n: entries.length,
      execEwma: round1(ewma(execs)),
      complianceEwma: comps.length ? Math.round(ewma(comps)) : 0,
      trend: trendOf(execs),
    });
  }
  byType.sort((a, b) => b.n - a.n);

  const allExecs = sorted.map((s) => s.executionScore);
  return {
    byType,
    overallExecEwma: round1(ewma(allExecs)),
    overallTrend: trendOf(allExecs),
    sampleSize: sorted.length,
  };
}

const SEVERITY_RANK = { alert: 0, watch: 1, good: 2 } as const;
const MIN_OBSERVATIONS = 3; // don't fire a pattern off one or two rides

// Translate the model into ranked, actionable coaching observations. One per type
// (the most salient), plus an overall fatigue signal. Capped so it stays focused.
export function deriveInsights(model: AthleteModel): Insight[] {
  const out: Insight[] = [];
  for (const t of model.byType) {
    if (t.n < MIN_OBSERVATIONS) continue;
    if (t.execEwma < 5.5) {
      out.push({
        dimension: t.type,
        severity: "alert",
        title: `${t.type} is a weak point`,
        evidence: `Execution averaging ${t.execEwma}/10 across ${t.n} sessions.`,
        suggestion: `Ease the ${t.type} prescription (shorter reps or lower target) and progress gradually.`,
      });
    } else if (t.complianceEwma > 0 && t.complianceEwma < 80) {
      out.push({
        dimension: t.type,
        severity: "watch",
        title: `${t.type} under-delivered`,
        evidence: `~${t.complianceEwma}% completion across ${t.n} sessions.`,
        suggestion: `Prescribe fewer or shorter ${t.type} sessions to lift adherence.`,
      });
    } else if (t.trend === "down") {
      out.push({
        dimension: t.type,
        severity: "watch",
        title: `${t.type} trending down`,
        evidence: `Execution declining over ${t.n} sessions.`,
        suggestion: `Check fatigue; consider a recovery week before more ${t.type}.`,
      });
    } else if (t.execEwma >= 8) {
      out.push({
        dimension: t.type,
        severity: "good",
        title: `${t.type} dialled in`,
        evidence: `Execution ${t.execEwma}/10 across ${t.n} sessions.`,
        suggestion: `Ready to progress ${t.type} — add a rep or raise the target.`,
      });
    }
  }

  if (model.sampleSize >= 6 && model.overallTrend === "down") {
    out.push({
      dimension: "Overall",
      severity: "alert",
      title: "Execution trending down",
      evidence: `Overall quality ${model.overallExecEwma}/10 and falling.`,
      suggestion: "Likely accumulated fatigue — insert recovery before adding load.",
    });
  }

  return out.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]).slice(0, 5);
}

// Compact directive block for the block-generation prompt — turns patterns into
// concrete planning guidance rather than raw stats.
export function insightsToPromptBlock(insights: Insight[]): string {
  if (insights.length === 0) return "";
  const lines = insights.map((i) => `- ${i.title}: ${i.evidence} → ${i.suggestion}`);
  return `\nLEARNED PATTERNS (from execution history — apply these when shaping the block)\n${lines.join("\n")}`;
}
