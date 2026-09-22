/**
 * APEX RESEARCH — HISTORICAL ANALYSIS PACK (deterministic)
 *
 * Gives AI derived facts, not raw facts. Every number traced to yfinance.
 * Revenue/etc. history -> CAGR, trajectory, margin/ROE/ROIC/FCF trends,
 * leverage/working-capital/EPS deltas — so writer reasons over research
 * dataset, not raw DB rows.
 *
 * Provenance: every derived value cites [F-metric] period.
 */

import type { Fact, FactPack } from "./types";

export interface DerivedMetric {
  label: string;
  value: number | string;
  unit?: string;
  evidence: string; // cites [F-...] ids + periods
  confidence: number;
}

export interface HistoricalAnalysisPack {
  ticker: string;
  currency?: string;
  periods: string[]; // sorted oldest->newest
  // raw series (sparse)
  revenueSeries: Array<{ period: string; value: number; factId: string }>;
  netIncomeSeries: Array<{ period: string; value: number; factId: string }>;
  ebitSeries: Array<{ period: string; value: number; factId: string }>;
  equitySeries: Array<{ period: string; value: number; factId: string }>;
  assetsSeries: Array<{ period: string; value: number; factId: string }>;
  debtSeries: Array<{ period: string; value: number; factId: string }>;
  cashSeries: Array<{ period: string; value: number; factId: string }>;
  cfoSeries: Array<{ period: string; value: number; factId: string }>;
  capexSeries: Array<{ period: string; value: number; factId: string }>;
  epsSeries: Array<{ period: string; value: number; factId: string }>;
  // derived
  derived: DerivedMetric[];
  // textual summary for prompt injection
  summaryLines: string[];
}

function pickSeries(
  facts: Fact[],
  predicate: (m: string) => boolean
): Array<{ period: string; value: number; factId: string; metric: string }> {
  return facts
    .filter((f) => f.value !== undefined && isFinite(f.value as number) && predicate(f.metric))
    .sort((a, b) => a.period.localeCompare(b.period))
    .map((f) => ({ period: f.period, value: f.value as number, factId: `F-${f.metric}`, metric: f.metric }));
}

function cagr(series: number[]): number | undefined {
  if (series.length < 2) return undefined;
  const first = series[0];
  const last = series[series.length - 1];
  if (!(first > 0 && last > 0)) return undefined;
  const v = Math.pow(last / first, 1 / (series.length - 1)) - 1;
  return isFinite(v) ? v : undefined;
}

function yoy(series: Array<{ value: number }>): number[] {
  const out: number[] = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1].value;
    const cur = series[i].value;
    out.push(prev !== 0 ? (cur - prev) / Math.abs(prev) : 0);
  }
  return out;
}

