# NodeVelo roadmap

The **forward backlog — work left only.** The goal everything is measured against: **be a coaching
*layer* that fuses signals into one coherent, self-correcting athlete model — not a re-skin of
Intervals.icu.**

Companion docs: live bugs → [todo.md](todo.md) · **shipped detail** → [ARCHIVE.md](ARCHIVE.md) ·
exploratory spikes → [research.md](research.md) · how it all works → [README.md](README.md).

Only open work appears here — anything shipped moves out to [ARCHIVE.md](ARCHIVE.md). Ordered roughly by
leverage. `← X` = blocked-on / derives-from; numeric IDs (#1–4, §5–7) are stable cross-reference handles.

---

## Next up

### #2 · Per-athlete calibration — extend the framework  ⭐ (the keystone)
Bring more parameters under the same `parameterise → derive-with-fallback → stamp` machinery.
- **Per-type IF cutoffs — open slivers:** surface the offsets on Settings (derived live from zones, not
  yet in `CalibrationStore`); anchor RaceSim. Shares the curve read with **Track A**.
- **Fold in the CR-11 constants** (population fallback, opportunistic): morning-check strain bands +
  TSB-deep cutoff; durability `88%` floor + `≤122%/≤20m` insert envelope; athlete-state fusion weights (§5).
- **Context-stamp the ledger → unlock honest auto-derivation** ⭐ (the data play that turns the
  override-only edges into *learned* ones). Several parameters can only be manually overridden today —
  not derived — because the ledger records the *value* an entry scored against but not the athlete-state
  **context** at that moment, so there's nothing to correlate an outcome against. Fix the input side
  first: freeze the state-at-scoring-time onto each entry (TSB + ATL/CTL, readiness, morning-check
  fatigue/sleep/soreness — frozen like `ftpUsed`/`calibration`). Then build a **state →
  subsequent-execution-quality** correlation (same engine shape as Track C's carbs play) that converts a
  "no honest signal yet" param from population-default-+-override into a confidence-gated *derived* value.
  Worked example — the **TSB adaptation window** (override-only today): once TSB-at-the-time is stamped,
  find the TSB depth below which THIS athlete's *next* quality session reliably under-executes and
  recenter the deep-fatigue edge there — calibrating to where they **adapt**, not merely where they
  **train** (the distinction that makes auto-derivation dishonest before the data exists). Gated +
  reversible + never auto-applied below medium confidence; the manual override stays as the floor.
  Ties **#4** (the validation loop reads the same stamped context) + **Track C** (shared correlation engine).
- **Pattern (follow per param):** default = today's literal value; derive with confidence-gated
  fallback; stamp on any ledger entry it scores; test that a fresh athlete scores identically.
- *Owned elsewhere:* optimal carbs g/h `→ Track C`; ACWR band + EWMA α stay on their current path.

### Scoring-core gaps (route through #2 — they touch `execution-score.ts`)
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
`fuel.intakeVsNeed` + `fuel.fuelingState` are reserved `null` `← Track C / §6`.

### #3 · Proactive reschedule — slivers
Decision thresholds → per-athlete `← #2`; let the **reactive** `RescheduleBanner` adopt the shared
`findMakeUpSlot` (still rest-only); calendar mirror `← §7`; possible fully-automatic fatigue-path
downgrade (on `fatigueAlert`, before a miss).

### §5 · Athlete-state — slivers
Energy-availability evaluator `← Track C`; per-athlete fusion weights `← #2`; tune score→band thresholds
+ headline against real use; possible score-over-time trend.

---

## Feature tracks (multi-session ⭐)

### Track A · Power-curve intelligence
The population reference multiples → `#2`; feed the rider profile into the **block review / retrospective**
(read curve shape, not just compliance); optionally persist a snapshot if rider-type-over-time is wanted.

### Track B · Session selection & variety
Per-template scoring loop (grade each long ride vs its template's expected signal — the
`durabilityTemplate` stamp is in place; ties #4 + Track C); tighten per-loading-week RaceSim only if real
use shows the LLM under-delivering.

### Track C · Fueling intelligence  (inputs already synced — high value)
All open. Turn fueling from a static formula into a learned signal:
- **Correlation engine** — per ride type, correlate synced carbs g/h against decoupling, RPE-vs-IF
  divergence, interval completion, next-day TSB → converge on the athlete's optimal g/h, stored as a
  calibrated parameter `← #2`.
- **Contextual post-ride prompts** (deterministic thresholds, LLM phrases the number).
- **Pre-ride loading loop** — day-before carb bump before long durability, then *learn whether it
  helped* (loaded vs baseline decoupling) and stop if it doesn't move the signal.
- Surfacing layer = **§6**; build the derivation once, reuse in §6 + the Today tile + the Trends overlay.

---

## Platform & performance  (local-first single-user)

- **P8** — structured logging (`{route, step, status, ms}` instead of silent `catch`); AI-route cost
  guard (in-memory token-bucket on `/api/generate` + `/api/ask`).
- **P9** — PWA install (`manifest.ts` + service worker); stream `/api/generate` (blocks 1–2 min today).

---

## UI refinements

- **Nutrition-availability tile on Today** ⭐ — EA proxy `(intake − ride burn)/kg`; overlaps §6 / Track C;
  feeds `CoachSnapshot.fuel`. Deterministic.
- **Recent Baselines — pick the useful ~4** (w/kg@threshold, weekly TSS, rides/wk, CTL ramp, decoupling
  trend). Fix TSS-vs-Load naming + the weekly-hours window (todo `MR-2`); split NP from Avg + annotate-or-
  demote IF; verify tiles populate post-sync (todo `TR-4`, avg-speed `RC-1`).
- **Pw:HR × fuel Trends overlay** — carb-intake g/h on the existing `efSeries` chart (build w/ Track C).
- **Page density** — **Trends** (~1.6/2.2 folds) and **Today on mobile** still run over the fold —
  tighten card rhythm / collapse there next.

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
