import { describe, expect, it } from "vitest";
import { listKnowledgeFiles, loadKnowledgeBaseContext, stripObsidianSyntax, parseGoalsWeakpointsForMigration, stripGoalsWeakpointsSections } from "./kb-loader";

// CR-4: the loader must never hard-fail when knowledge-base/ is absent (a fresh clone / CI) — it
// falls back to the committed knowledge-base-defaults/ skeleton. These invariants hold whether or not
// a local KB exists, and guard against the defaults' README leaking into the editor list / prompt.
describe("kb-loader resilience (CR-4)", () => {
  it("always lists the core KB files and never the defaults README", async () => {
    const files = await listKnowledgeFiles();
    expect(files).toContain("training_knowledge.md");
    expect(files).toContain("cycling_database.md");
    expect(files).not.toContain("README.md");
  });

  it("loads non-empty context without throwing, and never injects the README", async () => {
    const ctx = await loadKnowledgeBaseContext();
    expect(ctx.length).toBeGreaterThan(0);
    expect(ctx).toContain("training_knowledge.md"); // the section header is present
    expect(ctx).not.toMatch(/knowledge-base-defaults/); // the defaults README is never concatenated in
  });

  it("strips Obsidian-only navigation syntax from the generation prompt", async () => {
    const ctx = await loadKnowledgeBaseContext();
    expect(ctx).not.toMatch(/\[\[/); // no wikilinks leak into the prompt
    expect(ctx).not.toMatch(/## Related notes/); // the navigation footer is dropped
  });
});

describe("stripObsidianSyntax", () => {
  it("flattens wikilinks: alias, else section, else target", () => {
    expect(stripObsidianSyntax("not in [[cycling_database]].")).toBe("not in cycling_database.");
    expect(stripObsidianSyntax("See [[cycling_database#3. RECOVERY]].")).toBe("See 3. RECOVERY.");
    expect(stripObsidianSyntax("the [[training_knowledge#5. FTP PLATEAU DIAGNOSIS|FTP plateau]] work")).toBe(
      "the FTP plateau work"
    );
  });

  it("removes the Related-notes footer and its preceding rule", () => {
    const src = "Body text.\n\n---\n\n## Related notes\n\n- [[cycling_database]] — foundations.";
    expect(stripObsidianSyntax(src)).toBe("Body text.");
  });

  it("keeps a heading that follows the footer (defensive against future sections)", () => {
    const src = "Body.\n\n## Related notes\n\n- [[x]]\n\n## Appendix\n\nKept.";
    const out = stripObsidianSyntax(src);
    expect(out).not.toMatch(/Related notes/);
    expect(out).toContain("## Appendix");
    expect(out).toContain("Kept.");
  });
});

describe("parseGoalsWeakpointsForMigration", () => {
  it("returns empty arrays when athlete_profile.md has no GOALS/WEAKPOINTS content or is missing", async () => {
    const result = await parseGoalsWeakpointsForMigration();
    // Whatever the real fixture file contains — this just asserts the shape and that it never throws.
    expect(Array.isArray(result.goals)).toBe(true);
    expect(Array.isArray(result.weakpoints)).toBe(true);
    for (const g of result.goals) expect(g.focus).toBe("general");
  });
});

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
