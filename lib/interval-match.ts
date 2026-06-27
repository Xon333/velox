// Match the coach's prescription against the intervals the athlete curated in
// Intervals.icu, rep-by-rep, and roll it up. Pure + deterministic.
//
// Alignment is best-fit by DURATION (RV-6): each prescribed rep takes the unused executed effort
// whose length is closest to it, ties broken by earliest index so equal-length reps keep their order.
// This fixes the common real-world pattern where the athlete marks surges as intervals — a single
// prescribed rep no longer grabs the first little surge; the effort that actually looks like the rep
// (by length) wins, and the surges fall through to `extras`. Greedy, so not globally optimal on a
// pathological mix, but correct for the realistic cases (equal-length reps, or one long rep among
// short surges). Power is NOT used to align — only to score the matched rep — since a hard surge can
// out-watt the real rep.

import type { ExecutedInterval, IntervalAdherence, IntervalComparison, PrescribedInterval } from "./types";
import { median } from "./stats";

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
  // Filtering uses NP first (higher, more stable) so warm-up/recovery laps below the work
  // band are excluded correctly. Adherence uses avg watts (what you actually averaged, not the
  // normalized figure) so DI-2 power mis-reads are avoided — NP can be 20%+ above avg for
  // short or variable efforts and would overstate adherence.
  const filterPower = (e: ExecutedInterval) => e.npWatts ?? e.avgWatts ?? 0;
  const adherePower = (e: ExecutedInterval) => e.avgWatts ?? e.npWatts ?? 0;
  const typed = executed.filter((e) => e.type === "WORK");
  const work = typed.length > 0 ? typed : executed.filter((e) => filterPower(e) >= 0.8 * minTarget);

  const used = new Set<number>();
  const reps: IntervalAdherence[] = [];
  for (const f of flat) {
    let best = -1;
    for (let j = 0; j < work.length; j++) {
      if (used.has(j)) continue;
      if (best === -1) {
        best = j;
      } else if (Math.abs(work[j].durationSec - f.durationSec) < Math.abs(work[best].durationSec - f.durationSec)) {
        best = j; // strictly closer by duration; ties keep the earlier index
      }
    }
    if (best === -1) break; // no executed efforts left to match
    used.add(best);
    const actual = Math.round(adherePower(work[best]));
    const actualDur = work[best].durationSec;
    reps.push({
      targetWatts: f.targetWatts,
      actualWatts: actual,
      durationSec: actualDur,
      targetDurationSec: f.durationSec,
      adherencePct: f.targetWatts > 0 ? Math.round((actual / f.targetWatts) * 100) : 0,
      durationPct: f.durationSec > 0 ? Math.round((actualDur / f.durationSec) * 100) : 100,
    });
  }

  const avg = (xs: number[]) => (xs.length > 0 ? Math.round(xs.reduce((s, v) => s + v, 0) / xs.length) : 0);
  const avgAdherencePct = avg(reps.map((r) => r.adherencePct));
  const avgDurationPct = avg(reps.map((r) => r.durationPct));
  // Effective execution = power adherence scaled by how much of the prescribed duration was
  // actually held (capped at 100% so an over-long rep isn't credited as extra). A rep nailed
  // on watts but cut short is NOT a fully-executed rep — this is what scoring keys on.
  const effectiveAdherencePct = avg(
    reps.map((r) => Math.round(r.adherencePct * Math.min(1, r.durationPct / 100)))
  );

  // Plan-vs-detection mismatch (not a bail): every matched rep ran ~half-or-less its prescribed
  // length, yet power was on target AND the rep count matched. That consistent half-duration +
  // nailed-watts signature means the plan's per-rep duration definition differs from what was
  // ridden (e.g. a SIT day stored as 1-min reps but ridden/detected as 30s) — so the duration
  // penalty would mis-score a correct session. A genuine bail (short reps with weak power, or a
  // mid-session fade) is excluded by the strong-power + all-reps-consistent requirement.
  //
  // ACCEPTED TRADEOFF (RV-6): this also launders a *deliberately* short-but-strong session — an
  // athlete who cut every rep in half at the right wattage ("I'll hit the watts but only 30s each")
  // reads as a detection mismatch and dodges the duration penalty. We accept that false-positive to
  // avoid the far more common false-negative (penalising a correctly-ridden session whose stored rep
  // duration just disagrees with detection). The disposition flow (athlete marks it partial) is the
  // intended correction for the rare genuine-short case.
  const countMatches = reps.length === flat.length;
  const allRepsHalvedOrLess = reps.length >= 2 && reps.every((r) => r.durationPct < 55);
  const powerNailed = reps.length > 0 && median(reps.map((r) => r.adherencePct)) >= 95;
  const structuralMismatch = countMatches && allRepsHalvedOrLess && powerNailed;

  // Work efforts not claimed by any prescribed rep = mid-ride added intervals or surge markers (DI-3).
  // Surface them as extras (no target to score against), preserving ride order.
  const extras = work
    .map((e, j) => ({ e, j }))
    .filter(({ j }) => !used.has(j))
    .map(({ e }) => ({ actualWatts: Math.round(adherePower(e)), durationSec: e.durationSec }));

  return {
    prescribedLabels: prescription.map((p) => p.label),
    reps,
    // Only reps that held ≥90% of the prescribed duration count as completed.
    completed: reps.filter((r) => r.durationPct >= 90).length,
    total: flat.length,
    avgAdherencePct,
    avgDurationPct,
    effectiveAdherencePct,
    structuralMismatch,
    extras,
  };
}
