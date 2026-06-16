import { NextResponse } from "next/server";
import { readRideFeedback, writeRideFeedback } from "@/lib/data-store";
import { mergeFeedback, summariseFeedback } from "@/lib/feedback";
import type { FeedbackDayType, RideFeedback } from "@/lib/types";

const DAY_TYPES: FeedbackDayType[] = ["interval", "endurance", "other"];

// Clamp a 1..max rating, accepting null/absent. Defensive against junk payloads.
function rating(v: unknown, max: number): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(1, Math.round(n)));
}

function nonNegInt(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

// GET → today's feedback (if any) + a recent summary for the trend engine.
export async function GET() {
  const log = await readRideFeedback();
  const today = new Date().toISOString().slice(0, 10);
  return NextResponse.json({
    today: log.entries.find((e) => e.date === today) ?? null,
    summary: summariseFeedback(log.entries),
  });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;

  const date = typeof b.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : null;
  if (!date) return NextResponse.json({ error: "A valid date is required." }, { status: 400 });
  const dayType = DAY_TYPES.includes(b.dayType as FeedbackDayType) ? (b.dayType as FeedbackDayType) : "other";

  const entry: RideFeedback = {
    date,
    dayType,
    rpe: rating(b.rpe, 10),
    legs: rating(b.legs, 5),
    intervalSensation: rating(b.intervalSensation, 5),
    cognitiveFatigue: rating(b.cognitiveFatigue, 5),
    fuelComfort: rating(b.fuelComfort, 5),
    hydrationMl: nonNegInt(b.hydrationMl),
    enjoyment: rating(b.enjoyment, 5),
    notes: typeof b.notes === "string" && b.notes.trim() ? b.notes.trim().slice(0, 500) : null,
    createdAt: new Date().toISOString(),
  };

  const log = await readRideFeedback();
  const entries = mergeFeedback(log.entries, entry);
  await writeRideFeedback({ entries, updatedAt: new Date().toISOString() });

  return NextResponse.json({ today: entry, summary: summariseFeedback(entries) });
}
