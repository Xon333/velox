"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import type { FeedbackDayType, RideFeedback } from "@/lib/types";

const SCALE5 = [1, 2, 3, 4, 5];
const SCALE10 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

function Rating({
  label,
  value,
  scale,
  onChange,
}: {
  label: string;
  value: number | null;
  scale: number[];
  onChange: (n: number) => void;
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{label}</p>
      <div className="mt-1 flex flex-wrap gap-1">
        {scale.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={`h-6 w-6 rounded text-[11px] font-medium transition-colors ${
              value === n
                ? "bg-zinc-900 text-white dark:bg-[#00d4ff]/20 dark:text-[#00d4ff]"
                : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
            }`}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

// Structured post-ride survey — fields split by day type (interval vs endurance). Replaces
// free-text journalling with uniform, trend-parseable signals. Shown collapsed once logged.
export default function RideFeedbackForm({ date, dayType }: { date: string; dayType: FeedbackDayType }) {
  const [existing, setExisting] = useState<RideFeedback | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<Record<string, number | null>>({});
  const [hydration, setHydration] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api<{ today: RideFeedback | null }>("/api/feedback");
        if (!cancelled) setExisting(r.today && r.today.date === date ? r.today : null);
      } catch {
        if (!cancelled) setExisting(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [date]);

  const set = (k: string, v: number) => setF((s) => ({ ...s, [k]: v }));

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api<{ today: RideFeedback }>("/api/feedback", {
        method: "POST",
        body: JSON.stringify({ date, dayType, ...f, hydrationMl: hydration === "" ? null : Number(hydration), notes }),
      });
      setExisting(res.today);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (existing === undefined) return null; // still loading

  if (existing && !open) {
    const bits = [
      existing.rpe != null ? `RPE ${existing.rpe}/10` : null,
      existing.legs != null ? `legs ${existing.legs}/5` : null,
      existing.fuelComfort != null ? `gut ${existing.fuelComfort}/5` : null,
    ].filter(Boolean);
    return (
      <div className="mt-3 rounded border border-zinc-100 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">How it felt · logged</p>
          <button
            onClick={() => {
              setF({
                rpe: existing.rpe,
                legs: existing.legs,
                intervalSensation: existing.intervalSensation,
                cognitiveFatigue: existing.cognitiveFatigue,
                fuelComfort: existing.fuelComfort,
                enjoyment: existing.enjoyment,
              });
              setHydration(existing.hydrationMl != null ? String(existing.hydrationMl) : "");
              setNotes(existing.notes ?? "");
              setOpen(true);
            }}
            className="text-[11px] text-cyan-700 hover:underline dark:text-[#00d4ff]"
          >
            Edit
          </button>
        </div>
        <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">{bits.length ? bits.join(" · ") : "logged"}</p>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded border border-zinc-100 bg-zinc-50 px-3 py-2.5 dark:border-zinc-700 dark:bg-zinc-900">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
        How did it feel?
      </p>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2.5">
        <Rating label="RPE (effort)" value={f.rpe ?? null} scale={SCALE10} onChange={(n) => set("rpe", n)} />
        <Rating label="Legs freshness" value={f.legs ?? null} scale={SCALE5} onChange={(n) => set("legs", n)} />
        {dayType === "interval" && (
          <>
            <Rating label="Interval sensation" value={f.intervalSensation ?? null} scale={SCALE5} onChange={(n) => set("intervalSensation", n)} />
            <Rating label="Cognitive fatigue" value={f.cognitiveFatigue ?? null} scale={SCALE5} onChange={(n) => set("cognitiveFatigue", n)} />
          </>
        )}
        {dayType === "endurance" && (
          <>
            <Rating label="Gut / fuelling" value={f.fuelComfort ?? null} scale={SCALE5} onChange={(n) => set("fuelComfort", n)} />
            <Rating label="Enjoyment" value={f.enjoyment ?? null} scale={SCALE5} onChange={(n) => set("enjoyment", n)} />
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Hydration (ml)</p>
              <input
                type="number"
                min={0}
                value={hydration}
                onChange={(e) => setHydration(e.target.value)}
                className="mt-1 w-24 rounded border border-zinc-300 px-2 py-1 text-xs focus:border-zinc-900 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:focus:border-zinc-400"
              />
            </div>
          </>
        )}
      </div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        placeholder="anything else (optional)"
        className="mt-2 w-full rounded border border-zinc-300 px-2 py-1 text-xs focus:border-zinc-900 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:placeholder-zinc-500 dark:focus:border-zinc-400"
      />
      <div className="mt-2 flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-md bg-zinc-900 px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-zinc-700 disabled:bg-zinc-300 dark:border dark:border-[#00d4ff]/50 dark:bg-transparent dark:text-[#00d4ff] dark:hover:bg-[#00d4ff]/10"
        >
          {saving ? "Saving…" : "Save feedback"}
        </button>
        {error && <span className="text-[11px] text-red-600 dark:text-red-400">{error}</span>}
      </div>
    </div>
  );
}
