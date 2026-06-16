"use client";

import { useState } from "react";
import { api } from "@/lib/client-api";
import { Zone } from "./ui";

const EXAMPLES = [
  "Wet & cold out — hill threshold or the trainer?",
  "Legs feel flat — push today or swap to Z2?",
  "Short on time — what's the minimum that still counts?",
];

// Cheap, context-aware spot-check for today. Sends the current block + session + form to a
// small model; the athlete adds any live context (weather, how they feel) in the question.
export default function AskCoach() {
  const [query, setQuery] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = async (q: string) => {
    const question = q.trim();
    if (!question || loading) return;
    setLoading(true);
    setError(null);
    setAsked(question);
    setAnswer(null);
    try {
      const res = await api<{ answer: string }>("/api/ask", { method: "POST", body: JSON.stringify({ query: question }) });
      setAnswer(res.answer);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ask failed");
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setQuery("");
    setAsked(null);
    setAnswer(null);
    setError(null);
  };

  return (
    <Zone title="Ask coach" hint="quick · today's context">
      {!asked ? (
        <>
          <div className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  ask(query);
                }
              }}
              placeholder="a quick question about today…"
              className="min-w-0 flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:placeholder-zinc-500 dark:focus:border-zinc-400"
            />
            <button
              onClick={() => ask(query)}
              disabled={loading || !query.trim()}
              className="shrink-0 rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-300 dark:border dark:border-[#00d4ff]/50 dark:bg-transparent dark:text-[#00d4ff] dark:hover:bg-[#00d4ff]/10 dark:disabled:border-zinc-700 dark:disabled:text-zinc-600"
            >
              Ask
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => ask(ex)}
                className="rounded-full border border-zinc-200 px-2 py-1 text-[11px] text-zinc-500 transition-colors hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-500 dark:hover:text-zinc-200"
              >
                {ex}
              </button>
            ))}
          </div>
        </>
      ) : (
        <div>
          <p className="text-xs font-medium text-zinc-700 dark:text-zinc-200">{asked}</p>
          <div className="mt-1.5 min-h-[2rem] max-h-44 overflow-y-auto rounded-md bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
            {loading && <p className="text-xs italic text-zinc-400 dark:text-zinc-500">thinking…</p>}
            {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
            {answer && <p className="whitespace-pre-line text-xs leading-5 text-zinc-700 dark:text-zinc-300">{answer}</p>}
          </div>
          {!loading && (
            <button onClick={reset} className="mt-1.5 text-[11px] text-cyan-700 hover:underline dark:text-[#00d4ff]">
              Ask another
            </button>
          )}
        </div>
      )}
    </Zone>
  );
}
