# NodeVelo — live punch-list

Short-lived tracker for **incoming bugs and feedback** — things to action soon, not strategy.
Keep it lean: when an item ships, move its one-line record to [ARCHIVE.md](ARCHIVE.md).

- **What's next / strategy** → [ROADMAP.md](ROADMAP.md)
- **Completed work** → [ARCHIVE.md](ARCHIVE.md)
- **Research spikes** → [research.md](research.md)

**Legend** — Status: ☐ todo · ◑ partial · ☑ done · Priority: P1 correctness/data-integrity ·
P2 high-value UX/feature · P3 polish/education · Type: `bug` `ux` `feat` `audit` `edu`

---

## Open

**CR-2026-06-24 — xhigh code-review sweep of the Jun-23 logic commits + the a11y pass.** 15 findings,
verified against source. Act top-down; P1 = data-integrity, fix first.

### P1 — data-integrity (act first)

- ☑ P1 `bug` **LEDGER-1** — SYNC-2 rebuild could reclassify pre-current-block planned rides as off-plan
  (`buildRideScores` knows only the current block; block history keeps no per-day plan, so it can't be
  reconstructed). **Audit: live ledger clean** — only one block has ever existed (all 8 planned entries
  fall inside it; the 100 pre-block rides are legitimately legacy), so the rebuild caused 0 downgrades. It
  was a latent landmine (detonates on the first rebuild after a 2nd block exists). **Fix:** new
  `mergeScoreLogRebuild` guarantees a rebuild never downgrades a frozen `planned` entry to off-plan; wired
  into the rebuild branch. Off-plan/current-block/new dates still re-score. 6 tests added.
  _[score-log.ts](lib/score-log.ts) · [sync/route.ts:267](app/api/sync/route.ts:267)._
- ☑ P1 `bug` **SET-1** — settings PUT silently dropped `strainBands` / `durabilityInsertEnvelope` /
  `athleteStateWeights` (rebuilt `updated`, only re-attached `acwrBands` + `tsbModifierEdges`; full-overwrite
  wiped the rest every save). **Fix:** all three now accept+clamp via their resolvers and preserve-when-omitted
  — `strainBands` + `durabilityInsertEnvelope` in SET-1, `athleteStateWeights` accept block added with CAL-1
  once its resolver clamped. 6 route tests. _[settings/route.ts](app/api/settings/route.ts)._
- ☑ P1 `bug` **LEDGER-2** — SYNC-2 rebuild dropped frozen `formState`/`morningCheck` provenance for rides
  older than the fresh wellness window (`fresh` won the merge with `formState:undefined`, deleting
  correlation-engine data points). **Fix:** `mergeScoreLogRebuild` now carries forward any context stamp
  the re-scored `fresh` entry lacks (a fresh stamp still wins when present; context-free stays context-free).
  3 tests added. _[score-log.ts](lib/score-log.ts)._
- ☑ P1 `audit` **LEDGER-3** — `rebuildLedger` was an unguarded destructive boolean on the hot sync route
  that re-ran on every sync if set. **Fix:** persisted one-shot marker (`ledger-rebuild.json`) + pure
  `shouldRebuildLedger(requested, alreadyRebuilt, force)` predicate — a normal sync never rebuilds, a repeat
  request is refused once the marker is set, and `force:true` is the explicit re-run path. (Kept on the sync
  trigger by design: the rebuild needs fresh-sync-derived state — calibration/ftpForDate/context — so a
  standalone endpoint would just re-run a sync; the guard is the right-depth fix.) 4 predicate tests added.
  _[sync-ledger.ts](lib/sync-ledger.ts) · [sync/route.ts:158](app/api/sync/route.ts:158)._
- ☑ P1 `bug` **CAL-1** — `resolveAthleteStateWeights` was the only resolver with no clamp/ordering, so an
  extreme override could disable the lived-fatigue safety cap at [athlete-state.ts:122](lib/athlete-state.ts:122).
  **Fix:** a per-leaf `ATHLETE_STATE_WEIGHT_BOUNDS` spec + `clampLeaves` walker bounds every leaf; key
  safety invariants — `override.scoreCap` ≤70 (stays below the 80+ "primed" band) and `override.livedThreshold`
  ≤3 (only 3 lived signals exist, so the cap stays reachable); scales pinned ≥0 and ACWR optimal/danger
  sign-locked so polarity can't invert; `tsb.freshAbove` order-enforced above `deepBelow`. Resolver is the
  single chokepoint (sync + coach-snapshot both route through it). Settings PUT now accepts the override.
  5 tests added. _[calibration.ts:238](lib/calibration.ts:238)._ Deeper schema-driven unification = CAL-2.

