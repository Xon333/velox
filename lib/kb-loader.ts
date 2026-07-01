// Knowledge base loader. Files are read fresh on every call (never cached in
// memory) so edits made via the Knowledge Base Manager take effect on the
// very next generation.
import { promises as fs } from "fs";
import path from "path";
import type { AthleteProfile } from "./types";
import type { Zone } from "./zones";

// ---------- athlete_profile.md parser ----------

export interface AthleteMdSnapshot {
  personalData: Record<string, string>;
  performanceData: Record<string, string>;
  powerProfile: Array<{ duration: string; watts: string; wkg: string }>;
  trainingZones: Array<{ zone: string; name: string; power: string; hr: string }>;
  weakpoints: Array<{ weakpoint: string; detail: string }>;
  goals: Array<{ goal: string; target: string }>;
}

function extractSectionText(content: string, heading: string): string {
  const lines = content.split("\n");
  let inSection = false;
  const result: string[] = [];
  const headingRe = new RegExp(`^##\\s+${heading}`, "i");
  for (const line of lines) {
    if (headingRe.test(line)) { inSection = true; continue; }
    if (inSection) {
      if (/^##\s/.test(line)) break;
      if (line.trim() === "---") break;
      result.push(line);
    }
  }
  return result.join("\n").trim();
}

function parseKvTable(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    if (/^\s*\|[\s-|]+\|\s*$/.test(line)) continue; // separator row
    const cells = line.split("|").filter(Boolean).map((c) => c.trim());
    if (cells.length >= 2 && cells[0] !== "Parameter" && cells[0] !== "Zone" &&
        cells[0] !== "Duration" && cells[0] !== "Weakpoint" && cells[0] !== "Goal") {
      out[cells[0]] = cells[1];
    }
  }
  return out;
}

function parseRows(text: string): string[][] {
  return text
    .split("\n")
    .filter((l) => l.trim().startsWith("|") && !/^\s*\|[\s-|]+\|\s*$/.test(l))
    .map((l) => l.split("|").filter(Boolean).map((c) => c.trim()))
    .filter((row) => row.length >= 2);
}

export async function parseAthleteMd(): Promise<AthleteMdSnapshot> {
  let content = "";
  try {
    content = await fs.readFile(path.join(KB_DIR, "athlete_profile.md"), "utf-8");
  } catch {
    return { personalData: {}, performanceData: {}, powerProfile: [], trainingZones: [], weakpoints: [], goals: [] };
  }

  const personalSection = extractSectionText(content, "PERSONAL DATA");
  const perfSection = extractSectionText(content, "PERFORMANCE DATA");
  const powerSection = extractSectionText(content, "POWER PROFILE");
  const zonesSection = extractSectionText(content, "TRAINING ZONES");
  const weakpointsSection = extractSectionText(content, "WEAKPOINTS");
  const goalsSection = extractSectionText(content, "GOALS");

  const powerRows = parseRows(powerSection).filter((r) => r[0] !== "Duration");
  const zoneRows = parseRows(zonesSection).filter((r) => r[0] !== "Zone");
  const wpRows = parseRows(weakpointsSection).filter((r) => r[0] !== "Weakpoint");
  const goalRows = parseRows(goalsSection).filter((r) => r[0] !== "Goal");

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
    weakpoints: wpRows.map((r) => ({
      weakpoint: r[0] ?? "",
      detail: r[1] ?? "",
    })),
    goals: goalRows.map((r) => ({
      goal: r[0] ?? "",
      target: r[1] ?? "",
    })),
  };
}

