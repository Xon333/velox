// Re-bucket a sample stream (power watts or heart-rate bpm) into the athlete's own
// zones from athlete_profile.md, rather than relying on Intervals.icu's pre-bucketed
// times — whose boundaries can differ, and which (for power) are often absent entirely.

export interface Zone {
  name: string;
  lo: number; // inclusive lower bound
  hi: number | null; // exclusive upper bound; null = open (top zone)
}

// Counts samples per zone (≈seconds at 1 Hz). Used as a distribution, so the exact
// sampling rate doesn't matter as long as it's uniform. Zones are expected ordered
// low→high and contiguous; the first matching zone wins.
export function bucketZones(samples: number[], zones: Zone[]): number[] {
  const times = new Array(zones.length).fill(0);
  for (const v of samples) {
    if (!Number.isFinite(v) || v <= 0) continue;
    for (let i = 0; i < zones.length; i++) {
      const z = zones[i];
      if (v >= z.lo && (z.hi === null || v < z.hi)) {
        times[i] += 1;
        break;
      }
    }
  }
  return times;
}
