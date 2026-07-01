import { NextResponse } from "next/server";
import { readSeasonPlan, writeSeasonPlan } from "@/lib/data-store";
import { validateSeasonPlanInput } from "@/lib/season";

export async function GET() {
  const plan = await readSeasonPlan();
  return NextResponse.json({ plan });
}

export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = validateSeasonPlanInput(body);
  if (typeof parsed === "string") return NextResponse.json({ error: parsed }, { status: 400 });
  const current = await readSeasonPlan();
  // Owned fields come from the athlete; engine-drafted periods are preserved (re-drafted on generate).
  await writeSeasonPlan({ ...current, objective: parsed.objective, events: parsed.events });
  return NextResponse.json({ plan: await readSeasonPlan() });
}
