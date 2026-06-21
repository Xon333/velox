import { describe, expect, it } from "vitest";
import { listKnowledgeFiles, loadKnowledgeBaseContext } from "./kb-loader";

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
});
