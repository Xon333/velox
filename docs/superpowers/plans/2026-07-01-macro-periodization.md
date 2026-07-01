# Macro Periodization & Season Scope — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent, engine-drafted, rough/rolling season arc of limiter-focus periods that every generated block slots into, surfaced as a roadmap-stepper with an optional event flag.

**Architecture:** A new `data/season-plan.json` store holds the arc. A pure, deterministic `lib/season.ts` drafts it (Mode-C rolling cycle now; dormant event-anchored backward-schedule for later), grounded in knowledge-base constants. The generate flow injects a `seasonContext` prompt line + a `validateSeasonFit` warning; a `SeasonRoadmap` React component renders it on `/plan`. Deterministic core / generative shell: the engine owns every number and the sequence; the LLM only phrases each period's `rationale`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Tailwind v4, Vitest. JSON persistence via `lib/json-store.ts` helpers re-exported through `lib/data-store.ts`.

## Global Constraints

- **Deterministic core, generative shell** — all scheduling/numbers are plain TypeScript; the LLM only phrases `FocusPeriod.rationale`. Never let the model compute the arc.
- **KB-grounded constants (verbatim, from `knowledge-base/cycling_database.md` Annual Periodisation Framework + `training_knowledge.md`):** Base ~90/10, Build ~80/20, Peak 4–6 wk ~75/25, Taper 1–2 wk; deload 30–50% volume every 3–4 wk (3:1 default, 2:1 under heavy fatigue); rotate threshold/VO2/durability, "cycle VO2 blocks with threshold blocks"; base is non-negotiable.
- **Pure logic is unit-tested** with Vitest (`lib/*.test.ts`); tests are the contract. Route handlers and React components follow the existing repo convention of extracting pure helpers and testing those (this codebase does not unit-test routes/components directly).
- **Concurrent checkout:** stage only files you touched (`git add <path>...`, never `git add -A`); commit on `main`.
- **Verification loop for any change:** `npx tsc --noEmit && npm test`.
- Self-contained: reads achieved load from the existing `score-log`; no hard dependency on SUB-1/block-history.

---

### Task 1: Season types, store IO, and KB constants

**Files:**
- Modify: `lib/types.ts` (add season types; widen `BlockParams.lengthWeeks`)
- Modify: `lib/data-store.ts` (add `readSeasonPlan`/`writeSeasonPlan` + default)
- Create: `lib/season.ts` (constants + first pure helper)
- Test: `lib/season.test.ts`

**Interfaces:**
- Produces: `SeasonFocus`, `SeasonPhase`, `SeasonEvent`, `FocusPeriod`, `SeasonPlan` (types); `SEASON_CONSTANTS`; `defaultBuildOrder(): SeasonFocus[]`; `readSeasonPlan()`/`writeSeasonPlan()`.

- [ ] **Step 1: Add the season types to `lib/types.ts`** (place after the `CurrentBlock` block, ~line 297)

```ts
// ---------- Season plan (data/season-plan.json) — macro periodization (MACRO-1..3) ----------

export type SeasonFocus = "aerobic-base" | "threshold" | "vo2max" | "anaerobic" | "durability" | "sharpen";
export type SeasonPhase = "base" | "build" | "peak" | "taper" | "transition";

export interface SeasonEvent {
  name: string;
  date: string; // ISO YYYY-MM-DD
  priority: "A" | "B" | "C";
}

export interface FocusPeriod {
  focus: SeasonFocus;
  phase: SeasonPhase;
  startDate: string; // ISO
  plannedWeeks: number; // 1–8 (taper can be a single week)
  intensitySplit: string; // KB, e.g. "80/20"
  targetWeeklyTss: number | null; // null when FTP/CTL unavailable
  deloadWeek: boolean; // trailing recovery week
  rationale: string; // KB-grounded; the only LLM-phrased field
  source: "derived" | "override";
  confidence: "low" | "medium" | "high"; // limiter-pick confidence
  achievedTss?: number; // stamped when the period rolls into the past (frozen)
}

export interface SeasonPlan {
  objective: string;
  events: SeasonEvent[];
  periods: FocusPeriod[];
  updatedAt: string;
}
```

- [ ] **Step 2: Widen `BlockParams.lengthWeeks` in `lib/types.ts`** (line 166)

```ts
export interface BlockParams {
  lengthWeeks: 2 | 4 | 6 | 8;
  goal: string;
  weakpoints: string[];
  startDate: string; // YYYY-MM-DD
}
```

- [ ] **Step 3: Create `lib/season.ts` with KB constants + the default build-rotation helper**

```ts
// Macro periodization engine (MACRO-1..3). Pure + deterministic: drafts a rough, rolling season arc of
// limiter-focus periods, grounded in the knowledge base. The LLM only phrases FocusPeriod.rationale.
import type { FocusPeriod, SeasonFocus } from "./types";

// KB-grounded (cycling_database.md Annual Periodisation Framework + training_knowledge.md). Mode-C focus
// periods are mesocycle-sized (a "base touch" is 2–4 wk, not the 10–16 wk annual base phase).
export const SEASON_CONSTANTS = {
  weeks: { "aerobic-base": 3, threshold: 4, vo2max: 4, anaerobic: 3, durability: 3, sharpen: 1 } as Record<SeasonFocus, number>,
  split: { "aerobic-base": "90/10", threshold: "80/20", vo2max: "80/20", anaerobic: "80/20", durability: "80/20", sharpen: "75/25" } as Record<SeasonFocus, string>,
  peakWeeks: 5, // 4–6
  taperWeeks: 1, // 1–2
  deloadEveryWeeks: 4, // 3:1 — a deload week after 3 loading weeks
  deloadTightEveryWeeks: 3, // 2:1 under heavy fatigue
  loadRampPct: 6, // +5–8% weekly-TSS ramp midpoint
  horizonPeriods: 5, // how many future periods to draft (rough & rolling)
} as const;

// Build-phase rotation order when no confident limiter is known (KB variety rule).
export function defaultBuildOrder(): SeasonFocus[] {
  return ["threshold", "vo2max", "durability"];
}

// Add whole weeks to an ISO date (UTC-safe).
export function addWeeks(iso: string, weeks: number): string {
  return new Date(Date.parse(iso) + weeks * 7 * 86_400_000).toISOString().slice(0, 10);
}
```

- [ ] **Step 4: Add the store IO to `lib/data-store.ts`** — import `SeasonPlan` in the type import (line 4) and add:

