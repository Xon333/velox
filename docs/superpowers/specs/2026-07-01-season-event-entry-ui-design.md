# Season Event Entry UI — Design

**Date:** 2026-07-01
**Status:** ✅ Shipped 2026-07-01 — see [ARCHIVE.md](../../../ARCHIVE.md)
**Follows:** [2026-07-01-macro-periodization-design.md](2026-07-01-macro-periodization-design.md) (MACRO-1) — closes the gap it left: `SeasonPlan.objective`/`events` are athlete-owned intent, already persisted by `PUT /api/season`, but nothing in the UI lets the athlete set them.

---

## 1. Problem & context

The just-shipped Macro Periodization feature added `SeasonPlan { objective, events, periods, updatedAt }` and a working `/api/season` GET/PUT, and `SeasonRoadmap.tsx` on `/plan` already *displays* an event flag when one exists. But there is no form anywhere to actually create or edit an event — `objective`/`events` can only be set via a raw PUT request. Until this ships, the event-anchored engine mode (Task 5 of the periodization plan — the backward taper/peak/build schedule) can never activate for a real athlete, because nothing ever writes a `SeasonEvent`.

## 2. Goals / non-goals

**Goals**
- A form to set the season `objective` (free text) and manage a list of `SeasonEvent`s (name, date, priority A/B/C) — add, edit, remove.
- Reuse the existing `/api/season` GET/PUT and the existing `validateSeasonPlanInput` validator — no new backend surface.
- Match this codebase's established form conventions exactly (the Nutrition formula section in `AthleteProfileForm.tsx`) rather than inventing a new UI pattern.

**Non-goals**
- Triggering a re-plan from this form. Saving `objective`/`events` is enough — the next `POST /api/generate` already re-plans and will route into event mode the moment a future A-event exists (Task 9's existing wiring).
- Any new validation rules beyond what `validateSeasonPlanInput` already enforces (e.g. no "only one A-event" rule, no minimum event count).
- A dedicated component test — matches this codebase's convention that React components aren't unit-tested (only pure `lib/*` logic is), and this form introduces no new pure logic.

## 3. Placement

A new `<Section title="Season">` card in `components/AthleteProfileForm.tsx`, positioned directly above the existing "Nutrition formula" section (grouping the two owned-intent, inline-edited forms together, below the synced/derived cards — Rider profile, Power PRs). No `synced` badge, no `editHref` — edited inline, like Nutrition formula, not via the Knowledge Base markdown editor (which owns free-text goals/weakpoints/PRs instead).

This is a second, fully independent form on the same page: its own local state (`objective`, `events`), its own `seasonSaveState`, its own **Save** button, and its own fetch/save cycle — entirely separate from the Nutrition formula section's existing `nut`/`saveState`/Save button. Saving Season never touches Nutrition's fields or vice versa.

## 4. Data flow

**Load:** on mount, alongside the existing `/api/profile` fetch, add an independent fetch to `/api/season` (`api<{ plan: SeasonPlan }>("/api/season")`) — the exact same call `SeasonRoadmap.tsx` already makes from a different page. Seeds two new pieces of local state:
```ts
const [objective, setObjective] = useState("");
const [events, setEvents] = useState<SeasonEvent[]>([]);
const [seasonSaveState, setSeasonSaveState] = useState<SaveState>({ state: "idle" });
```
(`SaveState` is the type already defined in this file for the nutrition form; reused as-is.) The card renders after the page's existing "Loading…" gate resolves — no separate empty-state to design.

**Edit (client-side only, until Save):**
- Objective: a single controlled text input.
- Events: each row is controlled (`events.map((e, i) => i === idx ? { ...e, field: val } : e)`), same array-of-objects update pattern the nutrition fields already use.
- "+ Add event" appends `{ name: "", date: "", priority: "B" }` — defaults to **B**, not A, so clicking Add twice doesn't silently create a second A-race.
- Each row has a "×" remove button (removes by index).

**Save:**
1. Call `validateSeasonPlanInput({ objective, events })` (imported directly from `lib/season.ts` — it's pure, no Node-only APIs, safe to call client-side).
2. If it returns a string, set `seasonSaveState = { state: "error", message: <that string> }` and stop — **no network call** for an obviously invalid input, mirroring how the nutrition form pre-validates before ever hitting the network.
3. If it returns the parsed object, `PUT /api/season` with `{ objective, events }`, using the same `idle → saving → saved` transitions the nutrition form already uses.
4. On success, re-fetch `/api/season` and reseed `objective`/`events` from the response — mirrors the nutrition form's existing "save then refetch" pattern, and confirms the engine-owned `periods` array (never sent by this form) survived untouched.
5. On a network/server failure, `catch (err) { setSeasonSaveState({ state: "error", message: err instanceof Error ? err.message : "Save failed" }) }` — identical to the nutrition form's catch block.

## 5. Inputs

- **Date:** native `<input type="date">` per event row. Its value is already `YYYY-MM-DD`, exactly what `validateSeasonPlanInput` and the API expect — no parsing/formatting layer, mirroring nutrition's use of native `<input type="number">`.
- **Priority:** a plain native `<select>` with options A/B/C — no custom dropdown component exists elsewhere in this codebase to match against.

## 6. Edge cases

- **Empty state** (no objective, zero events): renders the objective field, an empty list, and "+ Add event." `{ objective: "", events: [] }` is a valid save.
- **Clearing all events:** allowed — no minimum-event rule (e.g. a cancelled race).
- **First A-event added:** no special handling needed here — the next block generation re-plans and activates the dormant event-anchored engine mode automatically (Task 9's existing best-effort wiring).
- **Multiple A-events / past-dated events:** no new validation added — the engine's existing (accepted) behavior of picking the first future A-event by array order, and ignoring past-dated events, is unchanged and out of scope for this form.
- **No cap** on the number of events in the list.

## 7. Testing

No new pure logic is introduced — this form wires already-tested functions (`validateSeasonPlanInput`, the existing `/api/season` GET/PUT) to controlled inputs. Per this codebase's established convention (confirmed throughout the periodization feature: `SeasonRoadmap.tsx` has no component test), no dedicated component test is added. Verification is `npx tsc --noEmit` (the form must compile cleanly) plus a manual check that add/edit/remove/save round-trips correctly against a running dev server.

## 8. Pillar alignment

- **Two-memory split (pillar 3):** `objective`/`events` are owned intent, edited by the athlete, never derived — consistent with how nutrition settings and goals/weakpoints are already split from synced physiology.
- **Deterministic core:** no new logic beyond reusing the already-pure `validateSeasonPlanInput`; the form is a thin wiring layer.
- **Local-first:** no new persistence — reuses `data/season-plan.json` via the existing route.

## 9. Out of scope (this pass)

- Triggering an immediate re-plan/preview from this form.
- A dedicated `/settings`-style page for events (Profile houses it, per approved placement).
- Any UI warning about multiple A-events or the engine's array-order tie-break (tracked as existing, accepted debt from the periodization feature).
