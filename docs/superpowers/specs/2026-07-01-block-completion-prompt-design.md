# Block-Completion Prompt — Design

**Date:** 2026-07-01
**Status:** Approved design (pre-implementation)
**Follows:** [2026-07-01-season-block-hierarchy-design.md](2026-07-01-season-block-hierarchy-design.md) —
raised as part of "make the season/block flow easier to understand": once a block finishes, the athlete has
no proactive nudge to generate the next one — `BlockGenerator` on `/plan` stays collapsed (`hasActiveBlock`
never turns false just because the block's dates have passed) until the athlete happens to notice and act.

---

## 1. Problem & context

`CurrentBlock` has no lifecycle beyond "exists" or "deleted" — nothing distinguishes an active, in-range block
from one whose `endDate` has already passed. `BlockGenerator.tsx`'s collapsed/expanded state is driven purely
by `hasActiveBlock` (is there a block object at all), so a finished block still renders the generator collapsed,
identical to a block with two weeks left to run. The athlete only discovers a block finished by noticing
`PlannedToday`'s "No session planned for today" message and inferring why.

## 2. Goals / non-goals

**Goals**
- A deterministic, reusable definition of "block finished."
- A proactive, high-visibility nudge on `/today` (the page the athlete already checks daily) once a block
  finishes, using this app's existing `MorningCheckIn`-style proactive-prompt precedent rather than inventing
  a new UI pattern.
- Reuse the existing empty-state slot (`PlannedToday`'s "no session" message) rather than adding new UI surface.

**Non-goals**
- No change to `BlockGenerator`/`PlanView`'s collapse behavior on `/plan` — explicitly deferred; this pass is
  the Today-side nudge only.
- No dismiss/snooze state — the prompt is persistent (re-evaluated every load) until a new block exists,
  matching how every other proactive-but-consequential signal in this app already behaves (no snooze exists
  anywhere else for something this material).
- No tie-in to whether every session in the finished block was actually logged/scored — completion is defined
  purely by date (see §3).

## 3. What counts as "finished"

A new pure predicate, alongside the other date-window helpers in `lib/types.ts` or `lib/date.ts` (whichever
already hosts comparable pure date logic — confirm at implementation time):
```ts
export function isBlockFinished(block: CurrentBlock | null, today: string): boolean {
  return block !== null && today > block.endDate;
}
```
Deliberately **date-only**, not tied to session completion/scoring — matches how every other block-timing
signal in this app already works (`weekOfBlock`, "days remaining," `daysRemaining` in `dashboard/plan.tsx`),
and avoids the alternative's real failure mode: a signal that depends on every session being logged/scored
could get stuck indefinitely behind a skipped rest day, a compromised session, or a delayed sync.

## 4. UI wiring

**Hook point:** `PlannedToday` (`components/dashboard/today.tsx`) — the component that already renders
*"No session planned for today"* whenever `block?.days.find((d) => d.date === today)` comes back null (which
is exactly what happens once `today` has moved past `block.endDate`, since `block.days` only covers the
block's actual date range). No new card, no new fetch — `CurrentBlock` is already available in app state via
`useSync()`, the same state `PlannedToday` already reads.

```tsx
export function PlannedToday({ block }: { block: CurrentBlock | null }) {
  const today = todayIso();
  if (isBlockFinished(block, today)) {
    return (
      <div>
        <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
          Your block finished on {block!.endDate} — ready to plan the next one?
        </p>
        <Link href="/plan" className="mt-2 inline-block text-sm text-cyan-700 hover:underline dark:text-[#00d4ff]">
          Generate the next block →
        </Link>
      </div>
    );
  }
  const day = block?.days.find((d) => d.date === today) ?? null;
  if (!day || day.type === "Rest") {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        {day?.type === "Rest" ? "Rest day — recover." : "No session planned for today."}
      </p>
    );
  }
  // ...unchanged
}
```
(Exact JSX/classes to be finalized against the current file at implementation time — the `Section`/typography
conventions already established elsewhere in `today.tsx` apply.)

**Persistence:** no dismiss state. The condition re-evaluates from `CurrentBlock`/`today` on every `/today`
load and naturally stops firing the moment a new block is generated and written (its `endDate` moves into the
future) — zero new bookkeeping, zero new fetch.

**Explicitly deferred:** `BlockGenerator`'s collapse behavior on `/plan` is untouched this pass — a block past
its `endDate` still renders collapsed there. The Today-side nudge is the whole fix for this round.

## 5. Edge cases & degradation

- **No block at all** (first-time athlete, or one explicitly deleted): `isBlockFinished` returns `false`
  (guarded by `block !== null`) — the existing "No session planned for today" message is unaffected.
- **A block that's still in-range**: unaffected — falls through to the existing day-lookup logic exactly as
  today.
- **A block that finished, then a new one is generated same-day**: the new block's `endDate` is in the future,
  so the very next render of `PlannedToday` (after the write completes and app state refetches) shows the new
  block's actual today-entry instead of the nudge — no special-casing needed, it's just the natural result of
  re-evaluating against fresh state.

## 6. Testing

`isBlockFinished` is pure and gets direct Vitest coverage: a block with `endDate` in the past → `true`; a block
with `endDate` today or in the future → `false`; `null` block → `false`. No new component test — matches this
codebase's established convention; `PlannedToday`'s branch is thin JSX over the tested predicate.

## 7. Pillar alignment

- **Deterministic core:** the finished-check is pure date comparison, no derived/fuzzy signal.
- **Local-first:** no new persistence, no new fetch — reuses already-loaded `CurrentBlock` app state.

## 8. Out of scope (this pass)

- `BlockGenerator`/`PlanView` auto-expand or a distinct "finished" visual treatment on `/plan` itself.
- Any snooze/dismiss mechanism.
- Tying "finished" to actual session completion/scoring rather than the date window.
