// Match the coach's prescription against the intervals the athlete curated in
// Intervals.icu, rep-by-rep, and roll it up. Order-based alignment: the i-th prescribed
// rep is compared to the i-th executed work effort. Pure + deterministic.

import type { ExecutedInterval, IntervalAdherence, IntervalComparison, PrescribedInterval } from "./types";

export function matchPrescription(
  prescription: PrescribedInterval[],
  executed: ExecutedInterval[]
): IntervalComparison | null {
  if (prescription.length === 0) return null;

  // Flatten prescribed reps in order: "2×20" → two 20-min targets.
  const flat: Array<{ targetWatts: number; durationSec: number }> = [];
  for (const p of prescription) {
    for (let i = 0; i < Math.max(1, p.reps); i++) {
      flat.push({ targetWatts: p.targetWatts, durationSec: p.durationSec });
    }
  }

  // Prefer Intervals' WORK-typed efforts; if none are typed, fall back to efforts whose
  // power is in the work band (excludes warmups/recovery valves) so alignment holds.
  const minTarget = Math.min(...flat.map((f) => f.targetWatts));
  const power = (e: ExecutedInterval) => e.npWatts ?? e.avgWatts ?? 0;
  const typed = executed.filter((e) => e.type === "WORK");
  const work = typed.length > 0 ? typed : executed.filter((e) => power(e) >= 0.8 * minTarget);

  const reps: IntervalAdherence[] = [];
  const n = Math.min(flat.length, work.length);
  for (let i = 0; i < n; i++) {
    const target = flat[i].targetWatts;
    const actual = Math.round(power(work[i]));
    reps.push({
      targetWatts: target,
      actualWatts: actual,
      durationSec: work[i].durationSec,
      adherencePct: target > 0 ? Math.round((actual / target) * 100) : 0,
    });
  }

  const avgAdherencePct =
    reps.length > 0 ? Math.round(reps.reduce((s, r) => s + r.adherencePct, 0) / reps.length) : 0;

  return {
    prescribedLabels: prescription.map((p) => p.label),
    reps,
    completed: reps.length,
    total: flat.length,
    avgAdherencePct,
  };
}
