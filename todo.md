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

| ID | S | Pri | Type | Item |
|----|---|-----|------|------|
| TR-1 | ☐ | P3 | ux | **Trends "Weekly volume" card → compact to half-width**, same size as the "Execution quality" card. It's full-width today ([`Trends.tsx`](components/Trends.tsx) ~466); pair it in a `lg:grid-cols-2` and leave the right column intentionally empty per the ask. _Eval: trivial; the grid pattern already exists on the Execution-quality/Recent-baselines row (~446)._ |
| TR-2 | ☐ | P3 | ux | **Weekly-volume bars → encode magnitude in colour** (shades of blue) instead of the uniform `bg-sky-400` / `#00d4ff` (`WeeklyVolumeBars`, [`Trends.tsx`](components/Trends.tsx) ~206), so the bar reads volume by hue, not just height. _Eval: valid — height alone is hard to read across 16 weeks; bucket hours into ~4 blue shades (or lightness-scale off `max`)._ |
| TR-3 | ☐ | P3 | ux | **Weekly-volume + Execution-quality cards → add a `MetricTip` ⓘ hover** explaining the metric (consistent with the Today TSB/ACWR hovers). Both already have per-bar `title` tooltips + a subtitle `hint`, but no card-level explanation popup. _Eval: this is the actionable slice of ROADMAP "Popups where needed"; reuse [`MetricTip`](components/dashboard/shared.tsx)._ |
| TR-4 | ☐ | P2 | bug? | **Verify NP / Avg power / Avg speed actually render on the Today card after a fresh sync.** The metric strip builds them conditionally on synced fields ([`today.tsx`](components/dashboard/today.tsx) `metrics`); RC-1 avg-speed is a *new* synced field that only populates on the next sync. If a value is missing it's a data-presence gap, not a UI one. The card *design* question (drop/replace IF, split NP vs Avg) is in [ROADMAP.md](ROADMAP.md). |

_Design/judgment items live in [ROADMAP.md](ROADMAP.md): power-zone SoT vs personal override; the
"Z2 dialed-in" overstatement (time-above-zone discipline signal); and the Today-card metric set —
**IF lacks context on its own; surface avg power · NP · speed as distinct synced values** (enriches
the existing Recent-Baselines / NP-Avg / IF reconsideration)._

_Add new bugs/feedback here as they come in. For anything strategic or multi-session, put it in
[ROADMAP.md](ROADMAP.md) instead._
