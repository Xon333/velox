# CONTINUE — session handoff

A living "resume here" note. Point a fresh session at this file: _"read CONTINUE.md and continue."_
The canonical backlog is [ROADMAP.md](ROADMAP.md); completed work is in [ARCHIVE.md](ARCHIVE.md);
how the app works is [README.md](README.md). Update or clear this file as work moves.

_Last updated: after P5 shipped (deterministic schedule validator)._

---

## Working principle (the user's directive)
**Dial in the backend / second-brain logic / schemas FIRST, before adding new features.** So favour
the Platform & performance (P-series) + correctness items over the coaching-feature items for now.

## Shipped this session
- **P5** — deterministic schedule validator (`lib/schedule-validate.ts validateSchedule`): flags
  back-to-back hard days (date-adjacency, spans week boundary) + any week over the
  `qualitySessionsPerLoadingWeek` budget. Quality set = Threshold/VO2max/SIT/RaceSim. Folded into
  the generate route's `warnings[]` beside `validatePlanProtocol`. Warns only — never reorders.
  11 new tests. (Not yet committed.)
- Prior sessions: **P1** (`e357ca3`) prompt caching + singleton client; **P2** (`3d49b27`)
  structured tool-use generation (`lib/plan-schema.ts`; regex `plan-parser.ts` kept one release);
  **P3** (`0de91b5`) decoupled `/api/sync` from the LLM coach note + `warnings[]` in the nav rail.

## State of the tree
- **193 tests pass** (`npm test`), **`npx tsc --noEmit` clean**, **`npm run build` clean**.
- **Lint is pre-existing dirty** (~11 problems: React-compiler strictness, `prefer-const` in
  `calibration.ts`/`plan-parser.ts`, an unused `numArr` in `intervals-api.ts`, a `Today's`
  unescaped-entity). These predate this session and the build tolerates them — **don't attribute
  them to recent work or fix them inside an unrelated commit.**

## Next up (suggested order — backend first)
1. **P6 — Reliability quick-wins** (cheap, mostly-independent): `error.tsx` boundary,
   model+prompt-version stamping (schema touch on `TodayAnalysis`/`GeneratedPlan`/
   `BlockHistoryEntry`), export/import backup, `json-store` async mutex, re-analyse-today.
2. **P4 — Observability + generation caching**: generate-result cache (skip Claude when the prompt
   is byte-identical to a recent one), stream `/api/ask`, surface intervention coach-accuracy %,
   token/cost tracker in Settings.
- Then bigger platform: P7 (TanStack Query client), P8 (logging + AI-route rate-limit), P9 (PWA +
  streamed generation).
- Coaching features (after backend): **Weak-Point Optimizer ⭐**, **Goal-driven session selection ⭐**,
  per-athlete execution bands (#1), Second-brain learning upgrades, signal fusion (#5). Note: the
  user is researching the goal-driven-session-selection heuristics and will provide findings.

## Open threads / gotchas
- **`knowledge-base/` and `data/` are gitignored** (local user content). KB edits (e.g. the PW-1/3/9
  §10/§11 rules) live only on this machine; the generation-prompt rules that reference them ARE
  committed.
- **P2 fallback**: `plan-parser.ts` (regex) is retained for one release as the tool-use fallback —
  safe to delete once tool-use is proven in real generations.
- **P3 scope note**: the deterministic ride analysis is still gated on `isAnthropicConfigured()`
  (matches prior behaviour). Could be loosened later so metrics/PRs show even without Anthropic.
- **P1 caching economics**: only generation has a cache breakpoint; it nets out positive on the
  regenerate-loop / multiple-blocks-in-a-session, slight write premium on a true one-and-done.

## Verify before claiming done
`npx tsc --noEmit && npm run build && npm test` — and keep new pure logic unit-tested.
