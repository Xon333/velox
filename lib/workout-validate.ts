// KB-grounded workout-protocol validation. Run at generation time so a workout that
// contradicts the knowledge base — e.g. SIT prescribed as 1-min efforts, or below the maximal
// intensity floor — is flagged BEFORE it reaches the calendar. That keeps the plan and the live
// session describing the same thing, which is the root of plan-vs-detection mismatch (the
// matcher otherwise judges a correctly-ridden session against a wrong prescription).
//
// Deterministic: emits warnings only, never silently rewrites the coach's intent. Bands are
// deliberately lenient (a tolerance past the KB edges) so only clear violations fire — false
// warnings cause data fatigue. Sources: training_knowledge.md §4 (SIT: 4–6×30s all-out at
// 130–200% FTP, 4-min recovery) and cycling_database.md (Z5 VO2max 106–120%, 3–8 min efforts;
// Z4 Threshold 91–105%; sweet spot 88–93%).

import type { PlannedDay, WorkoutType } from "./types";
import { parsePrescription } from "./prescription";

interface ProtocolRule {
  maxEffortSec?: number; // longest a single work effort should run
  minEffortSec?: number; // shortest
  minIntensityPct?: number; // floor for a work step's %FTP
  maxIntensityPct?: number; // ceiling
  cite: string; // KB reference, surfaced in the warning
}

// Only the structured "quality" types carry a protocol worth validating; Z2/Recovery/Strength/
// Rest have no fixed interval shape. Bands include tolerance past the KB edges.
const PROTOCOL: Partial<Record<WorkoutType, ProtocolRule>> = {
  SIT: { maxEffortSec: 45, minIntensityPct: 130, cite: "KB training §4: SIT is 4–6×30s all-out at 130–200% FTP" },
  VO2max: { minEffortSec: 90, maxEffortSec: 600, minIntensityPct: 100, maxIntensityPct: 130, cite: "KB database Z5: VO2max is 3–8 min at 106–120% FTP" },
  Threshold: { minIntensityPct: 80, maxIntensityPct: 115, cite: "KB database Z4: threshold/sweet-spot is 88–105% FTP" },
};

function fmtDur(sec: number): string {
  return sec >= 60 ? `${Math.round(sec / 60)}m` : `${sec}s`;
}

// Validate one planned day's work efforts against its type's KB protocol. Returns a (possibly
// empty) list of human-readable warnings — never throws, never mutates.
export function validateWorkoutProtocol(day: PlannedDay, ftp: number): string[] {
  const rule = PROTOCOL[day.type];
  if (!rule || !day.workoutText) return [];
  // parsePrescription returns only the deliberate work efforts (≥80% FTP); warmups, recovery
  // valves and endurance steps are already excluded, so we never flag those.
  const steps = parsePrescription(day.workoutText, ftp);
  if (steps.length === 0) return [];

  const warnings: string[] = [];
  for (const s of steps) {
    if (rule.maxEffortSec !== undefined && s.durationSec > rule.maxEffortSec) {
      warnings.push(`DAY ${day.date} (${day.type}): effort ${s.label} runs ${fmtDur(s.durationSec)} — longer than protocol (${rule.cite}).`);
    }
    if (rule.minEffortSec !== undefined && s.durationSec < rule.minEffortSec) {
      warnings.push(`DAY ${day.date} (${day.type}): effort ${s.label} is only ${fmtDur(s.durationSec)} — shorter than protocol (${rule.cite}).`);
    }
    if (rule.minIntensityPct !== undefined && s.targetPctFtp < rule.minIntensityPct) {
      warnings.push(`DAY ${day.date} (${day.type}): effort at ${s.targetPctFtp}% FTP is below the ${rule.minIntensityPct}% floor (${rule.cite}).`);
    }
    if (rule.maxIntensityPct !== undefined && s.targetPctFtp > rule.maxIntensityPct) {
      warnings.push(`DAY ${day.date} (${day.type}): effort at ${s.targetPctFtp}% FTP exceeds the ${rule.maxIntensityPct}% ceiling (${rule.cite}).`);
    }
  }
  return warnings;
}

// Validate a whole generated block. Flattened so the generate route can fold these straight
// into the plan's warnings array.
export function validatePlanProtocol(days: PlannedDay[], ftp: number): string[] {
  return days.flatMap((d) => validateWorkoutProtocol(d, ftp));
}
