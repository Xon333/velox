// Crash-safe local JSON IO. The filesystem is this app's database, so writes must never leave
// a half-written file and an unrecoverable store must survive a corrupt write:
//
//  - Atomic write: serialise → temp file → fsync → rename. POSIX rename is atomic, so a crash
//    mid-write can never produce a truncated JSON — the old file stays intact until the new
//    one is fully on disk.
//  - Rolling backup: irreplaceable stores (the immutable ledgers, physiology history, blocks,
//    manual settings) snapshot their previous good version to `<file>.bak` before each write.
//  - Recovery on read: if the live file is missing or unparseable, fall back to `.bak`, then
//    to the caller's default — so a single bad write can't wipe the ledger.
//
// Regenerable stores (re-derivable from a fresh Intervals sync) get atomic writes but no
// backup — there's nothing worth recovering.

import { promises as fs } from "fs";
import path from "path";

// Resolved per call (not a module const) so tests can point at a throwaway directory via
// NODEVELO_DATA_DIR without re-importing, and so the app always reads the env in force at runtime.
function dataDir(): string {
  return process.env.NODEVELO_DATA_DIR || path.join(process.cwd(), "data");
}

// Stores that cannot be re-derived from a fresh sync → keep a one-deep backup.
const CRITICAL = new Set([
  "score-log.json",
  "intervention-log.json",
  "physiology.json",
  "current-block.json",
  "block-history.json",
  "athlete.json",
  "block-settings.json",
  "dispositions.json",
]);

export async function readJsonFile<T>(file: string, fallback: T): Promise<T> {
  const full = path.join(dataDir(), file);
  for (const candidate of [full, `${full}.bak`]) {
    try {
      const raw = await fs.readFile(candidate, "utf-8");
      const parsed: unknown = JSON.parse(raw);
      if (parsed === null || parsed === undefined) continue;
      return parsed as T;
    } catch {
      // missing or unparseable — try the next candidate (.bak), then the default
    }
  }
  return fallback;
}

// Per-file write serialization. Two concurrent writes to the same store (e.g. a sync and a
// disposition POST both touching score-log.json) share one temp path and would otherwise interleave
// the copy→write→rename steps and clobber each other. Each write chains onto the previous write of
// the *same* file so they apply one-at-a-time (last-write-wins); different files stay parallel.
const writeChains = new Map<string, Promise<void>>();

export function writeJsonFile(file: string, value: unknown): Promise<void> {
  // `.catch` so a prior failed write doesn't poison the chain for the next caller; the returned
  // promise still rejects if *this* write fails (preserving the throw-on-error contract).
  const prev = writeChains.get(file) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(() => atomicWrite(file, value));
  writeChains.set(file, next);
  // Drop the entry once it's settled and still the tail, so the map can't grow unbounded.
  void next.catch(() => {}).finally(() => {
    if (writeChains.get(file) === next) writeChains.delete(file);
  });
  return next;
}

async function atomicWrite(file: string, value: unknown): Promise<void> {
  const dir = dataDir();
  await fs.mkdir(dir, { recursive: true });
  const full = path.join(dir, file);

  if (CRITICAL.has(file)) {
    // Snapshot the previous good version before overwriting (no-op on first write).
    await fs.copyFile(full, `${full}.bak`).catch(() => {});
  }

  const tmp = `${full}.tmp`;
  const data = JSON.stringify(value, null, 2) + "\n";
  const handle = await fs.open(tmp, "w");
  try {
    await handle.writeFile(data, "utf-8");
    await handle.sync(); // flush to disk before the rename so the swap is durable
  } finally {
    await handle.close();
  }
  await fs.rename(tmp, full); // atomic swap
}
