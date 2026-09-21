/**
 * APEX RESEARCH — Guidance Reconciliation (model-vs-baseline table)
 *
 * The institutional "Guidance vs Model" engine, built for the data that
 * exists TODAY: trailing history bands + Street consensus (Yahoo targets).
 * Each row compares what the MODEL assumes against what has been
 * DEMONSTRATED (history) and what the STREET expects (consensus).
 *
 * Management guidance has a FIRST-CLASS typed slot
 * ({ value, source, date } | null) that is currently unfilled — there is no
 * filings/earnings-call ingestion source in this runtime, and inventing
 * guidance would be fabrication. When a filings source lands, populate the
 * slot; every consumer below already handles it (UNVERIFIED → reconciled).
 * Until then the table is explicit about what it cannot check.
 */

import type { AnnualFinancials, StockData } from "@/types/report";
import { stmtNum } from "@/types/report";

export type BaselineStatus = "PASS" | "WARN" | "UNVERIFIED";

export interface ManagementGuidance {
  value: number | string;
  source: string;
  date?: string;
}

export interface BaselineRow {
  metric: string;
  unit: string;
  historyBand: { min: number; median: number; max: number; periods: number } | null;
  modelValue: number | null;
  streetValue: number | null;
  /** Management guidance — null until a filings/call ingestion source exists. */
  guidance: ManagementGuidance | null;
  status: BaselineStatus;
  note: string;
}

