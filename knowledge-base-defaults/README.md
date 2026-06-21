# knowledge-base-defaults

The committed **skeleton** of the knowledge base — structure + the section anchors the generation
prompt cites (`§4`, `§10`, `§11`, `§12`, …), **not** real coaching content.

- Your actual knowledge base lives in `/knowledge-base/` (gitignored, local, personal). The loader
  (`lib/kb-loader.ts`) reads each file from there if present and **falls back to the matching default
  here** otherwise — so a fresh clone / CI runs without hard-failing, and the repo stays
  self-consistent (the code references sections that exist *somewhere* in-repo).
- These stubs are intentionally thin. They are not meant to generate good plans on their own — drop
  your own `cycling_database.md` / `training_knowledge.md` / `nutrition_knowledge.md` /
  `athlete_profile.md` into `/knowledge-base/` and they override these per-file.
- Editing a file in the in-app Knowledge editor writes a local override into `/knowledge-base/`; this
  directory is never written to at runtime.
