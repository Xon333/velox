import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { readJsonFile, writeJsonFile } from "./json-store";

// Point the store at a throwaway dir so tests never touch real ledger data.
let dir: string;
const p = (file: string) => path.join(dir, file);

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "nodevelo-store-"));
  process.env.NODEVELO_DATA_DIR = dir;
});

afterAll(async () => {
  delete process.env.NODEVELO_DATA_DIR;
  await fs.rm(dir, { recursive: true, force: true });
});

afterEach(async () => {
  // Wipe between tests so filenames can be reused without bleed-through.
  for (const f of await fs.readdir(dir)) await fs.rm(p(f), { force: true });
});

describe("json-store (atomic + recovery)", () => {
  it("round-trips and leaves no temp file behind", async () => {
    await writeJsonFile("rt.json", { entries: ["v1"], updatedAt: "a" });
    expect(await readJsonFile("rt.json", null)).toEqual({ entries: ["v1"], updatedAt: "a" });
    await expect(fs.access(p("rt.json.tmp"))).rejects.toBeDefined();
  });

  it("recovers from a corrupt live file via the .bak", async () => {
    await writeJsonFile("rec.json", { v: "good" });
    await fs.copyFile(p("rec.json"), p("rec.json.bak")); // a prior good backup exists
    await fs.writeFile(p("rec.json"), "{ this is not valid json", "utf-8"); // live file goes corrupt
    expect(await readJsonFile("rec.json", { v: "DEFAULT" })).toEqual({ v: "good" });
  });

  it("falls back to the default when both live and backup are unusable", async () => {
    await fs.writeFile(p("broken.json"), "{ broken", "utf-8");
    expect(await readJsonFile("broken.json", { v: "DEFAULT" })).toEqual({ v: "DEFAULT" });
  });

  it("snapshots a .bak before overwriting a CRITICAL store", async () => {
    await writeJsonFile("score-log.json", { v: 1 }); // first write — no prior to back up
    await writeJsonFile("score-log.json", { v: 2 }); // backs up {v:1}
    expect(JSON.parse(await fs.readFile(p("score-log.json.bak"), "utf-8"))).toEqual({ v: 1 });
  });
});

describe("json-store concurrent writes (the per-file mutex)", () => {
  it("serializes concurrent writes to the same file without corruption (last-write-wins)", async () => {
    await Promise.all(Array.from({ length: 25 }, (_, n) => writeJsonFile("race.json", { n })));
    // Must be valid JSON (no interleaved/truncated write) and hold the last queued value.
    const raw = await fs.readFile(p("race.json"), "utf-8");
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(await readJsonFile<{ n: number }>("race.json", { n: -1 })).toEqual({ n: 24 });
  });

  it("does not block writes to different files", async () => {
    await Promise.all([writeJsonFile("a.json", { id: "A" }), writeJsonFile("b.json", { id: "B" })]);
    expect(await readJsonFile("a.json", null)).toEqual({ id: "A" });
    expect(await readJsonFile("b.json", null)).toEqual({ id: "B" });
  });

  it("a failed write does not poison the chain for the next write", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular; // throws inside JSON.stringify
    await expect(writeJsonFile("chain.json", circular)).rejects.toThrow();
    await writeJsonFile("chain.json", { ok: true });
    expect(await readJsonFile("chain.json", null)).toEqual({ ok: true });
  });
});