### P2 — correctness, lower urgency / latent

- ☑ P2 `bug` **CAL-3** — durability envelope split-brain fixed: `validateSchedule` now resolves the
  durability envelope once and threads `embeddedHardPct` through `isHardDay`→`carriesEmbeddedIntensity`, so
  spacing agrees with `validatePlanProtocol` on what counts as an embedded effort. 1 test added.
  _[schedule-validate.ts](lib/schedule-validate.ts)._
- ☑ P2 `bug` **API-1** — added `numPos` (treats a present-but-zero power reading as absent), used for the
  activity `normalizedPower` and interval `npWatts`, so a 0-watt weighted-avg no longer short-circuits the
  `??` and forces IF=0. 1 test added. _[intervals-api.ts:210](lib/intervals-api.ts:210)._
- ☑ P2 `bug` **API-2** — added `numLoose` (accepts a numeric string), used for `decoupling`, so a
  string-serialised value is no longer silently dropped. Safe no-op when the API sends a number (the real
  payload does). 1 test added. _[intervals-api.ts:218](lib/intervals-api.ts:218)._
- ☑ P2 `feat` **FUEL-1** — `fuelStampFor` now keeps an explicitly-logged `0g` ride (`grams < 0` drop, not
  `<= 0`): unlogged stays `null`→absent, fasted stays `0`→a real data point for the Track-C correlation.
  `RideScoreEntry.fuel` has no consumer yet, so no behavioural ripple. _[score-log.ts:46](lib/score-log.ts:46)._

### P3 — altitude / cleanup / a11y polish

- ☑ P3 `audit` **CAL-2** (scoped) — hoisted the duplicated finite-guard `pick` to one module-level helper in
  [calibration.ts](lib/calibration.ts); the four band resolvers now share it. The full schema-driven
  unification was **deliberately not done**: the resolvers' ordering rules are heterogeneous (ACWR nudges
  up, strain nudges the lower band down, durability nudges the ceiling, TSB chains ascending), so a generic
  resolver is ~as complex as the four, and CAL-1 already closed the bug this was tied to — marginal gain vs
  regression risk on tested scoring code.
- ☑ P3 `audit` **A11Y-1** — **detector rule** (`muted-contrast` in [detect.mjs](prototypes/impeccable-audit/detect.mjs))
  flags `text-zinc-400` used as a light-mode color (≈2.6:1 on white, under AA) while passing the correct
  `text-zinc-500 dark:text-zinc-400`. **Sweep done:** every genuine bare usage across 14 components swapped to
  the AA pattern (`text-zinc-500 dark:text-zinc-400`; the two `dark:text-zinc-600` tiers kept their dark tier),
  including the close-× control and empty-state placeholders. Detector now reports 0 muted-contrast.
- ☑ P3 `bug` **A11Y-2** + `ux` **UI-1** — fixed together: extracted `BAND_COLOR`/`DIR`/`driverEffectClass`
  into [athlete-state-ui.tsx](components/athlete-state-ui.tsx); both StateDriversCard and AthleteStateCard
  import it, so the duplicated band/effect logic (which drifted and left the bare-`text-zinc-400` neutral
  arm in two places) is gone and the neutral arm is now `text-zinc-500 dark:text-zinc-400` (AA) in one place.
- ☑ P3 `bug` **CAL-4** — exported `DECOUPLING_GOOD_BOUNDS` from [calibration.ts](lib/calibration.ts);
  `deriveDecouplingGood`, the calibration route, and the CalibrationPanel input/validation all share it.
- ☑ P3 `ux` **UI-2** — `CalibrationPanel.submit` now validates the `DECOUPLING_GOOD_BOUNDS` range, not just
  finiteness, so an out-of-range entry shows the error instead of being silently server-clamped.
  _[CalibrationPanel.tsx](components/CalibrationPanel.tsx)._

_Prior 2026-06-23 sync triage (SYNC-1, NP/decoupling map, SYNC-2, SYNC-3) shipped/closed → [ARCHIVE.md](ARCHIVE.md).
Note: this sweep found LEDGER-1/2/3 are regressions in SYNC-2 itself._

Add new bugs/feedback here as they come in; strategy → [ROADMAP.md](ROADMAP.md).

_Design/judgment calls that surfaced during the CR sweep now live in [ROADMAP.md](ROADMAP.md): power-zone
SoT vs personal override; the "Z2 dialed-in" overstatement; Recent-Baselines content / TSS-vs-Load naming;
whether IF should be replaced rather than annotated; CR-C observability (P8); CR-F per-carb checks (Track C)._
