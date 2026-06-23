"use client";

import { useSync } from "./SyncProvider";
import { Card } from "./ui";
import { resolveCalibratedValue } from "@/lib/calibration";
import { DEFAULT_DECOUPLING_GOOD } from "@/lib/execution-score";
import type { CalibratedParameter } from "@/lib/types";

// Read-only view of the per-athlete calibration (ROADMAP #2). Shows the effective value the scorer
// uses + its provenance, so the athlete can see what's been learned from their own data vs. the
// population default. No editing yet — the record carries `manualOverride` for when that lands.

function detail(p: CalibratedParameter | undefined, effective: number): string {
  if (!p || p.source === "default") return "Population default — not enough of your data yet.";
  if (p.manualOverride != null) return "Manually set.";
  if (effective === p.value) return `Calibrated from your last ${p.dataPoints} rides · ${p.confidence} confidence${p.locked ? " · locked" : ""}.`;
  return `Learning from ${p.dataPoints} rides — using the default until there's enough to be confident.`;
}

export default function CalibrationPanel() {
  const { state } = useSync();
  const cal = state?.calibration ?? null;
  const dg = cal?.decouplingGood;
  const effective = resolveCalibratedValue(dg ?? null, DEFAULT_DECOUPLING_GOOD);

  const rows = [
    {
      label: "Decoupling “good” cutoff",
      value: `${effective.toFixed(1)}%`,
      hint: "Aerobic drift below this scores well; the bands recenter on your own typical decoupling.",
      detail: detail(dg, effective),
    },
  ];

  return (
    <Card title="Per-athlete calibration">
      <p className="-mt-1 mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        Scoring thresholds the app learns from your own data, with a population default until there&apos;s enough history.
        Updated on each sync. Read-only for now.
      </p>
      {!cal ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">Sync to compute your calibration.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.label} className="border-t border-zinc-100 pt-3 first:border-t-0 first:pt-0 dark:border-zinc-700/60">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">{r.label}</span>
                <span className="font-mono text-sm text-zinc-900 dark:text-zinc-100">{r.value}</span>
              </div>
              <p className="mt-0.5 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">{r.hint}</p>
              <p className="mt-0.5 text-[11px] leading-snug text-zinc-400 dark:text-zinc-500">{r.detail}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
