import { NextResponse } from "next/server";
import { isIntervalsConfigured, runFullSync, IntervalsApiError } from "@/lib/intervals-api";
import {
  readAthleteProfile,
  readCurrentBlock,
  readLastSync,
  writeTodayAnalysis,
  writeCurrentBlock,
  writeLastSync,
  readTodayAnalysis,
} from "@/lib/data-store";
import { analyseRide, buildRideAnalysisInput, isAnthropicConfigured } from "@/lib/anthropic-api";
import { adjustBuffer, weightTrendFromWellness } from "@/lib/nutrition";
import type { TodayAnalysis } from "@/lib/types";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// GET returns the cached app state; it never hits Intervals.icu.
export async function GET() {
  const [lastSync, currentBlock, todayAnalysis] = await Promise.all([
    readLastSync(),
    readCurrentBlock(),
    readTodayAnalysis(),
  ]);
  return NextResponse.json({
    configured: isIntervalsConfigured(),
    anthropicConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    lastSync,
    currentBlock,
    todayAnalysis,
  });
}

// POST pulls fresh data from Intervals.icu, then (if a ride happened today)
// runs a short Claude analysis comparing actual vs planned.
export async function POST() {
  if (!isIntervalsConfigured()) {
    return NextResponse.json(
      { error: "Intervals.icu is not configured. Set INTERVALS_API_KEY and INTERVALS_ATHLETE_ID in .env.local." },
      { status: 400 }
    );
  }
  try {
    const lastSync = await runFullSync();
    await writeLastSync(lastSync);

    let todayAnalysis: TodayAnalysis | null = null;

    if (isAnthropicConfigured()) {
      const today = todayIso();
      const todayActivity = lastSync.activities.find(
        (a) => a.date === today && (a.type === "Ride" || a.type === "VirtualRide")
      );

      if (todayActivity) {
        const [currentBlock, profile] = await Promise.all([
          readCurrentBlock(),
          readAthleteProfile(),
        ]);
        const plannedDay = currentBlock?.days.find((d) => d.date === today) ?? null;

        try {
          const actualMin = Math.round(todayActivity.movingTimeSec / 60);
          const ftp = profile.performance.ftp;
          const compliancePct =
            plannedDay && plannedDay.durationMin > 0
              ? Math.round((actualMin / plannedDay.durationMin) * 100)
              : null;
          const intensityFactor =
            todayActivity.avgWatts !== null && ftp > 0
              ? Math.round((todayActivity.avgWatts / ftp) * 100) / 100
              : null;

          // Advised daily intake using real ride kJ (1 kJ ≈ 1 kcal for cyclists)
          const weightTrend = weightTrendFromWellness(lastSync.wellness) ?? 0;
          const { bufferApplied } = adjustBuffer(profile.nutrition.buffer, weightTrend);
          const rideFuelKcal = todayActivity.kj ?? 0;
          const advisedBaseKcal = profile.nutrition.baseCalories;
          const advisedIntakeKcal = Math.round(advisedBaseKcal + rideFuelKcal + bufferApplied);

          const input = buildRideAnalysisInput(
            todayActivity,
            plannedDay ? { name: plannedDay.name, type: plannedDay.type, durationMin: plannedDay.durationMin } : null,
            ftp,
            profile.performance.thresholdHr
          );
          const coachNote = await analyseRide(input);

          todayAnalysis = {
            analysedAt: new Date().toISOString(),
            activityDate: today,
            activityName: todayActivity.name,
            activityDurationMin: actualMin,
            activityAvgWatts: todayActivity.avgWatts,
            activityNormalizedPower: todayActivity.normalizedPower,
            activityMaxWatts: todayActivity.maxWatts,
            activityAvgHr: todayActivity.avgHr,
            activityMaxHr: todayActivity.maxHr,
            activityKj: todayActivity.kj,
            activityTrainingLoad: todayActivity.trainingLoad,
            activityRpe: todayActivity.rpe,
            activityDecoupling: todayActivity.decoupling,
            plannedName: plannedDay?.name ?? null,
            plannedType: plannedDay?.type ?? null,
            plannedDurationMin: plannedDay?.durationMin ?? null,
            compliancePct,
            intensityFactor,
            advisedIntakeKcal,
            advisedBaseKcal,
            advisedBufferKcal: bufferApplied,
            advisedRideFuelKcal: rideFuelKcal,
            coachNote,
          };
          await writeTodayAnalysis(todayAnalysis);
        } catch {
          // Analysis is best-effort — don't fail the whole sync.
        }
      }
    }

    return NextResponse.json({ lastSync, todayAnalysis });
  } catch (err) {
    const status = err instanceof IntervalsApiError && err.status === 401 ? 401 : 502;
    const message = err instanceof Error ? err.message : "Sync failed";
    return NextResponse.json({ error: message }, { status });
  }
}

// DELETE clears the current block so a new one can be generated.
export async function DELETE() {
  await writeCurrentBlock(null);
  return NextResponse.json({ ok: true });
}
