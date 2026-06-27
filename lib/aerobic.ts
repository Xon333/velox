// Z2-isolated Pw:HR (intervals.icu `icu_power_hr_z2`) — power per heartbeat over a ride's Z2 samples.
// HIGHER = more power per beat = fresher/fitter (the inverse of decoupling's polarity). It's an
// intent-INDEPENDENT aerobic read: computed over the ride's Z2 samples only, so it doesn't infer intensity
// from a ride's type (which off-plan is itself inferred from intensity → would be circular). Two consumers
// share this module so the "qualifying ride" definition + the %Δ-vs-baseline can't drift: the off-plan
// execution-score signal (the gap decoupling left) and the athlete-state aerobic driver.

export const AEROBIC_MIN_Z2_MINS = 15; // trust a ride's Z2 Pw:HR only above this much Z2 (a few warmup mins is noise)
export const AEROBIC_BASELINE_DAYS = 90; // trailing window the baseline is drawn from
export const AEROBIC_MIN_BASELINE = 3; // need a few readings before a baseline is trustworthy
export const AEROBIC_DEADBAND_PCT = 3; // within ±this of baseline = no signal (per-ride Pw:HR is noisy — see the decoupling demotion)

export interface PwHrRide {
  date: string; // YYYY-MM-DD
  type: string; // activity type — only OUTDOOR "Ride" qualifies (see qualifyingPwHr)
  powerHrZ2: number | null;
  powerHrZ2Mins: number | null;
}

// A ride's Z2 Pw:HR if it's an OUTDOOR ride that clears the Z2-minutes floor, else null. Outdoor-only
// (`type === "Ride"`, excluding VirtualRide) for parity with the Trends Pw:HR (`isSteadyEnduranceRide`):
// indoor/virtual rides have no wind cooling → cardiac drift, and ERG holds power flat, so their Z2 Pw:HR is
// distorted. Including them would both pollute the baseline AND mis-grade an indoor ride against a
// mostly-outdoor baseline (an indoor-conditions penalty misread as aerobic strain — EC-1). One gate, so the
// baseline builder and the per-ride read can't drift apart.
export function qualifyingPwHr(r: PwHrRide): number | null {
  return r.type === "Ride" && r.powerHrZ2 != null && (r.powerHrZ2Mins ?? 0) >= AEROBIC_MIN_Z2_MINS ? r.powerHrZ2 : null;
}

// The athlete's aerobic baseline as-of a ride: mean Z2 Pw:HR over qualifying rides STRICTLY BEFORE `date`
// within the trailing window. Excludes the ride itself (no self-reference — same discipline as RV2-4) and
// is as-of correct for scoring a historical entry. Null below the min-sample floor.
// ponytail: O(rides) per call → O(n²) across a full ledger rebuild; n ≤ a sync window of rides, so it's
// fine — switch to a rolling accumulator only if a rebuild ever shows up in a profile.
export function z2PwHrBaselineBefore(rides: PwHrRide[], date: string): number | null {
  const cutoff = new Date(Date.parse(date) - AEROBIC_BASELINE_DAYS * 86_400_000).toISOString().slice(0, 10);
  const vals = rides
    .filter((r) => r.date < date && r.date >= cutoff)
    .map(qualifyingPwHr)
    .filter((v): v is number => v != null);
  if (vals.length < AEROBIC_MIN_BASELINE) return null;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

// Signed %Δ of a ride's Z2 Pw:HR vs its baseline (positive = above baseline = better aerobic efficiency).
// Null when the ride doesn't qualify or there's no usable baseline → the consumer applies no signal.
export function aerobicEffPct(ride: PwHrRide, baseline: number | null): number | null {
  const v = qualifyingPwHr(ride);
  if (v == null || baseline == null || baseline <= 0) return null;
  return ((v - baseline) / baseline) * 100;
}
