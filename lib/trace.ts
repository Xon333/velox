// Build the downsampled streams + executed-interval bands that drive the ride
// power-trace chart. Downsampling keeps the stored analysis small (~240 points) while
// preserving the shape; bands mark where the athlete's WORK intervals fell.

import type { ExecutedInterval, RideTrace } from "./types";

function downsample(arr: number[], target: number): number[] {
  if (arr.length <= target) return arr.map((v) => (Number.isFinite(v) ? Math.round(v) : 0));
  const out: number[] = [];
  const bucket = arr.length / target;
  for (let i = 0; i < target; i++) {
    const start = Math.floor(i * bucket);
    const end = Math.floor((i + 1) * bucket);
    let sum = 0;
    let n = 0;
    for (let j = start; j < end; j++) {
      const v = arr[j];
      if (Number.isFinite(v)) {
        sum += v;
        n += 1;
      }
    }
    out.push(n > 0 ? Math.round(sum / n) : 0);
  }
  return out;
}

export function buildRideTrace(
  power: number[],
  hr: number[],
  executed: ExecutedInterval[],
  targetWatts: number | null,
  points = 240
): RideTrace | null {
  if (power.length < 2) return null;
  const len = power.length;
  const bands = executed
    .filter((e) => e.type === "WORK" && e.startIndex !== null && e.endIndex !== null)
    .map((e) => ({ start: (e.startIndex as number) / len, end: (e.endIndex as number) / len }))
    .filter((b) => b.end > b.start && b.start >= 0 && b.end <= 1);
  return {
    power: downsample(power, points),
    hr: hr.length >= 2 ? downsample(hr, points) : [],
    bands,
    targetWatts,
  };
}
