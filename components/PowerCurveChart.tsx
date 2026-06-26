import type { PowerCurvePoint } from "@/lib/types";

// Power-duration curve as a small SVG line chart (log-x, watts on y). Hand-rolled to match the app's other
// charts (Sparkline) — no charting dep. Durations span 5s…60min, so x is log-scaled or the short efforts
// bunch up against the axis. y is 0-based so the magnitude reads honestly.

const LABELS: Record<number, string> = {
  5: "5s", 15: "15s", 30: "30s", 60: "1m", 120: "2m", 300: "5m", 1200: "20m", 1800: "30m", 3600: "60m",
};
const LABELLED = new Set([5, 60, 300, 1200, 3600]); // keep the x-axis uncluttered

// Pure geometry: map the curve to plot-area coords [0..1] (x log-scaled by duration, y 0-based by watts).
// Exported for testing; the component just positions these in the SVG. Returns [] for <2 points.
export function scalePowerCurve(points: PowerCurvePoint[]): Array<{ durationSec: number; watts: number; x: number; y: number }> {
  const pts = [...points].filter((p) => p.durationSec > 0 && p.watts > 0).sort((a, b) => a.durationSec - b.durationSec);
  if (pts.length < 2) return [];
  const lmin = Math.log(pts[0].durationSec);
  const lmax = Math.log(pts[pts.length - 1].durationSec);
  const maxW = Math.max(...pts.map((p) => p.watts));
  return pts.map((p) => ({
    durationSec: p.durationSec,
    watts: p.watts,
    x: lmax > lmin ? (Math.log(p.durationSec) - lmin) / (lmax - lmin) : 0,
    y: 1 - p.watts / maxW, // 0 = top (max watts), 1 = baseline
  }));
}

export default function PowerCurveChart({ points }: { points: PowerCurvePoint[] }) {
  const scaled = scalePowerCurve(points);
  if (scaled.length < 2) return null;

  const W = 320, H = 150, PAD_L = 30, PAD_R = 8, PAD_T = 10, PAD_B = 18;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const px = (x: number) => PAD_L + x * plotW;
  const py = (y: number) => PAD_T + y * plotH;
  const maxW = Math.max(...scaled.map((s) => s.watts));

  const line = scaled.map((s, i) => `${i === 0 ? "M" : "L"} ${px(s.x).toFixed(1)},${py(s.y).toFixed(1)}`).join(" ");
  const area = `${line} L ${px(scaled[scaled.length - 1].x).toFixed(1)},${(PAD_T + plotH).toFixed(1)} L ${px(scaled[0].x).toFixed(1)},${(PAD_T + plotH).toFixed(1)} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Power-duration curve">
      {/* y-axis: max-watts top, 0 baseline */}
      <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={PAD_T + plotH} className="stroke-zinc-200 dark:stroke-zinc-700" strokeWidth={1} />
      <line x1={PAD_L} y1={PAD_T + plotH} x2={W - PAD_R} y2={PAD_T + plotH} className="stroke-zinc-200 dark:stroke-zinc-700" strokeWidth={1} />
      <text x={PAD_L - 4} y={PAD_T + 4} textAnchor="end" className="fill-zinc-400 text-[8px]">{maxW}W</text>
      <text x={PAD_L - 4} y={PAD_T + plotH} textAnchor="end" className="fill-zinc-400 text-[8px]">0</text>

      <path d={area} className="fill-cyan-500/10 dark:fill-[#00d4ff]/10" stroke="none" />
      <path d={line} fill="none" strokeWidth={1.5} strokeLinejoin="round" className="stroke-cyan-600 dark:stroke-[#00d4ff]" />

      {scaled.map((s) => (
        <g key={s.durationSec}>
          <circle cx={px(s.x)} cy={py(s.y)} r={2} className="fill-cyan-600 dark:fill-[#00d4ff]" />
          {LABELLED.has(s.durationSec) && (
            <text x={px(s.x)} y={H - 5} textAnchor="middle" className="fill-zinc-500 dark:fill-zinc-400 text-[8px]">
              {LABELS[s.durationSec] ?? `${s.durationSec}s`}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}
