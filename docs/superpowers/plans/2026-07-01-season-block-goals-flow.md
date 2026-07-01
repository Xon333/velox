# Season/Block Flow — Goals Centralization + Hierarchy + Completion Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Goals/Weakpoints off hand-edited markdown into a proper JSON-backed form, wire Season and
Block generation into a real hierarchy (Season = general "why", Block = specific "what," now informed by
Season), and add a proactive nudge when a block finishes — three approved specs, built together in dependency
order.

**Architecture:** Task 1–3 (foundational): widen `AthleteProfile.goals`/`weakpoints`, migrate once from the
markdown file, fix the generation prompt so it only ever sees fresh JSON-sourced goals, and ship a real
add/edit/delete form. Task 4–5 (depends on 1–3's new field shape): two pure helpers in `lib/season.ts`
(`suggestedBlockWeeks`, `filterGoalsByFocus`) wired into the block generator's pre-fills + a visible
season-context readout. Task 6 (independent): a pure `isBlockFinished` predicate hooked into an existing
empty-state UI branch — no new component.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript 5, Tailwind v4, Vitest.

## Global Constraints

- **Concurrent trunk checkout:** `lib/kb-loader.ts` and `lib/kb-loader.test.ts` currently have UNCOMMITTED
  changes from a concurrent session (adds `stripObsidianSyntax()`, wires it into `loadKnowledgeBaseContext`,
  adds a "Related notes" footer to the now-deleted `athleteProfileToMarkdown`). **Decision (confirmed with the
  project owner):** delete the dead functions anyway — they are genuinely unreachable regardless of that
  edit — and COMPOSE with `stripObsidianSyntax` rather than reverting it (call both, don't remove either).
  Before starting Task 1, re-run `git status --short lib/kb-loader.ts lib/kb-loader.test.ts` — if either shows
  further uncommitted changes beyond what's described here, STOP and report to the user rather than guessing
  at what changed.
- Stage only the exact files each task touches (`git add <path>...`, never `git add -A`/`git add .`); commit
  on `main` (this project is trunk-based, no per-session branches).
- Pure `lib/*.ts` logic gets Vitest coverage (TDD: failing test → implement → pass). React components are
  NOT unit-tested in this codebase (confirmed: `AthleteProfileForm.tsx`, `BlockGenerator.tsx`, `PlanView.tsx`,
  `today.tsx` all have zero component tests today) — UI-wiring tasks verify via `npx tsc --noEmit` plus a
  manual dev-server/preview check.
- Verification before every commit: `npx tsc --noEmit && npm test` both clean. Current baseline: 592 tests
  passing (confirm this count before Task 1's first commit, in case the concurrent session has since added
  its own tests to `lib/kb-loader.test.ts`).
- Never invent validation rules beyond what's specified in a task — an unrecognized `focus` value always
  falls back to `"general"`, never throws.

---

## Part A — Goals/Weakpoints Centralization

### Task 1: Data model + one-time migration

**Files:**
- Modify: `lib/types.ts` (widen `AthleteProfile`)
- Modify: `lib/data-store.ts` (migration wiring, `DEFAULT_PROFILE`)
- Modify: `lib/kb-loader.ts` (new `parseGoalsWeakpointsForMigration`; remove `goals`/`weakpoints` from
  `AthleteMdSnapshot`/`parseAthleteMd`; delete `athleteProfileToMarkdown`/`writeAthleteProfileMd`)
- Create: `lib/data-store.test.ts` (does not exist yet)
- Test: `lib/kb-loader.test.ts` (append; do not touch the concurrent session's existing additions)

**Interfaces:**
- Produces: `AthleteProfile.goals: Array<{ goal: string; target: string; focus: SeasonFocus | "general" }>`,
  `AthleteProfile.weakpoints: Array<{ weakpoint: string; detail: string }>`, `AthleteProfile.goalsMigratedAt: string | null`.
  `applyGoalsMigration(profile: AthleteProfile, parseMd: () => Promise<{ goals: AthleteProfile["goals"]; weakpoints: AthleteProfile["weakpoints"] }>): Promise<AthleteProfile>`
  (exported from `lib/data-store.ts`). `parseGoalsWeakpointsForMigration(): Promise<{ goals: AthleteProfile["goals"]; weakpoints: AthleteProfile["weakpoints"] }>`
  (exported from `lib/kb-loader.ts`).

- [ ] **Step 1: Re-verify the concurrent-session file state**

Run: `git status --short lib/kb-loader.ts lib/kb-loader.test.ts`
Expected: exactly `M lib/kb-loader.ts` and `M lib/kb-loader.test.ts`. If anything else appears (a third file,
or these two are now clean/committed), STOP and report to the user before continuing — the ground-truth this
plan was written against may have changed.

- [ ] **Step 2: Widen `AthleteProfile` in `lib/types.ts`**

Find (currently at `lib/types.ts:42-48`):
```ts
export interface AthleteProfile {
  performance: PerformanceData;
  goals: string[];
  weakpoints: string[];
  nutrition: NutritionSettings;
  updatedAt: string; // ISO timestamp
}
```
Replace with:
```ts
export interface AthleteProfile {
  performance: PerformanceData;
  goals: Array<{ goal: string; target: string; focus: SeasonFocus | "general" }>;
  weakpoints: Array<{ weakpoint: string; detail: string }>;
  nutrition: NutritionSettings;
  goalsMigratedAt: string | null; // ISO timestamp once the one-time markdown migration has run
  updatedAt: string; // ISO timestamp
}
```
`SeasonFocus` is already defined later in this same file (`lib/types.ts:303`) — no new import needed since
this is a same-file reference; TypeScript resolves forward references within a module.

- [ ] **Step 3: Update `DEFAULT_PROFILE` in `lib/data-store.ts`**

Find (currently at `lib/data-store.ts:11-29`, the `goals`/`weakpoints` lines):
```ts
  goals: [],
  weakpoints: [],
```
These lines stay byte-identical (an empty array is valid for both the old and new type) — but add the new
field. Find the object's closing `nutrition`/`updatedAt` lines and add `goalsMigratedAt: null` alongside them:
```ts
  goals: [],
  weakpoints: [],
  nutrition: {
    baseCalories: 2000,
    restDayTarget: 2600,
    buffer: 300,
    targetWeightKg: 75,
  },
  goalsMigratedAt: null,
  updatedAt: new Date(0).toISOString(),
```
(Match whatever the exact surrounding lines are — the `nutrition` object and `updatedAt` line already exist;
only the new `goalsMigratedAt: null,` line is an addition, placed between them.)

- [ ] **Step 4: Add `parseGoalsWeakpointsForMigration` to `lib/kb-loader.ts`**

This reuses the existing private `extractSectionText`/`parseRows` primitives (`lib/kb-loader.ts:20`, `:50`) —
do not export them; add one new exported function that calls them internally, right after `parseAthleteMd`'s
current definition:
```ts
// One-time migration source (Goals/Weakpoints centralization): re-parses whatever GOALS/WEAKPOINTS content
// currently exists in athlete_profile.md, in the NEW structured shape. Migrated goals always get
// focus: "general" — the markdown table never had a Focus column, so there's no tag to recover; the athlete
// re-tags through the new form afterward if they want finer filtering. Never throws on a missing file.
export async function parseGoalsWeakpointsForMigration(): Promise<{
  goals: Array<{ goal: string; target: string; focus: "general" }>;
  weakpoints: Array<{ weakpoint: string; detail: string }>;
}> {
  let content = "";
  try {
    content = await fs.readFile(path.join(KB_DIR, "athlete_profile.md"), "utf-8");
  } catch {
    return { goals: [], weakpoints: [] };
  }
  const goalsSection = extractSectionText(content, "GOALS");
  const weakpointsSection = extractSectionText(content, "WEAKPOINTS");
  const goalRows = parseRows(goalsSection).filter((r) => r[0] !== "Goal");
  const wpRows = parseRows(weakpointsSection).filter((r) => r[0] !== "Weakpoint");
  return {
    goals: goalRows.map((r) => ({ goal: r[0] ?? "", target: r[1] ?? "", focus: "general" as const })),
    weakpoints: wpRows.map((r) => ({ weakpoint: r[0] ?? "", detail: r[1] ?? "" })),
  };
}
```

- [ ] **Step 5: Remove `goals`/`weakpoints` from `AthleteMdSnapshot` and `parseAthleteMd`**

Find (currently at `lib/kb-loader.ts:11-18`):
```ts
export interface AthleteMdSnapshot {
  personalData: Record<string, string>;
  performanceData: Record<string, string>;
  powerProfile: Array<{ duration: string; watts: string; wkg: string }>;
  trainingZones: Array<{ zone: string; name: string; power: string; hr: string }>;
  weakpoints: Array<{ weakpoint: string; detail: string }>;
  goals: Array<{ goal: string; target: string }>;
}
```
Replace with (removing the last two fields):
```ts
export interface AthleteMdSnapshot {
  personalData: Record<string, string>;
  performanceData: Record<string, string>;
  powerProfile: Array<{ duration: string; watts: string; wkg: string }>;
  trainingZones: Array<{ zone: string; name: string; power: string; hr: string }>;
}
```
Find `parseAthleteMd`'s body (currently `lib/kb-loader.ts:58-100`) and remove the `weakpointsSection`/
`goalsSection`/`wpRows`/`goalRows` local variables and the `weakpoints`/`goals` entries from its return object
and from the early-return-on-missing-file object. The function becomes:
```ts
export async function parseAthleteMd(): Promise<AthleteMdSnapshot> {
  let content = "";
  try {
    content = await fs.readFile(path.join(KB_DIR, "athlete_profile.md"), "utf-8");
  } catch {
    return { personalData: {}, performanceData: {}, powerProfile: [], trainingZones: [] };
  }

  const personalSection = extractSectionText(content, "PERSONAL DATA");
  const perfSection = extractSectionText(content, "PERFORMANCE DATA");
  const powerSection = extractSectionText(content, "POWER PROFILE");
  const zonesSection = extractSectionText(content, "TRAINING ZONES");

  const powerRows = parseRows(powerSection).filter((r) => r[0] !== "Duration");
  const zoneRows = parseRows(zonesSection).filter((r) => r[0] !== "Zone");

  return {
    personalData: parseKvTable(personalSection),
    performanceData: parseKvTable(perfSection),
    powerProfile: powerRows.map((r) => ({
      duration: r[0] ?? "",
      watts: r[1] ?? "",
      wkg: r[2] ?? "",
    })),
    trainingZones: zoneRows.map((r) => ({
      zone: r[0] ?? "",
      name: r[1] ?? "",
      power: r[2] ?? "",
      hr: r[3] ?? "",
    })),
  };
}
```

- [ ] **Step 6: Delete the two confirmed-dead functions**

Delete `athleteProfileToMarkdown` and `writeAthleteProfileMd` entirely (currently `lib/kb-loader.ts:343-395`
before the concurrent session's diff — locate them by their exact current content: `athleteProfileToMarkdown`
starts `export function athleteProfileToMarkdown(profile: AthleteProfile): string {` and ends at the closing
`` ` `` `;` `}` that terminates its template literal; `writeAthleteProfileMd` immediately follows and ends
`}`). **Before deleting, note**: the concurrent session added a "Related notes" footer INSIDE
`athleteProfileToMarkdown`'s template string — that addition is deleted along with the rest of the dead
function, which is the agreed outcome (the function was unreachable either way; re-verify with
`grep -rn "writeAthleteProfileMd\|athleteProfileToMarkdown" --include="*.ts" --include="*.tsx" .` before
deleting that there are still zero callers anywhere — if a caller has appeared since this plan was written,
STOP and report to the user rather than deleting a now-reachable function).

Also remove the `list` helper local to `athleteProfileToMarkdown` if it has no other caller in the file
(check with `grep -n "list(" lib/kb-loader.ts` after deletion — if `list` is now unused, remove it too; if
still referenced elsewhere, leave it).

- [ ] **Step 7: Add `applyGoalsMigration` + wire it into `readAthleteProfile` in `lib/data-store.ts`**

Add the import (top of `lib/data-store.ts`, alongside the existing `kb-loader` import):
```ts
import { parseGoalsWeakpointsForMigration, readMdPerformance } from "./kb-loader";
```
(Merge with whatever `kb-loader` import already exists in the file — currently `import { readMdPerformance } from "./kb-loader";` per the file's existing structure; add `parseGoalsWeakpointsForMigration` to that same import line.)

Add this pure, directly-testable function above `readAthleteProfile`:
```ts
// Pure migration decision, separated from readAthleteProfile's file IO so the flag-gating logic (the
// trickiest part — never re-import after the flag is set, never overwrite already-non-empty data) is
// testable without mocking the filesystem. `parseMd` is injected so the test can supply a fake.
export async function applyGoalsMigration(
  profile: AthleteProfile,
  parseMd: () => Promise<{ goals: AthleteProfile["goals"]; weakpoints: AthleteProfile["weakpoints"] }>
): Promise<AthleteProfile> {
  if (profile.goalsMigratedAt !== null) return profile;
  const now = new Date().toISOString();
  if (profile.goals.length > 0 || profile.weakpoints.length > 0) {
    return { ...profile, goalsMigratedAt: now };
  }
  const { goals, weakpoints } = await parseMd();
  return { ...profile, goals, weakpoints, goalsMigratedAt: now };
}
```

Modify `readAthleteProfile` (currently `lib/data-store.ts:32-49`):
```ts
export async function readAthleteProfile(): Promise<AthleteProfile> {
  let profile = await readJson<AthleteProfile>("athlete.json", DEFAULT_PROFILE);
  if (profile.goalsMigratedAt === null) {
    profile = await applyGoalsMigration(profile, parseGoalsWeakpointsForMigration);
    await writeAthleteProfile(profile);
  }
  // Overlay FTP/HR so IF/execution scoring, trends and generation all agree on the same
  // numbers. Precedence: athlete.json defaults < athlete_profile.md (fallback) < the
  // physiology store (the source of truth, synced from Intervals.icu).
  const md = await readMdPerformance();
  if (md.ftp !== undefined && md.ftp > 0) profile.performance.ftp = md.ftp;
  if (md.thresholdHr !== undefined && md.thresholdHr > 0) profile.performance.thresholdHr = md.thresholdHr;
  if (md.maxHr !== undefined && md.maxHr > 0) profile.performance.maxHr = md.maxHr;
  const phys = await readPhysiology();
  if (phys?.current) {
    const c = phys.current;
    if (c.ftp > 0) profile.performance.ftp = c.ftp;
    if (c.lthr !== null && c.lthr > 0) profile.performance.thresholdHr = c.lthr;
    if (c.maxHr !== null && c.maxHr > 0) profile.performance.maxHr = c.maxHr;
  }
  return profile;
}
```

- [ ] **Step 8: Write the failing tests for `applyGoalsMigration`**

Create `lib/data-store.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { applyGoalsMigration } from "./data-store";
import type { AthleteProfile } from "./types";

const baseProfile = (over: Partial<AthleteProfile> = {}): AthleteProfile => ({
  performance: { ftp: 200, maxHr: 190, thresholdHr: 170, weightKg: 75, weeklyHoursMin: 6, weeklyHoursMax: 10 },
  goals: [],
  weakpoints: [],
  nutrition: { baseCalories: 2000, restDayTarget: 2600, buffer: 300, targetWeightKg: 75 },
  goalsMigratedAt: null,
  updatedAt: "",
  ...over,
});

describe("applyGoalsMigration", () => {
  it("seeds goals/weakpoints from markdown on first run and sets the flag", async () => {
    const parseMd = async () => ({
      goals: [{ goal: "FTP", target: "300W", focus: "general" as const }],
      weakpoints: [{ weakpoint: "Cornering", detail: "" }],
    });
    const result = await applyGoalsMigration(baseProfile(), parseMd);
    expect(result.goals).toEqual([{ goal: "FTP", target: "300W", focus: "general" }]);
    expect(result.weakpoints).toEqual([{ weakpoint: "Cornering", detail: "" }]);
    expect(result.goalsMigratedAt).not.toBeNull();
  });

  it("never re-runs once the flag is set, even if the markdown parse would return different data", async () => {
    const already = baseProfile({ goalsMigratedAt: "2026-01-01T00:00:00.000Z", goals: [{ goal: "Old", target: "", focus: "general" }] });
    const parseMd = async () => ({ goals: [{ goal: "New", target: "", focus: "general" as const }], weakpoints: [] });
    const result = await applyGoalsMigration(already, parseMd);
    expect(result).toEqual(already); // byte-identical — parseMd never called, nothing changed
  });

  it("does not overwrite existing non-empty data even if the flag is somehow still null (defensive)", async () => {
    const inconsistent = baseProfile({ goalsMigratedAt: null, goals: [{ goal: "Existing", target: "", focus: "general" }] });
    const parseMd = async () => ({ goals: [{ goal: "FromMarkdown", target: "", focus: "general" as const }], weakpoints: [] });
    const result = await applyGoalsMigration(inconsistent, parseMd);
    expect(result.goals).toEqual([{ goal: "Existing", target: "", focus: "general" }]); // existing data wins
    expect(result.goalsMigratedAt).not.toBeNull(); // flag still gets set
  });

  it("seeds empty arrays and still sets the flag when the file has no goals/weakpoints", async () => {
    const parseMd = async () => ({ goals: [], weakpoints: [] });
    const result = await applyGoalsMigration(baseProfile(), parseMd);
    expect(result.goals).toEqual([]);
    expect(result.weakpoints).toEqual([]);
    expect(result.goalsMigratedAt).not.toBeNull();
  });
});
```

- [ ] **Step 9: Run the test to verify it fails, then implement, then pass**

Run: `npx vitest run lib/data-store.test.ts`
Expected (before Step 7's implementation, if not yet done): FAIL — `applyGoalsMigration is not exported`.
After Step 7 is in place: run again — Expected: PASS (4/4).

- [ ] **Step 10: Write the failing test for `parseGoalsWeakpointsForMigration`**

Append to `lib/kb-loader.test.ts` — **do not touch the concurrent session's existing `describe` blocks**
(`"kb-loader resilience (CR-4)"`, `"stripObsidianSyntax"`); add a new one after them:
```ts
import { parseGoalsWeakpointsForMigration } from "./kb-loader";
```
(add `parseGoalsWeakpointsForMigration` to the existing import line at the top of the file, alongside
`listKnowledgeFiles`, `loadKnowledgeBaseContext`, `stripObsidianSyntax`)
```ts
describe("parseGoalsWeakpointsForMigration", () => {
  it("returns empty arrays when athlete_profile.md has no GOALS/WEAKPOINTS content or is missing", async () => {
    const result = await parseGoalsWeakpointsForMigration();
    // Whatever the real fixture file contains — this just asserts the shape and that it never throws.
    expect(Array.isArray(result.goals)).toBe(true);
    expect(Array.isArray(result.weakpoints)).toBe(true);
    for (const g of result.goals) expect(g.focus).toBe("general");
  });
});
```

- [ ] **Step 11: Run to verify pass, run the full suite**

Run: `npx vitest run lib/kb-loader.test.ts lib/data-store.test.ts`
Expected: all passing, 0 regressions in the concurrent session's own added tests.
Run: `npx tsc --noEmit`
Expected: clean (this will surface every consumer of the old `AthleteMdSnapshot.goals`/`weakpoints` shape
that still needs updating — Task 2/3 handle those; if `tsc` fails on a file this task doesn't own, note it
but do not fix it here, since Tasks 2–3 own those specific consumers).

- [ ] **Step 12: Commit**

```bash
git add lib/types.ts lib/data-store.ts lib/data-store.test.ts lib/kb-loader.ts lib/kb-loader.test.ts
git commit -m "feat(goals): centralize Goals/Weakpoints into AthleteProfile with one-time migration"
```

---

### Task 2: Generation-prompt freshness + `/api/profile` PUT extension

**Files:**
- Modify: `lib/kb-loader.ts` (new `stripGoalsWeakpointsSections`, wired into `loadKnowledgeBaseContext`)
- Modify: `app/api/generate/route.ts` (inject `goalsContext`/`weakpointsContext`)
- Modify: `app/api/profile/route.ts` (GET returns `goals`/`weakpoints`/`goalsMigratedAt`; PUT accepts them)
- Test: `lib/kb-loader.test.ts` (append)

**Interfaces:**
- Consumes: `AthleteProfile.goals`/`weakpoints` (Task 1). `readAthleteProfile()`/`writeAthleteProfile()`
  (existing, from `lib/data-store.ts`).
- Produces: `stripGoalsWeakpointsSections(content: string): string` (exported from `lib/kb-loader.ts`).

- [ ] **Step 1: Write the failing test for `stripGoalsWeakpointsSections`**

Add `stripGoalsWeakpointsSections` to the existing import line in `lib/kb-loader.test.ts`, then append:
```ts
describe("stripGoalsWeakpointsSections", () => {
  it("removes GOALS and WEAKPOINTS sections through the next top-level heading", () => {
    const src = "# Athlete Profile\n\n## GOALS\n\n| Goal | Target |\n|------|--------|\n| FTP | 300W |\n\n## WEAKPOINTS\n\n| Weakpoint | Detail |\n|-----------|--------|\n| Cornering | Late apex |\n\n## PERSONAL DATA\n\nKept.";
    const out = stripGoalsWeakpointsSections(src);
    expect(out).not.toContain("GOALS");
    expect(out).not.toContain("FTP");
    expect(out).not.toContain("WEAKPOINTS");
    expect(out).not.toContain("Cornering");
    expect(out).toContain("## PERSONAL DATA");
    expect(out).toContain("Kept.");
  });

  it("is a no-op on content with no GOALS/WEAKPOINTS headings", () => {
    const src = "# Athlete Profile\n\n## PERSONAL DATA\n\nSomething.";
    expect(stripGoalsWeakpointsSections(src)).toBe(src.trim());
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/kb-loader.test.ts -t "stripGoalsWeakpointsSections"`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement `stripGoalsWeakpointsSections` and wire it into `loadKnowledgeBaseContext`**

Add, near `stripObsidianSyntax` in `lib/kb-loader.ts`:
```ts
// Strip the GOALS/WEAKPOINTS sections from athlete_profile.md's raw text before it's inlined into the
// generation prompt (Goals/Weakpoints centralization): those sections are now stale/historical — the
// athlete's live data lives in AthleteProfile.goals/weakpoints and is injected separately as
// goalsContext/weakpointsContext (app/api/generate/route.ts) — so the raw markdown copy must never leak
// a frozen snapshot into generation. Same "next top-level heading or EOF" boundary as the Related-notes
// footer stripping.
export function stripGoalsWeakpointsSections(content: string): string {
  return content
    .replace(/\n+## +GOALS\b[\s\S]*?(?=\n## |$)/, "")
    .replace(/\n+## +WEAKPOINTS\b[\s\S]*?(?=\n## |$)/, "")
    .trim();
}
```

Modify `loadKnowledgeBaseContext` (currently, after the concurrent session's edit):
```ts
export async function loadKnowledgeBaseContext(): Promise<string> {
  const files = await listKnowledgeFiles();
  const ordered = KB_ORDER.filter((f) => files.includes(f)).concat(
    files.filter((f) => !KB_ORDER.includes(f))
  );
  const sections: string[] = [];
  for (const file of ordered) {
    const content = await readKbWithFallback(file);
    if (content !== null) {
      const stripped = file === "athlete_profile.md" ? stripGoalsWeakpointsSections(content) : content;
      sections.push(`===== FILE: ${file} =====\n\n${stripObsidianSyntax(stripped)}`);
    }
  }
  return sections.join("\n\n");
}
```
(This composes with the concurrent session's `stripObsidianSyntax` call rather than removing it — both
strips apply, in this order: GOALS/WEAKPOINTS removed first, then Obsidian syntax flattened on what remains.)

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/kb-loader.test.ts`
Expected: all passing (including the concurrent session's own tests, untouched).

- [ ] **Step 5: Inject `goalsContext`/`weakpointsContext` into the generation prompt**

In `app/api/generate/route.ts`, find the `deferredContext` block (currently around line 195-197) and add,
immediately after it:
```ts
    // Goals/Weakpoints centralization: the athlete's live, JSON-sourced goals/weakpoints — replaces the
    // now-stripped raw markdown copy (see stripGoalsWeakpointsSections) so generation never sees stale data.
    const goalsContext = profile.goals.length > 0
      ? `\nGOALS\n${profile.goals.map((g) => `- ${g.goal}${g.target ? ` → ${g.target}` : ""}`).join("\n")}`
      : "";
    const weakpointsContext = profile.weakpoints.length > 0
      ? `\nWEAKPOINTS TO ADDRESS\n${profile.weakpoints.map((w) => `- ${w.weakpoint}${w.detail ? `: ${w.detail}` : ""}`).join("\n")}`
      : "";
```
Find the `buildSystemPrompt` call's dynamic-context concatenation (currently at line ~244):
```ts
      seedsContext + reflectionsContext + stateContext + directivesContext + quirkContext + powerProfileContext + formFuelContext + sessionReqContext + durabilityContext + deferredContext + seasonContext,
```
Change to:
```ts
      seedsContext + reflectionsContext + stateContext + directivesContext + quirkContext + powerProfileContext + formFuelContext + sessionReqContext + durabilityContext + deferredContext + goalsContext + weakpointsContext + seasonContext,
```

- [ ] **Step 6: Extend `GET`/`PUT /api/profile` to expose and accept goals/weakpoints**

In `app/api/profile/route.ts`, add `goals: profile.goals, weakpoints: profile.weakpoints, goalsMigratedAt: profile.goalsMigratedAt,`
to the `GET` handler's returned JSON object (anywhere in the object literal — e.g. right after `nutrition: profile.nutrition,`).

Replace the `PUT` handler's body entirely:
```ts
// PUT saves nutrition and/or goals/weakpoints (Goals/Weakpoints centralization) — any of the three
// top-level keys may be present; each is validated and applied independently.
export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const current = await readAthleteProfile();
  let updated = { ...current, updatedAt: new Date().toISOString() };

  if (b.nutrition !== undefined) {
    const input = b.nutrition as Record<string, unknown>;
    const { baseCalories, restDayTarget, buffer, targetWeightKg } = input;
    const pos = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0;
    if (!pos(baseCalories)) return NextResponse.json({ error: "baseCalories must be a positive number." }, { status: 400 });
    if (!pos(restDayTarget)) return NextResponse.json({ error: "restDayTarget must be a positive number." }, { status: 400 });
    if (!pos(targetWeightKg)) return NextResponse.json({ error: "targetWeightKg must be a positive number." }, { status: 400 });
    if (typeof buffer !== "number" || !Number.isFinite(buffer) || buffer < 0 || buffer > 600) {
      return NextResponse.json({ error: "buffer must be between 0 and 600 kcal." }, { status: 400 });
    }
    updated = {
      ...updated,
      nutrition: {
        baseCalories: baseCalories as number,
        restDayTarget: restDayTarget as number,
        buffer: buffer as number,
        targetWeightKg: targetWeightKg as number,
      },
    };
  }

  const VALID_FOCUS = new Set(["aerobic-base", "threshold", "vo2max", "anaerobic", "durability", "sharpen", "general"]);

  if (b.goals !== undefined) {
    if (!Array.isArray(b.goals)) return NextResponse.json({ error: "goals must be an array." }, { status: 400 });
    const goals: typeof updated.goals = [];
    for (const g of b.goals) {
      if (!g || typeof g !== "object") return NextResponse.json({ error: "Each goal must be an object." }, { status: 400 });
      const rec = g as Record<string, unknown>;
      const goal = typeof rec.goal === "string" ? rec.goal.trim() : "";
      const target = typeof rec.target === "string" ? rec.target.trim() : "";
      const focus = typeof rec.focus === "string" && VALID_FOCUS.has(rec.focus) ? (rec.focus as typeof goals[number]["focus"]) : "general";
      if (!goal) return NextResponse.json({ error: "Goal text is required." }, { status: 400 });
      goals.push({ goal, target, focus });
    }
    updated = { ...updated, goals };
  }

  if (b.weakpoints !== undefined) {
    if (!Array.isArray(b.weakpoints)) return NextResponse.json({ error: "weakpoints must be an array." }, { status: 400 });
    const weakpoints: typeof updated.weakpoints = [];
    for (const w of b.weakpoints) {
      if (!w || typeof w !== "object") return NextResponse.json({ error: "Each weakpoint must be an object." }, { status: 400 });
      const rec = w as Record<string, unknown>;
      const weakpoint = typeof rec.weakpoint === "string" ? rec.weakpoint.trim() : "";
      const detail = typeof rec.detail === "string" ? rec.detail.trim() : "";
      if (!weakpoint) return NextResponse.json({ error: "Weakpoint text is required." }, { status: 400 });
      weakpoints.push({ weakpoint, detail });
    }
    updated = { ...updated, weakpoints };
  }

  await writeAthleteProfile(updated);
  return NextResponse.json({ nutrition: updated.nutrition, goals: updated.goals, weakpoints: updated.weakpoints });
}
```

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit` — Expected: clean (or only errors in files Task 3 will fix — note which).
Run: `npm test` — Expected: all passing.

- [ ] **Step 8: Commit**

```bash
git add lib/kb-loader.ts lib/kb-loader.test.ts app/api/generate/route.ts app/api/profile/route.ts
git commit -m "feat(goals): strip stale markdown from KB context, inject fresh goals/weakpoints; extend profile PUT"
```

---

### Task 3: Form UI + consumer rewiring

**Files:**
- Modify: `components/AthleteProfileForm.tsx` (replace read-only Goals/Weakpoints `Section` with a form)
- Modify: `components/dashboard/PlanView.tsx` (goal/weakpoints pre-fill source)
- Modify: `components/dashboard/plan.tsx` (`GoalsProgress`)

**Interfaces:**
- Consumes: `AthleteProfile.goals`/`weakpoints` via `/api/profile` GET (Task 2). `SeasonFocus` (from
  `@/lib/types`, already imported elsewhere in `AthleteProfileForm.tsx`).

- [ ] **Step 1: Widen `ProfileResponse` and add form state in `AthleteProfileForm.tsx`**

Add to the `ProfileResponse` interface (currently `lib/AthleteProfileForm.tsx:46-58`):
```ts
interface ProfileResponse {
  nutrition: NutritionSettings;
  ftpStaleDays: number | null;
  physiologyChange: PhysiologyChange | null;
  physiologySource: "intervals" | "manual" | null;
  athleteMd: AthleteMdSnapshot;
  autoSync: AutoSyncInfo;
  bufferStatus: BufferStatus;
  syncedPowerCurve: PowerCurvePoint[];
  powerProfile: PowerProfile | null;
  latestWeightKg: number | null;
  weightHistory: WeightPoint[];
  goals: Array<{ goal: string; target: string; focus: SeasonFocus | "general" }>;
  weakpoints: Array<{ weakpoint: string; detail: string }>;
}
```
Add new local state, alongside the existing `objective`/`events`/`seasonSaveState` (currently
`AthleteProfileForm.tsx:128-130`):
```ts
  const [goals, setGoals] = useState<ProfileResponse["goals"]>([]);
  const [weakpoints, setWeakpoints] = useState<ProfileResponse["weakpoints"]>([]);
  const [goalsSaveState, setGoalsSaveState] = useState<SaveState>({ state: "idle" });
```
In the existing profile-loading effect (currently `AthleteProfileForm.tsx:135-152`), after
`setData(response);`, add:
```ts
        setGoals(response.goals);
        setWeakpoints(response.weakpoints);
```

- [ ] **Step 2: Add the mutation helpers and save handler**

After the existing `saveNutrition` function (or anywhere alongside `updateEvent`/`addEvent`/`removeEvent`/
`saveSeason`, currently `AthleteProfileForm.tsx:200-229`), add:
```ts
  const updateGoal = (index: number, patch: Partial<ProfileResponse["goals"][number]>) => {
    setGoals((gs) => gs.map((g, i) => (i === index ? { ...g, ...patch } : g)));
    if (goalsSaveState.state === "saved") setGoalsSaveState({ state: "idle" });
  };
  const addGoal = () => {
    setGoals((gs) => [...gs, { goal: "", target: "", focus: "general" }]);
  };
  const removeGoal = (index: number) => {
    setGoals((gs) => gs.filter((_, i) => i !== index));
  };

  const updateWeakpoint = (index: number, patch: Partial<ProfileResponse["weakpoints"][number]>) => {
    setWeakpoints((ws) => ws.map((w, i) => (i === index ? { ...w, ...patch } : w)));
    if (goalsSaveState.state === "saved") setGoalsSaveState({ state: "idle" });
  };
  const addWeakpoint = () => {
    setWeakpoints((ws) => [...ws, { weakpoint: "", detail: "" }]);
  };
  const removeWeakpoint = (index: number) => {
    setWeakpoints((ws) => ws.filter((_, i) => i !== index));
  };

  const saveGoals = async () => {
    if (goals.some((g) => !g.goal.trim())) {
      setGoalsSaveState({ state: "error", message: "Goal text is required." });
      return;
    }
    if (weakpoints.some((w) => !w.weakpoint.trim())) {
      setGoalsSaveState({ state: "error", message: "Weakpoint text is required." });
      return;
    }
    setGoalsSaveState({ state: "saving" });
    try {
      await api("/api/profile", { method: "PUT", body: JSON.stringify({ goals, weakpoints }) });
      setGoalsSaveState({ state: "saved" });
      const fresh = await api<ProfileResponse>("/api/profile");
      setGoals(fresh.goals);
      setWeakpoints(fresh.weakpoints);
    } catch (err) {
      setGoalsSaveState({ state: "error", message: err instanceof Error ? err.message : "Save failed" });
    }
  };
```

- [ ] **Step 3: Replace the read-only Goals/Weakpoints Section with the form**

Find the current block (currently `AthleteProfileForm.tsx:398-432`):
```tsx
      {/* 3. Goals & Weakpoints */}
      {(athleteMd.goals.length > 0 || athleteMd.weakpoints.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {athleteMd.goals.length > 0 && (
            <Section title="Goals" editHref="/knowledge">
              <ul className="space-y-1.5">
                {athleteMd.goals.map((g, i) => (
                  <li key={i} className="flex items-start justify-between gap-2 rounded bg-zinc-50 px-2.5 py-2 dark:bg-zinc-900">
                    <span className="min-w-0 text-sm text-zinc-800 dark:text-zinc-200">{g.goal}</span>
                    {g.target && g.target !== g.goal && (
                      <span className="min-w-0 break-words rounded-full bg-cyan-50 px-2 py-0.5 text-[11px] font-medium text-cyan-700 dark:bg-[#00d4ff]/10 dark:text-[#00d4ff]">
                        {g.target}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {athleteMd.weakpoints.length > 0 && (
            <Section title="Weakpoints" editHref="/knowledge">
              <ul className="space-y-1.5">
                {athleteMd.weakpoints.map((w, i) => (
                  <li key={i} className="rounded bg-zinc-50 px-2.5 py-2 dark:bg-zinc-900">
                    <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{w.weakpoint}</p>
                    {w.detail && w.detail !== w.weakpoint && (
                      <p className="mt-0.5 text-xs leading-5 text-zinc-500 dark:text-zinc-400">{w.detail}</p>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}
```
Replace with:
```tsx
      {/* Goals & Weakpoints — athlete-owned intent, now a real form (Goals/Weakpoints centralization)
          instead of hand-edited markdown. Independent Save button/state from Nutrition and Season. */}
      <Section title="Goals & Weakpoints">
        <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
          What you're working toward, and where you're weak — the coach reads these every generation.
        </p>
        <div className="space-y-2">
          {goals.map((g, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2 rounded bg-zinc-50 px-2.5 py-2 dark:bg-zinc-900">
              <label className="min-w-[8rem] flex-1">
                <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">Goal</span>
                <input
                  type="text"
                  value={g.goal}
                  onChange={(e) => updateGoal(i, { goal: e.target.value })}
                  className="mt-1 w-full rounded border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-400"
                />
              </label>
              <label className="min-w-[8rem] flex-1">
                <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">Target</span>
                <input
                  type="text"
                  value={g.target}
                  onChange={(e) => updateGoal(i, { target: e.target.value })}
                  className="mt-1 w-full rounded border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-400"
                />
              </label>
              <label>
                <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">Focus</span>
                <select
                  value={g.focus}
                  onChange={(e) => updateGoal(i, { focus: e.target.value as ProfileResponse["goals"][number]["focus"] })}
                  className="mt-1 rounded border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-400"
                >
                  <option value="general">general</option>
                  <option value="aerobic-base">aerobic-base</option>
                  <option value="threshold">threshold</option>
                  <option value="vo2max">vo2max</option>
                  <option value="anaerobic">anaerobic</option>
                  <option value="durability">durability</option>
                </select>
              </label>
              <button
                onClick={() => removeGoal(i)}
                title="Remove this goal"
                className="rounded-md border border-red-300 px-2 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={addGoal}
          className="mt-3 rounded border border-zinc-200 px-2 py-1 text-[10px] font-medium text-zinc-500 transition-colors hover:border-zinc-300 hover:text-zinc-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200"
        >
          + Add goal
        </button>

        <div className="mt-4 space-y-2">
          {weakpoints.map((w, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2 rounded bg-zinc-50 px-2.5 py-2 dark:bg-zinc-900">
              <label className="min-w-[8rem] flex-1">
                <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">Weakpoint</span>
                <input
                  type="text"
                  value={w.weakpoint}
                  onChange={(e) => updateWeakpoint(i, { weakpoint: e.target.value })}
                  className="mt-1 w-full rounded border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-400"
                />
              </label>
              <label className="min-w-[10rem] flex-1">
                <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">Detail</span>
                <input
                  type="text"
                  value={w.detail}
                  onChange={(e) => updateWeakpoint(i, { detail: e.target.value })}
                  className="mt-1 w-full rounded border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-400"
                />
              </label>
              <button
                onClick={() => removeWeakpoint(i)}
                title="Remove this weakpoint"
                className="rounded-md border border-red-300 px-2 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={addWeakpoint}
          className="mt-3 rounded border border-zinc-200 px-2 py-1 text-[10px] font-medium text-zinc-500 transition-colors hover:border-zinc-300 hover:text-zinc-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200"
        >
          + Add weakpoint
        </button>

        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={saveGoals}
            disabled={goalsSaveState.state === "saving"}
            className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:bg-zinc-300 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white dark:disabled:bg-zinc-700 dark:disabled:text-zinc-400"
          >
            {goalsSaveState.state === "saving" ? "Saving…" : "Save"}
          </button>
          {goalsSaveState.state === "saved" && <span className="text-xs text-green-700 dark:text-green-400">✓ Saved</span>}
          {goalsSaveState.state === "error" && <span className="text-xs text-red-600">{goalsSaveState.message}</span>}
        </div>
      </Section>
```
Note this new `Section` has no `editHref` prop (no more "Edit → /knowledge" link — Goals/Weakpoints are no
longer edited via the Knowledge Base).

- [ ] **Step 4: Update `components/dashboard/PlanView.tsx`'s pre-fill source**

Find the profile-loading effect (currently `PlanView.tsx:65-87`):
```tsx
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { athleteMd: md } = await api<{ athleteMd: AthleteMdSnapshot }>("/api/profile");
        if (!cancelled) {
          setAthleteMd(md);
          if (md.goals.length > 0) {
            setGoal(md.goals.map((g) => g.goal + (g.target ? ` → ${g.target}` : "")).join("\n"));
          }
          if (md.weakpoints.length > 0) {
            setWeakpointsText(md.weakpoints.map((w) => w.weakpoint).join("\n"));
          }
        }
      } catch {
        // profile prefill is best-effort
      }
      void loadBlockHistory();
    })();
    return () => {
      cancelled = true;
    };
  }, [loadBlockHistory]);
```
Replace with (fetch the same `athleteMd` for `GoalsProgress`, but read `goals`/`weakpoints` from the
top-level `AthleteProfile`-sourced fields instead of `athleteMd.goals`/`weakpoints`, which no longer exist):
```tsx
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await api<{
          athleteMd: AthleteMdSnapshot;
          goals: Array<{ goal: string; target: string; focus: string }>;
          weakpoints: Array<{ weakpoint: string; detail: string }>;
        }>("/api/profile");
        if (!cancelled) {
          setAthleteMd(response.athleteMd);
          if (response.goals.length > 0) {
            setGoal(response.goals.map((g) => g.goal + (g.target ? ` → ${g.target}` : "")).join("\n"));
          }
          if (response.weakpoints.length > 0) {
            setWeakpointsText(response.weakpoints.map((w) => w.weakpoint).join("\n"));
          }
        }
      } catch {
        // profile prefill is best-effort
      }
      void loadBlockHistory();
    })();
    return () => {
      cancelled = true;
    };
  }, [loadBlockHistory]);
```
This is an interim shape — Task 5 will change how `goal` gets seeded (filtered by season focus) but the
FETCH shape (reading `response.goals` instead of `response.athleteMd.goals`) is settled here and doesn't
change again in Task 5.

Also update `GoalsProgress`'s call site (currently `PlanView.tsx:199`, `{athleteMd && <GoalsProgress athleteMd={athleteMd} />}`)
— since Step 5 changes `GoalsProgress`'s prop shape, this line needs a matching update once Step 5 lands;
do both in the same commit for this task (see Step 5 below, then come back and update this call site to
`{goalsForProgress.length > 0 && <GoalsProgress goals={goalsForProgress} />}`, storing the fetched
`response.goals` in a new small piece of state, e.g. `const [goalsForProgress, setGoalsForProgress] = useState<Array<{ goal: string; target: string }>>([]);` set alongside `setAthleteMd` in the effect above:
`setGoalsForProgress(response.goals);`).

- [ ] **Step 5: Update `GoalsProgress` in `components/dashboard/plan.tsx`**

Find (currently `plan.tsx:162-184`):
```tsx
interface ProfileGoals {
  athleteMd: AthleteMdSnapshot;
}

export function GoalsProgress({ athleteMd }: ProfileGoals) {
  if (!athleteMd.goals.length) return null;

  const powerGoals = athleteMd.performanceData;

  return (
    <Card title="Goals">
      <div className="flex flex-col gap-2">
        {athleteMd.goals.map((g) => (
```
Replace the interface and function signature (keep everything else in the function body — the
`powerGoals`/rendering logic below `athleteMd.goals.map` — unchanged except swapping the data source):
```tsx
interface ProfileGoals {
  goals: Array<{ goal: string; target: string }>;
  performanceData: Record<string, string>;
}

export function GoalsProgress({ goals, performanceData }: ProfileGoals) {
  if (!goals.length) return null;

  const powerGoals = performanceData;

  return (
    <Card title="Goals">
      <div className="flex flex-col gap-2">
        {goals.map((g) => (
```
(The rest of the function body — the `.map` callback rendering `g.goal`/`g.target`, and the `powerGoals`
rendering below — is unchanged; only the destructured parameter names and the two lines shown above change.)

Update `PlanView.tsx`'s call site to match (from Step 4's note):
```tsx
          {goalsForProgress.length > 0 && athleteMd && (
            <GoalsProgress goals={goalsForProgress} performanceData={athleteMd.performanceData} />
          )}
```
replacing the old `{athleteMd && <GoalsProgress athleteMd={athleteMd} />}` line (currently `PlanView.tsx:199`).

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit` — Expected: clean.
Run: `npm test` — Expected: all passing (no test changes in this task — pure UI wiring).

- [ ] **Step 7: Manual verification against a running dev server**

1. Load `/profile`. Confirm the new "Goals & Weakpoints" section renders (add/edit/remove rows for both,
   independent Save button) in place of the old read-only lists + "Edit →" link.
2. Add a goal with a Focus tag, save, reload — confirm it persists and the Focus selection is remembered.
3. Load `/plan`. Confirm the block-goal textarea still pre-fills from your goals (now sourced from the new
   field) and the "Goals" card (`GoalsProgress`) still renders correctly.
4. Confirm Nutrition's and Season's Save buttons on `/profile` still work independently — no cross-talk.

- [ ] **Step 8: Commit**

```bash
git add components/AthleteProfileForm.tsx components/dashboard/PlanView.tsx components/dashboard/plan.tsx
git commit -m "feat(goals): Goals/Weakpoints add/edit/delete form; rewire PlanView + GoalsProgress consumers"
```

---

## Part B — Season/Block Hierarchy

### Task 4: `suggestedBlockWeeks` + `filterGoalsByFocus` + objective folding

**Files:**
- Modify: `lib/season.ts`
- Test: `lib/season.test.ts`

**Interfaces:**
- Consumes: `FocusPeriod`, `SeasonFocus`, `SeasonPlan` (existing types). `formatSeasonContext` (existing,
  `lib/season.ts:245`), `currentPeriod` (existing, `lib/season.ts:239`), `periodEnd`/`weeksBetween` (existing
  private helpers in the same file, reused directly since this task adds code to the same module).
- Produces: `suggestedBlockWeeks(period: FocusPeriod, today: string): 2 | 4 | 6 | 8`,
  `filterGoalsByFocus<T extends { focus: SeasonFocus | "general" }>(goals: T[], seasonFocus: SeasonFocus | null): T[]`.

- [ ] **Step 1: Write the failing tests**

Append to `lib/season.test.ts`:
```ts
import { suggestedBlockWeeks, filterGoalsByFocus } from "./season";

describe("suggestedBlockWeeks", () => {
  const period = (startDate: string, plannedWeeks: number): FocusPeriod => ({
    focus: "threshold", phase: "build", startDate, plannedWeeks, intensitySplit: "80/20",
    targetWeeklyTss: null, deloadWeek: false, rationale: "", source: "derived", confidence: "medium",
  });
  it("ceilings to the smallest allowed value >= remaining weeks", () => {
    expect(suggestedBlockWeeks(period("2026-07-01", 4), "2026-07-01")).toBe(4); // 4 remaining -> 4
    expect(suggestedBlockWeeks(period("2026-07-01", 4), "2026-07-15")).toBe(2); // 2 remaining -> 2
    expect(suggestedBlockWeeks(period("2026-07-01", 8), "2026-07-08")).toBe(8); // 7 remaining -> 8
  });
  it("floors at 2 even with 1 or 0 weeks remaining", () => {
    expect(suggestedBlockWeeks(period("2026-07-01", 3), "2026-07-15")).toBe(2); // 1 wk left (or less) -> 2
    expect(suggestedBlockWeeks(period("2026-07-01", 2), "2026-07-15")).toBe(2); // period already over -> floor 2
  });
  it("caps at 8 for a long remaining runway", () => {
    expect(suggestedBlockWeeks(period("2026-07-01", 12), "2026-07-01")).toBe(8);
  });
});

describe("filterGoalsByFocus", () => {
  const g = (goal: string, focus: import("./types").SeasonFocus | "general") => ({ goal, target: "", focus });
  const goals = [g("A", "threshold"), g("B", "vo2max"), g("C", "general"), g("D", "durability")];
  it("includes focus-matching goals plus every general-tagged goal", () => {
    expect(filterGoalsByFocus(goals, "threshold").map((x) => x.goal)).toEqual(["A", "C"]);
  });
  it("returns every goal unfiltered when seasonFocus is null", () => {
    expect(filterGoalsByFocus(goals, null)).toEqual(goals);
  });
  it("returns only general-tagged goals when no goal matches the given focus", () => {
    expect(filterGoalsByFocus(goals, "anaerobic").map((x) => x.goal)).toEqual(["C"]);
  });
});
```
- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/season.test.ts -t "suggestedBlockWeeks|filterGoalsByFocus"`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement both functions**

Add to `lib/season.ts`, near `currentPeriod`/`formatSeasonContext`:
```ts
const ALLOWED_BLOCK_WEEKS = [2, 4, 6, 8] as const;

// Suggested (not locked) block length for the generator's pre-fill: ceiling-rounds the period's remaining
// weeks to the smallest allowed value >= it, floored at 2, capped at 8. Ceiling (not nearest/floor) is
// deliberate — the suggested block always covers AT LEAST the rest of the current period rather than
// leaving a stray week neither covered by the block nor a full next period; a block running slightly past
// the period boundary is the already-accepted case (replanSeasonArc's three-bucket re-plan handles it).
export function suggestedBlockWeeks(period: FocusPeriod, today: string): 2 | 4 | 6 | 8 {
  const remaining = period.plannedWeeks - weeksBetween(period.startDate, today);
  for (const w of ALLOWED_BLOCK_WEEKS) {
    if (w >= remaining) return w;
  }
  return 8;
}

// Goals relevant to the season's current focus, for the block-goal pre-fill: a focus match, plus every
// "general"-tagged goal (not tied to one physiological system — always shown). Returns every goal
// unfiltered when there's no current period (seasonFocus null) — identical to today's un-narrowed pre-fill.
export function filterGoalsByFocus<T extends { focus: SeasonFocus | "general" }>(
  goals: T[],
  seasonFocus: SeasonFocus | null
): T[] {
  if (seasonFocus === null) return goals;
  return goals.filter((g) => g.focus === seasonFocus || g.focus === "general");
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/season.test.ts`
Expected: all passing.

- [ ] **Step 5: Fold `objective` into `formatSeasonContext`**

Find (currently `lib/season.ts:245-252`):
```ts
export function formatSeasonContext(plan: SeasonPlan, today: string): string | null {
  const p = currentPeriod(plan, today);
  if (!p) return null;
  const wk = Math.max(1, weeksBetween(p.startDate, today) + 1);
  const load = p.targetWeeklyTss != null ? ` · target ~${p.targetWeeklyTss} TSS/wk` : "";
  const deload = p.deloadWeek ? " · deload week" : "";
  return `SEASON CONTEXT: phase ${p.phase} · focus ${p.focus} · wk ${wk} of ${p.plannedWeeks}${load}${deload}. ${p.rationale}`;
}
```
Replace with:
```ts
export function formatSeasonContext(plan: SeasonPlan, today: string): string | null {
  const p = currentPeriod(plan, today);
  if (!p) return null;
  const wk = Math.max(1, weeksBetween(p.startDate, today) + 1);
  const load = p.targetWeeklyTss != null ? ` · target ~${p.targetWeeklyTss} TSS/wk` : "";
  const deload = p.deloadWeek ? " · deload week" : "";
  const objective = plan.objective.trim() ? `${plan.objective.trim()} — ` : "";
  return `SEASON CONTEXT: ${objective}phase ${p.phase} · focus ${p.focus} · wk ${wk} of ${p.plannedWeeks}${load}${deload}. ${p.rationale}`;
}
```

- [ ] **Step 6: Write the failing test for the objective-folding change**

The existing `describe("season context + fit validation", ...)` block (`lib/season.test.ts:191-201`) already
defines a `cur` period fixture and uses the shared `planWith(periods)` helper (`lib/season.test.ts:137`,
which defaults `objective: "get faster"`). Its existing test `"formats a one-line season context for the
prompt"` (line 193-198) already exercises a non-empty objective via that default, but doesn't assert on it —
add two new tests in the same `describe` block, immediately after that existing test (after line 198's
closing `});`):
```ts
  it("prepends the season objective when set", () => {
    const line = formatSeasonContext(planWith([cur]), "2026-07-01")!;
    expect(line.startsWith("SEASON CONTEXT: get faster — phase build")).toBe(true);
  });
  it("omits the objective prefix entirely when it's empty", () => {
    const plan = { ...planWith([cur]), objective: "" };
    const line = formatSeasonContext(plan, "2026-07-01")!;
    expect(line.startsWith("SEASON CONTEXT: phase build")).toBe(true);
    expect(line).not.toContain(" — phase"); // no stray separator with nothing before it
  });
```

- [ ] **Step 7: Run to verify pass, full suite**

Run: `npx vitest run lib/season.test.ts` — Expected: all passing.
Run: `npx tsc --noEmit && npm test` — Expected: both clean.

- [ ] **Step 8: Commit**

```bash
git add lib/season.ts lib/season.test.ts
git commit -m "feat(season): suggestedBlockWeeks + filterGoalsByFocus; fold objective into formatSeasonContext"
```

---

### Task 5: Wire into `PlanView`/`BlockGenerator`

**Files:**
- Modify: `components/dashboard/PlanView.tsx`
- Modify: `components/dashboard/BlockGenerator.tsx`

**Interfaces:**
- Consumes: `suggestedBlockWeeks`, `filterGoalsByFocus`, `currentPeriod`, `formatSeasonContext` (all from
  `@/lib/season`, Task 4). `SeasonPlan` (from `@/lib/types`).

- [ ] **Step 1: Add a season-plan fetch + widen `lengthWeeks` in `PlanView.tsx`**

Add imports at the top of `PlanView.tsx`:
```ts
import { currentPeriod, filterGoalsByFocus, formatSeasonContext, suggestedBlockWeeks } from "@/lib/season";
import type { SeasonPlan } from "@/lib/types";
```
Widen the state declaration (currently `PlanView.tsx:27`):
```ts
  const [lengthWeeks, setLengthWeeks] = useState<2 | 4 | 6 | 8>(4);
```
Add new state for the readout + raw goals (needed for re-filtering once the season plan loads), alongside
the existing `goal`/`weakpointsText` state:
```ts
  const [seasonReadout, setSeasonReadout] = useState<string | null>(null);
```
Add a new, independent effect (mirroring the pattern already used in `AthleteProfileForm.tsx` for its
separate `/api/season` fetch) — place it after the existing profile-loading effect:
```ts
  // Season context for the generator: pre-fills length + narrows the goal pre-fill to what's relevant
  // this focus period, and surfaces a readout so the athlete can see why (Season/Block hierarchy).
  // Independent fetch from the profile effect above — non-fatal on failure, same as SeasonRoadmap.tsx.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { plan } = await api<{ plan: SeasonPlan }>("/api/season");
        if (cancelled) return;
        const today = localToday();
        const period = currentPeriod(plan, today);
        if (period) {
          setLengthWeeks(suggestedBlockWeeks(period, today));
          setSeasonReadout(formatSeasonContext(plan, today));
        }
      } catch {
        // season context is optional — the form just falls back to today's defaults
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
```

- [ ] **Step 2: Narrow the goal pre-fill by season focus**

This requires the season fetch's `period.focus` at the point the goal pre-fill happens. Since the profile
fetch (Task 3, Step 4) and the season fetch (this task, Step 1) are two independent effects that may resolve
in either order, filter at the point of use rather than trying to coordinate effect ordering: store the raw
fetched goals separately, and derive the filtered pre-fill in a small combined effect, OR — simpler and
avoiding a race — extend the season-fetch effect above to ALSO own the goal-pre-fill decision, since it
already has `period.focus` in scope. Change the profile-loading effect (Task 3, Step 4's version) to store
the raw goals without immediately setting `goal`:
```ts
  const [rawGoals, setRawGoals] = useState<Array<{ goal: string; target: string; focus: string }>>([]);
```
In the profile effect, replace the `if (response.goals.length > 0) { setGoal(...) }` block with:
```ts
          setRawGoals(response.goals);
```
Then in the season-fetch effect (Step 1 above), after `setSeasonReadout(...)`, add:
```ts
          if (rawGoals.length > 0) {
            const filtered = filterGoalsByFocus(rawGoals as Array<{ goal: string; target: string; focus: import("@/lib/types").SeasonFocus | "general" }>, period.focus);
            setGoal(filtered.map((g) => g.goal + (g.target ? ` → ${g.target}` : "")).join("\n"));
          }
```
And handle the no-current-period case (falls back to ALL goals, unfiltered — matching Task 3's original
behavior) by adding an `else` branch alongside the `if (period)` in Step 1:
```ts
        if (period) {
          setLengthWeeks(suggestedBlockWeeks(period, today));
          setSeasonReadout(formatSeasonContext(plan, today));
          if (rawGoals.length > 0) {
            const filtered = filterGoalsByFocus(rawGoals as Array<{ goal: string; target: string; focus: import("@/lib/types").SeasonFocus | "general" }>, period.focus);
            setGoal(filtered.map((g) => g.goal + (g.target ? ` → ${g.target}` : "")).join("\n"));
          }
        } else if (rawGoals.length > 0) {
          setGoal(rawGoals.map((g) => g.goal + (g.target ? ` → ${g.target}` : "")).join("\n"));
        }
```
Because `rawGoals` is read inside this effect but set by a different effect, add `rawGoals` to this effect's
dependency array so it re-runs once the profile fetch resolves (whichever effect finishes second correctly
re-derives `goal`): change `}, []);` to `}, [rawGoals]);` for the season-fetch effect. This makes the
season-fetch effect's async fetch re-run whenever `rawGoals` changes — acceptable here since `/api/season`
is a cheap, idempotent GET and this only fires twice total (once on mount, once when goals arrive).

- [ ] **Step 3: Pass the readout + wire it through to `BlockGenerator`**

Add a `seasonReadout` prop to the `<BlockGenerator />` call site (currently `PlanView.tsx:206-224`):
```tsx
      <BlockGenerator
        hasActiveBlock={hasActiveBlock}
        genOpen={genOpen}
        setGenOpen={setGenOpen}
        lengthWeeks={lengthWeeks}
        setLengthWeeks={setLengthWeeks}
        startDate={startDate}
        setStartDate={setStartDate}
        goal={goal}
        setGoal={setGoal}
        weakpointsText={weakpointsText}
        setWeakpointsText={setWeakpointsText}
        generating={generating}
        generate={generate}
        generateError={generateError}
        elapsed={elapsed}
        anthropicConfigured={state.anthropicConfigured}
        showSyncTip={!state.lastSync && state.configured}
        seasonReadout={seasonReadout}
      />
```

- [ ] **Step 4: Widen `BlockGenerator`'s length buttons + accept the readout**

In `components/dashboard/BlockGenerator.tsx`, widen the props interface (currently lines 7-25):
```ts
export interface BlockGeneratorProps {
  hasActiveBlock: boolean;
  genOpen: boolean;
  setGenOpen: (open: boolean) => void;
  lengthWeeks: 2 | 4 | 6 | 8;
  setLengthWeeks: (w: 2 | 4 | 6 | 8) => void;
  startDate: string;
  setStartDate: (d: string) => void;
  goal: string;
  setGoal: (g: string) => void;
  weakpointsText: string;
  setWeakpointsText: (w: string) => void;
  generating: boolean;
  generate: () => void;
  generateError: string | null;
  elapsed: number;
  anthropicConfigured: boolean;
  showSyncTip: boolean;
  seasonReadout: string | null;
}
```
Add `seasonReadout` to the destructured function parameters (currently lines 27-45), and widen the length
buttons array (currently line 101: `{([2, 4] as const).map((w) => (`) to:
```tsx
                {([2, 4, 6, 8] as const).map((w) => (
```
Add the readout line — right after the opening `<section>`'s content, before the `hasActiveBlock && !genOpen`
conditional (so it's visible whether the generator is collapsed or expanded)... actually, place it inside
the EXPANDED branch only (it's context for the fields, which are hidden when collapsed) — immediately before
the `<div className="mt-4 grid gap-4 ...">` block (currently line 97):
```tsx
          {seasonReadout && (
            <p className="mt-3 rounded bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
              {seasonReadout}
            </p>
          )}
          <div className="mt-4 grid gap-4 border-t border-zinc-100 pt-4 sm:grid-cols-2 lg:grid-cols-4 dark:border-zinc-700">
```
(Only the `<p>` block is new; the surrounding `<div className="mt-4 grid ...">` line already exists — this
step inserts the new block directly above it.)

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` — Expected: clean.
Run: `npm test` — Expected: all passing (no new tests this task — pure UI wiring over Task 4's tested logic).

- [ ] **Step 6: Manual verification against a running dev server**

1. Load `/plan` with an existing season plan (one with periods — generate a block first if needed, or seed
   `data/season-plan.json` temporarily for the check, restoring it afterward).
2. Open the generator (or confirm it's already open). Confirm the season readout line renders above the
   length/goal/weakpoints fields, and the length buttons now show 2/4/6/8 (not just 2/4).
3. Confirm the pre-selected length button matches what `suggestedBlockWeeks` would compute for the current
   period (do the arithmetic by hand against the period's `startDate`/`plannedWeeks` to confirm).
4. Confirm the goal textarea pre-fills with only the Focus-matching + general-tagged goals, not everything.
5. Confirm you can still freely override any of the three fields before generating — nothing is locked.

- [ ] **Step 7: Commit**

```bash
git add components/dashboard/PlanView.tsx components/dashboard/BlockGenerator.tsx
git commit -m "feat(season): wire suggested length + focus-filtered goal pre-fill + readout into the generator"
```

---

## Part C — Block-Completion Prompt

### Task 6: `isBlockFinished` + `PlannedToday` hook

**Files:**
- Modify: `lib/date.ts` (verified: exists, has zero existing imports, no circular-dependency risk importing
  the `CurrentBlock` type from `lib/types.ts`)
- Modify: `components/dashboard/today.tsx` (`PlannedToday`)
- Test: `lib/date.test.ts` (verified: already exists, already tests pure date-comparison helpers
  `localToday`/`resolveToday`/`utcToday` — append here, matching its established style)

**Interfaces:**
- Produces: `isBlockFinished(block: CurrentBlock | null, today: string): boolean`.

- [ ] **Step 1: Write the failing test**

Add `CurrentBlock` as a type-only import to `lib/date.test.ts`'s existing import line (currently
`import { localToday, resolveToday, utcToday } from "./date";`) — as a separate `import type` line:
```ts
import type { CurrentBlock } from "./types";
```
Append, at the end of `lib/date.test.ts` (after the existing `describe("resolveToday", ...)` block), and add
`isBlockFinished` to the existing `import { localToday, resolveToday, utcToday } from "./date";` line:
```ts
describe("isBlockFinished", () => {
  const block = (endDate: string): CurrentBlock => ({
    goal: "g", lengthWeeks: 4, startDate: "2026-06-01", endDate, overview: "", createdAt: "", days: [],
  });
  it("is true once today is after the block's endDate", () => {
    expect(isBlockFinished(block("2026-06-28"), "2026-06-29")).toBe(true);
  });
  it("is false when today is on or before the block's endDate", () => {
    expect(isBlockFinished(block("2026-06-28"), "2026-06-28")).toBe(false);
    expect(isBlockFinished(block("2026-06-28"), "2026-06-20")).toBe(false);
  });
  it("is false when there is no block", () => {
    expect(isBlockFinished(null, "2026-06-29")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/date.test.ts`
Expected: FAIL — `isBlockFinished` not exported.

- [ ] **Step 3: Implement**

Add to `lib/date.ts`, near the other pure date helpers (e.g. after `isoDaysAgo`):
```ts
// True once a block's endDate has passed — pure date comparison, deliberately NOT tied to whether every
// session was logged/scored (that could get stuck behind a skipped rest day, a compromised session, or a
// delayed sync). Drives the block-completion prompt in PlannedToday (components/dashboard/today.tsx).
export function isBlockFinished(block: CurrentBlock | null, today: string): boolean {
  return block !== null && today > block.endDate;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/date.test.ts` — Expected: 3/3 new passing, 0 regressions in the file's existing
`localToday`/`resolveToday` tests.

- [ ] **Step 5: Hook into `PlannedToday`**

In `components/dashboard/today.tsx`, add the import (top of file, alongside the other imports):
```ts
import { isBlockFinished } from "@/lib/date";
```
Find `PlannedToday`'s current body (currently `components/dashboard/today.tsx:520-529`):
```tsx
export function PlannedToday({ block }: { block: CurrentBlock | null }) {
  const today = todayIso();
  const day = block?.days.find((d) => d.date === today) ?? null;
  if (!day || day.type === "Rest") {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        {day?.type === "Rest" ? "Rest day — recover." : "No session planned for today."}
      </p>
    );
  }
```
Replace with:
```tsx
export function PlannedToday({ block }: { block: CurrentBlock | null }) {
  const today = todayIso();
  if (isBlockFinished(block, today)) {
    return (
      <div>
        <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
          Your block finished on {block!.endDate} — ready to plan the next one?
        </p>
        <Link
          href="/plan"
          className="mt-2 inline-block text-sm text-cyan-700 hover:underline dark:text-[#00d4ff]"
        >
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
```
Check whether `Link` (from `next/link`) is already imported in `components/dashboard/today.tsx` — if not,
add `import Link from "next/link";` at the top of the file alongside the other imports.

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit` — Expected: clean.
Run: `npm test` — Expected: all passing.

- [ ] **Step 7: Manual verification against a running dev server**

1. Temporarily edit `data/current-block.json`'s `endDate` to a date in the past (back it up / note the
   original value first), reload `/today`. Confirm the "Your block finished on [date] — ready to plan the
   next one?" message renders with a working link to `/plan`.
2. Restore `data/current-block.json`'s original `endDate`. Reload `/today` — confirm normal today-session
   behavior returns (no regression).
3. Confirm a `/today` load with no `data/current-block.json` at all (or a deleted block) still shows the
   plain "No session planned for today" message, not the finished-block prompt.

- [ ] **Step 8: Commit**

```bash
git add lib/date.ts lib/date.test.ts components/dashboard/today.tsx
git commit -m "feat(today): proactive block-completion prompt via isBlockFinished"
```

---

## Self-Review

**1. Spec coverage:**
- Goals/Weakpoints centralization spec: data model (Task 1) ✓, migration + flag guard (Task 1) ✓, dead-code
  cleanup (Task 1) ✓, KB-context freshness (Task 2) ✓, PUT extension (Task 2) ✓, form UI (Task 3) ✓, consumer
  rewiring (Task 3) ✓.
- Season/block hierarchy spec: `suggestedBlockWeeks` (Task 4) ✓, `filterGoalsByFocus` (Task 4) ✓, objective
  folding (Task 4) ✓, generator wiring + readout (Task 5) ✓, length buttons widened (Task 5) ✓.
- Block-completion prompt spec: `isBlockFinished` (Task 6) ✓, `PlannedToday` hook (Task 6) ✓.

**2. Placeholder scan:** No TBD/TODO. Two spots originally deferred a decision to the implementer (Task 4's
objective-folding test fixture; Task 6's function/test file location) — both were resolved during this
self-review by reading the actual current files (`lib/season.test.ts`'s real `planWith`/`cur` fixtures;
confirming `lib/date.ts`/`lib/date.test.ts` exist with no import-cycle risk) and rewritten with exact,
final code. No open decisions remain.

**3. Type consistency:** `AthleteProfile.goals`/`weakpoints` shape (Task 1) is used identically in Task 2's
route validation, Task 3's form state/handlers, and Task 4/5's `filterGoalsByFocus` call — same field names
(`goal`/`target`/`focus`, `weakpoint`/`detail`) throughout. `SeasonFocus | "general"` union is consistent
across Task 1 (type), Task 2 (route validation `VALID_FOCUS` set), Task 3 (the `<select>` options), and Task
4 (`filterGoalsByFocus`'s generic constraint). `isBlockFinished`'s signature (Task 6) matches its one call
site in `PlannedToday` exactly.

**Dependency order confirmed:** Task 1 → 2 → 3 (each depends on the previous within Part A); Task 4 depends
on Task 1's `AthleteProfile.goals` shape (uses `focus: SeasonFocus | "general"` in its generic constraint) and
Task 3's consumer rewiring landing first (Task 5 modifies the same `PlanView.tsx` regions Task 3 already
touched); Task 6 has no dependency on Parts A/B and can be built in any order relative to them, placed last
per the approved sequencing (smallest, independent).
