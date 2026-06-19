import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

// Disaster-recovery export. The filesystem (data/*.json + knowledge-base/**/*.md) is this app's
// only source of truth and both dirs are gitignored, so this bundles them into one downloadable
// JSON file. Read-only — never mutates anything. Restore via POST /api/import.

const DATA_DIR = process.env.NODEVELO_DATA_DIR || path.join(process.cwd(), "data");
const KB_DIR = path.join(process.cwd(), "knowledge-base");

// Collect every file under `dir` matching `keep`, keyed by path relative to `dir` (so nested KB
// dirs like block-retrospectives/ round-trip). Missing dir → empty map, never throws.
async function collect(dir: string, keep: (rel: string) => boolean): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  async function walk(current: string): Promise<void> {
    let entries: import("fs").Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return; // dir doesn't exist
    }
    for (const e of entries) {
      const full = path.join(current, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile()) {
        const rel = path.relative(dir, full);
        if (keep(rel)) out[rel] = await fs.readFile(full, "utf-8");
      }
    }
  }
  await walk(dir);
  return out;
}

export async function GET() {
  // Skip the .bak/.tmp recovery artifacts — a restore rewrites them anyway.
  const data = await collect(DATA_DIR, (rel) => rel.endsWith(".json"));
  const knowledgeBase = await collect(KB_DIR, (rel) => rel.endsWith(".md"));

  const bundle = {
    app: "nodevelo",
    kind: "backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    data,
    knowledgeBase,
  };

  const filename = `nodevelo-backup-${new Date().toISOString().slice(0, 10)}.json`;
  return new NextResponse(JSON.stringify(bundle, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
