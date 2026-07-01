# Goals/Weakpoints Centralization + Form — Design

**Date:** 2026-07-01
**Status:** ✅ Shipped 2026-07-01 — see [ARCHIVE.md](../../../ARCHIVE.md)
**Follows:** [2026-07-01-season-block-hierarchy-design.md](2026-07-01-season-block-hierarchy-design.md) (§4
depends on this spec's data model) — raised when discussing how Goals/Weakpoints, Season, and Block generation
should relate; the athlete's own call was that hand-editing a markdown table was never the intended long-term
UX (`athlete_profile.md` was a bootstrap headstart, not a commitment to keep editing goals through a file that
changes over time), and the file/UI shouldn't hold two divergent copies of data that changes.

---

## 1. Problem & context

Goals and Weakpoints currently live only in `knowledge-base/athlete_profile.md`'s markdown tables, parsed by
`parseAthleteMd()` into `AthleteMdSnapshot.goals`/`weakpoints`. Editing means hand-writing markdown table syntax
in the Knowledge Base editor — the "wrong medium" for structured, frequently-changing data (confirmed: this is
purely an editing-ergonomics complaint, not a discoverability/sequencing one).

A genuinely useful finding while grounding this: `AthleteProfile` (`athlete.json`, via `readAthleteProfile`/
`writeAthleteProfile`) **already declares** `goals: string[]` and `weakpoints: string[]` fields — but they're
never populated (`DEFAULT_PROFILE` is always empty) and the only function that ever wrote them back to markdown,
`athleteProfileToMarkdown`/`writeAthleteProfileMd` (`lib/kb-loader.ts:343,388`), is confirmed **dead code** —
zero callers anywhere in the codebase. This is vestigial from an earlier, superseded design (its own comment:
*"athlete.json is the source of truth; this regenerates athlete_profile.md so the two stay in sync"* — the
opposite of the current architecture, where the file is hand-edited and read via `parseAthleteMd`).

A second finding, material to this design: `loadKnowledgeBaseContext()` (`lib/kb-loader.ts:264-275`) inlines
the **raw** content of every knowledge-base `.md` file verbatim (stripping only Obsidian syntax) into every
generation prompt — independent of whatever `parseAthleteMd()` structurally parses. So simply migrating the
*parsed* Goals/Weakpoints elsewhere, while leaving the *raw markdown tables* physically in the file, would leave
stale, frozen goals silently leaking into every future generation prompt forever, contradicting the entire
point of centralizing them.

## 2. Goals / non-goals

**Goals**
- Widen the existing (dead) `AthleteProfile.goals`/`weakpoints` fields to a structured shape; delete the two
  confirmed-dead functions as part of the same change.
- One-time, automatic, lossless migration from the current markdown content — no manual re-entry.
- A proper add/edit/delete form on `/profile`, mirroring the just-shipped Season section's pattern exactly.
- Guarantee generation only ever sees the fresh, JSON-sourced Goals/Weakpoints — never a stale markdown copy.
- Never auto-edit the athlete's `athlete_profile.md` file.

**Non-goals**
- No change to the Focus-tagging *semantics* from the hierarchy spec (still the six `SeasonFocus` values ∪
  `general`) — only where the field lives changes.
- No UI to edit any *other* `athlete_profile.md` content (personal data, power profile, PRs) — those stay
  markdown-only, unaffected.
- No re-triggering of migration once it's run once, even if the athlete later clears all goals to empty.

## 3. Data model

`AthleteProfile` (`lib/types.ts:42-48`) widens:
```ts
export interface AthleteProfile {
  performance: PerformanceData;
  goals: Array<{ goal: string; target: string; focus: SeasonFocus | "general" }>; // was string[]
  weakpoints: Array<{ weakpoint: string; detail: string }>; // was string[]
  nutrition: NutritionSettings;
  goalsMigratedAt: string | null; // ISO timestamp once migration has run; new field
  updatedAt: string;
}
```
`DEFAULT_PROFILE` sets `goals: []`, `weakpoints: []`, `goalsMigratedAt: null` as before (an empty profile is
still valid — no migration needed for a brand-new athlete with nothing in the file either).

**Cleanup (targeted, in-scope):** delete `athleteProfileToMarkdown` and `writeAthleteProfileMd`
(`lib/kb-loader.ts:343-395`, confirmed zero callers) — dead code from a superseded design, safe to remove as
part of touching this exact area.

**`parseAthleteMd()` stops parsing GOALS/WEAKPOINTS sections.** `AthleteMdSnapshot.goals`/`weakpoints`
(`lib/kb-loader.ts:17`) are removed from the type entirely; `parseAthleteMd()` no longer extracts those two
sections (personal data, power profile, PRs parsing is untouched).

## 4. One-time migration

**Trigger:** on the first `readAthleteProfile()` call where `profile.goalsMigratedAt === null`.

**Why a dedicated flag, not "is the array empty":** if migration were keyed on emptiness, an athlete who
later deletes every goal through the new form (a legitimate, intentional action) would have their empty list
silently repopulated from the (now-stale) markdown content on the next load — a real bug this flag prevents.
Once `goalsMigratedAt` is set, migration never runs again, regardless of what the JSON store or the file
contain afterward.

**Mechanism:** `readAthleteProfile()` (`lib/data-store.ts:32-49`) — which already overlays synced physiology
onto the stored profile — gains one more step, run only when `goalsMigratedAt` is null:
1. If `profile.goals`/`weakpoints` are ALREADY non-empty (an inconsistent state that shouldn't normally arise,
   since nothing else writes them before migration, but guarded against defensively), skip parsing entirely —
   existing data always wins, never gets overwritten — and just set `goalsMigratedAt` to now.
2. Otherwise, call the (still-present, unrelated) markdown-parsing logic *one time* to read whatever
   Goals/Weakpoints currently exist in `athlete_profile.md` (reusing the same table-parsing primitives
   `parseAthleteMd` used, scoped down to just those two sections since the rest of `parseAthleteMd` is
   unaffected and still needed for personal/power data), seed `profile.goals`/`weakpoints` from that parse, and
   set `goalsMigratedAt` to now.

Either branch persists via `writeAthleteProfile` before
returning. Idempotent by construction — the flag check happens before any parsing work.

## 5. Generation-prompt freshness

`loadKnowledgeBaseContext()` (`lib/kb-loader.ts:264-275`) gains a targeted change: when concatenating
`athlete_profile.md` specifically, it strips the `## GOALS` and `## WEAKPOINTS` sections from the raw text
before inlining it (reusing `extractSectionText`'s section-boundary logic in reverse — strip rather than
extract). The athlete's file itself is **never written to** by this step; only the in-memory string handed to
the LLM is affected.

A new `goalsContext`/`weakpointsContext` string, built from the JSON-sourced `AthleteProfile.goals`/
`weakpoints`, is injected into the generation prompt separately — same pattern as the existing `seasonContext`/
`powerProfileContext` dynamic-context blocks in `app/api/generate/route.ts`. This guarantees the LLM only ever
sees what the athlete most recently saved through the form, never a frozen markdown snapshot.

## 6. Form UI

Replaces `AthleteProfileForm.tsx`'s current read-only Goals/Weakpoints `Section` (which shows
`athleteMd.goals`/`weakpoints` plus an "Edit → /knowledge" link) with two editable row-lists — the exact
add/edit/delete/Save pattern the just-shipped Season section already established:
- **Goals:** goal (text), target (text), focus (a `<select>` over the six `SeasonFocus` values + `general`).
- **Weakpoints:** weakpoint (text), detail (text) — no Focus tag; Weakpoints stays on its own axis (confirmed
  in the hierarchy spec — no natural mapping to physiological focus).