```ts
const DEFAULT_SEASON_PLAN: SeasonPlan = {
  objective: "",
  events: [],
  periods: [],
  updatedAt: new Date(0).toISOString(),
};

export async function readSeasonPlan(): Promise<SeasonPlan> {
  return readJson<SeasonPlan>("season-plan.json", DEFAULT_SEASON_PLAN);
}

export async function writeSeasonPlan(plan: SeasonPlan): Promise<void> {
  await writeJson("season-plan.json", { ...plan, updatedAt: new Date().toISOString() });
}
```

- [ ] **Step 5: Write the failing test** in `lib/season.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { SEASON_CONSTANTS, defaultBuildOrder, addWeeks } from "./season";

describe("season constants + helpers", () => {
  it("encodes the KB deload cadence (3:1 default, 2:1 tight)", () => {
    expect(SEASON_CONSTANTS.deloadEveryWeeks).toBe(4);
    expect(SEASON_CONSTANTS.deloadTightEveryWeeks).toBe(3);
  });
  it("rotates threshold → vo2max → durability by default (KB variety)", () => {
    expect(defaultBuildOrder()).toEqual(["threshold", "vo2max", "durability"]);
  });
  it("adds whole weeks UTC-safe", () => {
    expect(addWeeks("2026-07-01", 3)).toBe("2026-07-22");
  });
});
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run lib/season.test.ts`
Expected: PASS (3 tests). Then `npx tsc --noEmit` — Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add lib/types.ts lib/data-store.ts lib/season.ts lib/season.test.ts
git commit -m "feat(season): types, season-plan store, KB constants (MACRO-1)"
```

---

### Task 2: `draftSeasonArc` — Mode-C rolling cycle (base-gate + limiter rotation + realize)

**Files:**
- Modify: `lib/season.ts`
- Test: `lib/season.test.ts`

**Interfaces:**
- Consumes: `SEASON_CONSTANTS`, `defaultBuildOrder`, `addWeeks` (Task 1).
- Produces:
  - `interface SeasonDraftInput { objective: string; events: SeasonEvent[]; ctl: number | null; ftp: number | null; recentWeeklyTss: number | null; limiter: { system: SeasonFocus | null; confidence: "low" | "medium" | "high" }; recentFocuses: SeasonFocus[]; }`
  - `needsBaseGate(recentFocuses: SeasonFocus[]): boolean`
  - `nextBuildFocus(limiter, recentFocuses): SeasonFocus`
  - `draftSeasonArc(input: SeasonDraftInput, today: string): FocusPeriod[]` (Mode-C only in this task; deload/load/event added in Tasks 3–5)

- [ ] **Step 1: Write the failing tests** (append to `lib/season.test.ts`)

```ts
import { needsBaseGate, nextBuildFocus, draftSeasonArc, type SeasonDraftInput } from "./season";

const baseInput = (over: Partial<SeasonDraftInput> = {}): SeasonDraftInput => ({
  objective: "get faster", events: [], ctl: 60, ftp: 280, recentWeeklyTss: 420,
  limiter: { system: null, confidence: "low" }, recentFocuses: ["aerobic-base", "threshold"], ...over,
});

describe("draftSeasonArc — Mode-C", () => {
  it("base-gates when no aerobic-base sits in the recent window", () => {
    expect(needsBaseGate([])).toBe(true); // first-ever draft leads with base
    expect(needsBaseGate(["threshold", "vo2max", "durability", "threshold"])).toBe(true);
    expect(needsBaseGate(["aerobic-base", "threshold"])).toBe(false);
  });

  it("picks the weakest system first when the limiter is confident, else default rotation", () => {
    expect(nextBuildFocus({ system: "vo2max", confidence: "high" }, ["threshold"])).toBe("vo2max");
    // low-confidence limiter → default order, skipping a back-to-back repeat
    expect(nextBuildFocus({ system: null, confidence: "low" }, ["threshold"])).toBe("vo2max");
  });

  it("never repeats a focus back-to-back", () => {
    expect(nextBuildFocus({ system: "threshold", confidence: "high" }, ["threshold"])).not.toBe("threshold");
  });

  it("drafts base(if gated) → rotating build periods → a realize week, dated contiguously", () => {
    const arc = draftSeasonArc(baseInput({ recentFocuses: [] }), "2026-07-01");
    expect(arc[0].focus).toBe("aerobic-base");
    expect(arc[0].startDate).toBe("2026-07-01");
    expect(arc[1].startDate).toBe(addWeeksExpected(arc[0])); // contiguous
    expect(arc.some((p) => p.focus === "sharpen")).toBe(true); // realize week present
    expect(arc.every((p) => p.source === "derived")).toBe(true);
  });
});

function addWeeksExpected(p: { startDate: string; plannedWeeks: number }): string {
  return new Date(Date.parse(p.startDate) + p.plannedWeeks * 7 * 86_400_000).toISOString().slice(0, 10);
}
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/season.test.ts -t "Mode-C"`
Expected: FAIL ("needsBaseGate is not a function").

- [ ] **Step 3: Implement in `lib/season.ts`**

```ts
import type { FocusPeriod, SeasonEvent, SeasonFocus, SeasonPhase } from "./types";

export interface SeasonDraftInput {
  objective: string;
  events: SeasonEvent[];
  ctl: number | null;
  ftp: number | null;
  recentWeeklyTss: number | null;
  limiter: { system: SeasonFocus | null; confidence: "low" | "medium" | "high" };
  recentFocuses: SeasonFocus[]; // most recent last
}

const BUILD_FOCI: SeasonFocus[] = ["threshold", "vo2max", "anaerobic", "durability"];

// KB: "base is non-negotiable." Lead with a base touch when the recent window carries none.
export function needsBaseGate(recentFocuses: SeasonFocus[]): boolean {
  return !recentFocuses.slice(-4).includes("aerobic-base");
}

// Weakest system first when confident; else default rotation. Never repeat the last focus (KB variety).
export function nextBuildFocus(
  limiter: SeasonDraftInput["limiter"],
  recentFocuses: SeasonFocus[]
): SeasonFocus {
  const last = recentFocuses[recentFocuses.length - 1] ?? null;
  const wanted =
    limiter.system && limiter.confidence !== "low" && BUILD_FOCI.includes(limiter.system)
      ? limiter.system
      : null;
  if (wanted && wanted !== last) return wanted;
  const order = defaultBuildOrder();
  return order.find((f) => f !== last) ?? order[0];
}

