// Track B — grade an executed durability long ride against its TEMPLATE's expected signal: did the
// template's prescribed efforts actually happen, at the right intensity and (for the back-loaded templates)
// late in the ride, on fatigue? Returns a signed execution-score contribution: delivered = the durability
// stimulus was executed as designed; absent = it became a plain Z2 ride. Null when there's nothing to judge
// (template A — pure accumulation, no efforts — or no interval data). Pure + deterministic.
// Bands/durations mirror the template structures in lib/durability.ts (KB §12).

import type { ExecutedInterval } from "./types";

// Templates that embed efforts INSIDE the long Z2 ride (so above-Z2 time is expected, not a discipline
// lapse). Template A is pure accumulation — unbroken Z2 — and keeps the easy-ride discipline check.
export const EXPECTS_EMBEDDED_EFFORTS = new Set(["B", "C", "D", "E"]);

const LATE_FRAC = 0.55; // an effort starting past this fraction of the ride counts as "on fatigue"
const DISTRIBUTED_SPREAD = 0.4; // E: the efforts must span ≥ this fraction of the ride to read as woven-through

interface EffortSpec {
  minPctFtp: number;
  maxPctFtp: number; // Infinity = open top (sprints)
  minDurationSec: number;
  maxDurationSec: number; // Infinity = no cap (sustained)
  minCount: number;
  timing: "late" | "distributed";
}

const TEMPLATE_EFFORT: Record<string, EffortSpec> = {
  B: { minPctFtp: 0.88, maxPctFtp: 1.08, minDurationSec: 300, maxDurationSec: Infinity, minCount: 1, timing: "late" }, // threshold 8–15 min, back third
  C: { minPctFtp: 1.05, maxPctFtp: 1.25, minDurationSec: 150, maxDurationSec: 420, minCount: 1, timing: "late" }, // VO2 3–4 min, late
  D: { minPctFtp: 1.4, maxPctFtp: Infinity, minDurationSec: 5, maxDurationSec: 40, minCount: 3, timing: "late" }, // sprints 10–20 s, final hour
  E: { minPctFtp: 0.92, maxPctFtp: Infinity, minDurationSec: 20, maxDurationSec: 600, minCount: 3, timing: "distributed" }, // surges woven through
};

export interface DurabilityDelivery {
  signal: number; // +2 delivered · 0 efforts-present-but-mis-placed · -2 absent (skipped the stimulus)
  delivered: boolean;
  reason: string;
}

export function gradeDurabilityDelivery(
  template: string | null | undefined,
  executed: ExecutedInterval[],
  ftp: number,
  totalDurationSec: number
): DurabilityDelivery | null {
  if (!template || !(template in TEMPLATE_EFFORT)) return null; // A / unknown → no embedded efforts to detect
  if (ftp <= 0 || totalDurationSec <= 0 || executed.length === 0) return null; // can't judge without data
  const spec = TEMPLATE_EFFORT[template];

  const inBand = executed.filter((e) => {
    const w = e.avgWatts ?? e.npWatts;
    if (w == null) return false;
    const pct = w / ftp;
    return pct >= spec.minPctFtp && pct <= spec.maxPctFtp && e.durationSec >= spec.minDurationSec && e.durationSec <= spec.maxDurationSec;
  });

  if (inBand.length === 0) {
    return { signal: -2, delivered: false, reason: `Template ${template}: the prescribed efforts weren't delivered — rode as plain Z2.` };
  }

  // Effort timing as a fraction THROUGH THE RIDE, from stream SAMPLE indices: start_index ÷ the last
  // recorded sample (max end_index across the ride's intervals, which span warm-up → cool-down). Both are
  // sample indices from the same stream, so the ratio is the true position regardless of sample rate or
  // paused time — unlike start_index ÷ movingTimeSec, which silently assumed 1 Hz with no pauses (EC-2).
  const lastSample = executed.reduce((m, e) => Math.max(m, e.endIndex ?? 0), 0);
  const fracs = lastSample > 0
    ? inBand.map((e) => e.startIndex).filter((s): s is number => s != null).map((s) => s / lastSample)
    : [];
  let timingOk: boolean;
  if (fracs.length === 0) {
    timingOk = false; // efforts present but no timing data → can't confirm the on-fatigue placement
  } else if (spec.timing === "late") {
    timingOk = fracs.filter((f) => f >= LATE_FRAC).length >= spec.minCount;
  } else {
    timingOk = inBand.length >= spec.minCount && Math.max(...fracs) - Math.min(...fracs) >= DISTRIBUTED_SPREAD;
  }

  if (inBand.length >= spec.minCount && timingOk) {
    return {
      signal: 2,
      delivered: true,
      reason: `Template ${template}: prescribed efforts delivered ${spec.timing === "late" ? "late, on fatigue" : "spread through the ride"}.`,
    };
  }
  return {
    signal: 0,
    delivered: false,
    reason: `Template ${template}: efforts present but not ${spec.timing === "late" ? "placed late on fatigue" : "spread across the ride"} as prescribed.`,
  };
}