Own independent Save button/state (not shared with Nutrition's or Season's), same `idle/saving/saved/error`
pattern. `PUT /api/profile` extends to accept `goals`/`weakpoints` alongside the existing `nutrition` body.

**Consumers updated:** `PlanView.tsx` (goal/weakpoints pre-fill — per the hierarchy spec's §6 wiring, now reads
`AthleteProfile.goals`/`weakpoints` instead of `athleteMd.goals`/`weakpoints`), `dashboard/plan.tsx` (its
read-only goals display). Both are mechanical field-source rewires — neither component's fetch call changes,
since `/api/profile`'s response already carries the full `AthleteProfile`.

## 7. Edge cases & degradation

- **First-ever load with an empty file and empty JSON store:** migration runs, finds nothing, sets the flag,
  proceeds with empty arrays — identical to today's "no goals yet" state.
- **A goal's Focus value becomes invalid** (e.g. hand-edited JSON, or a future `SeasonFocus` removed): the form
  and `filterGoalsByFocus` both treat an unrecognized value as `general` — never throws, never drops the goal.
- **`goalsMigratedAt` is null but `goals`/`weakpoints` are already non-empty** (an inconsistent state that
  shouldn't arise given the flag-gated trigger, but guarded defensively) — covered by §4's step 1: existing
  data always wins, the markdown parse is skipped, only the flag gets set.
- **The markdown file's GOALS/WEAKPOINTS tables are left physically in place**, per the decided approach —
  they become inert historical text, visible if the athlete opens the file directly, but never read by the
  app again after migration (confirmed not re-parsed, confirmed stripped from the KB context).

## 8. Testing

New pure logic gets Vitest coverage:
- The migration seeding logic: a fresh (`goalsMigratedAt: null`) profile with markdown content seeds correctly
  and sets the flag; a profile with the flag already set never re-parses even if the file changes; an empty
  file with no goals sections seeds empty arrays and still sets the flag (never retries).
- The KB-context stripping logic: a file with GOALS/WEAKPOINTS sections has them removed from the string handed
  to the LLM context; a file without those sections is unaffected; other sections (personal data, power
  profile) are never touched.
- Focus-value validation: a valid `SeasonFocus` string round-trips; `"general"` round-trips; an unrecognized
  string falls back to `"general"` rather than throwing.

No new component tests — matches this codebase's established convention.

## 9. Pillar alignment

- **Two-memory split (pillar 3), revised with the athlete's own reasoning:** Goals/Weakpoints move from
  "hand-edited markdown" to "hand-edited JSON via a form" — still fully owned, hand-authored intent, never
  derived or recomputed; only the editing medium changes, per the athlete's explicit call that the file was
  never meant to be the durable long-term editing surface for data that changes over time.
- **Deterministic core:** migration and KB-context stripping are pure/deterministic; no LLM involvement.
- **Local-first:** no new persistence — reuses the existing `athlete.json` store and `/api/profile` route.

## 10. Out of scope (this pass)

- Any UI to edit the file's other sections (personal data, power profile, PRs) — untouched, markdown-only.
- Any mechanism to re-import from markdown after the first migration (the flag is permanent by design).
- Removing the now-inert GOALS/WEAKPOINTS tables from the athlete's actual file (left as-is, per the decided
  "never auto-edit the file" approach).
