/**
 * APEX RESEARCH — Economic Plausibility Engine (model-vs-economics QA)
 *
 * Accounting QA asks: "does Assets = Liabilities + Equity?"
 * This engine asks: "does this MODEL make economic sense?"
 *
 *   - Forecast capex collapsing vs demonstrated investment intensity
 *   - D&A falling while the PP&E stock grows (under-depreciation)
 *   - Model net debt departing from the reported stock without a
 *     maturity/borrowing plan on record
 *   - Terminal FCFF dwarfing every historical FCF year
 *   - Terminal capex below terminal D&A (shrinking asset base + growth)
 *   - Forecast growth/margins above demonstrated ceilings
 *
 * Pure + deterministic. Consumes the baseline reconciliation table
 * (guidance-reconciliation.ts) plus terminal specifics — no duplicated
 * band math. Every finding is WARN-grade with the comparison spelled out:
 * plausibility informs conviction; it never blocks publication on its own
 * (accounting/bridge FAILs own the hard gate).
 */

import type { AnnualFinancials, DCFResult } from "@/types/report";
import { isBankStatement, isInsuranceStatement } from "@/types/report";
import { buildBaselineReconciliation, type BaselineRow } from "./guidance-reconciliation";

export interface PlausibilityFinding {
  id: "ECON-01" | "ECON-02" | "ECON-03" | "ECON-04" | "ECON-05";
  name: string;
  status: "PASS" | "WARN" | "SKIP";
  detail: string;
}

export interface EconomicPlausibilityReport {
  findings: PlausibilityFinding[];
  warnCount: number;
  generatedAt: string;
}

const rowOf = (rows: BaselineRow[], metric: string): BaselineRow | undefined =>
  rows.find((r) => r.metric === metric);

function warn(id: PlausibilityFinding["id"], name: string, detail: string): PlausibilityFinding {
  return { id, name, status: "WARN", detail };
}
function pass(id: PlausibilityFinding["id"], name: string, detail: string): PlausibilityFinding {
  return { id, name, status: "PASS", detail };
}
function skip(id: PlausibilityFinding["id"], name: string, detail: string): PlausibilityFinding {
  return { id, name, status: "SKIP", detail };
}

