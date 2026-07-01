# Season/Block Hierarchy — Design

**Date:** 2026-07-01
**Status:** Approved design (pre-implementation)
**Follows:** [2026-07-01-macro-periodization-design.md](2026-07-01-macro-periodization-design.md) (MACRO-1/2/3) and
[2026-07-01-season-event-entry-ui-design.md](2026-07-01-season-event-entry-ui-design.md) — closes the gap surfaced
right after those shipped: Season and Block generation are two independent "what am I training for" inputs with
no connection between them, `SeasonPlan.objective` is written but never read anywhere, and the athlete has no
visibility into *why* a block was pre-filled the way it was.

---

## 1. Problem & context

Four surfaces currently answer "what am I training for," with no hierarchy between them:

| Surface | Feeds generation? |
|---|---|
| Goals + Weakpoints (`athlete_profile.md`, Knowledge Base) | Yes — KB context every generation |
| Per-block goal + weakpoints (`BlockGenerator` on `/plan`) | Yes — `BlockParams.goal`/`weakpoints`, shapes the prescription |
| Season objective (`/profile`'s Season card) | **No** — confirmed by direct inspection of `formatSeasonContext`, which reads `phase`/`focus`/week-count/`targetWeeklyTss`/`rationale` only |
| Season events | Yes — drives phase/focus selection + the `SEASON CONTEXT` prompt line |

Concretely: `PlanView.tsx:27` still hardcodes `useState<2 | 4>(4)` and `BlockGenerator.tsx` only renders `[2, 4]`
length buttons — even though `BlockParams.lengthWeeks`'s *type* was widened to `2 | 4 | 6 | 8` when the macro
periodization engine shipped, there is currently no way to actually generate a 6- or 8-week block from the UI.
The block-goal textarea pre-fills from **every** Goal verbatim regardless of what the season is currently
building toward, and nothing in the generator tells the athlete why the length/goal fields hold what they do.

## 2. Goals / non-goals

**Goals**
- Season is the bigger-scope "why" (general objective + planned events); Block generation stays
  specific (concrete, athlete-written text for this block), with its defaults now *informed* by Season.
- Block length pre-fills from the current focus period's remaining weeks, still freely overridable.
- The block-goal pre-fill narrows to Goals relevant to the current season focus, instead of showing everything.
- The Season → Block connection becomes visible in the generator itself, not just inferable from the roadmap.
- `SeasonPlan.objective` becomes load-bearing — read by the same formatter that already builds the LLM's
  season-context line.

**Non-goals**
- Weakpoints pre-fill is unchanged — it answers a different question (skills, not physiological systems)
  and forcing a mapping onto Season's 6-value focus vocabulary would be artificial.
- No mechanical/keyword-based goal classification — see §3 for why this was rejected in favor of explicit tagging.
- No change to the athlete's ability to freely edit/override any pre-filled field — this only changes defaults.
- No change to `replanSeasonArc`, `draftSeasonArc`, or any other already-shipped season-engine logic.

## 3. Approach: explicit Focus tagging over keyword matching

Goals are free text (`"FTP" → "300W"`, `"Local performance" → "Hill KOMs in Novo Mesto area, Slovenia"`) and
Season focus is a fixed 6-value enum (`aerobic-base | threshold | vo2max | anaerobic | durability | sharpen`).
Rejected: mechanical keyword matching (e.g. "FTP"/"threshold" → `threshold`) — some goals ("Racing", "Local
performance") have no physiological-system reading at all, so a keyword approach needs an ambiguous fallback and
can silently hide a goal a keyword miss should have shown. This app's whole pattern is athlete-owned, explicit,
deterministic data over guessed mappings (the same reasoning behind the two-memory split, the KB-grounded season
constants, and every other owned-intent field) — so goals are explicitly tagged once, by the athlete, in the same
place they're already written.

## 4. Data model

**Goals table gains an optional third column** in `knowledge-base/athlete_profile.md`:

```markdown
## GOALS

| Goal | Target | Focus |
|------|--------|-------|
| FTP | 300W | threshold |
| 1-minute power | 600W | anaerobic |
| 5-second power | 1000W | anaerobic |
| Durability | Sustain power on 3h+ rides | durability |
| Local performance | Hill KOMs in Novo Mesto area, Slovenia | general |
| Racing | Begin competing at amateur level | general |
```

Values: the six `SeasonFocus` strings, or `general` for goals not tied to one physiological system. **Fully
backward compatible** — `parseRows()` (`lib/kb-loader.ts:50-56`) already filters rows by `row.length >= 2`, so
existing two-column rows simply have `r[2]` undefined; no migration is required, and untagged goals behave as
`general` (always shown, never hidden).

`AthleteMdSnapshot`'s `goals` field (`lib/kb-loader.ts:17`) widens from `Array<{ goal: string; target: string }>`
to `Array<{ goal: string; target: string; focus: SeasonFocus | "general" }>`. `parseAthleteMd()`'s goal-mapping
(`lib/kb-loader.ts:96-99`) reads `r[2]`, validates it against the known `SeasonFocus` values ∪ `"general"`, and
falls back to `"general"` for anything absent or unrecognized (a typo never throws or drops the goal — it just
becomes untagged). This is purely additive to the type; the three existing consumers (`PlanView.tsx`,
`AthleteProfileForm.tsx`, `dashboard/plan.tsx`) only read `.goal`/`.target` today and are unaffected.

**`SeasonPlan.objective` becomes load-bearing.** `formatSeasonContext` (`lib/season.ts:245-252`) prepends
`plan.objective` (when non-empty) to the string it already builds:
```
"get faster: FTP + punch for hilly KOMs — phase build · focus vo2max · wk 2 of 4 · target ~450 TSS/wk. Build vo2max — your most depressed system relative to your engine."
```
This single string is both what's injected into the generation prompt (unchanged call site — `formatSeasonContext`
is already wired into `app/api/generate/route.ts`) and what the new generator readout displays (§6) — one source,
two audiences, mirroring how `CoachSnapshot` already ensures the athlete sees what the LLM sees.

## 5. Block length pre-fill

New pure function in `lib/season.ts`:
```ts
export function suggestedBlockWeeks(period: FocusPeriod, today: string): 2 | 4 | 6 | 8
```
Computes weeks remaining in the period (`plannedWeeks` minus elapsed weeks since `startDate`, via the existing
`weeksBetween`/`addWeeks` helpers), then **rounds up (ceiling) to the smallest allowed value in `{2, 4, 6, 8}`
that is ≥ the remaining weeks** — e.g. 1 or 2 remaining → 2; 3 or 4 remaining → 4; 5 or 6 remaining → 6; 7+
remaining → 8 (capped, never higher). Ceiling (not nearest/floor) is deliberate: it means the suggested block
always covers *at least* the rest of the current period rather than leaving a stray week neither covered by
the block nor by a full next period — consistent with "the block is allowed to run past the period boundary"
being the already-accepted case (the three-bucket re-plan handles a block crossing into the next period
gracefully, per the macro-periodization design).

**Wiring:** `PlanView.tsx`'s `lengthWeeks` state widens from `useState<2 | 4>(4)` to `useState<2 | 4 | 6 | 8>(4)`,
seeded from `suggestedBlockWeeks(currentPeriod, today)` in the same effect that fetches `/api/season` (no new
network call — this feature already needs that fetch for §6's goal filter and readout).
`BlockGenerator.tsx`'s length buttons expand from `([2, 4] as const)` to `([2, 4, 6, 8] as const)`.

**Degradation:** no season plan / no current period → falls back to the existing static default of 4 weeks,
identical to today's behavior — a first-time athlete sees no change.

## 6. Goal pre-fill filtering + the context readout

New pure function in `lib/season.ts`:
```ts
export function filterGoalsByFocus<T extends { focus: SeasonFocus | "general" }>(
  goals: T[],
  seasonFocus: SeasonFocus | null
): T[]
```
Returns goals whose `focus` matches `seasonFocus`, plus every `general`-tagged goal (always included — they're
not tied to any one period). When `seasonFocus` is `null` (no current period), returns every goal unfiltered —
byte-identical to today's behavior.

**Wiring:** `PlanView.tsx:73`'s goal-textarea seed (currently `md.goals.map(...).join("\n")` — every goal) changes
to seed from `filterGoalsByFocus(md.goals, currentPeriod?.focus ?? null)`. The `"from profile; edit to override"`
placeholder stays accurate — this only narrows what's pre-filled; nothing about override behavior changes.
Weakpoints (`weakpointsText`) is untouched — unfiltered, exactly as today.

**The readout.** A small read-only line in `BlockGenerator.tsx`, above the length/goal/weakpoints fields, built
from the same `formatSeasonContext` string (§4) fetched alongside the season plan:
```
Season: get faster: FTP + punch for hilly KOMs — build · vo2max (your weakest system) · wk 2 of 4 · target ~450 TSS/wk
```
This is the direct answer to "the process is hard to understand" — the athlete sees the reasoning right where
the length/goal pre-fills land, not just their effect.

## 7. Edge cases & degradation

- **No season plan / no current period:** length falls back to 4, goal falls back to unfiltered (today's exact
  behavior), readout line doesn't render. Zero regression for an athlete who hasn't touched Season yet.
- **A goal tagged with a typo'd/unrecognized Focus value:** falls back to `general` (always shown), never
  throws, never silently drops the goal.
- **Readout fetch failure:** best-effort — the line simply doesn't render, no error banner (mirrors how the
  Season section on `/profile` and `SeasonRoadmap` already degrade on a fetch failure).
- **Override behavior unchanged:** every pre-filled field remains freely editable; this feature only changes
  *defaults*, never what can be typed or submitted.
- **A period with no matching + no `general` goals:** the textarea pre-fills **empty**, not "show everything" —
  an honest signal ("nothing written for this focus yet") rather than a silent fallback that would mask the gap.

## 8. Testing

New pure logic gets Vitest coverage (unlike the event-entry UI pass, which added none):
- `suggestedBlockWeeks`: exact-match boundaries (2/4/6/8), snapping between allowed values, flooring below 2.
- `filterGoalsByFocus`: focus match included; `general` always included; `null` season focus returns everything
  unfiltered; no match and no `general` returns empty.
- `parseAthleteMd`'s extended Focus-column parsing (in its existing test file): a tagged goal parses correctly;
  an untagged (2-column) goal defaults to `general`; an unrecognized value falls back to `general` rather than
  throwing.

No new component tests — matches this codebase's established convention (`SeasonRoadmap.tsx`, the event-entry UI,
neither has one). The `BlockGenerator`/`PlanView` wiring is thin glue over already-tested pure functions;
verification there is `tsc --noEmit` plus a manual dev-server check, same as the event-entry UI pass.

## 9. Pillar alignment

- **Two-memory split (pillar 3):** the Focus tag is athlete-authored, hand-edited intent — never inferred or
  recomputed, same as every other Goals-table field.
- **Deterministic core:** `suggestedBlockWeeks`/`filterGoalsByFocus` are pure functions; no LLM involvement in
  either decision.
- **"Athlete sees what the LLM sees":** `formatSeasonContext`'s single string now serves both the generator
  readout and the generation prompt — no divergent copies.
- **Local-first:** no new persistence; extends the existing `athlete_profile.md` table and reuses `/api/season`.

## 10. Out of scope (this pass)

- Any UI to edit the Focus tag from `/profile` or `/knowledge` directly (still edited in the raw markdown table,
  same as Goals/Weakpoints today).
- Locking block length to the season period (rejected in favor of suggested-not-locked, per the approved design).
- Filtering Weakpoints by season focus (rejected — different axis, no natural mapping).
- Any change to how `draftSeasonArc`/`replanSeasonArc` themselves compute periods.
