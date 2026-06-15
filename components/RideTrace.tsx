import type { RideTrace as RideTraceData } from "@/lib/types";

// Power-trace chart: power as the primary line, the prescribed target as a dashed
// line, shaded bands where the work intervals fell, and HR as a faint secondary
// overlay (so decoupling shows up as the gap widening). Pure SVG, no JS.
export default function RideTrace({ trace }: { trace: RideTraceData }) {
  const { power, hr, bands, targetWatts } = trace;
  if (power.length < 2) return null;

  const W = 340;
  const H = 72;
  const PAD = 4;
  const maxP = Math.max(...power, targetWatts ?? 0) || 1;
  const toX = (i: number) => (i / (power.length - 1)) * W;
  const toYp = (v: number) => PAD + (1 - v / maxP) * (H - PAD * 2);
  const powerPath = power.map((v, i) => `${i ? "L" : "M"}${toX(i).toFixed(1)},${toYp(v).toFixed(1)}`).join(" ");

  let hrPath = "";
  if (hr.length === power.length) {
    const valid = hr.filter((v) => v > 0);
    const lo = valid.length ? Math.min(...valid) : 0;
    const hi = valid.length ? Math.max(...valid) : 1;
    const range = hi - lo || 1;
    const toYh = (v: number) => PAD + (1 - (Math.max(v, lo) - lo) / range) * (H - PAD * 2);
    hrPath = hr.map((v, i) => `${i ? "L" : "M"}${toX(i).toFixed(1)},${toYh(v).toFixed(1)}`).join(" ");
  }

  const targetY = targetWatts ? toYp(targetWatts) : null;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full touch-none" style={{ height: H }} preserveAspectRatio="none">
      {bands.map((b, i) => (
        <rect key={i} x={b.start * W} y={0} width={(b.end - b.start) * W} height={H} className="fill-zinc-200/70 dark:fill-[#00d4ff]/12" />
      ))}
      {targetY !== null && (
        <line x1={0} y1={targetY} x2={W} y2={targetY} strokeDasharray="3 3" strokeWidth={1} vectorEffect="non-scaling-stroke" className="stroke-pink-500/70 dark:stroke-[#ff49c8]/70" />
      )}
      {hrPath && <path d={hrPath} fill="none" strokeWidth={1} vectorEffect="non-scaling-stroke" className="stroke-zinc-400 dark:stroke-zinc-500" />}
      <path d={powerPath} fill="none" strokeWidth={1.4} strokeLinejoin="round" vectorEffect="non-scaling-stroke" className="stroke-blue-500 dark:stroke-[#00d4ff]" />
    </svg>
  );
}