// Numeric performance values parsed from athlete_profile.md — the athlete-edited
// source of truth. Used to keep athlete.json's FTP/HR consistent with the markdown
// (e.g. so Intensity Factor uses the same FTP the athlete sees and generation uses).
// Returns only the fields that parse cleanly; missing/garbled values are omitted.
export async function readMdPerformance(): Promise<{ ftp?: number; thresholdHr?: number; maxHr?: number }> {
  const { performanceData } = await parseAthleteMd();
  const firstInt = (val: string | undefined): number | undefined => {
    const m = val?.match(/\d+/);
    return m ? parseInt(m[0], 10) : undefined;
  };
  const findValue = (pred: (key: string) => boolean): string | undefined => {
    const key = Object.keys(performanceData).find((k) => pred(k.trim().toLowerCase()));
    return key ? performanceData[key] : undefined;
  };
  return {
    ftp: firstInt(findValue((k) => k === "ftp")),
    thresholdHr: firstInt(findValue((k) => k.includes("threshold") && k.includes("hr"))),
    maxHr: firstInt(findValue((k) => k.includes("max") && k.includes("hr"))),
  };
}

// Parse one column ("power" or "hr") of athlete_profile.md's TRAINING ZONES table
// into ordered zones. Handles "< 170W", "170–216W" (en-dash or hyphen), "> 432W";
// skips rows with no range (e.g. a "Max" HR cell). Ordered low→high.
async function parseMdZones(field: "power" | "hr"): Promise<Zone[]> {
  const { trainingZones } = await parseAthleteMd();
  const out: Zone[] = [];
  for (const z of trainingZones) {
    const s = z[field] ?? "";
    const ints = (s.match(/\d+/g) ?? []).map(Number);
    if (ints.length === 0) continue;
    let lo: number;
    let hi: number | null;
    if (/<|less/i.test(s)) {
      lo = 0;
      hi = ints[0];
    } else if (/>|\+/.test(s)) {
      lo = ints[0];
      hi = null;
    } else if (ints.length >= 2) {
      lo = ints[0];
      hi = ints[1];
    } else {
      lo = ints[0];
      hi = null;
    }
    out.push({ name: `${z.zone} ${z.name}`.trim(), lo, hi });
  }
  return out;
}

export async function readMdHrZones(): Promise<Zone[]> {
  return parseMdZones("hr");
}

export async function readMdPowerZones(): Promise<Zone[]> {
  return parseMdZones("power");
}

const KB_DIR = path.join(process.cwd(), "knowledge-base");
// Committed skeleton (schema + the section anchors the prompt cites). The real KB under
// knowledge-base/ is gitignored personal data and overrides this per-file; the defaults only fill
// gaps, so a fresh clone / CI doesn't hard-fail and the repo documents the expected structure.
const KB_DEFAULTS_DIR = path.join(process.cwd(), "knowledge-base-defaults");

// .md files in a dir, or [] if the dir is absent (a fresh clone has no knowledge-base/).
async function listMd(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir)).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
}

// Read a KB file, preferring the user's local copy and falling back to the committed default.
async function readKbWithFallback(name: string): Promise<string | null> {
  for (const dir of [KB_DIR, KB_DEFAULTS_DIR]) {
    try {
      return await fs.readFile(path.join(dir, name), "utf-8");
    } catch {
      // try the next source
    }
  }
  return null;
}

// Concatenation order required by the spec; bikefit is optional.
const KB_ORDER = [
  "cycling_database.md",
  "training_knowledge.md",
  "nutrition_knowledge.md",
  "athlete_profile.md",
  "bikefit_knowledge.md",
];

function assertSafeName(name: string): void {
  if (name !== path.basename(name) || !name.endsWith(".md")) {
    throw new Error(`Invalid knowledge base file name: ${name}`);
  }
}

