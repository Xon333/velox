# Macro Periodization & Season Scope — Design

**Date:** 2026-07-01
**Status:** ✅ Shipped 2026-07-01 (MACRO-1/2/3) — see [ARCHIVE.md](../../../ARCHIVE.md)
**ROADMAP:** audit P4 · `MACRO-1/2/3` · ties `6a` `§7` `#4` `#2`; synergy with `SUB-1` (not a blocker)

---

## 1. Problem & context

The 2026-06-30 audit found the planning unit is a single 2–4 wk block generated in isolation. Week-level
theming exists (loading vs deload/taper, LLM-written) and RaceSim is treated as a peaking session, and the
block-to-block *content* carry-forward channels exist (`next_block_seeds`,
`blockHistory[].structuredReflections`, deferred quality, athlete-model insights) — but there is **no layer
above the block**: no target event/date, no weeks-to-event, no base→build→peak→taper sequence, no cross-block
load progression, no taper-by-countdown. A coach's core value-add over a workout generator *is* that arc.

**Athlete context (drives the priority order):** primary mode is **open-ended "get faster"** (raise
FTP + punch for hilly KOMs) with **no dated events yet**; specific races arrive **next year**. So: nail a
rolling, no-event progression engine first; build event-anchoring in now but keep it dormant until an event
is added.

## 2. Goals / non-goals

**Goals**
- A persistent, engine-drafted, **rough & rolling** season arc of **focus periods** that each generated block
  slots into with full context.
- **Co-pilot** at two levels: the arc gives context; the block is where the athlete acts. The engine drafts;
  the athlete overrides.
- Deterministic core, generative shell — every number and the sequence are TypeScript grounded in the KB; the
  LLM only phrases the per-period rationale.
- Surface it as a **roadmap-stepper progress bar** with an optional **event flag**.
- Build **event-anchored mode** now (dormant, unit-tested with a synthetic event); Mode-C is the default path.

**Non-goals**
- Auto-pilot (system schedules/queues blocks unattended) — explicitly rejected in favour of co-pilot.
- A fixed dated calendar the athlete falls behind on — the arc is directional and re-plans from where they are.
- Full multi-season / multi-year planning. One season horizon at a time.
- The precise weekly intake-vs-need energy model (that's `§6`).

## 3. Approach

**Limiter-focus periods inside a base→build envelope, with an event peak/taper overlay** (Approach 1 of the
brainstorm). The arc is a sequence of **focus periods**, each emphasising one system (aerobic-base / threshold
/ vo2max / anaerobic / durability / sharpen), chosen from the athlete's weakest system and rotated for variety;
a light directional envelope shifts the mix over time; deload is forced every 3rd–4th week. When an A-event
with a date exists, a peak→taper overlay back-fills the tail. This reuses machinery already in the app
(power-profile "easy win" limiter, durability template rotation A–E, session-requirements, ACWR bands,
readiness/fatigue alerts) rather than adding a parallel phase system, and it matches both the "get faster"
goal and the "focus periods on a progress bar" UI vision.

**KB grounding (constants encoded deterministically, not invented — from `cycling_database.md` Annual
Periodisation Framework + `training_knowledge.md`):**

| Phase | Duration | Focus | Intensity split |
|---|---|---|---|
| Base | 10–16 wk (annual); a Mode-C "base touch" is mesocycle-sized 2–4 wk | Aerobic volume, Z2 | ~90/10 easy/mod |
| Build | 8–12 wk (annual); Mode-C build focus periods 3–4 wk each | Threshold + VO2max, rotated | ~80/20 easy/hard |
| Peak | 4–6 wk | Race-specific sharpening | ~75/25 |
| Taper | 1–2 wk | Reduced volume, freshness | Low volume |
| Transition | 2–4 wk | Rest / reset | Unstructured |

- **Deload:** 30–50% volume reduction every 3–4 weeks throughout all phases. Cadence 3:1 default, **2:1** when
  life/fatigue load is heavy.
- **Variety / block periodization:** rotate threshold / VO2max / sweet-spot / over-unders; "cycle VO2max blocks
  with threshold blocks rather than running both simultaneously." Base is non-negotiable (aerobic capacity is
  the ceiling for every later phase).

## 4. Data model

**New store `data/season-plan.json`** (IO via `data-store.ts`, read-with-default like the other stores).

