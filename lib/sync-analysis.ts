// The one LLM step of a sync, split out so /api/sync can return fast with the deterministic
// analysis (metrics, zones, intervals, PRs, execution score) and the coach note is filled in by a
// follow-up /api/analyze call. Idempotent: only runs when today's analysis has no note yet, so a
// re-sync never wipes a generated note and the auto-post fires exactly once.

import { analyseRide, buildRideAnalysisInput, GENERATION_MODEL, isAnthropicConfigured, PROMPT_VERSION } from "./anthropic-api";
import { createEvent } from "./intervals-api";
import {
  readAthleteProfile,
  readBlockSettings,
  readCurrentBlock,
  readLastSync,
  readTodayAnalysis,
  writeTodayAnalysis,
} from "./data-store";
import type { TodayAnalysis } from "./types";

// `force` re-runs even when a note already exists — used by the manual re-analyse action so an
// athlete can retry after an Anthropic hiccup without waiting for the next full sync. The default
// (false) keeps the sync path idempotent: a re-sync never re-pays for a note it already has.
export async function addCoachNote(
  today: string,
  warnings: string[],
  force = false
): Promise<TodayAnalysis | null> {
  const analysis = await readTodayAnalysis();
  if (!analysis || analysis.activityDate !== today) return analysis ?? null; // nothing to analyse today
  if (analysis.coachNote && !force) return analysis; // already generated — idempotent
  if (!isAnthropicConfigured()) return analysis;

  try {
    const [lastSync, currentBlock, profile] = await Promise.all([
      readLastSync(),
      readCurrentBlock(),
      readAthleteProfile(),
    ]);
    const todayActivity = lastSync?.activities.find(
      (a) => a.date === today && (a.type === "Ride" || a.type === "VirtualRide")
    );
    if (!todayActivity) return analysis;
    const plannedDay = currentBlock?.days.find((d) => d.date === today) ?? null;

    // Rebuild the analysis input from the raw activity + the deterministic fields the fast path
    // already computed and stored on `analysis` (zones, interval comparison, PRs).
    const input = buildRideAnalysisInput(
      todayActivity,
      plannedDay ? { name: plannedDay.name, type: plannedDay.type, durationMin: plannedDay.durationMin } : null,
      profile.performance.ftp,
      profile.performance.thresholdHr
    );
    input.powerZoneTimes = analysis.powerZoneTimes;
    input.hrZoneTimes = analysis.hrZoneTimes;
    input.intervalComparison = analysis.intervalComparison;
    input.powerPRs = analysis.powerPRs;

    const coachNote = await analyseRide(input);
    const updated: TodayAnalysis = {
      ...analysis,
      coachNote,
      analysedAt: new Date().toISOString(),
      // Stamp the note's provenance only when one was actually produced; an empty result leaves
      // the analysis unstamped so the next sync/re-analyse retries cleanly.
      ...(coachNote ? { model: GENERATION_MODEL, promptVersion: PROMPT_VERSION } : {}),
    };
    await writeTodayAnalysis(updated);

    // Auto-post to Intervals.icu once, if opted in. (Runs only on first note generation because of
    // the coachNote-empty guard above, so it can't double-post on a re-sync.)
    if (coachNote) {
      const settings = await readBlockSettings();
      if (settings.autoPostCoachNote) {
        const scoreLine = updated.executionScore !== null ? `\nExecution score: ${updated.executionScore}/10` : "";
        await createEvent({
          category: "NOTE",
          start_date_local: `${today}T00:00:00`,
          name: "Coach analysis",
          description: `[Nodevelo coach] ${updated.activityName}${scoreLine}\n\n${coachNote.trim()}`,
        }).catch(() => {}); // best-effort write-back
      }
    }
    return updated;
  } catch (e) {
    warnings.push(`Coach note generation failed: ${e instanceof Error ? e.message : String(e)}`);
    return analysis;
  }
}
