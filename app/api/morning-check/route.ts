import { NextResponse } from "next/server";
import { readCurrentBlock, readLastSync, readMorningChecks, writeCurrentBlock, writeMorningChecks } from "@/lib/data-store";
import { decideMorningCheck, mergeMorningCheck, type MorningCheckAnswers } from "@/lib/morning-check";
import { applyProactiveReschedule, suggestProactiveReschedule } from "@/lib/reschedule";
import { computeAcwr, computeReadiness } from "@/lib/readiness";
import type { IllnessLevel, MorningCheckEntry, WorkoutType } from "@/lib/types";

const QUALITY = new Set<WorkoutType>(["Threshold", "VO2max", "SIT", "RaceSim"]);
const ILLNESS: IllnessLevel[] = ["none", "mild", "sick"];

const today = () => new Date().toISOString().slice(0, 10);

// GET → the UI's state: today's stored check (if any), whether today is a quality day, and the
// proactive reschedule target (so the form can preview the move before the athlete applies it).
export async function GET() {
  const date = today();
  const [block, checks] = await Promise.all([readCurrentBlock(), readMorningChecks()]);
  const todayDay = block?.days.find((d) => d.date === date) ?? null;
  const isQualityDay = !!todayDay && todayDay.durationMin > 0 && QUALITY.has(todayDay.type);
  return NextResponse.json({
    check: checks.entries.find((e) => e.date === date) ?? null,
    isQualityDay,
    suggestion: suggestProactiveReschedule(block, date),
  });
}

function parseAnswers(b: Record<string, unknown>): MorningCheckAnswers | string {
  const rating = (v: unknown): number | null => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
  };
  const fatigue = rating(b.fatigue);
  const sleep = rating(b.sleep);
  const soreness = rating(b.soreness);
  const motivation = rating(b.motivation);
  if (fatigue === null || sleep === null || soreness === null || motivation === null) {
    return "fatigue, sleep, soreness and motivation must each be an integer 1–5.";
  }
  if (!ILLNESS.includes(b.illness as IllnessLevel)) return "illness must be none, mild or sick.";
  return { fatigue, sleep, soreness, motivation, illness: b.illness as IllnessLevel };
}

// POST → submit the check-in. Computes the deterministic decision (subjective strain + the objective
// form signals), stores it, and returns the decision + the proposed move. Does NOT auto-apply.
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const answers = parseAnswers((body ?? {}) as Record<string, unknown>);
  if (typeof answers === "string") return NextResponse.json({ error: answers }, { status: 400 });

  const date = today();
  const [block, sync] = await Promise.all([readCurrentBlock(), readLastSync()]);
  const todayDay = block?.days.find((d) => d.date === date) ?? null;
  const isQualityDay = !!todayDay && todayDay.durationMin > 0 && QUALITY.has(todayDay.type);

  const { decision, strain, reasons } = decideMorningCheck(answers, {
    isQualityDay,
    tsb: sync?.fitness.tsb ?? null,
    readiness: sync ? computeReadiness(sync.fitness, sync.wellness)?.level ?? null : null,
    acwr: sync ? computeAcwr(sync.activities)?.level ?? null : null,
  });

  const entry: MorningCheckEntry = { date, ...answers, strain, decision, setAt: new Date().toISOString() };
  const log = await readMorningChecks();
  await writeMorningChecks({ entries: mergeMorningCheck(log.entries, entry), updatedAt: new Date().toISOString() });

  return NextResponse.json({
    decision,
    reasons,
    suggestion: decision === "downgrade" ? suggestProactiveReschedule(block, date) : null,
  });
}

// PUT → athlete-confirmed apply: downgrade today + move/swap the quality stimulus. Local block only
// (the Intervals.icu calendar mutation is a separate, larger step — so the note tells the athlete to
// mirror it), matching the reactive /api/reschedule POST.
export async function PUT() {
  const block = await readCurrentBlock();
  if (!block) return NextResponse.json({ error: "No active block." }, { status: 400 });
  const applied = applyProactiveReschedule(block, today());
  if (!applied) return NextResponse.json({ error: "Today isn't a quality day to downgrade." }, { status: 400 });
  await writeCurrentBlock({ ...block, days: applied.days });
  return NextResponse.json({
    ok: true,
    to: applied.to,
    toWasRest: applied.toWasRest,
    note: applied.to
      ? "Moved in the app plan. Mirror it on your Intervals.icu calendar."
      : "Downgraded today; no make-up slot left this block — it's a priority for your next block.",
  });
}
