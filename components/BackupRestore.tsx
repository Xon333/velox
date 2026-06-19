"use client";

import { useRef, useState } from "react";

// Disaster-recovery UI: export the whole local store (data/ + knowledge-base/) as one JSON file,
// or restore from one. Restore is destructive, so it's gated behind a confirm and a reload.
export default function BackupRestore() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be picked again later
    if (!file) return;
    if (
      !window.confirm(
        "Restore from this backup? It overwrites ALL current training data and knowledge-base files on this machine. Critical stores keep a one-step .bak."
      )
    )
      return;

    setBusy(true);
    setStatus(null);
    try {
      const text = await file.text();
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: text,
      });
      const json = (await res.json()) as { error?: string; restored?: number };
      if (!res.ok) throw new Error(json.error || "Import failed");
      setStatus({ ok: true, msg: `Restored ${json.restored ?? 0} files. Reloading…` });
      setTimeout(() => window.location.reload(), 1000);
    } catch (err) {
      setStatus({ ok: false, msg: err instanceof Error ? err.message : "Import failed" });
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-5 py-4 dark:border-zinc-700 dark:bg-zinc-800">
      <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Backup &amp; restore</h2>
      <p className="mt-1 text-sm text-zinc-500">
        Your training data and knowledge base live only on this machine. Export a snapshot you can
        re-import after a reset or a move to a new machine.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <a
          href="/api/export"
          download
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          Export backup
        </a>
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="rounded-md border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-300 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:border-zinc-600"
        >
          {busy ? "Restoring…" : "Restore from file…"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          onChange={onFile}
          className="hidden"
        />
      </div>
      {status && (
        <p
          className={`mt-3 text-sm ${
            status.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
          }`}
        >
          {status.msg}
        </p>
      )}
    </div>
  );
}