export interface BaselineReconciliation {
  rows: BaselineRow[];
  /** True when every row reconciles or is explicitly unverified (never blocked). */
  allClear: boolean;
  generatedAt: string;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

function bandOf(vs: number[]): BaselineRow["historyBand"] {
  const clean = vs.filter((v) => Number.isFinite(v));
  if (clean.length < 2) return null;
  const s = [...clean].sort((a, b) => a - b);
  const m = s.length >> 1;
  return {
    min: s[0],
    median: s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2,
    max: s[s.length - 1],
    periods: clean.length,
  };
}

const pct = (v: number | null, digits = 1): string =>
  v === null ? "n/a" : `${(v * 100).toFixed(digits)}%`;

export interface BaselineInputs {
  annualFinancials: AnnualFinancials[];
  /** Model vectors actually priced (canonical forecast preferred, DCF assumptions fallback). */
  modelGrowth: number[];
  modelMargins: number[];
  modelCapexPct: number | null;
  modelTaxRate: number | null;
  modelPayout: number | null;
  modelNetDebt: number | null;
  modelFairValue: number | null;
  stockData: StockData;
}

/** Build the model-vs-baseline reconciliation table (pure). */
export function buildBaselineReconciliation(inp: BaselineInputs): BaselineReconciliation {
  const fins = inp.annualFinancials;
  const rows: BaselineRow[] = [];

  // Revenue CAGR band (first→last positive revenues).
  const revs = fins.map((f: any) => Number(f.revenue ?? f.totalRevenue) || 0);
  let histCagr: number | null = null;
  if (revs.length >= 2 && revs[0] > 0 && revs[revs.length - 1] > 0) {
    histCagr = Math.pow(revs[revs.length - 1] / revs[0], 1 / (revs.length - 1)) - 1;
  }
  const modelCagr = inp.modelGrowth.length > 0
    ? inp.modelGrowth.reduce((s, g) => s * (1 + g), 1) ** (1 / inp.modelGrowth.length) - 1
    : null;
  const yoyGrowths: number[] = [];
  for (let i = 1; i < revs.length; i++) {
    if (revs[i - 1] > 0 && revs[i] > 0) yoyGrowths.push(revs[i] / revs[i - 1] - 1);
  }
  const growthBand = bandOf(yoyGrowths);
  rows.push({
    metric: "Revenue growth",
    unit: "CAGR vs YoY band",
    historyBand: growthBand,
    modelValue: modelCagr,
    streetValue: null,
    guidance: null,
    status: !growthBand || modelCagr === null ? "UNVERIFIED" : modelCagr > growthBand.max + 0.15 ? "WARN" : "PASS",
    note: !growthBand || modelCagr === null
      ? "Insufficient history or model vector to reconcile growth."
      : modelCagr > growthBand.max + 0.15
        ? `Model CAGR ${pct(modelCagr)} exceeds the best demonstrated YoY year ${pct(growthBand.max)} by >15pp — demand pipeline/guidance evidence (management-guidance slot empty: no filings source).`
        : `Model CAGR ${pct(modelCagr)} inside demonstrated range [${pct(growthBand.min)} … ${pct(growthBand.max)}]${histCagr !== null ? ` (multi-year CAGR ${pct(histCagr)})` : ""}.`,
  });

  // EBIT margin band.
  const histMargins = fins
    .map((f: any) => {
      const r = Number(f.revenue ?? f.totalRevenue) || 0;
      const oi = stmtNum(f, "operatingIncome");
      return r > 0 ? oi / r : null;
    })
    .filter((v): v is number => v !== null && Number.isFinite(v));
  const marginBand = bandOf(histMargins);
  const modelMarginAvg = inp.modelMargins.length > 0
    ? inp.modelMargins.reduce((s, m) => s + m, 0) / inp.modelMargins.length
    : null;
  rows.push({
    metric: "EBIT margin",
    unit: "average",
    historyBand: marginBand,
    modelValue: modelMarginAvg,
    streetValue: null,
    guidance: null,
    status: !marginBand || modelMarginAvg === null ? "UNVERIFIED" : modelMarginAvg > marginBand.max + 0.05 ? "WARN" : "PASS",
    note: !marginBand || modelMarginAvg === null
      ? "Insufficient history or model vector to reconcile margins."
      : modelMarginAvg > marginBand.max + 0.05
        ? `Model average margin ${pct(modelMarginAvg)} sits >5pp above the demonstrated ceiling ${pct(marginBand.max)} — requires mix-shift or operating-leverage evidence.`
        : `Model average margin ${pct(modelMarginAvg)} within demonstrated band [${pct(marginBand.min)} … ${pct(marginBand.max)}].`,
  });

  // Capex intensity band.
  const histCapex = fins
    .map((f: any) => {
      const r = Number(f.revenue ?? f.totalRevenue) || 0;
      const c = Math.abs(Number(f.capitalExpenditures) || 0);
      return r > 0 ? c / r : null;
    })
    .filter((v): v is number => v !== null && Number.isFinite(v));
  const capexBand = bandOf(histCapex);
  rows.push({
    metric: "Capex intensity",
    unit: "% of revenue",
    historyBand: capexBand,
    modelValue: inp.modelCapexPct,
    streetValue: null,
    guidance: null,
    status: !capexBand || inp.modelCapexPct === null ? "UNVERIFIED" : inp.modelCapexPct < capexBand.median * 0.5 ? "WARN" : "PASS",
    note: !capexBand || inp.modelCapexPct === null
      ? "Insufficient history or model intensity to reconcile capex."
      : inp.modelCapexPct < capexBand.median * 0.5
        ? `Model capex ${pct(inp.modelCapexPct)} is <50% of demonstrated median ${pct(capexBand.median)} — under-investment vs history; reconcile against management capex guidance (slot empty: no filings source).`
        : `Model capex ${pct(inp.modelCapexPct)} vs demonstrated median ${pct(capexBand.median)} — investment continuity holds.`,
  });

  // Effective tax rate band.
  const histEtr = fins
    .map((f: any) => {
      const pre = Number(f.pretaxIncome) || 0;
      const tax = Number(f.incomeTaxExpense) || 0;
      return pre > 0 ? tax / pre : null;
    })
    .filter((v): v is number => v !== null && v >= 0 && v <= 0.6);
  const etrBand = bandOf(histEtr);
  rows.push({
    metric: "Effective tax rate",
    unit: "rate",
    historyBand: etrBand,
    modelValue: inp.modelTaxRate,
    streetValue: null,
    guidance: null,
    status: !etrBand || inp.modelTaxRate === null ? "UNVERIFIED" : inp.modelTaxRate < etrBand.min - 0.05 ? "WARN" : "PASS",
    note: !etrBand || inp.modelTaxRate === null
      ? "Insufficient history or model rate to reconcile tax."
      : inp.modelTaxRate < etrBand.min - 0.05
        ? `Model tax ${(inp.modelTaxRate * 100).toFixed(1)}% is >5pp below demonstrated floor ${pct(etrBand.min)} — verify NOLs/holidays before trusting NOPAT.`
        : `Model tax ${(inp.modelTaxRate * 100).toFixed(1)}% within demonstrated band [${pct(etrBand.min)} … ${pct(etrBand.max)}].`,
  });

  // Net debt stock.
  const latest: any = fins[fins.length - 1] || {};
  const bsNetDebt = (Number(latest.totalDebt) || 0) - (Number(latest.cash) || 0);
  rows.push({
    metric: "Net debt trajectory",
    unit: "money",
    historyBand: null,
    modelValue: inp.modelNetDebt,
    streetValue: null,
    guidance: null,
    status: inp.modelNetDebt === null ? "UNVERIFIED" : Math.abs(inp.modelNetDebt - bsNetDebt) > Math.max(1000, Math.abs(bsNetDebt) * 0.5) && bsNetDebt > 0 ? "WARN" : "PASS",
    note: inp.modelNetDebt === null
      ? "No model net-debt figure to reconcile."
      : Math.abs(inp.modelNetDebt - bsNetDebt) > Math.max(1000, Math.abs(bsNetDebt) * 0.5) && bsNetDebt > 0
        ? `Model net debt ${Math.round(inp.modelNetDebt).toLocaleString("en")} departs >50% from reported ${Math.round(bsNetDebt).toLocaleString("en")} — reconcile against maturity/borrowing plans (guidance slot empty).`
        : `Model net debt ties to the reported stock (${Math.round(bsNetDebt).toLocaleString("en")}).`,
  });

  // Fair value vs Street.
  const mean = num(inp.stockData.targetMeanPrice);
  const high = num(inp.stockData.targetHighPrice);
  const low = num(inp.stockData.targetLowPrice);
  const opinions = num(inp.stockData.numberOfAnalystOpinions) ?? 0;
  const streetOk = mean !== null && mean > 0 && opinions > 0;
  const bandOk = high !== null && low !== null && high > 0 && low > 0;
  const fv = inp.modelFairValue;
  const outsideBand = streetOk && bandOk && fv !== null && ((fv as number) < (low as number) || (fv as number) > (high as number));
  rows.push({
    metric: "Fair value vs Street",
    unit: "per share",
    historyBand: null,
    modelValue: fv,
    streetValue: streetOk ? mean : null,
    guidance: null,
    status: !streetOk || fv === null ? "UNVERIFIED" : outsideBand ? "WARN" : "PASS",
    note: !streetOk || fv === null
      ? "No Street consensus on record — model stands alone (disclosed, not corroborated)."
      : outsideBand
        ? `Model FV ${(fv as number).toFixed(2)} sits OUTSIDE the Street range ${(low as number).toFixed(2)}–${(high as number).toFixed(2)} (${opinions} opinions, mean ${(mean as number).toFixed(2)}) — explain the disagreement explicitly.`
        : `Model FV ${(fv as number).toFixed(2)} inside Street range ${(low as number).toFixed(2)}–${(high as number).toFixed(2)} (${opinions} opinions).`,
  });

  // allClear counts WARNs only — UNVERIFIED rows (missing history, absent
  // Street, empty guidance slot) are disclosed gaps, not failures.
  return { rows, allClear: rows.every((r) => r.status !== "WARN"), generatedAt: new Date().toISOString() };
}

export default { buildBaselineReconciliation };
