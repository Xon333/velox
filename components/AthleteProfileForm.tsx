"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, timeAgo } from "@/lib/client-api";
import type { AthleteMdSnapshot } from "@/lib/kb-loader";
import type { PowerCurvePoint } from "@/lib/types";

interface NutritionSettings {
  baseCalories: number;
  restDayTarget: number;
  buffer: number;
  targetWeightKg: number;
}

interface AutoSyncInfo {
  syncedAt: string | null;
  latestWeightKg: number | null;
  latestWeightDate: string | null;
  weightTrend7Day: number | null;
  avgRpe7Day: number | null;
  lastKcalConsumed: number | null;
  lastKcalDate: string | null;
}

interface BufferStatus {
  bufferApplied: number;
  delta: number;
  reason: string;
}

interface ProfileResponse {
  nutrition: NutritionSettings;
  athleteMd: AthleteMdSnapshot;
  autoSync: AutoSyncInfo;
  bufferStatus: BufferStatus;
  syncedPowerCurve: PowerCurvePoint[];
  latestWeightKg: number | null;
}

type SaveState = { state: "idle" | "saving" | "saved" } | { state: "error"; message: string };

const POWER_CURVE_LABELS: Record<number, string> = {
  5: "5s", 15: "15s", 30: "30s", 60: "1 min",
  120: "2 min", 300: "5 min", 1200: "20 min", 1800: "30 min", 3600: "60 min",
};

