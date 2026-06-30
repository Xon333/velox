# NodeVelo roadmap

The **forward backlog — work left only.** The goal everything is measured against: **be a coaching
*layer* that fuses signals into one coherent, self-correcting athlete model — not a re-skin of
Intervals.icu.**

Companion docs: live bugs → [todo.md](todo.md) · **shipped detail** → [ARCHIVE.md](ARCHIVE.md) ·
exploratory spikes → [research.md](research.md) · how it all works → [README.md](README.md).

Only open work appears here — anything shipped moves out to [ARCHIVE.md](ARCHIVE.md). Ordered roughly by
leverage. `← X` = blocked-on / derives-from; numeric IDs (#1–4, §5–7) are stable cross-reference handles.

---

## ⚑ State-of-the-app audit (2026-06-30)

Senior-dev + cycling-coach review against the five README pillars. **Verdict: engineering quality
substantially exceeds data maturity** — the deterministic core and the learning architecture are
well-built, but the *self-correcting* loop (the thesis) has barely turned over.

**Central finding — the trainable corpus is ~2 weeks, not 6 months.** The score ledger holds 114
entries but only **13 `planned`** (planned rides are the only ones that teach the model); 100 are
`legacy`. The cause is **not** elapsed time — the athlete has trained 6 mo / 6 days-a-wk (140 rides
in-window). It's that the **first in-app block was written 2026-06-15**, so only rides on/after that
date match an app prescription; the prior ~6 months are real training but **un-prescribed from the
app's view**, so they're `legacy` and excluded from execution/adherence learning by design ("no plan
to be off"). Compounding it: `buildRideScores` knows only the CURRENT block and **no `block-history`
retains per-day prescriptions**, so historical planned rides can't be re-matched on a ledger rebuild
(only frozen-in-place entries survive — LEDGER-1). `intervention-log.json` / `block-history.json`
don't exist yet → **#4 validation has 0 records**; the athlete model runs at n=1–8 per type (below the
≥3-obs trend gate and the correlation engine's discrimination gate) → most learning returns population
defaults.

**Holds well (don't disturb):** pillar 1 (layer-not-replacement), pillar 2 (deterministic core /
generative shell — nutrition + interval protocols guarded on *both* ends, generation & validation),
pillar 3 (two-memory split, structurally enforced), pillar 4 (immutable ledger). The "calibrated
honesty" UX (provenance stamps, confidence tiers, withheld thin reads) is a real differentiator.

**Strict findings (severity):**
- ⚠️ **Learning loop dormant for lack of first-party data** (above). #4 *measures* but doesn't yet
  *demote*; per-athlete calibration/correlation sit on defaults below their gates.
- ⚠️ **Planned corpus isn't durable across blocks** — retain per-day prescriptions (`block-history`)
  so adherence history survives block roll-off + rebuilds; consider a backfill path for the legacy
  months where a plan genuinely existed. (The legacy rides *can* already feed FTP-independent trends —
  Pw:HR, polarization, volume baselines — which need no prescription.)
- ⚠️ **Test coverage lopsided** — ~all 49 suites are `lib/*`; the 494-line `sync` + 272-line `generate`
  routes (reconciliation, scoring orchestration, tool-use parsing) are the highest-stakes, least-tested
  code, and they guard the immutable ledger everything learns from.
- 🔸 **No periodization above the block** — no season/macrocycle scope, no cross-block progression, no
  taper/peak logic (`6a` deferred). The planner optimises 2–4 weeks in isolation; previous-block insight
  only flows as retrospective `next_block_seeds`, and there are no completed blocks yet.
- 🔸 **Local-first durability** rests on homegrown `.bak` files on one machine (no off-machine backup of
  `data/`); trunk-based with a concurrent agent is operationally fragile.
- 🔸 **Observability + cost guard absent (P8)** — silent `catch`es, unbounded AI routes; generation
  blocks 1–2 min with no streaming (P9).
- 🔸 **Fueling is per-session, not periodised**; strength is a stub (5 kcal/min); recovery is
  one-dimensional (HRV honestly gated off — no source).
- 🔸 **Doc drift** — README claims the nutrition formula computes protein (carbs only); "556 tests" (now 564).

**Priorities (data > features):**
1. **Turn the loop over.** Retain block prescriptions (`block-history`); close #4 (low hit-rate →
   *demote*, not just annotate); reduce friction so generate→ride→score→learn actually accrues.
2. **Test the `sync` + `generate` routes** — protect the ledger from silent reconciliation/scoring bugs.
3. **Off-machine backup of `data/`** + branch discipline for the shared checkout.
4. **Periodization / season scope + event-aware planning** (`6a`) — high coaching value, but also needs
   the loop turning, so it ranks behind 1–2.

---

## Next up

### #2 · Per-athlete calibration — extend the framework  ⭐ (the keystone)
Bring more parameters under the same `parameterise → derive-with-fallback → stamp` machinery. The
marquee data-play — context-stamp the ledger, then auto-derive off it — has shipped its spine: the input
stamp (`formState`; the morning-check stamp was removed with the subjective-wellness revert), the first
derived edge (`deriveTsbDeepFatigue`), and the shared `deriveExecutionEdge` engine it now rides on (all in
ARCHIVE). What's left:
- **Per-type IF cutoffs — open slivers:** ✅ offsets now surfaced read-only on `/model`
  (`ifBandOffsetRows` → `IfBandOffsets`, derived live from synced zones). Left: RaceSim stays intentionally
  unanchored (surgy/mixed — no single zone edge; revisit only if real use wants it); the offsets are
  derived-live (not persisted in `CalibrationStore`) — fine unless a manual override is ever wanted. Shares
  the curve read with **Track A**.
- **More honest auto-derivations off the engine** — each new edge is a *spec* over
  `lib/correlation.ts`, not new code, but only where an **honest** execution outcome separates failures
  from successes. (The morning-check strain edge was dropped with the subjective-wellness revert — the
  morning read is now a manual flag, not a derived signal.) Still lacking a defensible outcome signal: the
  `productiveOverload`/`balanced` edges and the #3 reschedule thresholds. Carbs is the other consumer →
  **Track C** (ties **#4**).
- **Pattern (follow per param):** default = today's literal value; derive with confidence-gated
  fallback; stamp on any ledger entry it scores; test that a fresh athlete scores identically.
- *Owned elsewhere:* optimal carbs g/h `→ Track C`; ACWR band + EWMA α stay on their current path.

### Morning override — a manual "feeling ill / extreme fatigue" flag  (shipped → ARCHIVE)
**Reversed direction (2026-06-26).** The subjective-wellness sync pivot (Inc 1 + Inc 2) was removed — it was
latent/dead and un-utilitarian, and a wearable will give objective morning-readiness (HRV / sleep /
resting-HR) that's strictly better. The morning read is now a small Today **two-button flag** (feeling ill /
extreme fatigue) that downgrades today's quality session; objective fatigue stays surfaced by `readiness`.
Removed: the six subjective `WellnessEntry` fields, `wellnessToMorningAnswers`, the strain bands + edge
(`deriveStrainHigh` / `resolveStrainBandsOverride`), the ledger morning stamp. Objective wellness
(weight / CTL/ATL / HRV / sleep / kcal) is untouched. Spec:
`docs/superpowers/specs/2026-06-26-remove-subjective-wellness-manual-flag-design.md`.
- *Future:* when a wearable lands, objective morning-readiness slots into the same place (the load model /
  athlete-state), replacing the manual flag for the fatigue case.

### Scoring-core gaps (route through #2 — they touch `execution-score.ts`)
- ✅ **Off-plan aerobic signal — fill the gap decoupling left (shipped → ARCHIVE).** Off-plan rides are now
  graded on a non-circular aerobic read: the ride's Z2-isolated Pw:HR vs the athlete's own trailing baseline
  (`lib/aerobic.ts`, shared with the athlete-state driver), ±2 in `computeExecutionScore` for intrinsic
  rides. Baseline is per-ride strictly-before (no self-reference); a thin-Z2 ride or missing baseline → no
  effect. Applies in the ledger + the Today card.
- **Recovery-specific Z2 cap** — give Recovery its own "dialed-in" cap (above Z1, not Z2) *if* the
  lenient shared aerobic cap proves too soft in real use.
- **Power-zone source of truth** — decide: keep zones strictly Intervals.icu vs. a sanctioned local
  override in the calibration framework. (Lean strict-consistency.)

### #4 · Validation loop → auto-down-weight  (time-gated ~4wk)
`intervention-log.json` has no matured verdicts yet. Once data exists, a low hit-rate in
`lib/synthesis.ts` should **demote** a directive (today it only annotates). Plus: surface
planned-vs-actual per session type and, on a consistent gap, **flag an FTP re-test** in Intervals.icu
(never write FTP locally — `physiology.json` stays the synced SoT). Ties Track B template-scoring + #2.

### #1 · CoachSnapshot — fill the reserved slots
✅ The energy-availability read now fills both slots (`fuelingState` = low/adequate/ample band,
`intakeVsNeed` = its kcal/kg figure) — computed once in `resolveCoachSignals`, surfaced in both LLM paths
and the athlete card → ARCHIVE. Left: the *precise* weekly intake-vs-need ratio (kJ-out vs intake) is still
`§6` energy-balance; a *personalised* adequate line is `← Track C`. #1 stays as the cross-ref handle.

### #3 · Proactive reschedule — slivers
Decision thresholds → per-athlete `← #2`; let the **reactive** `RescheduleBanner` adopt the shared
`findMakeUpSlot` (still rest-only); calendar mirror `← §7`; possible fully-automatic fatigue-path
downgrade (on `fatigueAlert`, before a miss).

### §5 · Athlete-state — slivers
Energy-availability evaluator `← Track C`; *derive* the per-athlete fusion weights off the engine `← #2`
(the population fold-in + override shipped — derivation is the open part); tune score→band thresholds +
headline against real use; possible score-over-time trend.

---

## Feature tracks (multi-session ⭐)

### Track A · Power-curve intelligence
✅ The rider profile now feeds the **retrospective** (curve shape, not just compliance): the 84-day profile
goes into both retrospective prompts + a deterministic curve-shape seed (`powerProfileSeed`). The profile
already fed block generation. Left: the population reference multiples → `#2` (still local magic-numbers in
`power-profile.ts`); optionally persist a per-block snapshot for *rider-type-over-time* (deferred — one
block barely moves the curve, so the over-time read only pays off across a season).

### Track B · Session selection & variety
✅ Per-template scoring loop shipped: the durability template is stamped on the week's long Z2 ride at write
time, and `computeExecutionScore` grades that ride against its template's expected signal — above-Z2 time is
no longer penalised for B–E (they embed efforts), and `gradeDurabilityDelivery` (`lib/durability-score.ts`)
checks whether the prescribed efforts actually landed at the right intensity + timing (±2). The template is
also stamped on the ledger entry for #4 outcome attribution. Limits: the effort-delivery grade needs
interval timing only the **today** path fetches (the ledger gets the template-aware above-Z2 only); the
**long-ride identification** is a write-time heuristic (Z2 day near the block's longest Z2), and it activates
on the next written block. Left: tighten per-loading-week RaceSim only if real use shows under-delivery.

### Track C · Fueling intelligence + the shared correlation engine  (high value)
Turn fueling from a static formula into a learned signal, on the **shared correlation engine**. The
engine itself is **built** (`lib/correlation.ts` `deriveExecutionEdge` — the generalised guarded
regression `deriveTsbDeepFatigue` now rides on; "build the derivation once, reuse it" for carbs **and**
the calibration edges). The carbs **input is now stamped** too (`fuel.carbsGPerH`, from intervals.icu
`carbs_ingested`) — sparse until athletes fill it in, accumulating like `formState` did before its edge
could fire. What's left:
- **Optimum-derivation shape** — the engine's `deriveExecutionEdge` finds a *failure edge*; carbs needs
  an *optimum* (the g/h band tied to the best outcomes). Add that shape, then per ride type correlate
  `fuel.carbsGPerH` against decoupling / RPE-vs-IF divergence / interval completion / next-day TSB →
  converge on optimal g/h, stored as a calibrated parameter `← #2`.
- **Contextual post-ride prompts** (deterministic thresholds, LLM phrases the number) — also the nudge
  that gets `carbs_ingested` filled in, which feeds the derivation above.
- **Pre-ride loading loop** — day-before carb bump before long durability, then *learn whether it
  helped* (loaded vs baseline decoupling) and stop if it doesn't move the signal.
- Surfacing layer = **§6**; reuse the one derivation in §6 + the Today tile + the Trends overlay.

---

## Platform & performance  (local-first single-user)

- **P8** — structured logging (`{route, step, status, ms}` instead of silent `catch`); AI-route cost
  guard (in-memory token-bucket on `/api/generate` + `/api/ask`).
- **P9** — PWA install (`manifest.ts` + service worker); stream `/api/generate` (blocks 1–2 min today).

---

## UI refinements

- **Energy-availability tile — open slivers** — the deterministic EA proxy shipped (Today, trailing-window
  `(intake − ride burn)/kg`; now reads low/adequate/ample on a body-weight basis, and feeds
  `CoachSnapshot.fuel` `← #1` → ARCHIVE). Left: a *personalised* "adequate" line `← Track C` calibration.
- **Pw:HR × fuel Trends overlay** — carb-intake g/h on the existing `efSeries` chart (build w/ Track C).
- **Page density** — **Trends** (~1.6/2.2 folds) and **Today on mobile** still run over the fold (the EA tile
  added one more row to the readiness glance) — tighten card rhythm / collapse there next.

---

## Tooling & workflow (operating decision — UI refinement program)

The UI refinement program (consistency → density/IA → hybrid transparency) runs with a **broad
design-tooling adoption**, kept reversible so the unique cyberpunk identity is never homogenised.
- **Source-of-truth rule:** [`DESIGN.md`](DESIGN.md) is canonical. External kits *propose*; DESIGN.md
  *disposes* — any token/aesthetic suggestion that conflicts is rejected. Adoption is **workflow-level
  only** (Claude skills / plugins / MCPs); **no new app runtime dependencies**, so reverting is
  config-only with zero code impact.
- **Broad set (active):** design-idea kits (`awesome-claude-design` families + anti-slop kit, UI/UX
  Pro Max, a Tailwind-v4 dark kit) for ideation; a browser-verify MCP (Chrome DevTools / Playwright);
  Addy Osmani `web-quality-skills` (a11y / Core Web Vitals).
- **Selective fallback (reserve):** browser-verify MCP + the a11y/quality skill **only**. **Revert
  trigger:** on request → drop the idea-kits from config; the app does not change.

---

## Larger / scoped (when wanted)

- **6a · Event-aware race planning** ⭐ — structured event (date / A-B-C priority / type) → taper +
  carb-load + race-day timeline. KB already holds the protocol; LLM only phrases it, never invents grams.
- **§6 · Nutrition energy-balance** — Track C's surfacing layer: weekly kJ-out vs intake → `fuelingState`;
  then precise fluid/sodium/carb targets pre/intra/post by IF + duration.
- **§7 · Calendar flexibility** — condition-driven swaps + **bidirectional Intervals.icu sync**
  (large + API-risk; only `createEvent` exists today). Unblocks the calendar-mirror slivers under #3.
- **8 · NP-missing → "unverified"** — when NP is absent on an outdoor ride, stamp the entry `unverified`
  instead of scoring off raw avg power. Small.

---

## Exploratory research → [research.md](research.md)
The "Second Brain" spike (LangGraph / Mem0 / GraphRAG / HRV) — findings, not commitments. Lean spin-offs
worth pursuing: knowledge-connections, HRV-readiness.

---

## Decided against (don't re-propose without a real reason)
- **Postgres/Supabase + RLS · blob KB storage · auth middleware** — assumed a multi-tenant SaaS; NodeVelo
  is local-first single-user, so `fs`/JSON *is* the store. Revisit only on a deliberate hosted pivot.
- **pgvector RAG for the KB** — small markdown files fit cheaply in the prompt; the context-dump is intentional.
- **RxDB reactive-DB rewrite** — contradicts local-first JSON; the desync it targeted is fixed with refetch-on-sync.
- **SQLite (`better-sqlite3` + Drizzle + `sqlite-vec`) — deferred, not rejected.** Wins are mostly
  theoretical at single-user scale and its standout unlock (`sqlite-vec`) is gated on semantic RAG (also
  deferred). Reconsider when semantic RAG is committed or data volume / multi-user justifies it.
- **uPlot / canvas charting** — `buildRideTrace` already downsamples to ~240 points; no chart renders raw 1 Hz.
- **Cytoscape / knowledge-graph UI** — heavyweight dep re-presenting existing data.
- **Post-ride structured survey** — RPE/feel already sync from Intervals.icu (`icu_rpe`).