function fmtPct(v: number | undefined): string {
  if (v === undefined || !isFinite(v)) return "N/A";
  return `${(v * 100).toFixed(1)}%`;
}
function fmtNum(v: number | undefined): string {
  if (v === undefined || !isFinite(v)) return "N/A";
  const a = Math.abs(v);
  if (a >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  return String(Math.round(v * 100) / 100);
}

export function buildHistoricalAnalysisPack(pack: FactPack): HistoricalAnalysisPack {
  const currency = pack.market.facts.find((f) => f.metric === "currentPrice")?.currency;
  const rev = pickSeries(pack.incomeStatement.facts, (m) => /revenue/i.test(m));
  const ni = pickSeries(pack.incomeStatement.facts, (m) => /netIncome/i.test(m));
  const ebit = pickSeries(pack.incomeStatement.facts, (m) => /ebit|operatingIncome/i.test(m));
  const equity = pickSeries(pack.balanceSheet.facts, (m) => /equity|stockholdersEquity/i.test(m));
  const assets = pickSeries(pack.balanceSheet.facts, (m) => /^totalAssets$/i.test(m));
  const debt = pickSeries(pack.balanceSheet.facts, (m) => /totalDebt|longTermDebt/i.test(m));
  const cash = pickSeries(pack.balanceSheet.facts, (m) => /^cash$/i.test(m));
  const cfo = pickSeries(pack.cashFlow.facts, (m) => /operatingCashFlow|totalCashFromOperating/i.test(m));
  const capex = pickSeries(pack.cashFlow.facts, (m) => /capitalExpenditure/i.test(m));
  const eps = pickSeries(pack.earnings.facts.concat(pack.incomeStatement.facts as any), (m) => /^eps/i.test(m) || /eps/i.test(m));

  const periods = [...new Set([...rev, ...ni, ...ebit].map((s) => s.period))].sort();

  const derived: DerivedMetric[] = [];
  const lines: string[] = [];

  // Revenue trajectory
  if (rev.length >= 1) {
    const vals = rev.map((r) => r.value);
    const cg = cagr(vals);
    const yoyVals = yoy(rev);
    const trend = yoyVals.length >= 2 ? (yoyVals[yoyVals.length - 1] > yoyVals[0] ? "accelerating" : yoyVals[yoyVals.length - 1] < yoyVals[0] ? "decelerating" : "stable") : "n/a";
    lines.push(`Revenue: ${rev.map((r) => `${r.period} ${fmtNum(r.value)}`).join(" → ")} (n=${rev.length})`);
    if (cg !== undefined) {
      lines.push(`Revenue ${rev.length - 1}Y CAGR = ${fmtPct(cg)}; YoY = ${yoyVals.map(fmtPct).join(", ")}; Trend = ${trend}`);
      derived.push({ label: `${rev.length - 1}Y Revenue CAGR`, value: cg, unit: "decimal", evidence: rev.map((r) => `${r.factId} ${r.period}`).join(", "), confidence: rev.length >= 3 ? 0.85 : 0.6 });
    }
    if (yoyVals.length) derived.push({ label: "Revenue YoY trajectory", value: yoyVals.join(","), unit: "decimal-list", evidence: rev.map((r) => r.factId).join(", "), confidence: 0.7 });
  } else {
    lines.push("Revenue: Not available from yfinance (no revenue facts)");
  }

  // Margin trajectory (NI / Revenue where both available per period)
  const marginByPeriod: Array<{ period: string; margin: number }> = [];
  for (const r of rev) {
    const n = ni.find((x) => x.period === r.period);
    if (n) marginByPeriod.push({ period: r.period, margin: n.value / r.value });
  }
  if (marginByPeriod.length) {
    const margins = marginByPeriod.map((m) => m.margin);
    const chg = margins.length >= 2 ? margins[margins.length - 1] - margins[0] : 0;
    lines.push(`Net margin by period: ${marginByPeriod.map((m) => `${m.period} ${fmtPct(m.margin)}`).join(", ")}; Δ ${fmtPct(chg)} over ${marginByPeriod.length} periods`);
    derived.push({ label: "Net margin trajectory", value: margins[margins.length - 1], unit: "decimal", evidence: marginByPeriod.map((m) => m.period).join(","), confidence: 0.75 });
  }

  // ROE trend (NI / Equity)
  const roeByPeriod: Array<{ period: string; roe: number }> = [];
  for (const n of ni) {
    const e = equity.find((x) => x.period === n.period);
    if (e && e.value !== 0) roeByPeriod.push({ period: n.period, roe: n.value / e.value });
  }
  if (roeByPeriod.length) {
    lines.push(`ROE: ${roeByPeriod.map((r) => `${r.period} ${fmtPct(r.roe)}`).join(", ")}`);
    derived.push({ label: "ROE trend", value: roeByPeriod[roeByPeriod.length - 1].roe, unit: "decimal", evidence: roeByPeriod.map((r) => r.period).join(","), confidence: 0.7 });
  }

  // ROIC proxy (NI / Assets where available)
  if (assets.length && ni.length) {
    const roic = ni.map((n) => {
      const a = assets.find((x) => x.period === n.period);
      return a && a.value ? { period: n.period, v: n.value / a.value } : null;
    }).filter(Boolean) as Array<{ period: string; v: number }>;
    if (roic.length) lines.push(`ROA (NI/Assets): ${roic.map((r) => `${r.period} ${fmtPct(r.v)}`).join(", ")}`);
  }

  // FCF & conversion
  if (cfo.length) {
    const fcfByPeriod: Array<{ period: string; fcf: number }> = [];
    for (const cf of cfo) {
      const cap = capex.find((x) => x.period === cf.period);
      const fcf = cf.value - (cap ? Math.abs(cap.value) : 0);
      fcfByPeriod.push({ period: cf.period, fcf });
    }
    lines.push(`CFO: ${cfo.map((c) => `${c.period} ${fmtNum(c.value)}`).join(", ")}`);
    if (capex.length) lines.push(`Capex: ${capex.map((c) => `${c.period} ${fmtNum(Math.abs(c.value))}`).join(", ")}`);
    lines.push(`FCF (CFO-Capex): ${fcfByPeriod.map((f) => `${f.period} ${fmtNum(f.fcf)}`).join(", ")}`);
    // FCF conversion per period where NI available
    const conv = fcfByPeriod.map((f) => {
      const n = ni.find((x) => x.period === f.period);
      return n && n.value !== 0 ? { period: f.period, c: f.fcf / n.value } : null;
    }).filter(Boolean) as Array<{ period: string; c: number }>;
    if (conv.length) lines.push(`FCF/NI conversion: ${conv.map((c) => `${c.period} ${fmtPct(c.c)}`).join(", ")}`);
  }

  // Debt / leverage
  if (debt.length) {
    const vals = debt.map((d) => d.value);
    const cg = cagr(vals.map((v) => Math.abs(v) + 1));
    lines.push(`Debt: ${debt.map((d) => `${d.period} ${fmtNum(d.value)}`).join(" → ")}`);
    if (cg !== undefined) lines.push(`Debt trajectory CAGR proxy ${fmtPct(cg)}`);
  }
  if (equity.length) lines.push(`Equity: ${equity.map((e) => `${e.period} ${fmtNum(e.value)}`).join(" → ")}`);

  // EPS trend
  if (eps.length) {
    const vals = eps.map((e) => e.value);
    const cg = cagr(vals.map((v) => (v > 0 ? v : 1)));
    lines.push(`EPS: ${eps.map((e) => `${e.period} ${fmtNum(e.value)}`).join(" → ")}${cg !== undefined ? `; CAGR ${fmtPct(cg)}` : ""}`);
  }

  // Valuation multiples from market facts
  const price = pack.market.facts.find((f) => f.metric === "currentPrice")?.value;
  const pe = pack.market.facts.find((f) => f.metric === "trailingPE")?.value;
  const pb = pack.market.facts.find((f) => f.metric === "priceToBook")?.value;
  if (price !== undefined) lines.push(`Market: price ${fmtNum(price)} ${currency || ""}${pe !== undefined ? `, trailing P/E ${pe.toFixed(1)}` : ""}${pb !== undefined ? `, P/B ${pb.toFixed(2)}` : ""}`);

  // Evidence packet header
  const header = [
    `HISTORICAL ANALYSIS PACK — ${pack.ticker} (yfinance, ${pack.retrievalTimestamp})`,
    `Currency: ${currency || "N/A"} | Periods: ${periods.join(", ") || "N/A"} | Observations: rev ${rev.length}, NI ${ni.length}, equity ${equity.length}`,
    "",
  ];

  return {
    ticker: pack.ticker,
    currency,
    periods,
    revenueSeries: rev.map((r) => ({ period: r.period, value: r.value, factId: r.factId })),
    netIncomeSeries: ni.map((r) => ({ period: r.period, value: r.value, factId: r.factId })),
    ebitSeries: ebit.map((r) => ({ period: r.period, value: r.value, factId: r.factId })),
    equitySeries: equity.map((r) => ({ period: r.period, value: r.value, factId: r.factId })),
    assetsSeries: assets.map((r) => ({ period: r.period, value: r.value, factId: r.factId })),
    debtSeries: debt.map((r) => ({ period: r.period, value: r.value, factId: r.factId })),
    cashSeries: cash.map((r) => ({ period: r.period, value: r.value, factId: r.factId })),
    cfoSeries: cfo.map((r) => ({ period: r.period, value: r.value, factId: r.factId })),
    capexSeries: capex.map((r) => ({ period: r.period, value: r.value, factId: r.factId })),
    epsSeries: eps.map((r) => ({ period: r.period, value: r.value, factId: r.factId })),
    derived,
    summaryLines: [...header, ...lines],
  };
}

export function renderHistoricalAnalysisPack(pack: HistoricalAnalysisPack): string {
  return pack.summaryLines.join("\n");
}

export default { buildHistoricalAnalysisPack, renderHistoricalAnalysisPack };
