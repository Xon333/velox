# Season Event Entry UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Season" form section to the Athlete Profile page so the athlete can set their season objective and manage a list of target events (name, date, A/B/C priority) — the athlete-owned intent the macro-periodization engine already persists and reads but currently has no UI to write.

**Architecture:** A single addition to the existing `components/AthleteProfileForm.tsx`: new local state (`objective`, `events`, `seasonSaveState`) fetched from the already-shipped `GET /api/season` on mount (its own effect, mirroring `SeasonRoadmap.tsx`'s identical fetch), a new `<Section title="Season">` card with a controlled objective input and a controlled, growable list of event rows, and a Save flow that validates client-side via the already-shipped, pure `validateSeasonPlanInput` before `PUT /api/season`. No new backend, no new pure logic, no new types.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript 5, Tailwind v4. No test framework changes — this codebase's convention is that React components are not unit-tested (only pure `lib/*` logic is), and this plan introduces no new pure logic.

## Global Constraints

- Reuse only what already exists: `SeasonEvent`/`SeasonPlan` types (`lib/types.ts:306-331`), `validateSeasonPlanInput` (`lib/season.ts:299`), `GET`/`PUT /api/season` (`app/api/season/route.ts`), the `api<T>()` client helper (`lib/client-api.ts:3`). Do not add new backend routes, new types, or duplicate validation logic.
- The Season section's save state (`seasonSaveState`) is fully independent from the existing Nutrition formula section's `saveState` — its own `useState`, its own Save button, its own fetch/save cycle. Saving one must never touch the other's state or fields.
- Client-side validation calls `validateSeasonPlanInput({ objective, events })` BEFORE any network request; a string return is shown as an error with zero network calls. Only a non-string (parsed) return proceeds to the `PUT`.
- Placement: the new `<Section title="Season">` renders directly above the existing `<Section title="Nutrition formula">` in the JSX (i.e., after the Goals & Weakpoints block, before the `{/* Nutrition formula — bottom */}` comment).
- Verification: `npx tsc --noEmit` must be clean. No new automated test is added (matches this codebase's established convention — `SeasonRoadmap.tsx`, which this plan mirrors closely, has no component test either).
- Concurrent trunk: stage only `components/AthleteProfileForm.tsx` with an explicit `git add` (never `git add -A`); commit on `main`. Do not touch `lib/kb-loader.*` or `i-have-adhd/`.

---

### Task 1: Add the Season section to AthleteProfileForm

**Files:**
- Modify: `components/AthleteProfileForm.tsx`

**Interfaces:**
- Consumes: `SeasonEvent { name: string; date: string; priority: "A" | "B" | "C" }`, `SeasonPlan { objective: string; events: SeasonEvent[]; periods: FocusPeriod[]; updatedAt: string }` (both from `@/lib/types`); `validateSeasonPlanInput(body: unknown): { objective: string; events: SeasonEvent[] } | string` (from `@/lib/season`); `api<T>(url: string, init?: RequestInit): Promise<T>` (already imported in this file from `@/lib/client-api`); the existing `SaveState` type (already defined in this file, line 59) and the existing `Section` component (already defined in this file, line 85).
- Produces: nothing new consumed elsewhere — this is a leaf UI addition.

This is one cohesive change to one file; it's TDD-free per the Global Constraints (no new pure logic), so the steps below are implement-then-verify rather than red/green.

- [ ] **Step 1: Add the new imports**

At the top of `components/AthleteProfileForm.tsx`, change line 9 from:
```ts
import type { PowerCurvePoint, PowerProfile, PowerSystem } from "@/lib/types";
```
to:
```ts
import type { PowerCurvePoint, PowerProfile, PowerSystem, SeasonEvent, SeasonPlan } from "@/lib/types";
import { validateSeasonPlanInput } from "@/lib/season";
```

- [ ] **Step 2: Add the Season local state**

Immediately after the existing state declarations (after line 126, `const [saveState, setSaveState] = useState<SaveState>({ state: "idle" });`), add:

```ts
  const [objective, setObjective] = useState("");
  const [events, setEvents] = useState<SeasonEvent[]>([]);
  const [seasonSaveState, setSeasonSaveState] = useState<SaveState>({ state: "idle" });
```

- [ ] **Step 3: Add the Season fetch-on-mount effect**

Immediately after the existing profile-loading `useEffect` block (after its closing `}, []);` — currently ending around line 152), add a second, independent effect:

```ts
  // Season is athlete-owned intent (objective + target events) that the macro-periodization
  // engine reads and re-plans around — an independent fetch from a separate store/route, mirrored
  // from the identical pattern in SeasonRoadmap.tsx. Failure here is non-fatal: the section just
  // starts from empty defaults, same as a first-time athlete who's never set a season yet.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { plan } = await api<{ plan: SeasonPlan }>("/api/season");
        if (cancelled) return;
        setObjective(plan.objective);
        setEvents(plan.events);
      } catch {
        // non-fatal — the form just starts from empty defaults
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
```

- [ ] **Step 4: Add the event-row mutation helpers and the save handler**

Immediately after the existing `saveNutrition` function (after its closing `};` — currently ending around line 173), add:

```ts
  const updateEvent = (index: number, patch: Partial<SeasonEvent>) => {
    setEvents((evs) => evs.map((e, i) => (i === index ? { ...e, ...patch } : e)));
    if (seasonSaveState.state === "saved") setSeasonSaveState({ state: "idle" });
  };

  const addEvent = () => {
    setEvents((evs) => [...evs, { name: "", date: "", priority: "B" }]);
  };

  const removeEvent = (index: number) => {
    setEvents((evs) => evs.filter((_, i) => i !== index));
  };

  const saveSeason = async () => {
    const parsed = validateSeasonPlanInput({ objective, events });
    if (typeof parsed === "string") {
      setSeasonSaveState({ state: "error", message: parsed });
      return;
    }
    setSeasonSaveState({ state: "saving" });
    try {
      await api("/api/season", { method: "PUT", body: JSON.stringify(parsed) });
      setSeasonSaveState({ state: "saved" });
      const fresh = await api<{ plan: SeasonPlan }>("/api/season");
      setObjective(fresh.plan.objective);
      setEvents(fresh.plan.events);
    } catch (err) {
      setSeasonSaveState({ state: "error", message: err instanceof Error ? err.message : "Save failed" });
    }
  };
```

- [ ] **Step 5: Add the Season section JSX**

Find the comment `{/* Nutrition formula — bottom */}` (currently line 378) and insert the new `<Section>` directly before it:

```tsx
      {/* Season — athlete-owned objective + target events; the macro-periodization engine reads
          these to decide when to activate event-anchored mode (taper/peak toward a race date). */}
      <Section title="Season">
        <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
          What you're training for, and any target events — the coach plans the season arc around these.
        </p>
        <label className="block">
          <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">Objective</span>
          <input
            type="text"
            value={objective}
            placeholder="e.g. get faster: FTP + punch for hilly KOMs"
            onChange={(e) => {
              setObjective(e.target.value);
              if (seasonSaveState.state === "saved") setSeasonSaveState({ state: "idle" });
            }}
            className="mt-1 w-full rounded border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-400"
          />
        </label>

        <div className="mt-3 space-y-2">
          {events.map((ev, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2 rounded bg-zinc-50 px-2.5 py-2 dark:bg-zinc-900">
              <label className="min-w-[10rem] flex-1">
                <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">Name</span>
                <input
                  type="text"
                  value={ev.name}
                  onChange={(e) => updateEvent(i, { name: e.target.value })}
                  className="mt-1 w-full rounded border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-400"
                />
              </label>
              <label>
                <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">Date</span>
                <input
                  type="date"
                  value={ev.date}
                  onChange={(e) => updateEvent(i, { date: e.target.value })}
                  className="mt-1 rounded border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-400"
                />
              </label>
              <label>
                <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">Priority</span>
                <select
                  value={ev.priority}
                  onChange={(e) => updateEvent(i, { priority: e.target.value as SeasonEvent["priority"] })}
                  className="mt-1 rounded border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-400"
                >
                  <option value="A">A</option>
                  <option value="B">B</option>
                  <option value="C">C</option>
                </select>
              </label>
              <button
                onClick={() => removeEvent(i)}
                title="Remove this event"
                className="rounded-md border border-red-300 px-2 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950"
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <button
          onClick={addEvent}
          className="mt-3 rounded border border-zinc-200 px-2 py-1 text-[10px] font-medium text-zinc-500 transition-colors hover:border-zinc-300 hover:text-zinc-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200"
        >
          + Add event
        </button>

        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={saveSeason}
            disabled={seasonSaveState.state === "saving"}
            className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:bg-zinc-300 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white dark:disabled:bg-zinc-700 dark:disabled:text-zinc-400"
          >
            {seasonSaveState.state === "saving" ? "Saving…" : "Save"}
          </button>
          {seasonSaveState.state === "saved" && <span className="text-xs text-green-700 dark:text-green-400">✓ Saved</span>}
          {seasonSaveState.state === "error" && <span className="text-xs text-red-600">{seasonSaveState.message}</span>}
        </div>
      </Section>

```

- [ ] **Step 6: Verify the component compiles cleanly**

Run: `npx tsc --noEmit`
Expected: no errors. This specifically catches any signature mismatch against `SeasonEvent`/`validateSeasonPlanInput`/`api<T>()`.

- [ ] **Step 7: Manual verification against a running dev server**

Start (or confirm running) the dev server per this project's usual `npm run dev` / preview workflow, then:
1. Load `/profile`. Confirm a "Season" card renders above "Nutrition formula", with an empty Objective field and no event rows (assuming a fresh/empty `data/season-plan.json`, matching this session's confirmed empty-default state).
2. Type an objective, click "+ Add event" twice, fill in a Name/Date/Priority on each row, click "×" on one row to confirm it's removed, then click "Save".
3. Confirm the button shows "Saving…" then "✓ Saved", and reload the page to confirm the objective + remaining event(s) persist (round-tripped through `GET /api/season`).
4. Trigger a client-side validation error: add a row, leave its Name blank, click "Save" — confirm the exact `validateSeasonPlanInput` error message ("Event name is required.") appears with no network request needed (check the browser's network tab shows no `/api/season` PUT fired for this attempt).
5. Confirm the existing Nutrition formula section still saves independently and correctly (its own Save button, unaffected by any Season-section interaction) — a quick regression check that the two forms' state didn't get tangled.

Report each check's outcome; if step 7.1's empty-state assumption is wrong (i.e. `data/season-plan.json` already has content from earlier testing this session), that's fine — just confirm the form seeds correctly from whatever `GET /api/season` actually returns, and adjust the manual steps accordingly.

- [ ] **Step 8: Commit**

```bash
git add components/AthleteProfileForm.tsx
git commit -m "feat(season): add Season objective + event-entry section to Athlete Profile"
```

---

## Self-Review

**1. Spec coverage** (against `docs/superpowers/specs/2026-07-01-season-event-entry-ui-design.md`):
- §3 Placement (Section above Nutrition formula, no synced/editHref badge, independent save state) → Step 5 + Global Constraints. ✓
- §4 Data flow (independent `/api/season` fetch, controlled add/edit/remove, validate-then-PUT-then-refetch) → Steps 2–4. ✓
- §5 Inputs (native `date`/`select`) → Step 5 JSX. ✓
- §6 Edge cases (empty state, clearing all events, no re-plan trigger needed, no new validation) → covered by construction (no code path forces a minimum event count or triggers generation) + Step 7.1/7.4 manual checks. ✓
- §7 Testing (no new pure logic, no component test, `tsc` + manual check) → Steps 6–7. ✓

**2. Placeholder scan:** No TBD/TODO; every step has complete, runnable code. ✓

**3. Type consistency:** `SeasonEvent`/`SeasonPlan` imported once (Step 1) and used identically in state (Step 2), the effect (Step 3), the handlers (Step 4), and the JSX (Step 5) — no renamed fields, no drift from `lib/types.ts`'s actual shape (`name`/`date`/`priority`). `validateSeasonPlanInput`'s return type (`{ objective, events } | string`) is handled with the exact `typeof parsed === "string"` guard the function's own signature requires. `seasonSaveState` uses the pre-existing `SaveState` type verbatim — no new save-state shape invented. ✓