export async function listKnowledgeFiles(): Promise<string[]> {
  // Union of the user's local files (any .md) and the committed defaults — so the editor + generation
  // see the full set even before a coach has dropped in their own KB, and never throw on a missing
  // dir. The defaults contribution is restricted to the canonical KB names so the defaults' README
  // (and any non-KB file) never lands in the prompt or the editor list.
  const local = await listMd(KB_DIR);
  const defaults = (await listMd(KB_DEFAULTS_DIR)).filter((f) => KB_ORDER.includes(f));
  const names = new Set([...local, ...defaults]);
  return [...names].sort((a, b) => {
    const ia = KB_ORDER.indexOf(a);
    const ib = KB_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

export async function readKnowledgeFile(name: string): Promise<string> {
  assertSafeName(name);
  const content = await readKbWithFallback(name);
  if (content === null) throw new Error(`Knowledge base file not found: ${name}`);
  return content;
}

// Editing only — the manager deliberately supports no create/delete. Editing a file that currently
// exists only as a default writes a local override (the first local file may need the dir created).
export async function writeKnowledgeFile(name: string, content: string): Promise<void> {
  assertSafeName(name);
  const existing = await listKnowledgeFiles();
  if (!existing.includes(name)) {
    throw new Error(`Unknown knowledge base file: ${name}. Creating new files is not supported.`);
  }
  await fs.mkdir(KB_DIR, { recursive: true });
  await fs.writeFile(path.join(KB_DIR, name), content, "utf-8");
}

// Strip Obsidian-only navigation syntax before the KB goes into the generation
// prompt: the `## Related notes` footers and `[[wikilinks]]` exist for the human
// browsing the vault in Obsidian and carry no signal for the LLM, so we drop the
// footers entirely and flatten any inline wikilink to its readable display text
// (alias if present, else the section name, else the target). Saves prompt tokens
// and keeps the wikilinks from leaking into generated copy.
export function stripObsidianSyntax(content: string): string {
  return content
    // Drop the Related-notes footer (and the `---` rule preceding it) through the
    // next top-level heading or end of file.
    .replace(/\n+(?:---\s*\n+)?## +Related notes\b[\s\S]*?(?=\n## |$)/g, "")
    // Flatten remaining inline wikilinks to plain text.
    .replace(/\[\[([^\]]+)\]\]/g, (_match, inner: string) => {
      const [link, alias] = inner.split("|");
      if (alias) return alias.trim();
      const hashIdx = link.indexOf("#");
      return (hashIdx >= 0 ? link.slice(hashIdx + 1) : link).trim();
    })
    .trim();
}

// Full knowledge base as one string for prompt injection, each file prefixed
// with its filename as a section header.
export async function loadKnowledgeBaseContext(): Promise<string> {
  const files = await listKnowledgeFiles();
  const ordered = KB_ORDER.filter((f) => files.includes(f)).concat(
    files.filter((f) => !KB_ORDER.includes(f))
  );
  const sections: string[] = [];
  for (const file of ordered) {
    const content = await readKbWithFallback(file);
    if (content !== null) sections.push(`===== FILE: ${file} =====\n\n${stripObsidianSyntax(content)}`);
  }
  return sections.join("\n\n");
}

// ---------- Block retrospectives ----------
// Stored under knowledge-base/block-retrospectives/. They are NOT pulled into
// loadKnowledgeBaseContext() (listKnowledgeFiles only matches flat .md files),
// so they never bloat the generation prompt. Instead the *latest* file's
// next_block_seeds — editable by the athlete — are injected at generation time.

const RETRO_DIR = path.join(KB_DIR, "block-retrospectives");

async function ensureRetroDir(): Promise<void> {
  await fs.mkdir(RETRO_DIR, { recursive: true });
}

// Newest-first (filenames start with the block start date, so a reverse
// lexicographic sort is chronological).
export async function listRetrospectives(): Promise<string[]> {
  try {
    const entries = await fs.readdir(RETRO_DIR);
    return entries.filter((f) => f.endsWith(".md")).sort((a, b) => b.localeCompare(a));
  } catch {
    return [];
  }
}

export async function readRetrospective(name: string): Promise<string> {
  assertSafeName(name);
  return fs.readFile(path.join(RETRO_DIR, name), "utf-8");
}

// Unlike core KB files, retrospectives can be created (one per completed block).
export async function writeRetrospective(name: string, content: string): Promise<void> {
  assertSafeName(name);
  await ensureRetroDir();
  await fs.writeFile(path.join(RETRO_DIR, name), content, "utf-8");
}

// Parse the `next_block_seeds:` YAML list out of the newest retrospective's
// frontmatter. Athlete edits to this list flow straight into the next block.
export async function latestRetrospectiveSeeds(): Promise<string[]> {
  const all = await listRetrospectives();
  // Only date-prefixed retrospectives count for "latest" — ignore any stray
  // notes the athlete may have dropped in (their ISO date prefix sorts correctly).
  const dated = all.filter((f) => /^\d{4}-\d{2}-\d{2}_/.test(f));
  if (dated.length === 0) return [];
  let content = "";
  try {
    content = await fs.readFile(path.join(RETRO_DIR, dated[0]), "utf-8");
  } catch {
    return [];
  }
  const lines = content.split("\n");
  const seeds: string[] = [];
  let inSeeds = false;
  for (const line of lines) {
    if (/^next_block_seeds:\s*$/.test(line)) { inSeeds = true; continue; }
    if (inSeeds) {
      const m = line.match(/^\s+-\s+"?(.*?)"?\s*$/);
      if (m && m[1].trim()) { seeds.push(m[1].trim()); continue; }
      // A non-list line ends the block (next key, closing ---, or blank-then-key).
      if (line.trim() !== "" && !/^\s+-/.test(line)) break;
    }
  }
  return seeds;
}

// athlete.json is the source of truth; this regenerates athlete_profile.md so
// the two stay in sync (non-negotiable #6).
export function athleteProfileToMarkdown(profile: AthleteProfile): string {
  const p = profile.performance;
  const n = profile.nutrition;
  const list = (items: string[]) =>
    items.length > 0 ? items.map((g) => `- ${g}`).join("\n") : "- (none recorded)";
  return `# Athlete Profile

> Generated from athlete.json on ${new Date().toISOString().slice(0, 10)}.
> Edit via the Profile page — manual edits to this file are overwritten on the next profile save.

## Performance

- FTP: ${p.ftp} W
- Max HR: ${p.maxHr} bpm
- Threshold HR: ${p.thresholdHr} bpm
- Weight: ${p.weightKg} kg (target: ${n.targetWeightKg} kg)
- Weekly training availability: ${p.weeklyHoursMin}–${p.weeklyHoursMax} hours

## Goals

${list(profile.goals)}

## Weakpoints to address

${list(profile.weakpoints)}

## Nutrition formula settings

- Base calories: ${n.baseCalories} kcal
- Rest day target: ${n.restDayTarget} kcal
- Training day buffer: ${n.buffer} kcal (auto-adjusts ±150 kcal on 7-day weight trend, capped 0–600)
- Daily targets are computed by the app's deterministic formula: base + activity kJ + buffer on training days, flat target on rest days. Use the pre-computed values supplied with each generation request — never recalculate them.

---

## Related notes

This profile is the athlete-specific anchor; the knowledge files supply the general principles calibrated against it (stripped from the generation prompt — for navigating the Obsidian vault):

- [[cycling_database]] — foundational zones, FTP, periodisation, weekly structure, recovery, strength.
- [[training_knowledge]] — advanced training that targets the weakpoints above ([[training_knowledge#5. FTP PLATEAU DIAGNOSIS|FTP plateau]], [[training_knowledge#4. SPRINT INTERVAL TRAINING (SIT)|sprint]], [[training_knowledge#12. DURABILITY TEMPLATES|durability]]).
- [[nutrition_knowledge]] — advanced fuelling ([[nutrition_knowledge#1. FUEL FOR THE WORK REQUIRED (FFTWR)|fuel for the work required]], protein distribution).
`;
}

export async function writeAthleteProfileMd(profile: AthleteProfile): Promise<void> {
  await fs.mkdir(KB_DIR, { recursive: true }); // first write on a fresh setup creates the dir
  await fs.writeFile(
    path.join(KB_DIR, "athlete_profile.md"),
    athleteProfileToMarkdown(profile),
    "utf-8"
  );
}