function Section({
  title,
  editHref,
  children,
}: {
  title: string;
  editHref?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white px-4 py-4 dark:border-zinc-700 dark:bg-zinc-800">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
        {editHref && (
          <Link href={editHref} className="text-xs text-blue-600 hover:underline dark:text-blue-400">
            Edit in Knowledge Base →
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

function KvGrid({ entries }: { entries: [string, string][] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
      {entries.map(([k, v]) => (
        <div key={k}>
          <dt className="text-[11px] text-zinc-400 dark:text-zinc-500">{k}</dt>
          <dd className="mt-0.5 text-sm font-medium text-zinc-800 dark:text-zinc-200">{v || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function AthleteProfileForm() {
  const [data, setData] = useState<ProfileResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nut, setNut] = useState({ baseCalories: "", restDayTarget: "", buffer: "", targetWeightKg: "" });
  const [saveState, setSaveState] = useState<SaveState>({ state: "idle" });

  const load = useCallback(async () => {
    try {
      const response = await api<ProfileResponse>("/api/profile");
      setData(response);
      const n = response.nutrition;
      setNut({
        baseCalories: String(n.baseCalories),
        restDayTarget: String(n.restDayTarget),
        buffer: String(n.buffer),
        targetWeightKg: String(n.targetWeightKg),
      });
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load profile");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const saveNutrition = async () => {
    const parsed: Record<string, number> = {};
    for (const [key, value] of Object.entries(nut)) {
      const n = Number(value);
      if (value.trim() === "" || !Number.isFinite(n)) {
        setSaveState({ state: "error", message: `"${key}" is not a valid number.` });
        return;
      }
      parsed[key] = n;
    }
    setSaveState({ state: "saving" });
    try {
      await api("/api/profile", { method: "PUT", body: JSON.stringify({ nutrition: parsed }) });
      setSaveState({ state: "saved" });
      const fresh = await api<ProfileResponse>("/api/profile");
      setData(fresh);
    } catch (err) {
      setSaveState({ state: "error", message: err instanceof Error ? err.message : "Save failed" });
    }
  };

  if (loadError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
        {loadError}
      </div>
    );
  }
  if (!data) return <p className="py-12 text-center text-sm text-zinc-400">Loading…</p>;

  const { athleteMd, autoSync, bufferStatus, syncedPowerCurve, latestWeightKg } = data;

  const perfEntries = Object.entries(athleteMd.performanceData);
  const personalEntries = Object.entries(athleteMd.personalData);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Athlete profile</h1>
        <Link href="/knowledge" className="text-xs text-blue-600 hover:underline dark:text-blue-400">
          Edit athlete_profile.md →
        </Link>
      </div>

      {/* Performance snapshot */}
      {(personalEntries.length > 0 || perfEntries.length > 0) && (
        <Section title="Performance snapshot" editHref="/knowledge">
          <div className="space-y-4">
            {personalEntries.length > 0 && (
              <div>
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">Personal</p>
                <KvGrid entries={personalEntries as [string, string][]} />
              </div>
            )}
            {perfEntries.length > 0 && (
              <div>
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">Performance</p>
                <KvGrid entries={perfEntries as [string, string][]} />
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Power PRs — from sync if available, else from athlete_profile.md */}
      {(syncedPowerCurve.length > 0 || athleteMd.powerProfile.length > 0) && (
        <Section title="Power PRs" editHref={syncedPowerCurve.length > 0 ? undefined : "/knowledge"}>
          {syncedPowerCurve.length > 0 ? (
            <div>
              <p className="mb-2 text-[10px] text-zinc-400 dark:text-zinc-500">
                84-day best efforts · from Intervals.icu sync · synced {timeAgo(autoSync.syncedAt)}
              </p>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {syncedPowerCurve.map((pt) => {
                  const label = POWER_CURVE_LABELS[pt.durationSec] ?? `${pt.durationSec}s`;
                  const wkg = latestWeightKg ? (pt.watts / latestWeightKg).toFixed(1) : null;
                  return (
                    <div key={pt.durationSec} className="rounded-md bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
                      <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{label}</p>
                      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{pt.watts}W</p>
                      {wkg && <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{wkg} W/kg</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-zinc-400 dark:text-zinc-500">
                    <th className="pb-1 pr-4 font-medium">Duration</th>
                    <th className="pb-1 pr-4 font-medium">Watts</th>
                    <th className="pb-1 font-medium">W/kg</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700">
                  {athleteMd.powerProfile.map((p) => (
                    <tr key={p.duration}>
                      <td className="py-1 pr-4 text-zinc-500 dark:text-zinc-400">{p.duration}</td>
                      <td className="py-1 pr-4 font-semibold text-zinc-800 dark:text-zinc-200">{p.watts}</td>
                      <td className="py-1 text-zinc-500 dark:text-zinc-400">{p.wkg}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}

      {/* Training zones */}
      {athleteMd.trainingZones.length > 0 && (
        <Section title="Training zones" editHref="/knowledge">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-zinc-400 dark:text-zinc-500">
                  <th className="pb-1 pr-3 font-medium">Zone</th>
                  <th className="pb-1 pr-3 font-medium">Name</th>
                  <th className="pb-1 pr-3 font-medium">Power</th>
                  <th className="pb-1 font-medium">HR</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700">
                {athleteMd.trainingZones.map((z) => (
                  <tr key={z.zone}>
                    <td className="py-1 pr-3 font-semibold text-zinc-800 dark:text-zinc-200">{z.zone}</td>
                    <td className="py-1 pr-3 text-zinc-500 dark:text-zinc-400">{z.name}</td>
                    <td className="py-1 pr-3 text-zinc-500 dark:text-zinc-400">{z.power}</td>
                    <td className="py-1 text-zinc-500 dark:text-zinc-400">{z.hr}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* Goals & Weakpoints side by side */}
      {(athleteMd.goals.length > 0 || athleteMd.weakpoints.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {athleteMd.goals.length > 0 && (
            <Section title="Goals" editHref="/knowledge">
              <ul className="space-y-1.5">
                {athleteMd.goals.map((g, i) => (
                  <li key={i} className="flex items-start justify-between gap-3 rounded bg-zinc-50 px-2.5 py-2 dark:bg-zinc-900">
                    <span className="text-sm text-zinc-800 dark:text-zinc-200">{g.goal}</span>
                    {g.target && g.target !== g.goal && (
                      <span className="shrink-0 text-xs text-zinc-400 dark:text-zinc-500">{g.target}</span>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {athleteMd.weakpoints.length > 0 && (
            <Section title="Weakpoints" editHref="/knowledge">
              <ul className="space-y-1.5">
                {athleteMd.weakpoints.map((w, i) => (
                  <li key={i} className="rounded bg-zinc-50 px-2.5 py-2 dark:bg-zinc-900">
                    <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{w.weakpoint}</p>
                    {w.detail && w.detail !== w.weakpoint && (
                      <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{w.detail}</p>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}

      {/* Live Intervals.icu data */}
      <Section title="Live data from Intervals.icu">
        {autoSync.syncedAt === null ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No sync yet —{" "}
            <Link href="/dashboard" className="text-blue-600 hover:underline dark:text-blue-400">
              sync from the dashboard
            </Link>{" "}
            to populate.
          </p>
        ) : (
          <KvGrid entries={[
            ["Latest weight", autoSync.latestWeightKg !== null ? `${autoSync.latestWeightKg.toFixed(1)} kg` : "—"],
            ["7-day trend", autoSync.weightTrend7Day !== null ? `${autoSync.weightTrend7Day > 0 ? "+" : ""}${autoSync.weightTrend7Day.toFixed(1)} kg` : "—"],
            ["Avg RPE (7d)", autoSync.avgRpe7Day !== null ? `${autoSync.avgRpe7Day}/10` : "—"],
            ["Last intake", autoSync.lastKcalConsumed !== null ? `${autoSync.lastKcalConsumed} kcal` : "—"],
          ]} />
        )}
        <p className="mt-2 text-[11px] text-zinc-400 dark:text-zinc-500">
          Synced {timeAgo(autoSync.syncedAt)}.
        </p>
      </Section>

      {/* Nutrition formula settings */}
      <Section title="Nutrition formula">
        <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
          Drives the deterministic formula that pre-computes daily targets for every generated session.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [
              { key: "baseCalories", label: "Base calories", unit: "kcal" },
              { key: "restDayTarget", label: "Rest day target", unit: "kcal" },
              { key: "buffer", label: "Training buffer", unit: "kcal" },
              { key: "targetWeightKg", label: "Target weight", unit: "kg" },
            ] as const
          ).map((f) => (
            <label key={f.key}>
              <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                {f.label} <span className="text-zinc-400 dark:text-zinc-500">({f.unit})</span>
              </span>
              <input
                type="number"
                value={nut[f.key]}
                onChange={(e) => {
                  setNut((s) => ({ ...s, [f.key]: e.target.value }));
                  if (saveState.state === "saved") setSaveState({ state: "idle" });
                }}
                className="mt-1 w-full rounded border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-400"
              />
            </label>
          ))}
        </div>

        <div className="mt-3 rounded bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
          <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Buffer auto-adjustment</p>
          <p className="mt-0.5 text-sm text-zinc-700 dark:text-zinc-300">
            Configured {data.nutrition.buffer} kcal → applied{" "}
            <span className="font-semibold">{bufferStatus.bufferApplied} kcal</span>
            {bufferStatus.delta !== 0 && ` (${bufferStatus.delta > 0 ? "+" : ""}${bufferStatus.delta} kcal)`}
          </p>
          <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">{bufferStatus.reason}</p>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={saveNutrition}
            disabled={saveState.state === "saving"}
            className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:bg-zinc-300 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white dark:disabled:bg-zinc-700 dark:disabled:text-zinc-400"
          >
            {saveState.state === "saving" ? "Saving…" : "Save"}
          </button>
          {saveState.state === "saved" && <span className="text-xs text-green-700 dark:text-green-400">✓ Saved</span>}
          {saveState.state === "error" && <span className="text-xs text-red-600">{saveState.message}</span>}
        </div>
      </Section>
    </div>
  );
}
