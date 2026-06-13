"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, timeAgo } from "@/lib/client-api";
import type { AthleteMdSnapshot } from "@/lib/kb-loader";

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
}

type SaveState = { state: "idle" | "saving" | "saved" } | { state: "error"; message: string };

// ---------- read-only display helpers ----------

function KvRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 border-b border-zinc-100 last:border-0">
      <dt className="text-xs text-zinc-500 shrink-0">{label}</dt>
      <dd className="text-sm font-medium text-zinc-800 text-right">{value || "—"}</dd>
    </div>
  );
}

function ReadOnlySection({
  title,
  children,
  editHref,
}: {
  title: string;
  children: React.ReactNode;
  editHref?: string;
}) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white px-4 py-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
        {editHref && (
          <Link
            href={editHref}
            className="text-xs text-blue-600 hover:underline"
          >
            Edit in Knowledge Base →
          </Link>
        )}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

// ---------- main component ----------

export default function AthleteProfileForm() {
  const [data, setData] = useState<ProfileResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Nutrition settings — the only editable section on this page.
  const [nut, setNut] = useState({
    baseCalories: "",
    restDayTarget: "",
    buffer: "",
    targetWeightKg: "",
  });
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
      await api("/api/profile", {
        method: "PUT",
        body: JSON.stringify({ nutrition: parsed }),
      });
      setSaveState({ state: "saved" });
      const fresh = await api<ProfileResponse>("/api/profile");
      setData(fresh);
    } catch (err) {
      setSaveState({
        state: "error",
        message: err instanceof Error ? err.message : "Save failed",
      });
    }
  };

  if (loadError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {loadError}
      </div>
    );
  }
  if (!data) return <p className="py-12 text-center text-sm text-zinc-400">Loading…</p>;

  const { athleteMd, autoSync, bufferStatus } = data;
  const mdEmpty =
    Object.keys(athleteMd.performanceData).length === 0 &&
    athleteMd.goals.length === 0 &&
    athleteMd.weakpoints.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-900">Athlete profile</h1>
        <Link href="/knowledge" className="text-xs text-blue-600 hover:underline">
          Edit athlete_profile.md →
        </Link>
      </div>

      {mdEmpty && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong>athlete_profile.md is empty or unparseable.</strong>{" "}
          <Link href="/knowledge" className="underline">
            Open the Knowledge Base manager
          </Link>{" "}
          to fill in your performance data, goals and weakpoints.
        </div>
      )}

      {/* Personal + performance snapshot from athlete_profile.md */}
      {(Object.keys(athleteMd.personalData).length > 0 ||
        Object.keys(athleteMd.performanceData).length > 0) && (
        <ReadOnlySection
          title="Performance snapshot"
          editHref="/knowledge"
        >
          <div className="grid gap-x-8 sm:grid-cols-2">
            {Object.keys(athleteMd.personalData).length > 0 && (
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                  Personal
                </p>
                <dl>
                  {Object.entries(athleteMd.personalData).map(([k, v]) => (
                    <KvRow key={k} label={k} value={v} />
                  ))}
                </dl>
              </div>
            )}
            {Object.keys(athleteMd.performanceData).length > 0 && (
              <div className="mt-4 sm:mt-0">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                  Performance
                </p>
                <dl>
                  {Object.entries(athleteMd.performanceData).map(([k, v]) => (
                    <KvRow key={k} label={k} value={v} />
                  ))}
                </dl>
              </div>
            )}
          </div>

          {athleteMd.powerProfile.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                Power PRs
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-zinc-400">
                      <th className="pb-1 pr-4 font-medium">Duration</th>
                      <th className="pb-1 pr-4 font-medium">Watts</th>
                      <th className="pb-1 font-medium">W/kg</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {athleteMd.powerProfile.map((p) => (
                      <tr key={p.duration}>
                        <td className="py-1 pr-4 text-zinc-600">{p.duration}</td>
                        <td className="py-1 pr-4 font-medium text-zinc-800">{p.watts}</td>
                        <td className="py-1 text-zinc-600">{p.wkg}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {athleteMd.trainingZones.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                Training zones
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-zinc-400">
                      <th className="pb-1 pr-3 font-medium">Zone</th>
                      <th className="pb-1 pr-3 font-medium">Name</th>
                      <th className="pb-1 pr-3 font-medium">Power</th>
                      <th className="pb-1 font-medium">HR</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {athleteMd.trainingZones.map((z) => (
                      <tr key={z.zone}>
                        <td className="py-1 pr-3 font-medium text-zinc-800">{z.zone}</td>
                        <td className="py-1 pr-3 text-zinc-600">{z.name}</td>
                        <td className="py-1 pr-3 text-zinc-600">{z.power}</td>
                        <td className="py-1 text-zinc-600">{z.hr}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </ReadOnlySection>
      )}

      {/* Goals — parsed from athlete_profile.md */}
      {athleteMd.goals.length > 0 && (
        <ReadOnlySection title="Goals" editHref="/knowledge">
          <ul className="space-y-1.5">
            {athleteMd.goals.map((g, i) => (
              <li
                key={i}
                className="flex items-start justify-between gap-4 rounded-md bg-zinc-50 px-3 py-2"
              >
                <span className="text-sm font-medium text-zinc-800">{g.goal}</span>
                {g.target && g.target !== g.goal && (
                  <span className="text-xs text-zinc-500 text-right">{g.target}</span>
                )}
              </li>
            ))}
          </ul>
        </ReadOnlySection>
      )}

      {/* Weakpoints — parsed from athlete_profile.md */}
      {athleteMd.weakpoints.length > 0 && (
        <ReadOnlySection title="Weakpoints" editHref="/knowledge">
          <ul className="space-y-1.5">
            {athleteMd.weakpoints.map((w, i) => (
              <li
                key={i}
                className="rounded-md bg-zinc-50 px-3 py-2"
              >
                <p className="text-sm font-medium text-zinc-800">{w.weakpoint}</p>
                {w.detail && w.detail !== w.weakpoint && (
                  <p className="mt-0.5 text-xs text-zinc-500">{w.detail}</p>
                )}
              </li>
            ))}
          </ul>
        </ReadOnlySection>
      )}

      {/* Auto-sync from Intervals.icu — read-only live data */}
      <ReadOnlySection title="Live data from Intervals.icu">
        {autoSync.syncedAt === null ? (
          <p className="text-sm text-zinc-500">
            No sync yet —{" "}
            <Link href="/dashboard" className="text-blue-600 hover:underline">
              sync from the dashboard
            </Link>{" "}
            to populate this section.
          </p>
        ) : (
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-zinc-400">Latest weight</dt>
              <dd className="mt-0.5 font-medium text-zinc-800">
                {autoSync.latestWeightKg !== null
                  ? `${autoSync.latestWeightKg.toFixed(1)} kg`
                  : "—"}
                {autoSync.latestWeightDate && (
                  <span className="ml-1 text-xs font-normal text-zinc-400">
                    ({autoSync.latestWeightDate})
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-400">7-day weight trend</dt>
              <dd className="mt-0.5 font-medium text-zinc-800">
                {autoSync.weightTrend7Day !== null
                  ? `${autoSync.weightTrend7Day > 0 ? "+" : ""}${autoSync.weightTrend7Day.toFixed(1)} kg`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-400">Avg RPE (7 days)</dt>
              <dd className="mt-0.5 font-medium text-zinc-800">
                {autoSync.avgRpe7Day !== null ? `${autoSync.avgRpe7Day}/10` : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-400">Last logged intake</dt>
              <dd className="mt-0.5 font-medium text-zinc-800">
                {autoSync.lastKcalConsumed !== null
                  ? `${autoSync.lastKcalConsumed} kcal`
                  : "—"}
                {autoSync.lastKcalDate && (
                  <span className="ml-1 text-xs font-normal text-zinc-400">
                    ({autoSync.lastKcalDate})
                  </span>
                )}
              </dd>
            </div>
          </dl>
        )}
        <p className="mt-2 text-xs text-zinc-400">Synced {timeAgo(autoSync.syncedAt)}.</p>
      </ReadOnlySection>

      {/* Nutrition formula settings — the only editable section */}
      <section className="rounded-lg border border-zinc-200 bg-white px-4 py-4">
        <h2 className="text-sm font-semibold text-zinc-900">Nutrition formula settings</h2>
        <p className="mt-1 text-xs text-zinc-500">
          These values drive the deterministic nutrition formula that pre-computes daily targets
          for every generated session.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [
              { key: "baseCalories", label: "Base calories", unit: "kcal" },
              { key: "restDayTarget", label: "Rest day target", unit: "kcal" },
              { key: "buffer", label: "Training day buffer", unit: "kcal" },
              { key: "targetWeightKg", label: "Target weight", unit: "kg" },
            ] as const
          ).map((f) => (
            <label key={f.key}>
              <span className="text-xs font-medium text-zinc-600">
                {f.label}{" "}
                <span className="text-zinc-400">({f.unit})</span>
              </span>
              <input
                type="number"
                value={nut[f.key]}
                onChange={(e) => {
                  setNut((s) => ({ ...s, [f.key]: e.target.value }));
                  if (saveState.state === "saved") setSaveState({ state: "idle" });
                }}
                className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
              />
            </label>
          ))}
        </div>

        <div className="mt-3 rounded-md bg-zinc-50 px-3 py-2.5">
          <p className="text-xs font-semibold text-zinc-600">Buffer auto-adjustment</p>
          <p className="mt-1 text-sm text-zinc-700">
            Configured {data.nutrition.buffer} kcal → currently applied{" "}
            <span className="font-semibold">{bufferStatus.bufferApplied} kcal</span>
            {bufferStatus.delta !== 0 &&
              ` (${bufferStatus.delta > 0 ? "+" : ""}${bufferStatus.delta} kcal)`}
          </p>
          <p className="mt-1 text-xs text-zinc-500">{bufferStatus.reason}</p>
        </div>

        <div className="mt-4 flex items-center gap-3 border-t border-zinc-100 pt-3">
          <button
            onClick={saveNutrition}
            disabled={saveState.state === "saving"}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:bg-zinc-300"
          >
            {saveState.state === "saving" ? "Saving…" : "Save"}
          </button>
          {saveState.state === "saved" && (
            <span className="text-xs font-medium text-green-700">✓ Saved</span>
          )}
          {saveState.state === "error" && (
            <span className="text-xs text-red-600">{saveState.message}</span>
          )}
        </div>
      </section>
    </div>
  );
}