```ts
type SeasonFocus = "aerobic-base" | "threshold" | "vo2max" | "anaerobic" | "durability" | "sharpen";
type SeasonPhase = "base" | "build" | "peak" | "taper" | "transition";

interface SeasonEvent {
  name: string;
  date: string;              // ISO YYYY-MM-DD
  priority: "A" | "B" | "C";
}

interface FocusPeriod {
  focus: SeasonFocus;        // system emphasis (block periodization)
  phase: SeasonPhase;        // directional envelope (KB framework)
  startDate: string;         // ISO
  plannedWeeks: number;      // rough (1–8; taper can be a single week), re-planned
  intensitySplit: string;    // KB, e.g. "80/20"
  targetWeeklyTss: number | null;  // null when FTP/CTL unavailable (withhold, don't fake)
  deloadWeek: boolean;       // trailing recovery week (30–50% vol)
  rationale: string;         // KB-grounded; the ONLY LLM-phrased field
  source: "derived" | "override";
  achievedTss?: number;      // stamped when the period rolls into the past (frozen)
  confidence: "low" | "medium" | "high";  // limiter-pick confidence → drives "provisional" UI flag
}

interface SeasonPlan {
  objective: string;         // owned free-text ("get faster: FTP + punch for hilly KOMs")
  events: SeasonEvent[];     // owned (empty in Mode-C)
  periods: FocusPeriod[];    // engine-drafted arc
  updatedAt: string;
}
```

**Two invariants that make "rough & rolling + you override" work:**

1. **Past frozen / future rolling** (mirrors the immutable ledger). Periods *before today* are frozen with
   `achievedTss` stamped from the score-log — never re-drafted. Periods *from today forward* are the draft the
   engine re-plans on each generate.
2. **Override survives re-planning.** A period the athlete edits is `source: "override"`; the re-planner
   respects it (keeps its focus/length) and re-drafts only the untouched derived periods around it.

**Ownership split (pillar 3):** `objective` + `events` are owned intent (athlete-authored). `periods` are
engine-*derived* but athlete-*adjustable* — hence the per-period `source` flag. The plan is **self-contained**
(accumulates its own frozen history as periods complete), so it reads achieved load from the existing
score-log and does **not** hard-depend on `SUB-1`/block-history. `SUB-1` later enriches achieved-load detail.

## 5. The progression engine — `lib/season.ts` (pure, deterministic)

`draftSeasonArc(plan, fitness, limiter, history, today) → FocusPeriod[]`. Inputs are all already computed:
CTL (rolling-baselines / `sync.fitness`), FTP + weakest system (`power-profile` "easy win" + athlete-model
insights), recent focuses (frozen periods + score-log achieved TSS), KB constants.

**Mode-C — no A-event (default): rolling base→build cycle**
1. **Base gate** — lead with `aerobic-base` if base is thin (low CTL vs target, no recent base period, or the
   KB grey-zone/plateau signature). Base is the ceiling for later phases.
2. **Build with limiter-focus rotation** — sequence `threshold`/`vo2max`/`anaerobic`/`durability` periods
   (~3–4 wk each), weakest system first, then rotate so none repeats back-to-back (KB variety; cycle VO2 with
   threshold).
3. **Realize** — a lighter `sharpen`/test week after a build cluster to lock in gains (fires the FTP-retest
   prompt → ties `#4`).
4. Loop continuously — no "peak toward nothing."

**Event-anchored mode (built now, dormant until an A-event date exists): backward schedule**
- Taper (1–2 wk) ends on the A-date; Peak (4–6 wk) before; Build before; Base fills the runway; KB durations
  clamp each. B/C events → a mini-taper (a few days) without disrupting the arc.
- Branch cleanly: `events has A-date ? backwardSchedule() : rollingCycle()`.

**Cross-cutting (both modes):**
- **Deload cadence** — a `deloadWeek` every 3rd–4th week (3:1 default; auto-tighten to 2:1 when `fatigueAlert`
  or `loadRamp` already fire), 30–50% volume cut.
- **Load envelope** — each period's `targetWeeklyTss` ramps ~+5–8% off the prior period's frozen achieved load,
  **capped by the existing ACWR bands**; the first period (no frozen predecessor) seeds off recent achieved
  weekly TSS (rolling-baselines `avgTss90d`); `null` when FTP/CTL unavailable.
- **Re-plan** — on each generate: freeze elapsed periods (stamp `achievedTss`), preserve `override` periods,
  re-draft the derived tail from *current* fitness. **Idempotent** on unchanged inputs.

**Pillar-2 boundary:** every number + the sequence are deterministic; only `rationale` is LLM-phrased, grounded
in the same KB already injected into generation.

## 6. Block-generation integration

Hooks the existing `generate → preview → write` flow; does not replace it.

- **On opening `/plan`:** resolve the current `FocusPeriod` (drafting the arc first if none exists). Pre-fill
  the generator form with the recommended **focus**, **block length** (`2|4|6|8`, sized to the period's
  remaining weeks), and **weekly-TSS target**. The athlete can override any field; changing the focus marks the
  period `source: "override"` and re-plans the tail around it.
- **Prompt injection** — a new `seasonContext` line, alongside the existing `stateContext` / `sessionReqContext`
  / `durabilityContext` injections in `app/api/generate/route.ts`:
  > `SEASON CONTEXT: phase build · focus VO2max (your weakest system) · wk 2 of a 4-wk period · target ~450 TSS/wk (+6%, ACWR-safe) · deload due next block.`
- **`validateSeasonFit(days, period)`** — a new non-blocking validator (mirrors `validatePlanProtocol` /
  `validateSchedule` / `validateNutrition`): warns if the block's intensity split or weekly load drifts outside
  the period's envelope (e.g. a "base" period generated 35% hard).
