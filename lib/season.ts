// Macro periodization engine (MACRO-1..3). Pure + deterministic: drafts a rough, rolling season arc of
// limiter-focus periods, grounded in the knowledge base. The LLM only phrases FocusPeriod.rationale.
import type { FocusPeriod, SeasonEvent, SeasonFocus, SeasonPhase } from "./types";

// KB-grounded (cycling_database.md Annual Periodisation Framework + training_knowledge.md). Mode-C focus
// periods are mesocycle-sized (a "base touch" is 2–4 wk, not the 10–16 wk annual base phase).
export const SEASON_CONSTANTS = {
  weeks: { "aerobic-base": 3, threshold: 4, vo2max: 4, anaerobic: 3, durability: 3, sharpen: 1 } as Record<SeasonFocus, number>,
  split: { "aerobic-base": "90/10", threshold: "80/20", vo2max: "80/20", anaerobic: "80/20", durability: "80/20", sharpen: "75/25" } as Record<SeasonFocus, string>,
  peakWeeks: 5, // 4–6
  taperWeeks: 1, // 1–2
  deloadEveryWeeks: 4, // 3:1 — a deload week after 3 loading weeks
  deloadTightEveryWeeks: 3, // 2:1 under heavy fatigue
  loadRampPct: 6, // +5–8% weekly-TSS ramp midpoint
  horizonPeriods: 5, // how many future periods to draft (rough & rolling)
} as const;

// Build-phase rotation order when no confident limiter is known (KB variety rule).
export function defaultBuildOrder(): SeasonFocus[] {
  return ["threshold", "vo2max", "durability"];
}

// Add whole weeks to an ISO date (UTC-safe).
export function addWeeks(iso: string, weeks: number): string {
  return new Date(Date.parse(iso) + weeks * 7 * 86_400_000).toISOString().slice(0, 10);
}

export interface SeasonDraftInput {
  objective: string;
  events: SeasonEvent[];
  ctl: number | null;
  ftp: number | null;
  recentWeeklyTss: number | null;
  limiter: { system: SeasonFocus | null; confidence: "low" | "medium" | "high" };
  recentFocuses: SeasonFocus[]; // most recent last
  heavyFatigue: boolean;
}

const BUILD_FOCI: SeasonFocus[] = ["threshold", "vo2max", "anaerobic", "durability"];

// KB: "base is non-negotiable." Lead with a base touch when the recent window carries none.
export function needsBaseGate(recentFocuses: SeasonFocus[]): boolean {
  return !recentFocuses.slice(-4).includes("aerobic-base");
}

// Weakest system first when confident; else default rotation. Never repeat the last focus (KB variety).
export function nextBuildFocus(
  limiter: SeasonDraftInput["limiter"],
  recentFocuses: SeasonFocus[]
): SeasonFocus {
  const last = recentFocuses[recentFocuses.length - 1] ?? null;
  const wanted =
    limiter.system && limiter.confidence !== "low" && BUILD_FOCI.includes(limiter.system)
      ? limiter.system
      : null;
  if (wanted && wanted !== last) return wanted;
  const order = defaultBuildOrder();
  return order.find((f) => f !== last) ?? order[0];
}

function period(focus: SeasonFocus, phase: SeasonPhase, startDate: string, confidence: FocusPeriod["confidence"], rationale: string): FocusPeriod {
  return {
    focus, phase, startDate,
    plannedWeeks: focus === "sharpen" ? 1 : SEASON_CONSTANTS.weeks[focus],
    intensitySplit: SEASON_CONSTANTS.split[focus],
    targetWeeklyTss: null, // assigned in Task 4
    deloadWeek: false, // assigned in Task 3
    rationale, source: "derived", confidence,
  };
}

// Mode-C rolling cycle: base-gate → rotating limiter-focus build periods → a realize week. (Deload + load
// targets + the event overlay are layered by later helpers.) Drafts SEASON_CONSTANTS.horizonPeriods ahead.
export function draftSeasonArc(input: SeasonDraftInput, today: string): FocusPeriod[] {
  const periods: FocusPeriod[] = [];
  const recent = [...input.recentFocuses];
  let cursor = today;
  const conf = input.limiter.confidence;

  if (needsBaseGate(recent)) {
    periods.push(period("aerobic-base", "base", cursor, conf, "Aerobic base — the ceiling for every later phase (KB)."));
    recent.push("aerobic-base");
    cursor = addWeeks(cursor, periods[periods.length - 1].plannedWeeks);
  }

  while (periods.length < SEASON_CONSTANTS.horizonPeriods - 1) {
    const focus = nextBuildFocus(input.limiter, recent);
    const why =
      input.limiter.system === focus && conf !== "low"
        ? `Build ${focus} — your most depressed system relative to your engine.`
        : `Build ${focus} — rotating the quality focus (KB: avoid repeating one stimulus).`;
    periods.push(period(focus, "build", cursor, conf, why));
    recent.push(focus);
    cursor = addWeeks(cursor, periods[periods.length - 1].plannedWeeks);
  }

  periods.push(period("sharpen", "build", cursor, conf, "Realize — a lighter week to absorb the block and re-test."));
  return applyDeloadCadence(periods, input.heavyFatigue);
}

// Mark the period that crosses each deload boundary (30–50% volume cut lands in its trailing week).
// Boundary fires when cumulative loading weeks reach (every - 1), i.e. after 3 loading weeks for 3:1,
// after 2 loading weeks for 2:1 (tight).
export function applyDeloadCadence(periods: FocusPeriod[], tight: boolean): FocusPeriod[] {
  const every = tight ? SEASON_CONSTANTS.deloadTightEveryWeeks : SEASON_CONSTANTS.deloadEveryWeeks;
  const threshold = every - 1; // loading weeks before the deload period
  let weeksSinceDeload = 0;
  return periods.map((p) => {
    weeksSinceDeload += p.plannedWeeks;
    if (weeksSinceDeload >= threshold) {
      weeksSinceDeload = 0;
      return { ...p, deloadWeek: true };
    }
    return { ...p, deloadWeek: false };
  });
}
