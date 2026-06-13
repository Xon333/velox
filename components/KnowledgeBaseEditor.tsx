"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";

type SaveState = { state: "idle" | "saving" | "saved" } | { state: "error"; message: string };

export default function KnowledgeBaseEditor() {
  const [files, setFiles] = useState<string[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [original, setOriginal] = useState("");
  const [saveState, setSaveState] = useState<SaveState>({ state: "idle" });

  const dirty = content !== original;

  useEffect(() => {
    (async () => {
      try {
        const { files } = await api<{ files: string[] }>("/api/knowledge");
        setFiles(files);
        if (files.length > 0) void open(files[0], true);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Failed to list files");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = async (file: string, force = false) => {
    if (!force && dirty && !window.confirm("Discard unsaved changes?")) return;
    try {
      const data = await api<{ content: string }>(`/api/knowledge?file=${encodeURIComponent(file)}`);
      setSelected(file);
      setContent(data.content);
      setOriginal(data.content);
      setSaveState({ state: "idle" });
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to read file");
    }
  };

  const save = async () => {
    if (!selected) return;
    setSaveState({ state: "saving" });
    try {
      await api("/api/knowledge", { method: "PUT", body: JSON.stringify({ file: selected, content }) });
      setOriginal(content);
      setSaveState({ state: "saved" });
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
  if (files === null) {
    return <p className="py-12 text-center text-sm text-zinc-400">Loading…</p>;
  }

  return (
    <div>
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Knowledge base</h1>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        Injected into every generation prompt. Edits apply immediately to the next generation.
      </p>
      <div className="mt-4 flex gap-3">
        <aside className="w-48 shrink-0">
          <ul className="space-y-0.5">
            {files.map((file) => (
              <li key={file}>
                <button
                  onClick={() => void open(file)}
                  className={`w-full rounded px-3 py-2 text-left text-xs font-medium transition-colors ${
                    selected === file
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
                  }`}
                >
                  {file}
                  {selected === file && dirty ? " ●" : ""}
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <div className="min-w-0 flex-1">
          {selected ? (
            <>
              <textarea
                value={content}
                onChange={(e) => {
                  setContent(e.target.value);
                  if (saveState.state === "saved") setSaveState({ state: "idle" });
                }}
                spellCheck={false}
                className="h-[36rem] w-full resize-y rounded-lg border border-zinc-300 bg-white p-4 font-mono text-xs leading-5 text-zinc-800 focus:border-zinc-900 focus:outline-none dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:focus:border-zinc-400"
              />
              <div className="mt-2 flex items-center gap-3">
                <button
                  onClick={save}
                  disabled={!dirty || saveState.state === "saving"}
                  className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:bg-zinc-300 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white dark:disabled:bg-zinc-700 dark:disabled:text-zinc-400"
                >
                  {saveState.state === "saving" ? "Saving…" : "Save"}
                </button>
                {saveState.state === "saved" && (
                  <span className="text-xs font-medium text-green-700 dark:text-green-400">✓ Saved</span>
                )}
                {saveState.state === "error" && (
                  <span className="text-xs text-red-600">{saveState.message}</span>
                )}
                <span className="ml-auto text-xs text-zinc-400 dark:text-zinc-500">
                  {content.length.toLocaleString()} chars
                </span>
              </div>
            </>
          ) : (
            <p className="py-12 text-center text-sm text-zinc-400">No knowledge base files found.</p>
          )}
        </div>
      </div>
    </div>
  );
}
