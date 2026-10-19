/**
 * Small server-rendered SVG charts in the reference style: vivid blue bars and a donut.
 * No chart library: the data is a handful of points, and plain SVG stays accessible
 * (each mark has a <title> for hover and screen readers).
 */

export interface BarDatum {
  label: string;
  value: number;
}

function niceMax(v: number) {
  if (v <= 5) return 5;
  const pow = 10 ** Math.floor(Math.log10(v));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s * 4 >= v) ?? 10 * pow;
  return step * 4;
}

export function BarChart({ data, unit = "", ariaLabel }: { data: BarDatum[]; unit?: string; ariaLabel: string }) {
  const W = 640, H = 240, left = 44, right = 8, top0 = 16, bottom = 28;
  const max = niceMax(Math.max(1, ...data.map((d) => d.value)));
  const plotW = W - left - right, plotH = H - top0 - bottom;
  const band = plotW / Math.max(1, data.length);
  const barW = Math.min(36, band * 0.62);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));
  const peak = data.reduce((best, d) => (d.value > best.value ? d : best), data[0] ?? { label: "", value: 0 });
  const y = (v: number) => top0 + plotH - (v / max) * plotH;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} className="h-auto w-full">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={left} x2={W - right} y1={y(t)} y2={y(t)} stroke="#e7eaf2" strokeDasharray={t === 0 ? undefined : "3 4"} />
          <text x={left - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#8a90a2">
            {t.toLocaleString("en-GB")}
          </text>
        </g>
      ))}
      {data.map((d, i) => {
        const cx = left + band * i + band / 2;
        const h = Math.max(d.value > 0 ? 4 : 0, (d.value / max) * plotH);
        return (
          <g key={d.label}>
            <rect x={cx - barW / 2} y={top0 + plotH - h} width={barW} height={h} rx={Math.min(8, barW / 3)} fill="#4a3aff">
              <title>{`${d.label}: ${d.value.toLocaleString("en-GB")}${unit ? ` ${unit}` : ""}`}</title>
            </rect>
            <text x={cx} y={H - 8} textAnchor="middle" fontSize="11" fill="#8a90a2">
              {d.label}
            </text>
          </g>
        );
      })}
      {peak && peak.value > 0 && (() => {
        const i = data.indexOf(peak);
        const cx = left + band * i + band / 2;
        const label = `${peak.value.toLocaleString("en-GB")}${unit ? ` ${unit}` : ""}`;
        const w = label.length * 6.4 + 16;
        return (
          <g>
            <rect x={cx - w / 2} y={y(peak.value) - 28} width={w} height={20} rx={10} fill="#fff" stroke="#e7eaf2" />
            <text x={cx} y={y(peak.value) - 14} textAnchor="middle" fontSize="11" fontWeight="600" fill="#12141c">
              {label}
            </text>
          </g>
        );
      })()}
    </svg>
  );
}

export interface DonutDatum {
  label: string;
  value: number;
  color: string;
}

export function DonutChart({ data, ariaLabel, centre }: { data: DonutDatum[]; ariaLabel: string; centre?: string }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const R = 70, r = 44, C = 90;
  let angle = -Math.PI / 2;
  const arc = (start: number, end: number) => {
    const large = end - start > Math.PI ? 1 : 0;
    const p = (rad: number, rr: number) => [C + rr * Math.cos(rad), C + rr * Math.sin(rad)];
    const [x1, y1] = p(start, R), [x2, y2] = p(end, R), [x3, y3] = p(end, r), [x4, y4] = p(start, r);
    return `M${x1} ${y1}A${R} ${R} 0 ${large} 1 ${x2} ${y2}L${x3} ${y3}A${r} ${r} 0 ${large} 0 ${x4} ${y4}Z`;
  };

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row">
      <svg viewBox="0 0 180 180" role="img" aria-label={ariaLabel} className="size-44 shrink-0">
        {total === 0 ? (
          <circle cx={C} cy={C} r={(R + r) / 2} fill="none" stroke="#e7eaf2" strokeWidth={R - r} />
        ) : (
          data.map((d) => {
            if (d.value === 0) return null;
            const sweep = (d.value / total) * Math.PI * 2;
            const start = angle;
            angle += sweep;
            // A single 100% segment cannot be drawn as one arc: draw a ring instead.
            if (d.value === total) {
              return (
                <circle key={d.label} cx={C} cy={C} r={(R + r) / 2} fill="none" stroke={d.color} strokeWidth={R - r}>
                  <title>{`${d.label}: ${d.value} (100%)`}</title>
                </circle>
              );
            }
            const mid = start + sweep / 2;
            const pct = Math.round((d.value / total) * 100);
            return (
              <g key={d.label}>
                <path d={arc(start, angle)} fill={d.color} stroke="#fff" strokeWidth="2">
                  <title>{`${d.label}: ${d.value} (${pct}%)`}</title>
                </path>
                {pct >= 8 && (
                  <text x={C + ((R + r) / 2) * Math.cos(mid)} y={C + ((R + r) / 2) * Math.sin(mid) + 3.5} textAnchor="middle" fontSize="10" fontWeight="600" fill="#fff">
                    {pct}%
                  </text>
                )}
              </g>
            );
          })
        )}
        {centre && (
          <text x={C} y={C + 5} textAnchor="middle" fontSize="16" fontWeight="700" fill="#12141c">
            {centre}
          </text>
        )}
      </svg>
      <ul className="w-full space-y-2.5 text-sm">
        {data.map((d) => (
          <li key={d.label} className="flex items-center gap-2.5">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: d.color }} />
            <span className="flex-1 text-ink/80">{d.label}</span>
            <span className="font-semibold tabular-nums">{d.value.toLocaleString("en-GB")}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
