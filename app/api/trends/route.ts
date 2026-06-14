import { NextResponse } from "next/server";
import {
  readBlockHistory,
  readComplianceMemory,
  readLastSync,
  readRollingBaselines,
  readScoreLog,
} from "@/lib/data-store";

// GET assembles the long-term, second-brain-derived trends. It deliberately does
// NOT reproduce intervals.icu's raw PMC/power-curve charts — only signals that
// tie training execution to the athlete's own blocks and adaptation.
export async function GET() {
  const [sync, history, compliance, baselines, scoreLog] = await Promise.all([
    readLastSync(),
    readBlockHistory(),
    readComplianceMemory(),
    readRollingBaselines(),
    readScoreLog(),
  ]);

  // Pa:HR aerobic efficiency over the synced window (rides with power + HR).
  const paHr = (sync?.activities ?? [])
    .filter((a) => (a.type === "Ride" || a.type === "VirtualRide") && a.avgWatts !== null && a.avgHr !== null && a.avgHr > 0)
    .map((a) => ({ date: a.date, value: Math.round(((a.avgWatts as number) / (a.avgHr as number)) * 100) / 100 }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // CTL trajectory over the synced window.
  const ctl = (sync?.wellness ?? [])
    .filter((w) => w.ctl !== null)
    .map((w) => ({ date: w.date, value: Math.round((w.ctl as number) * 10) / 10 }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Block timeline — newest first. Already accumulates across blocks.
  const blocks = history.map((h) => ({
    goal: h.goal,
    startDate: h.startDate,
    endDate: h.endDate,
    lengthWeeks: h.lengthWeeks,
    complianceByType: h.complianceByType ?? null,
    ctlGain: h.ctlGain ?? null,
    actualHours: h.actualHours ?? null,
    plannedHours: h.plannedHours ?? null,
    nextBlockSeeds: h.nextBlockSeeds ?? null,
  }));

  // Cumulative compliance by type (across all logged sessions).
  const complianceByType = Object.entries(compliance.byType)
    .map(([type, e]) => ({ type, avgCompliancePct: e?.avgCompliancePct ?? null, sessions: e?.sessions ?? 0 }))
    .filter((c) => c.sessions > 0)
    .sort((a, b) => b.sessions - a.sessions);

  return NextResponse.json({
    paHr,
    ctl,
    blocks,
    complianceByType,
    baselines,
    scores: scoreLog.entries,
    syncedAt: sync?.syncedAt ?? null,
  });
}