/** Run the five economic plausibility checks (pure). */
export function checkEconomicPlausibility(args: {
  annualFinancials: AnnualFinancials[];
  dcf: DCFResult;
  stockData: { targetMeanPrice?: unknown; targetHighPrice?: unknown; targetLowPrice?: unknown; numberOfAnalystOpinions?: unknown };
}): EconomicPlausibilityReport {
  const { annualFinancials, dcf } = args;
  const fins = annualFinancials;
  const latest: any = fins[fins.length - 1] || {};
  const isFin = isBankStatement(latest) || isInsuranceStatement(latest);

  const fc: any = (dcf as any)?.canonicalForecast ?? null;
  const growth: number[] = Array.isArray(fc?.revenueGrowthRates) && fc.revenueGrowthRates.length > 0
    ? fc.revenueGrowthRates
    : Array.isArray((dcf.assumptions as any)?.revenueGrowthRates) ? (dcf.assumptions as any).revenueGrowthRates : [];
  const margins: number[] = Array.isArray(fc?.ebitMargins) && fc.ebitMargins.length > 0
    ? fc.ebitMargins
    : Array.isArray((dcf.assumptions as any)?.ebitMargins) ? (dcf.assumptions as any).ebitMargins : [];
  const capexPct: number | null = typeof fc?.avgCapexPct === "number" ? fc.avgCapexPct
    : typeof (dcf as any)?.avgCapexPct === "number" ? (dcf as any).avgCapexPct : null;
  const taxRate: number | null = typeof fc?.assumptions?.marginalTaxRate === "number" ? fc.assumptions.marginalTaxRate
    : typeof (dcf.assumptions as any)?.marginalTaxRate === "number" ? (dcf.assumptions as any).marginalTaxRate : null;
  const modelNetDebt: number | null = typeof (dcf as any)?.netDebt === "number" ? (dcf as any).netDebt : null;
  const fv: number | null = typeof (dcf as any)?.fairValuePerShare === "number" && (dcf as any).fairValuePerShare > 0
    ? (dcf as any).fairValuePerShare
    : typeof (dcf as any)?.intrinsicValue === "number" && (dcf as any).intrinsicValue > 0 ? (dcf as any).intrinsicValue : null;

  const baseline = buildBaselineReconciliation({
    annualFinancials: fins as any,
    modelGrowth: growth,
    modelMargins: margins,
    modelCapexPct: capexPct,
    modelTaxRate: taxRate,
    modelPayout: null,
    modelNetDebt,
    modelFairValue: fv,
    stockData: args.stockData as any,
  });

  const findings: PlausibilityFinding[] = [];

  // ECON-01 — capex continuity (forecast vs demonstrated investment).
  {
    const row = rowOf(baseline.rows, "Capex intensity");
    if (!row || row.status === "UNVERIFIED" || isFin) {
      findings.push(skip("ECON-01", "Capex Continuity", isFin ? "Financial-institution path: capex non-material to residual-income valuation — skipped." : "Insufficient capex history to judge continuity."));
    } else if (row.status === "WARN") {
      findings.push(warn("ECON-01", "Capex Continuity", `${row.note} A forecast that starves capex flatters FCFF one-for-one — verify against project pipelines and maintenance needs.`));
    } else {
      findings.push(pass("ECON-01", "Capex Continuity", row.note));
    }
  }

  // ECON-02 — D&A vs PP&E stock (under-depreciation while assets grow).
  {
    const ppe = fins.map((f: any) => Number(f.netFixedAssets) || 0);
    const dep = fins.map((f: any) => Math.abs(Number(f.depreciation) || Number((f as any).depreciationAmortization) || 0));
    const revs = fins.map((f: any) => Number(f.revenue ?? f.totalRevenue) || 0);
    const histDept = ppe.map((_, i) => (revs[i] > 0 ? dep[i] / revs[i] : null)).filter((v): v is number => v !== null);
    const medDept = histDept.length >= 2 ? histDept.slice().sort((a, b) => a - b)[histDept.length >> 1] : null;
    const ppeGrew = ppe.length >= 2 && ppe[0] > 0 && ppe[ppe.length - 1] / ppe[0] > 1.5;
    const fcDept: number | null = typeof fc?.avgDeptPct === "number" ? fc.avgDeptPct
      : typeof (dcf as any)?.avgDeptPct === "number" ? (dcf as any).avgDeptPct : null;
    if (isFin || medDept === null || fcDept === null) {
      findings.push(skip("ECON-02", "Depreciation vs Asset Stock", isFin ? "Financial-institution path — skipped." : "Insufficient D&A history to judge."));
    } else if (ppeGrew && fcDept < medDept * 0.6) {
      findings.push(warn("ECON-02", "Depreciation vs Asset Stock", `PP&E stock grew >50% over history yet forecast D&A intensity ${(fcDept * 100).toFixed(1)}% sits <60% of demonstrated median ${(medDept * 100).toFixed(1)}% — under-depreciation flatters NOPAT; verify asset lives and the PP&E roll-forward.`));
    } else {
      findings.push(pass("ECON-02", "Depreciation vs Asset Stock", `Forecast D&A ${(fcDept * 100).toFixed(1)}% vs demonstrated median ${(medDept * 100).toFixed(1)}% — depreciation keeps pace with the asset stock.`));
    }
  }

  // ECON-03 — net-debt trajectory vs reported stock.
  {
    const row = rowOf(baseline.rows, "Net debt trajectory");
    if (!row || row.status === "UNVERIFIED" || isFin) {
      findings.push(skip("ECON-03", "Debt Trajectory", isFin ? "Financial-institution path: deposits are operating liabilities — skipped." : "No model net-debt figure to judge."));
    } else if (row.status === "WARN") {
      findings.push(warn("ECON-03", "Debt Trajectory", `${row.note} Debt falling while borrowing plans rise (or vice versa) is a model-vs-funding-plan contradiction — the classic lever a weak DCF hides behind.`));
    } else {
      findings.push(pass("ECON-03", "Debt Trajectory", row.note));
    }
  }

  // ECON-04 — terminal realism (scale + reinvestment coherence).
  {
    const termFcff: number | null = typeof fc?.terminal?.fcffT === "number" ? fc.terminal.fcffT
      : typeof (dcf as any)?.terminalYearFcff === "number" ? (dcf as any).terminalYearFcff : null;
    const histFcf = fins
      .map((f: any) => Number(f.freeCashFlow))
      .filter((v) => Number.isFinite(v) && v > 0);
    const maxHist = histFcf.length > 0 ? Math.max(...histFcf) : null;
    const termCapexOk = capexPct !== null;
    const termDept: number | null = typeof fc?.avgDeptPct === "number" ? fc.avgDeptPct
      : typeof (dcf as any)?.avgDeptPct === "number" ? (dcf as any).avgDeptPct : null;
    const underInvested = termCapexOk && termDept !== null && capexPct !== null && capexPct < termDept * 0.7;
    if (termFcff === null || isFin) {
      findings.push(skip("ECON-04", "Terminal Realism", isFin ? "Financial-institution path — skipped." : "No terminal FCFF to judge."));
    } else if (maxHist !== null && termFcff > maxHist * 3) {
      findings.push(warn("ECON-04", "Terminal Realism", `Terminal FCFF ${Math.round(termFcff).toLocaleString("en")} is >3× the best demonstrated FCF year ${Math.round(maxHist).toLocaleString("en")} — the valuation prices a cash machine history never produced; demand terminal-margin evidence.${underInvested ? " Worse: terminal capex trails D&A (shrinking asset base priced alongside growth)." : ""}`));
    } else if (underInvested) {
      findings.push(warn("ECON-04", "Terminal Realism", `Terminal capex ${(capexPct as number * 100).toFixed(1)}% trails terminal D&A ${((termDept as number) * 100).toFixed(1)}% — a shrinking asset base cannot support perpetual growth; raise terminal reinvestment or lower terminal g.`));
    } else {
      findings.push(pass("ECON-04", "Terminal Realism", `Terminal FCFF ${Math.round(termFcff).toLocaleString("en")} scales credibly off demonstrated cash generation${maxHist !== null ? ` (best year ${Math.round(maxHist).toLocaleString("en")})` : ""}; terminal reinvestment coherent.`));
    }
  }

  // ECON-05 — growth/margin ceilings vs demonstrated bands.
  {
    const gRow = rowOf(baseline.rows, "Revenue growth");
    const mRow = rowOf(baseline.rows, "EBIT margin");
    const bits: string[] = [];
    let bad = false;
    if (gRow && gRow.status === "WARN") { bad = true; bits.push(gRow.note); }
    if (mRow && mRow.status === "WARN" && !isFin) { bad = true; bits.push(mRow.note); }
    if ((!gRow || gRow.status === "UNVERIFIED") && (!mRow || mRow.status === "UNVERIFIED" || isFin)) {
      findings.push(skip("ECON-05", "Growth & Margin Ceilings", "Insufficient history to judge forecast ceilings."));
    } else if (bad) {
      findings.push(warn("ECON-05", "Growth & Margin Ceilings", bits.join(" ")));
    } else {
      findings.push(pass("ECON-05", "Growth & Margin Ceilings", [gRow?.note, !isFin ? mRow?.note : null].filter(Boolean).join(" ")));
    }
  }

  return { findings, warnCount: findings.filter((f) => f.status === "WARN").length, generatedAt: new Date().toISOString() };
}

export default { checkEconomicPlausibility };
