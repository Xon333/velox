// Synthesises the learned coaching signals into ONE ranked, deduped directive block for block
// generation — instead of piping several overlapping context blocks (insights + validation +
// compliance) that the model has to reconcile. Insights are already severity-ranked and
// capped; here we fold in each dimension's validation track record so the model knows which
// of its own past nudges actually worked. Pure + deterministic.

import type { Insight, ValidationSummary } from "./types";

export function synthesizeCoachingDirectives(insights: Insight[], validation: ValidationSummary): string {
  if (insights.length === 0) return "";

  // Per-dimension hit rate (validated / decisive) from matured interventions.
  const track = new Map(
    validation.byDimension
      .filter((d) => d.hitRate !== null)
      .map((d) => [d.dimension, d.hitRate as number])
  );

  const lines = insights.map((i) => {
    const hr = track.get(i.dimension);
    const conf =
      hr !== undefined
        ? ` (past ${i.dimension} nudges worked ${Math.round(hr * 100)}% of the time — weight accordingly)`
        : "";
    return `- ${i.title}: ${i.evidence} → ${i.suggestion}${conf}`;
  });

  return `\nCOACHING DIRECTIVES (synthesised from execution history, validated against past blocks — act on these, most important first)\n${lines.join("\n")}`;
}