function period(focus: SeasonFocus, phase: SeasonPhase, startDate: string, confidence: FocusPeriod["confidence"], rationale: string): FocusPeriod {
  return {
    focus, phase, startDate,
    plannedWeeks: focus === "sharpen" ? 1 : SEASON_CONSTANTS.weeks[focus],
    intensitySplit: SEASON_CONSTANTS.split[focus],
    targetWeeklyTss: null, // assigned in Task 4
    deloadWeek: false, // assigned in Task 3
    rationale, source: "derived", confidence,
  };
}

// Mode-C rolling cycle: base-gate → rotating limiter-focus build periods → a realize week. (Deload + load
// targets + the event overlay are layered by later helpers.) Drafts SEASON_CONSTANTS.horizonPeriods ahead.
export function draftSeasonArc(input: SeasonDraftInput, today: string): FocusPeriod[] {
  const periods: FocusPeriod[] = [];
  const recent = [...input.recentFocuses];
  let cursor = today;
  const conf = input.limiter.confidence;

  if (needsBaseGate(recent)) {
    periods.push(period("aerobic-base", "base", cursor, conf, "Aerobic base — the ceiling for every later phase (KB)."));
    recent.push("aerobic-base");
    cursor = addWeeks(cursor, periods[periods.length - 1].plannedWeeks);
  }

  while (periods.length < SEASON_CONSTANTS.horizonPeriods - 1) {
    const focus = nextBuildFocus(input.limiter, recent);
    const why =
      input.limiter.system === focus && conf !== "low"
        ? `Build ${focus} — your most depressed system relative to your engine.`
        : `Build ${focus} — rotating the quality focus (KB: avoid repeating one stimulus).`;
    periods.push(period(focus, "build", cursor, conf, why));
    recent.push(focus);
    cursor = addWeeks(cursor, periods[periods.length - 1].plannedWeeks);
  }

  periods.push(period("sharpen", "build", cursor, conf, "Realize — a lighter week to absorb the block and re-test."));
  return periods;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/season.test.ts` — Expected: PASS. Then `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add lib/season.ts lib/season.test.ts
git commit -m "feat(season): Mode-C draftSeasonArc — base-gate + limiter rotation + realize (MACRO-2)"
```

---

### Task 3: Deload cadence

**Files:** Modify `lib/season.ts`; Test `lib/season.test.ts`

**Interfaces:**
- Consumes: `FocusPeriod`, `SEASON_CONSTANTS`.
- Produces: `applyDeloadCadence(periods: FocusPeriod[], tight: boolean): FocusPeriod[]` (marks `deloadWeek: true` on periods ending a loading run every 3rd–4th cumulative week). `draftSeasonArc` calls it with a new `input.heavyFatigue: boolean`.

- [ ] **Step 1: Write the failing test**

```ts
import { applyDeloadCadence } from "./season";

describe("deload cadence", () => {
  const p = (weeks: number): import("./types").FocusPeriod => ({
    focus: "threshold", phase: "build", startDate: "2026-07-01", plannedWeeks: weeks,
    intensitySplit: "80/20", targetWeeklyTss: null, deloadWeek: false, rationale: "", source: "derived", confidence: "medium",
  });
  it("flags a deload after ~3 loading weeks (3:1 default)", () => {
    const out = applyDeloadCadence([p(2), p(2), p(2)], false); // cumulative 2,4,6 wk
    expect(out[0].deloadWeek).toBe(false); // 2 wk in
    expect(out[1].deloadWeek).toBe(true); // crosses the 4-week (3:1) boundary
  });
  it("tightens to 2:1 under heavy fatigue", () => {
    const out = applyDeloadCadence([p(2), p(2)], true); // boundary at 3 wk
    expect(out[0].deloadWeek).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run lib/season.test.ts -t "deload cadence"` → FAIL.

- [ ] **Step 3: Implement**

```ts
// Mark the period that crosses each deload boundary (30–50% volume cut lands in its trailing week).
export function applyDeloadCadence(periods: FocusPeriod[], tight: boolean): FocusPeriod[] {
  const every = tight ? SEASON_CONSTANTS.deloadTightEveryWeeks : SEASON_CONSTANTS.deloadEveryWeeks;
  let weeksSinceDeload = 0;
  return periods.map((p) => {
    weeksSinceDeload += p.plannedWeeks;
    if (weeksSinceDeload >= every) {
      weeksSinceDeload = 0;
      return { ...p, deloadWeek: true };
    }
    return { ...p, deloadWeek: false };
  });
}
```

Then in `draftSeasonArc`: add `heavyFatigue: boolean` to `SeasonDraftInput`, and before `return periods;` change to `return applyDeloadCadence(periods, input.heavyFatigue);`. Update `baseInput` test helper in Task 2's tests to include `heavyFatigue: false`.

- [ ] **Step 4: Run to verify pass** — `npx vitest run lib/season.test.ts` → PASS; `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add lib/season.ts lib/season.test.ts
git commit -m "feat(season): deload cadence (3:1 default, 2:1 under fatigue)"
```

---

### Task 4: Load envelope (ACWR-capped ramp + first-period seed)

**Files:** Modify `lib/season.ts`; Test `lib/season.test.ts`

**Interfaces:**
- Produces: `assignLoadTargets(periods: FocusPeriod[], seedWeeklyTss: number | null, acwrCeiling: number): FocusPeriod[]` — ramps each period's `targetWeeklyTss` ~+`loadRampPct`% off the prior period (first period off `seedWeeklyTss`), capped so the implied acute:chronic step never exceeds `acwrCeiling` (use `DEFAULT_ACWR_BANDS.optimalHigh` from `./calibration`). `null` seed → all targets stay `null`.

- [ ] **Step 1: Write the failing test**

```ts
import { assignLoadTargets } from "./season";

describe("load envelope", () => {
  const p = (): import("./types").FocusPeriod => ({
    focus: "threshold", phase: "build", startDate: "2026-07-01", plannedWeeks: 3,
    intensitySplit: "80/20", targetWeeklyTss: null, deloadWeek: false, rationale: "", source: "derived", confidence: "medium",
  });
  it("ramps ~+6% off the seed, capped by ACWR", () => {
    const out = assignLoadTargets([p(), p(), p()], 400, 1.3);
    expect(out[0].targetWeeklyTss).toBe(424); // 400 * 1.06
    expect(out[1].targetWeeklyTss!).toBeGreaterThan(out[0].targetWeeklyTss!);
    // never a jump beyond the ACWR ceiling vs the seed-derived chronic
    expect(out[2].targetWeeklyTss! / 400).toBeLessThanOrEqual(1.3 + 0.001);
  });
  it("withholds targets when there is no seed (no FTP/CTL)", () => {
    expect(assignLoadTargets([p()], null, 1.3)[0].targetWeeklyTss).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure** → FAIL.

- [ ] **Step 3: Implement**

```ts
import { DEFAULT_ACWR_BANDS } from "./calibration";

export function assignLoadTargets(periods: FocusPeriod[], seedWeeklyTss: number | null, acwrCeiling: number): FocusPeriod[] {
  if (seedWeeklyTss === null || !Number.isFinite(seedWeeklyTss) || seedWeeklyTss <= 0) {
    return periods.map((p) => ({ ...p, targetWeeklyTss: null }));
  }
  const ramp = 1 + SEASON_CONSTANTS.loadRampPct / 100;
  const ceiling = seedWeeklyTss * acwrCeiling; // never let a target imply an acute:chronic past the band
  let prev = seedWeeklyTss;
  return periods.map((p) => {
    const target = p.deloadWeek ? Math.round(prev * 0.6) : Math.min(Math.round(prev * ramp), Math.round(ceiling));
    if (!p.deloadWeek) prev = target;
    return { ...p, targetWeeklyTss: target };
  });
}
```

Then in `draftSeasonArc`, after the deload step, call `assignLoadTargets(periods, input.recentWeeklyTss, DEFAULT_ACWR_BANDS.optimalHigh)` and return that (only when `input.ftp !== null && input.ctl !== null`; otherwise pass `null` seed so targets stay null).

- [ ] **Step 4: Run to verify pass** → PASS; `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add lib/season.ts lib/season.test.ts
git commit -m "feat(season): ACWR-capped weekly-TSS load envelope"
```

---

### Task 5: Event-anchored backward-schedule (built, dormant)

**Files:** Modify `lib/season.ts`; Test `lib/season.test.ts`

**Interfaces:**
- Produces: `backwardScheduleFromEvent(event: SeasonEvent, input: SeasonDraftInput, today: string): FocusPeriod[]`. `draftSeasonArc` branches: if `input.events` has an A-event with a future date, delegate to it; else the Mode-C cycle.

- [ ] **Step 1: Write the failing tests**

```ts
import { backwardScheduleFromEvent } from "./season";

describe("event-anchored mode (dormant until an A-event exists)", () => {
  it("back-fills taper → peak ending on the A-date, build/base before", () => {
    const ev = { name: "Gran Fondo", date: "2026-10-01", priority: "A" as const };
    const arc = backwardScheduleFromEvent(ev, baseInput(), "2026-07-01");
    const last = arc[arc.length - 1];
    expect(last.phase).toBe("taper");
    // taper ends on (or just before) the event date
    expect(new Date(addWeeksExpected(last)).getTime()).toBeGreaterThanOrEqual(Date.parse("2026-09-29"));
    expect(arc.some((p) => p.phase === "peak")).toBe(true);
    expect(arc[0].startDate).toBe("2026-07-01");
  });
  it("clamps to a taper-only when the runway is too short", () => {
    const ev = { name: "KOM", date: "2026-07-10", priority: "A" as const };
    const arc = backwardScheduleFromEvent(ev, baseInput(), "2026-07-01");
    expect(arc.every((p) => p.phase === "taper" || p.phase === "peak")).toBe(true);
  });
  it("draftSeasonArc routes to the event scheduler only for a future A-event", () => {
    const arc = draftSeasonArc(baseInput({ events: [{ name: "X", date: "2026-10-01", priority: "A" }] }), "2026-07-01");
    expect(arc.some((p) => p.phase === "taper")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure** → FAIL.

- [ ] **Step 3: Implement**

```ts
function weeksBetween(fromIso: string, toIso: string): number {
  return Math.max(0, Math.floor((Date.parse(toIso) - Date.parse(fromIso)) / (7 * 86_400_000)));
}

// Backward schedule from an A-event: taper (1–2 wk) ends on the date, peak (4–6 wk) before, then build/base
// fill the runway. Clamps to taper(/peak) only when the runway can't fit a real build.
export function backwardScheduleFromEvent(event: SeasonEvent, input: SeasonDraftInput, today: string): FocusPeriod[] {
  const runway = weeksBetween(today, event.date);
  const conf = input.limiter.confidence;
  const mk = (focus: SeasonFocus, phase: SeasonPhase, weeks: number, rationale: string): Omit<FocusPeriod, "startDate"> => ({
    focus, phase, plannedWeeks: weeks, intensitySplit: SEASON_CONSTANTS.split[focus],
    targetWeeklyTss: null, deloadWeek: false, rationale, source: "derived", confidence: conf,
  });
  const taper = mk("sharpen", "taper", SEASON_CONSTANTS.taperWeeks, `Taper into ${event.name} — cut volume, hold intensity (KB).`);
  const tail: Omit<FocusPeriod, "startDate">[] = [];
  if (runway <= SEASON_CONSTANTS.taperWeeks + 1) {
    tail.push(taper); // too close — taper only
  } else {
    const peakWeeks = Math.min(SEASON_CONSTANTS.peakWeeks, runway - SEASON_CONSTANTS.taperWeeks - 1);
    tail.push(mk("sharpen", "peak", Math.max(1, peakWeeks), `Peak/sharpen for ${event.name} — race-specific.`));
    let filled = peakWeeks + SEASON_CONSTANTS.taperWeeks;
    const order = [...defaultBuildOrder()];
    let i = 0;
    while (filled < runway) {
      const focus = order[i % order.length];
      const w = Math.min(SEASON_CONSTANTS.weeks[focus], runway - filled);
      if (w <= 0) break;
      tail.unshift(mk(focus, filled + SEASON_CONSTANTS.weeks[focus] >= runway - 2 ? "peak" : "build", w, `Build ${focus} toward ${event.name}.`));
      filled += w; i += 1;
    }
    tail.push(taper);
  }
  // Date them forward from today.
  let cursor = today;
  const dated: FocusPeriod[] = [];
  for (const t of tail) {
    dated.push({ ...t, startDate: cursor });
    cursor = addWeeks(cursor, t.plannedWeeks);
  }
  return applyDeloadCadence(dated, input.heavyFatigue);
}
```

Then in `draftSeasonArc`, at the top: `const aEvent = input.events.find((e) => e.priority === "A" && Date.parse(e.date) > Date.parse(today)); if (aEvent) return backwardScheduleFromEvent(aEvent, input, today);`

- [ ] **Step 4: Run to verify pass** → PASS; `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add lib/season.ts lib/season.test.ts
git commit -m "feat(season): dormant event-anchored backward-schedule + short-runway clamp"
```

---

### Task 6: Re-plan — freeze past, preserve overrides, idempotent

**Files:** Modify `lib/season.ts`; Test `lib/season.test.ts`

**Interfaces:**
- Produces: `replanSeasonArc(plan: SeasonPlan, input: SeasonDraftInput, achievedTssFor: (period: FocusPeriod) => number | null, today: string): SeasonPlan`. Freezes periods whose end is ≤ today (stamping `achievedTss`), preserves any future `source: "override"` period, and re-drafts the remaining derived tail from `today`.

- [ ] **Step 1: Write the failing tests**

```ts
import { replanSeasonArc } from "./season";
import type { SeasonPlan } from "./types";

const planWith = (periods: SeasonPlan["periods"]): SeasonPlan => ({ objective: "get faster", events: [], periods, updatedAt: "" });

describe("replanSeasonArc", () => {
  const achieved = () => 400;
  it("freezes elapsed periods with achievedTss and never re-drafts them", () => {
    const past = { focus: "aerobic-base" as const, phase: "base" as const, startDate: "2026-06-01", plannedWeeks: 3, intensitySplit: "90/10", targetWeeklyTss: 380, deloadWeek: false, rationale: "", source: "derived" as const, confidence: "medium" as const };
    const out = replanSeasonArc(planWith([past]), baseInput(), achieved, "2026-07-01");
    const frozen = out.periods.find((p) => p.startDate === "2026-06-01")!;
    expect(frozen.achievedTss).toBe(400);
  });
  it("preserves a future override period", () => {
    const ovr = { focus: "durability" as const, phase: "build" as const, startDate: "2026-07-15", plannedWeeks: 3, intensitySplit: "80/20", targetWeeklyTss: null, deloadWeek: false, rationale: "mine", source: "override" as const, confidence: "high" as const };
    const out = replanSeasonArc(planWith([ovr]), baseInput(), achieved, "2026-07-01");
    expect(out.periods.some((p) => p.source === "override" && p.rationale === "mine")).toBe(true);
  });
  it("is idempotent on unchanged inputs", () => {
    const a = replanSeasonArc(planWith([]), baseInput({ recentFocuses: [] }), achieved, "2026-07-01");
    const b = replanSeasonArc(a, baseInput({ recentFocuses: [] }), achieved, "2026-07-01");
    expect(b.periods.map((p) => p.focus + p.startDate)).toEqual(a.periods.map((p) => p.focus + p.startDate));
  });
});
```

- [ ] **Step 2: Run to verify failure** → FAIL.

- [ ] **Step 3: Implement**

```ts
import type { SeasonPlan } from "./types";

const periodEnd = (p: FocusPeriod): string => addWeeks(p.startDate, p.plannedWeeks);

export function replanSeasonArc(
  plan: SeasonPlan,
  input: SeasonDraftInput,
  achievedTssFor: (period: FocusPeriod) => number | null,
  today: string
): SeasonPlan {
  // Past = periods that have already ended → frozen with achieved load, never re-drafted.
  const frozen = plan.periods
    .filter((p) => periodEnd(p) <= today)
    .map((p) => ({ ...p, achievedTss: p.achievedTss ?? achievedTssFor(p) ?? undefined }));
  // Future overrides the athlete edited → preserved verbatim.
  const overrides = plan.periods.filter((p) => periodEnd(p) > today && p.source === "override");
  // Re-draft the derived tail from today, seeded by what actually happened.
  const recentFocuses = frozen.slice(-4).map((p) => p.focus);
  const draftStart = overrides.length ? periodEnd(overrides[overrides.length - 1]) : today;
  const derived = draftSeasonArc({ ...input, recentFocuses }, draftStart);
  const periods = [...frozen, ...overrides, ...derived].sort((a, b) => a.startDate.localeCompare(b.startDate));
  return { ...plan, periods, updatedAt: plan.updatedAt };
}
```

- [ ] **Step 4: Run to verify pass** → PASS; `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add lib/season.ts lib/season.test.ts
git commit -m "feat(season): rolling re-plan — frozen past, preserved overrides, idempotent"
```

---

### Task 7: `seasonContext` formatter + `validateSeasonFit`

**Files:** Modify `lib/season.ts`; Test `lib/season.test.ts`

**Interfaces:**
- Produces: `currentPeriod(plan, today): FocusPeriod | null`; `formatSeasonContext(plan, today): string | null`; `validateSeasonFit(days: PlannedDay[], period: FocusPeriod, ftp: number): string[]`.

- [ ] **Step 1: Write the failing tests**

```ts
import { currentPeriod, formatSeasonContext, validateSeasonFit } from "./season";
import type { PlannedDay } from "./types";

describe("season context + fit validation", () => {
  const cur = { focus: "vo2max" as const, phase: "build" as const, startDate: "2026-06-29", plannedWeeks: 4, intensitySplit: "80/20", targetWeeklyTss: 450, deloadWeek: false, rationale: "", source: "derived" as const, confidence: "high" as const };
  it("formats a one-line season context for the prompt", () => {
    const line = formatSeasonContext(planWith([cur]), "2026-07-01")!;
    expect(line).toContain("SEASON CONTEXT");
    expect(line).toContain("vo2max");
    expect(line).toContain("450");
  });
  it("returns null when the plan has no current period", () => {
    expect(formatSeasonContext(planWith([]), "2026-07-01")).toBeNull();
  });
  it("warns when a base period's block is too hard", () => {
    const base = { ...cur, focus: "aerobic-base" as const, phase: "base" as const, intensitySplit: "90/10" };
    const days: PlannedDay[] = [
      { date: "2026-07-01", weekNumber: 1, weekTheme: "", name: "VO2", type: "VO2max", durationMin: 60, workoutText: "", description: "" },
      { date: "2026-07-02", weekNumber: 1, weekTheme: "", name: "Z2", type: "Z2", durationMin: 60, workoutText: "", description: "" },
    ];
    expect(validateSeasonFit(days, base, 280).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify failure** → FAIL.

- [ ] **Step 3: Implement**

```ts
import type { PlannedDay } from "./types";

export function currentPeriod(plan: SeasonPlan, today: string): FocusPeriod | null {
  return plan.periods.find((p) => p.startDate <= today && periodEnd(p) > today) ?? null;
}

export function formatSeasonContext(plan: SeasonPlan, today: string): string | null {
  const p = currentPeriod(plan, today);
  if (!p) return null;
  const wk = Math.max(1, weeksBetween(p.startDate, today) + 1);
  const load = p.targetWeeklyTss != null ? ` · target ~${p.targetWeeklyTss} TSS/wk` : "";
  const deload = p.deloadWeek ? " · deload week" : "";
  return `SEASON CONTEXT: phase ${p.phase} · focus ${p.focus} · wk ${wk} of ${p.plannedWeeks}${load}${deload}. ${p.rationale}`;
}

// Non-blocking warnings, mirroring validateSchedule/validateNutrition. A base period should skew easy;
// flag a block whose hard-session share contradicts the period's intensity intent.
export function validateSeasonFit(days: PlannedDay[], period: FocusPeriod, ftp: number): string[] {
  void ftp;
  const warnings: string[] = [];
  const rides = days.filter((d) => d.type !== "Rest" && d.type !== "Strength");
  if (rides.length === 0) return warnings;
  const HARD = new Set(["Threshold", "VO2max", "SIT", "RaceSim"]);
  const hardShare = rides.filter((d) => HARD.has(d.type)).length / rides.length;
  if (period.phase === "base" && hardShare > 0.2) {
    warnings.push(`Season fit: this is a base/aerobic period (${period.intensitySplit}), but ${Math.round(hardShare * 100)}% of sessions are hard — expected mostly Z2.`);
  }
  return warnings;
}
```

- [ ] **Step 4: Run to verify pass** → PASS; `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add lib/season.ts lib/season.test.ts
git commit -m "feat(season): seasonContext formatter + validateSeasonFit warning"
```

---

### Task 8: `/api/season` route (GET/PUT) + pure input validator

**Files:**
- Modify: `lib/season.ts` (add `validateSeasonPlanInput`)
- Create: `app/api/season/route.ts`
- Test: `lib/season.test.ts`

**Interfaces:**
- Produces: `validateSeasonPlanInput(body: unknown): { objective: string; events: SeasonEvent[] } | string` (returns a string error message on invalid, matching `parseBlockParams`' style). The route persists via `writeSeasonPlan`, preserving engine-drafted `periods`.

- [ ] **Step 1: Write the failing test**

```ts
import { validateSeasonPlanInput } from "./season";

describe("validateSeasonPlanInput", () => {
  it("accepts an objective + well-formed events", () => {
    const r = validateSeasonPlanInput({ objective: "get faster", events: [{ name: "GF", date: "2026-10-01", priority: "A" }] });
    expect(typeof r).not.toBe("string");
  });
  it("rejects a bad event date / priority", () => {
    expect(typeof validateSeasonPlanInput({ objective: "x", events: [{ name: "GF", date: "nope", priority: "A" }] })).toBe("string");
    expect(typeof validateSeasonPlanInput({ objective: "x", events: [{ name: "GF", date: "2026-10-01", priority: "Z" }] })).toBe("string");
  });
});
```

- [ ] **Step 2: Run to verify failure** → FAIL.

- [ ] **Step 3: Implement `validateSeasonPlanInput` in `lib/season.ts`**

```ts
export function validateSeasonPlanInput(body: unknown): { objective: string; events: SeasonEvent[] } | string {
  if (!body || typeof body !== "object") return "Request body must be a JSON object.";
  const b = body as Record<string, unknown>;
  const objective = typeof b.objective === "string" ? b.objective.trim() : "";
  const rawEvents = Array.isArray(b.events) ? b.events : [];
  const events: SeasonEvent[] = [];
  for (const e of rawEvents) {
    if (!e || typeof e !== "object") return "Each event must be an object.";
    const ev = e as Record<string, unknown>;
    const name = typeof ev.name === "string" ? ev.name.trim() : "";
    const date = typeof ev.date === "string" ? ev.date : "";
    const priority = ev.priority;
    if (!name) return "Event name is required.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return "Event date must be a valid YYYY-MM-DD.";
    if (priority !== "A" && priority !== "B" && priority !== "C") return "Event priority must be A, B or C.";
    events.push({ name, date, priority });
  }
  return { objective, events };
}
```

- [ ] **Step 4: Create `app/api/season/route.ts`** (mirror the `disposition`/`settings` route style)

```ts
import { NextResponse } from "next/server";
import { readSeasonPlan, writeSeasonPlan } from "@/lib/data-store";
import { validateSeasonPlanInput } from "@/lib/season";

export async function GET() {
  const plan = await readSeasonPlan();
  return NextResponse.json({ plan });
}

export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = validateSeasonPlanInput(body);
  if (typeof parsed === "string") return NextResponse.json({ error: parsed }, { status: 400 });
  const current = await readSeasonPlan();
  // Owned fields come from the athlete; engine-drafted periods are preserved (re-drafted on generate).
  await writeSeasonPlan({ ...current, objective: parsed.objective, events: parsed.events });
  return NextResponse.json({ plan: await readSeasonPlan() });
}
```

- [ ] **Step 5: Run to verify pass** — `npx vitest run lib/season.test.ts` → PASS; `npx tsc --noEmit`; `curl -s -X GET http://localhost:3000/api/season` returns `{"plan":{...}}` when dev server is up.

- [ ] **Step 6: Commit**

```bash
git add lib/season.ts lib/season.test.ts app/api/season/route.ts
git commit -m "feat(season): /api/season GET/PUT + pure input validator"
```

---

### Task 9: Generate-flow integration — inject seasonContext, widen lengthWeeks, stamp on write

**Files:**
- Modify: `app/api/generate/route.ts`
- Modify: `app/api/write/route.ts`
- Modify: `lib/season.ts` (add `resolveLimiter` adapter if needed — see below)

**Interfaces:**
- Consumes: `readSeasonPlan`, `replanSeasonArc`, `currentPeriod`, `formatSeasonContext`, `validateSeasonFit`, `analyzePowerProfile` (existing), rolling-baselines `avgTss90d`, `sync.fitness.ctl`.
- Produces: a `seasonContext` string appended to the dynamic prompt half; season-fit warnings; `seasonFocus`/`seasonPhase` stamped onto the written block.

- [ ] **Step 1: Widen the runtime length check** in `app/api/generate/route.ts` `parseBlockParams` (line 46)

```ts
  if (lengthWeeks !== 2 && lengthWeeks !== 4 && lengthWeeks !== 6 && lengthWeeks !== 8) return "lengthWeeks must be 2, 4, 6 or 8.";
```

- [ ] **Step 2: Resolve + inject season context** in `app/api/generate/route.ts` — add `readSeasonPlan` to the imports (line 12) and the `Promise.all` (line 80), then after the `durabilityContext`/`deferredContext` block (~line 181) add:

```ts
    // Macro periodization (MACRO-3): re-plan the arc from current fitness, then hand the generator the
    // current focus period as context. Best-effort — a failure here must never block generation.
    let seasonContext = "";
    let currentSeasonPeriod: import("@/lib/types").FocusPeriod | null = null;
    try {
      const existingSeason = await readSeasonPlan();
      const pp = analyzePowerProfile(sync?.powerCurveAllTime ?? sync?.powerCurve ?? [], profile.performance.ftp, latestWeight);
      const limiter = pp?.easyWin ? { system: mapSystemToFocus(pp.easyWin.system), confidence: pp.confident ? "high" as const : "low" as const } : { system: null, confidence: "low" as const };
      const today = new Date().toISOString().slice(0, 10);
      // Preserve the athlete's owned objective/events (Task 8 PUT); the engine only re-drafts `periods`.
      const replanned = replanSeasonArc(
        existingSeason,
        { objective: existingSeason.objective, events: existingSeason.events, ctl: sync?.fitness.ctl ?? null, ftp: profile.performance.ftp, recentWeeklyTss: baselines.avgTss90d != null ? Math.round(baselines.avgTss90d * 7) : null, limiter, recentFocuses: [], heavyFatigue: !!(signals.loadRamp?.triggered) },
        () => null,
        today
      );
      await writeSeasonPlan(replanned);
      currentSeasonPeriod = currentPeriod(replanned, today);
      const line = formatSeasonContext(replanned, today);
      if (line) seasonContext = `\n${line}`;
    } catch { /* season layer is best-effort */ }
```

Add `readSeasonPlan, writeSeasonPlan` to the data-store import and `replanSeasonArc, currentPeriod, formatSeasonContext, validateSeasonFit` from `@/lib/season`. Add a small local `mapSystemToFocus` mapping `power-profile` systems (`neuromuscular|anaerobic|vo2max|threshold`) to `SeasonFocus` (`anaerobic|anaerobic|vo2max|threshold`).

- [ ] **Step 3: Append `seasonContext` to the dynamic prompt** — in the `buildSystemPrompt` call (line 205) add `+ seasonContext` to the concatenated dynamic string.

- [ ] **Step 4: Add the season-fit warning** — after the `validateSessionRequirements` push (line 250):

```ts
    if (currentSeasonPeriod) warnings.push(...validateSeasonFit(days, currentSeasonPeriod, profile.performance.ftp));
```

- [ ] **Step 5: Stamp the block on write** — in `app/api/write/route.ts`, when constructing the `CurrentBlock`, read the current period and stamp `seasonFocus`/`seasonPhase`. First add optional fields to `CurrentBlock` in `lib/types.ts`:

```ts
  seasonFocus?: string; // MACRO: the focus period this block was generated under
  seasonPhase?: string;
```

Then in the write route, resolve `currentPeriod(await readSeasonPlan(), today)` and include `...(period ? { seasonFocus: period.focus, seasonPhase: period.phase } : {})` in the `CurrentBlock` object.

- [ ] **Step 6: Verify** — `npx tsc --noEmit && npm test` (all green). With the dev server up: generate a block and confirm the response `plan.raw`/prompt path runs without error and any season-fit mismatch surfaces in `warnings`.

- [ ] **Step 7: Commit**

```bash
git add app/api/generate/route.ts app/api/write/route.ts lib/types.ts lib/season.ts
git commit -m "feat(season): inject seasonContext + season-fit warning into generation; widen lengthWeeks 2|4|6|8; stamp block"
```

---

### Task 10: UI — `SeasonRoadmap` on /plan (roadmap stepper + event flag)

**Files:**
- Modify: `lib/season.ts` (add pure `roadmapView` helper)
- Create: `components/SeasonRoadmap.tsx`
- Modify: `components/dashboard/PlanView.tsx` (render it at the top)
- Test: `lib/season.test.ts`

**Interfaces:**
- Produces: `roadmapView(plan, today): { focus: SeasonFocus; phase: SeasonPhase; label: string; weeks: number; status: "done" | "current" | "upcoming"; deloadWeek: boolean; targetWeeklyTss: number | null }[]` — the pure view-model the component renders.

- [ ] **Step 1: Write the failing test**

```ts
import { roadmapView } from "./season";

describe("roadmapView", () => {
  it("marks done / current / upcoming by date", () => {
    const periods = [
      { focus: "aerobic-base" as const, phase: "base" as const, startDate: "2026-06-01", plannedWeeks: 3, intensitySplit: "90/10", targetWeeklyTss: 380, deloadWeek: false, rationale: "", source: "derived" as const, confidence: "medium" as const },
      { focus: "vo2max" as const, phase: "build" as const, startDate: "2026-06-29", plannedWeeks: 4, intensitySplit: "80/20", targetWeeklyTss: 450, deloadWeek: false, rationale: "", source: "derived" as const, confidence: "high" as const },
      { focus: "durability" as const, phase: "build" as const, startDate: "2026-07-27", plannedWeeks: 3, intensitySplit: "80/20", targetWeeklyTss: 470, deloadWeek: false, rationale: "", source: "derived" as const, confidence: "high" as const },
    ];
    const v = roadmapView(planWith(periods), "2026-07-01");
    expect(v.map((x) => x.status)).toEqual(["done", "current", "upcoming"]);
  });
});
```

- [ ] **Step 2: Run to verify failure** → FAIL.

- [ ] **Step 3: Implement `roadmapView`** in `lib/season.ts`

```ts
import type { SeasonFocus, SeasonPhase } from "./types";

const FOCUS_LABEL: Record<SeasonFocus, string> = {
  "aerobic-base": "Aerobic", threshold: "Threshold", vo2max: "VO2max", anaerobic: "Anaerobic", durability: "Durability", sharpen: "Sharpen",
};

export function roadmapView(plan: SeasonPlan, today: string) {
  return plan.periods.map((p) => ({
    focus: p.focus,
    phase: p.phase,
    label: FOCUS_LABEL[p.focus],
    weeks: p.plannedWeeks,
    deloadWeek: p.deloadWeek,
    targetWeeklyTss: p.targetWeeklyTss,
    status: (periodEnd(p) <= today ? "done" : p.startDate <= today ? "current" : "upcoming") as "done" | "current" | "upcoming",
  }));
}
```

- [ ] **Step 4: Run to verify pass** → PASS.

- [ ] **Step 5: Create `components/SeasonRoadmap.tsx`** (roadmap stepper + event flag; colours per the approved mockup)

```tsx
"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { localToday } from "@/lib/date";
import { roadmapView } from "@/lib/season";
import type { SeasonPlan } from "@/lib/types";

const FOCUS_COLOR: Record<string, string> = {
  Aerobic: "#00d4ff", Threshold: "#f5a623", VO2max: "#ff49c8", Anaerobic: "#a06bff", Durability: "#38d39f", Sharpen: "#7fd8ea",
};

export default function SeasonRoadmap() {
  const [plan, setPlan] = useState<SeasonPlan | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { plan } = await api<{ plan: SeasonPlan }>("/api/season");
        if (!cancelled) setPlan(plan);
      } catch { /* season is optional context */ }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!plan || plan.periods.length === 0) return null;
  const today = localToday();
  const view = roadmapView(plan, today);
  const nextEvent = plan.events.filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;

  return (
    <section className="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Season</h2>
        <span className="text-[10px] text-zinc-500 dark:text-zinc-400">{plan.objective || "get faster"}</span>
      </div>
      <div className="flex gap-2 overflow-x-auto">
        {view.map((p, i) => (
          <div key={i} className={`min-w-0 flex-1 rounded-md border px-2.5 py-2 ${p.status === "current" ? "border-[#ff49c8] shadow-[0_0_0_1px_#ff49c8]" : "border-zinc-200 dark:border-zinc-700"} ${p.status === "done" ? "opacity-55" : ""}`}>
            <p className="text-[8px] font-bold uppercase tracking-wide" style={{ color: FOCUS_COLOR[p.label] }}>
              {p.status === "done" ? "✓ " : p.status === "current" ? "● " : "○ "}{p.phase}
            </p>
            <p className="text-[11px] font-semibold text-zinc-800 dark:text-zinc-100">{p.label}</p>
            <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
              {p.deloadWeek ? "deload · " : ""}{p.weeks} wk{p.targetWeeklyTss != null ? ` · ${p.targetWeeklyTss} TSS/wk` : ""}
            </p>
          </div>
        ))}
        {nextEvent && (
          <div className="flex min-w-[64px] flex-col items-center justify-center rounded-md border border-[#ffcf4d] bg-[#ffcf4d]/10 px-2 py-2 text-center">
            <span className="text-base leading-none">🏁</span>
            <span className="mt-1 text-[9px] font-bold text-[#b8952f] dark:text-[#ffcf4d]">{nextEvent.name}</span>
            <span className="text-[9px] text-zinc-500 dark:text-zinc-400">{nextEvent.date.slice(5)}</span>
          </div>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 6: Render it at the top of `PlanView`** — in `components/dashboard/PlanView.tsx`, import it (`import SeasonRoadmap from "../SeasonRoadmap";`) and add `<SeasonRoadmap />` as the first child inside the top-level `<div className="space-y-3">` (line 182), above the generator.

- [ ] **Step 7: Verify** — `npx tsc --noEmit && npm test` (all green). With the dev server up, load `/plan`: the roadmap renders when a plan exists (generate once to populate it), hides gracefully when empty. `preview_screenshot` to confirm the stepper + (no) event flag.

- [ ] **Step 8: Commit**

```bash
git add lib/season.ts lib/season.test.ts components/SeasonRoadmap.tsx components/dashboard/PlanView.tsx
git commit -m "feat(season): SeasonRoadmap stepper + event flag on /plan (MACRO UI)"
```

---

## Self-Review

**1. Spec coverage:**
- Data model (§4) → Task 1. ✓
- Mode-C engine (§5) → Tasks 2–4. ✓
- Event-anchored dormant mode (§5) → Task 5. ✓
- Re-plan / frozen-past / override (§4, §5) → Task 6. ✓
- Block-generation integration: seasonContext + validateSeasonFit + lengthWeeks 2|4|6|8 + write stamp (§6) → Tasks 7, 9. ✓
- `/api/season` (§6) → Task 8. ✓
- UI roadmap + event flag (§7) → Task 10. ✓
- Degradation: no-FTP → null targets (Task 4), low-confidence limiter → default order (Task 2), best-effort injection (Task 9), empty-plan UI hides (Task 10). ✓
- Testing (§10) → tests in every task. ✓
- **Gap noted:** `SeasonPlan.objective` is written empty by the generate-route re-plan (Task 9 passes `objective: ""` into the input, but Task 8's PUT preserves the athlete's objective in the store; the re-plan in Task 9 must read+preserve `plan.objective`/`plan.events`, not overwrite them). **Fix folded into Task 9 Step 2:** pass the *read plan's* `objective`/`events` into the `replanSeasonArc` input rather than empty literals, and `writeSeasonPlan` preserves them. Adjust the Task 9 snippet to `const existing = await readSeasonPlan();` and build the input from `existing.objective`/`existing.events`.

**2. Placeholder scan:** No TBD/TODO; every code step has real code. ✓

**3. Type consistency:** `SeasonDraftInput` gains `heavyFatigue` in Task 3 — Task 2's `baseInput` test helper and Task 9's input object must include it (called out in Task 3 Step 3 and present in Task 9). `draftSeasonArc(input, today)` signature stable across Tasks 2–6. `currentPeriod`/`periodEnd`/`weeksBetween`/`addWeeks` defined once, reused. `roadmapView` status union matches the component. ✓

**Applied fix (Task 9 Step 2):** read the existing plan first and thread its `objective`/`events` into `replanSeasonArc`; do not pass empty literals.
