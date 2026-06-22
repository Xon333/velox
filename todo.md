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

Code-review follow-ups on the #2 context-stamp / TSB-derivation work (findings 1–4 fixed inline; 5–8 here):

- ☐ **CS-5 · derived deepFatigue can override a *manual* neighbour edge** · P2 `bug` — `resolveTsbEdgesOverride`
  returns `{ deepFatigue: derived, ...settings }`; if the athlete manually set `productiveOverload`/`balanced`,
  a derived `deepFatigue` can trip `resolveTsbModifierEdges`'s ordering-nudge and rewrite their manual value,
  violating "manual wins" for the non-derived edges. Resolve precedence per-edge before the ordering pass.
- ☐ **CS-6 · duplicate `readMorningChecks()` in one sync POST** · P3 `bug` — `app/api/sync/route.ts` reads the
  morning-check file twice per POST (ledger context-stamp ~L240 + the snapshot Promise.all ~L390): redundant
  I/O + a window for the two reads to disagree under a concurrent write. Read once and thread it down.
- ☐ **CS-7 · TSB-derivation confidence gate may be too strict to fire** · P3 `audit` — `deriveTsbDeepFatigue`
  needs ≥8 *under-executed planned-quality* sessions (`confidenceFromN`) before it takes effect; that's ~a
  season of failures, so the feature is near-inert in practice. Validate against real data; consider a
  TSB-specific threshold or weighting the contrast strength, not just the failure count.
- ☐ **CS-8 · derivation robustness + `median`/`round1` duplication** · P3 `audit` — the discrimination guard
  compares two medians that can each rest on one data point (one fluky success swings it); and `median` is
  new while `round1` is now redefined in `readiness.ts`/`score-log.ts`/etc. Extract a shared `lib/stats.ts`.

Add new bugs/feedback here as they come in; strategy → [ROADMAP.md](ROADMAP.md).

_Design/judgment calls that surfaced during the CR sweep now live in [ROADMAP.md](ROADMAP.md): power-zone
SoT vs personal override; the "Z2 dialed-in" overstatement; Recent-Baselines content / TSS-vs-Load naming;
whether IF should be replaced rather than annotated; CR-C observability (P8); CR-F per-carb checks (Track C)._
