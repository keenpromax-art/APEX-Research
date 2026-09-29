import type { Block } from "@/lib/types";

function formatValue(value: number | null | undefined, unit: string): string {
  if (value === null || value === undefined) return "N/A";
  if (unit === "percent") return `${(value * 100).toFixed(1)}%`;
  if (unit === "currency") {
    const abs = Math.abs(value);
    if (abs >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
    if (abs >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
    return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }
  if (unit === "ratio") return `${value.toFixed(2)}x`;
  if (unit === "number" && Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (unit === "number" && Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

const CALLOUT_ICONS: Record<string, string> = {
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
  warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
  uncertainty: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>',
  fact: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>',
};

function Chart({ block }: { block: Extract<Block, { type: "chart" }> }) {
  const points = block.data ?? [];
  const width = 800;
  const height = 260;
  const padding = { top: 16, right: 16, bottom: 26, left: 60 };
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => padding.left + (i / Math.max(points.length - 1, 1)) * (width - padding.left - padding.right);
  const y = (v: number) => padding.top + (1 - (v - min) / span) * (height - padding.top - padding.bottom);

  return (
    <div className="chart-card">
      <div className="chart-title">{block.title}</div>
      {points.length > 0 && (
        <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg" role="img" aria-label={block.title}>
          <defs>
            <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#5b8cff" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#5b8cff" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
            const gy = padding.top + frac * (height - padding.top - padding.bottom);
            return (
              <g key={frac}>
                <line x1={padding.left} x2={width - padding.right} y1={gy} y2={gy} className="chart-grid" />
                <text x={6} y={gy + 3} className="chart-label">{formatValue(max - frac * span, "number")}</text>
              </g>
            );
          })}
          <line x1={padding.left} x2={width - padding.right} y1={height - padding.bottom} y2={height - padding.bottom} className="chart-axis" />
          {block.chartType === "bar" ? (
            points.map((p, i) => {
              const slot = (width - padding.left - padding.right) / points.length;
              const barWidth = Math.max(3, slot * 0.65);
              return (
                <rect
                  key={i}
                  x={x(i) - barWidth / 2}
                  y={y(p.value)}
                  width={barWidth}
                  height={Math.max(1, height - padding.bottom - y(p.value))}
                  rx={3}
                  className="chart-bar"
                />
              );
            })
          ) : (
            <>
              <path
                d={`${points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.value)}`).join(" ")} L${x(points.length - 1)},${height - padding.bottom} L${x(0)},${height - padding.bottom} Z`}
                className="chart-area"
              />
              <path d={points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.value)}`).join(" ")} className="chart-line" />
              <circle cx={x(points.length - 1)} cy={y(points[points.length - 1].value)} r={3.5} fill="#5b8cff" />
            </>
          )}
          <text x={padding.left} y={height - 8} className="chart-label">{points[0].label}</text>
          <text x={width - padding.right} y={height - 8} textAnchor="end" className="chart-label">{points[points.length - 1].label}</text>
        </svg>
      )}
    </div>
  );
}

export function BlockRenderer({ block }: { block: Block }) {
  switch (block.type) {
    case "heading": {
      const level = Math.min(Math.max(block.level || 2, 2), 4);
      const Tag = `h${level}` as "h2" | "h3" | "h4";
      return <Tag className={`block-heading level-${level}`}>{block.content}</Tag>;
    }
    case "paragraph":
      return (
        <p className="block-paragraph">
          {block.content}
          {block.epistemic && <span className="epistemic-tag">{block.epistemic}</span>}
        </p>
      );
    case "metric":
      return (
        <div className="metric-grid">
          <div className="metric-card">
            <div className="metric-label">{block.label}</div>
            <div>
              <span className="metric-value">{formatValue(block.value, block.unit)}</span>
              {block.change !== null && block.change !== undefined && (
                <span className={`metric-change ${block.change >= 0 ? "up" : "down"}`}>
                  {block.change >= 0 ? "+" : ""}{(block.change * 100).toFixed(1)}%
                </span>
              )}
            </div>
          </div>
        </div>
      );
    case "table":
      return (
        <div className="table-wrap">
          <table className="block-table">
            <thead>
              <tr>{block.columns.map((col, i) => <th key={i}>{col}</th>)}</tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} className={typeof cell === "number" ? "num" : ""}>
                      {typeof cell === "number" ? formatValue(cell, "number") : cell ?? "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "chart":
      return <Chart block={block} />;
    case "callout":
      return (
        <div className={`callout ${block.variant}`}>
          <span dangerouslySetInnerHTML={{ __html: CALLOUT_ICONS[block.variant] ?? CALLOUT_ICONS.info }} />
          <span>{block.content}</span>
        </div>
      );
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag className="block-list">
          {block.items.map((item, i) => <li key={i}>{item}</li>)}
        </Tag>
      );
    }
    case "formula":
      return (
        <div className="formula">
          {block.expression}
          {block.result !== null && block.result !== undefined && (
            <span> = {formatValue(block.result, "number")}</span>
          )}
        </div>
      );
    case "provenance":
      return (
        <div className="provenance">
          <ul className="block-list">
            {block.items.map((item, i) => (
              <li key={i}>{item.claim} — {formatValue(item.value, "number")} ({item.source})</li>
            ))}
          </ul>
        </div>
      );
    default:
      return null;
  }
}