- **Plumbing:** widen `BlockParams.lengthWeeks` `2|4 → 2|4|6|8` (verify `blockDates`, `PlanToolSchema`, and the
  prompt handle 6/8); new `/api/season` route (GET → plan-or-fresh-draft; PUT → validate + persist owned
  fields); on write, stamp the block's `seasonFocus`/`phase` so the frozen period + block-history record what
  was actually done.
- **Best-effort:** if drafting throws, generation proceeds **without** the season context — the season layer can
  never block a block from being generated.

## 7. UI — roadmap stepper + event flag

Validated via mockup (Option C + event flag). Each focus period is a card: **done** → checked + dimmed,
**current** → lit with progress (wk n/N) + target, **upcoming** → ghosted; the rationale is visible. An
optional **🏁 event flag** pins to an A-date and the tail auto-fills **Peak → Taper** backward from it; B/C
events show a smaller flag + mini-taper. With **no event** (current mode) the tail is open-ended — no
Peak/Taper/flag — and an "🏁 edit event" chip is the entry point.

- **Home:** top of `/plan` (full roadmap, above the generator it feeds). A compact read-only variant may later
  appear on `/today`; out of scope for v1.
- **Provisional flag:** when limiter confidence is low (thin data), the roadmap labels the arc *"provisional —
  sharpens as data accrues,"* consistent with the app's calibrated-honesty confidence tiers.
- Colour legend: aerobic-base cyan · threshold amber · vo2max pink · durability green · peak/sharpen purple ·
  taper light-cyan · event gold.

## 8. Edge cases & degradation

- **Sparse history** (the current 13-planned-ride reality): the arc still drafts from KB defaults + current
  fitness; if the athlete model can't name a weakest system (n<3/type, low confidence), focus selection falls
  back to a **default order** (base → threshold → vo2 → durability) and the roadmap shows the "provisional" flag.
- **No FTP / no CTL:** show focus sequence + weeks, **omit** `targetWeeklyTss` (withhold, don't fake).
- **Deload:** auto 3:1 → 2:1 when `fatigueAlert`/`loadRamp` fire.
- **Event too close:** if the runway can't fit a real build, clamp — compress peak/taper and warn ("A-race in
  3 weeks — only a taper is possible"). Past-dated events are ignored.
- **Missing/corrupt `season-plan.json`:** treat as "no plan" → draft fresh. Never crashes generation.
- **Overlapping/edited blocks:** the re-planner respects override periods; a shortened period re-flows downstream.

## 9. Error handling

- `/api/season` GET returns the plan (or a freshly-drafted one); PUT validates owned fields (ISO dates,
  priority ∈ {A,B,C}, non-empty objective) → 400 on malformed. Matches existing route conventions.
- Season-context injection is best-effort (see §6). `validateSeasonFit` is a non-blocking warning.

## 10. Testing — `lib/season.test.ts` (the deterministic contract)

- **Mode-C:** base-gate fires on low CTL / no recent base; limiter rotation picks weakest + no back-to-back
  repeat; deload every 3rd–4th; realize week after a build cluster.
- **Event mode** (synthetic A-event): backward-schedule places taper→peak→build→base correctly; short-runway
  clamp; B/C mini-taper.
- **Re-plan:** elapsed periods frozen with `achievedTss`; `override` periods preserved; faster-gain advances /
  missed-week shifts; **idempotent** re-draft on unchanged inputs.
- **Degradation:** no-FTP → `targetWeeklyTss` null; low-confidence limiter → default order; ACWR-cap on the ramp.
- Unit tests for `validateSeasonFit` + the `seasonContext` formatter. (Full `/api/generate` + `/api/season`
  route tests are `SUB-3`'s scope; at minimum the pure formatter + validator are covered here.)

## 11. Pillar alignment

- **Layer, not replacement** — sits above blocks; never re-skins Intervals.icu.
- **Deterministic core, generative shell** — engine owns every number + the sequence; LLM phrases only
  `rationale`, grounded in the already-injected KB.
- **Two-memory split** — `objective`/`events` owned; `periods` derived + adjustable (explicit `source`).
- **Immutable ledger** — past periods frozen with achieved load; the re-plan only touches the future.
- **Local-first** — one more JSON store.

## 12. Dependencies & sequencing

- **Synergy, not blocker:** `SUB-1` (block-history with prescriptions) enriches achieved-load detail; the plan
  is self-contained without it.
- **Enables:** `6a` event-aware race planning is the surfacing of the event-anchored mode; `§7` calendar mirror.
- **Feeds:** `#4` validates whether a phase sequence worked; `#2` calibrates the ramp-rate / deload-cadence
  constants (start as KB-grounded population defaults).

## 13. Out of scope (v1)

- Auto-pilot generation/queueing. Multi-season horizons. `/today` compact variant. The `§6` weekly
  intake-vs-need energy model. Calibrating the ramp/deload constants per-athlete (they ship as KB defaults;
  `#2` derives later).
