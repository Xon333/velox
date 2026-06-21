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

Re-review of `63a9263` (CR-9..16 hardening). **RR-1..4 are the priority (P1).**

| ID | S | Pri | Type | Item |
|----|---|-----|------|------|
| RR-1 | ☑ | P1 | bug | **Rest-day reschedule path now honest deload.** Proactive reschedule is easy-only (`findMakeUpSlot(..., ["easy"])`); no easy slot → today deloads to Recovery + carries forward, rest days never raided. `toWasRest` removed from the interface, route response, and `MorningCheckIn`. [reschedule.ts](lib/reschedule.ts) |
| RR-2 | ☑ | P1 | test | **CR-10 cap + deload paths now tested.** Added: swap-skips-rest, honest-deload-not-raid-rest, and `min(45, original)` cap (long→45, short→original) cases. [reschedule.test.ts](lib/reschedule.test.ts) |
| RR-3 | ☑ | P1 | bug | **Loading-week detection now theme-aware.** `isLoadingWeek` = ≥2 quality AND `weekTheme` not recovery/deload/unload/taper — a recovery week that keeps 2 quality is no longer flagged. [session-requirements.ts](lib/session-requirements.ts) |
| RR-4 | ☑ | P1 | bug | **Negation now clause-scoped.** Replaced the 15-char back-scan with `clauseStart` (breaks on punctuation/dashes/`but`/`however`/`yet`); a negation only flips a tag in its own clause — `"no gym, hilly race"` now requires a RaceSim. [session-requirements.ts](lib/session-requirements.ts) |
| RR-5 | ☑ | P2 | audit | **Band resolution now lives once** in `resolveCoachSignals` (takes the raw `settings.acwrBands` override, calls `resolveAcwrBands` internally); both routes drop the duplicated call + import. [coach-snapshot.ts](lib/coach-snapshot.ts) |
| RR-6 | ☑ | P2 | refactor | **`CoachSnapshotInput extends CoachSignals`** — the six signal fields are inherited, so the compiler now enforces what was a comment-only contract. [coach-snapshot.ts](lib/coach-snapshot.ts) |
| RR-7 | ☑ | P3 | refactor | Opaque `Parameters<typeof computeAcwr>[1]` replaced with the named `Partial<AcwrBands> \| null`. [coach-snapshot.ts](lib/coach-snapshot.ts) |
| RR-8 | ☑ | P2 | ux | **Warnings consolidated** — one warning naming every offending loading week (`weeks 1, 3 …`) instead of one per week. Bounded fan-out. [session-requirements.ts](lib/session-requirements.ts) |
| RR-9 | ☑ | P2 | test | **Branches covered:** multi-week consolidation, recovery-week exclusion, and block-floor fallback all tested. [session-requirements.test.ts](lib/session-requirements.test.ts) |
| RR-10 | ☑ | P2 | feat | **`proceed-easy` decision added.** Mild illness on fresh legs now caps intensity instead of going full gas: `applyEasyCap` converts today's quality session to a same-duration Z2 ride (intervals dropped, no relocation), athlete-confirmed like the downgrade. Type + route + component all handle the new state. [morning-check.ts](lib/morning-check.ts) |
| RR-11 | ☑ | P3 | bug | **Confirmed + hardened.** The `/api/morning-check` route already rejects non-1–5 ratings (400); `strainScore` now also clamps each input so its 4–20 range holds for any direct caller. [morning-check.ts](lib/morning-check.ts) |
| RR-12 | ☑ | P3 | polish | Validator no longer sorts Map entries — it sorts the small offending-week array instead; no week-numbering assumptions. [session-requirements.ts](lib/session-requirements.ts) |

**Decisions locked (2026-06-21):**
- **RR-1 → Honest deload + carry.** Proactive reschedule only swaps onto an *easy* day (load-neutral); if no easy slot, today→Recovery and the quality carries forward via the existing `deferred` path (CR-6). Drop the rest-target/`toWasRest` swap so "only the easy-day swap preserves load" is true by construction.
- **RR-3 → Heuristic + weekTheme exclude.** Keep ≥2-quality but skip weeks whose `weekTheme` marks recovery/deload/taper.
- **RR-8 → One consolidated warning** listing the offending week numbers.
- **RR-10 → Cap intensity.** Add a `proceed-easy` outcome (neck-check rule): mild illness proceeds but downgrades hard intervals to moderate. Note: expands `MorningCheckDecision` — touches the type, route, and component.

_Process note (no fix needed): `63a9263` bundled 8 review items (incl. doc-only CR-14/15/16) in one commit — keep future CR closures atomic so they can be reverted/bisected independently._

_Design/judgment items live in [ROADMAP.md](ROADMAP.md): power-zone SoT vs personal override; the
"Z2 dialed-in" overstatement; Recent-Baselines content / TSS-vs-Load naming; whether IF should be
replaced rather than annotated. Add new bugs/feedback here as they come in; strategy → [ROADMAP.md](ROADMAP.md)._
