// ============================================================
// APEX RESEARCH — Forecast Reconciliation Rules
// ------------------------------------------------------------
// Machine-verifiable identities over ONE CanonicalForecast:
//
//   Bridges:        revenue / EBIT / pretax / net-income / CFO / FCF
//   Roll-forwards:  cash / debt / PP&E / share-count
//   Linkage:        DCF inputs ≡ forecast (vectors, FCFF, EV, per-share)
//   Continuity:     trailing actuals → Y1 (margin-cliff tripwire)
//   Liquidity:      forecast cash shortfalls (funding explanation)
//   Scenarios:      scenario input vectors ≡ forecast vectors
//
// Every rule recomputes from the forecast's own rows or from the DCF
// it prices — agreement is evidence; shared code paths would be vacuous,
// so these rules intentionally re-derive (never trust builder fields).
// Severities: info < warn < material < blocker. A blocker means the
// dossier must not price or publish on this forecast.
// ============================================================
import { magnitudeTolerance, MONEY_BRIDGE_TOL } from "./financial-kernel";
import type { CanonicalForecast, ForecastSeverity } from "./canonical-forecast";

export type ReconRuleId =
  | "revenue-bridge"
  | "ebit-bridge"
  | "pretax-bridge"
  | "net-income-bridge"
  | "cfo-bridge"
  | "fcf-bridge"
  | "cash-roll-forward"
  | "debt-roll-forward"
  | "ppe-roll-forward"
  | "share-count-roll-forward"
  | "dcf-linkage"
  | "margin-continuity"
  | "funding-liquidity"
  | "scenario-vector-identity";

export interface ReconFinding {
  rule: ReconRuleId;
  year?: string;
  pass: boolean;
  severity: ForecastSeverity;
  expected: string;
  actual: string;
  detail: string;
}

const fmt0 = (n: number) => (Number.isFinite(n) ? n.toFixed(0) : "n/a");
const fmtPct1 = (n: number) => (Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : "n/a");

function ok(rule: ReconRuleId, detail: string, year?: string): ReconFinding {
  return { rule, year, pass: true, severity: "info", expected: "identity holds", actual: "identity holds", detail };
}

function fail(
  rule: ReconRuleId,
  severity: ForecastSeverity,
  expected: string,
  actual: string,
  detail: string,
  year?: string
): ReconFinding {
  return { rule, year, pass: false, severity, expected, actual, detail };
}

/** Absolute margin cliff that can never be a modeling choice (MSFT 46.8% → 14.8% class). */
export const MARGIN_CLIFF_BLOCK_PP = 0.20;
/** Cliff vs a high trailing base that triggers even below the absolute bar. */
export const MARGIN_HIGH_BASE = 0.25;
export const MARGIN_HIGH_BASE_DROP_PP = 0.15;
/** Gap that demands material attention (disclosed mid-cycle anchoring or not). */
export const MARGIN_MATERIAL_GAP_PP = 0.10;

export interface ReconcileInputs {
  forecast: CanonicalForecast;
  /** DCF assumption vectors to verify against the forecast (the mismatch catcher). */
  dcfAssumptions?: {
    revenueGrowthRates?: number[];
    ebitMargins?: number[];
    avgCapexPct?: number;
    avgDeptPct?: number;
    avgNwcChangePct?: number;
    wacc?: number;
    terminalGrowthRate?: number;
  } | null;
  /** DCF priced outputs to re-derive from forecast rows. */
  dcfOutputs?: {
    sumPvFcff?: number;
    enterpriseValue?: number;
    equityValue?: number;
    fairValuePerShare?: number | null;
    netDebt?: number;
    sharesOutstanding?: number;
  } | null;
  /** Scenario base input vectors (ledger) to verify against forecast vectors. */
  scenarioBaseVector?: { revenueGrowth?: number[]; ebitMargin?: number[] } | null;
  /** True when an FCFF DCF prices off this forecast (RI path skips linkage). */
  enforceDcfLinkage?: boolean;
}

/**
 * Run every reconciliation rule. Pure + deterministic. Findings with
 * severity blocker/material fail loudly; warn/info are diagnostic.
 */
export function reconcileForecast(inputs: ReconcileInputs): ReconFinding[] {
  const { forecast } = inputs;
  const out: ReconFinding[] = [];
  const rows = forecast.projections || [];
  if (rows.length === 0) {
    return [fail("revenue-bridge", "blocker", "5 forecast years", "0 years", "CanonicalForecast carries no projection rows — nothing downstream may price.")];
  }
  const a = forecast.assumptions;
  const tax = a.marginalTaxRate;

  // ── Bridges (re-derived per row) ──
  rows.forEach((r, i) => {
    const prevRev = i === 0 ? a.trailingRevenue : rows[i - 1].revenue;
    // revenue bridge
    {
      const exp = prevRev * (1 + r.revenueGrowth);
      const t = magnitudeTolerance(exp, r.revenue, MONEY_BRIDGE_TOL);
      if (!t.pass && t.material) out.push(fail("revenue-bridge", "blocker", fmt0(exp), fmt0(r.revenue), `Revenue ≠ prior × (1+g): ${t.detail}`, r.label));
    }
    // ebit bridge
    {
      const exp = r.revenue * r.ebitMargin;
      const t = magnitudeTolerance(exp, r.ebit, MONEY_BRIDGE_TOL);
      if (!t.pass && t.material) out.push(fail("ebit-bridge", "blocker", fmt0(exp), fmt0(r.ebit), `EBIT ≠ revenue × margin: ${t.detail}`, r.label));
    }
    // pretax bridge
    {
      const exp = r.ebit - r.interestExpense + r.interestIncome;
      const t = magnitudeTolerance(exp, r.pretax, MONEY_BRIDGE_TOL);
      if (!t.pass && t.material) out.push(fail("pretax-bridge", "blocker", fmt0(exp), fmt0(r.pretax), `Pretax ≠ EBIT − intExp + intInc: ${t.detail}`, r.label));
    }
    // net-income bridge
    {
      const exp = r.pretax - r.taxPayment;
      const t = magnitudeTolerance(exp, r.netIncome, MONEY_BRIDGE_TOL);
      if (!t.pass && t.material) out.push(fail("net-income-bridge", "blocker", fmt0(exp), fmt0(r.netIncome), `NI ≠ pretax − tax: ${t.detail}`, r.label));
    }
    // cfo bridge: CFO = NI + D&A − ΔWC (SBC modeled 0 by construction)
    {
      const exp = r.netIncome + r.depreciation - r.changeInWorkingCapital;
      const t = magnitudeTolerance(exp, r.operatingCashFlow, MONEY_BRIDGE_TOL);
      if (!t.pass && t.material) out.push(fail("cfo-bridge", "blocker", fmt0(exp), fmt0(r.operatingCashFlow), `CFO ≠ NI + D&A − ΔWC: ${t.detail}`, r.label));
    }
    // fcf bridge (two forms must agree): FCF = CFO − capex AND FCF = FCFF − (NOPAT − NI)
    {
      const exp = r.operatingCashFlow - r.capex;
      const t = magnitudeTolerance(exp, r.freeCashFlow, MONEY_BRIDGE_TOL);
      if (!t.pass && t.material) out.push(fail("fcf-bridge", "blocker", fmt0(exp), fmt0(r.freeCashFlow), `FCF ≠ CFO − capex: ${t.detail}`, r.label));
      const cross = r.fcff - (r.nopat - r.netIncome);
      const tc = magnitudeTolerance(cross, r.freeCashFlow, MONEY_BRIDGE_TOL);
      if (!tc.pass && tc.material) out.push(fail("fcf-bridge", "blocker", fmt0(cross), fmt0(r.freeCashFlow), `FCF ≠ FCFF − (NOPAT − NI) cross-identity: ${tc.detail}`, r.label));
    }
  });

  // ── Roll-forwards (chained across years from opening stocks) ──
  // Cash: close[t] = open + CFO − capex − div − buyback + netBorrowing (floored at 0 only with recorded gap)
  {
    let open = rows[0].cash - rows[0].netChangeInCash;
    rows.forEach((r) => {
      const expRaw = open + r.operatingCashFlow - r.capex - r.dividends - r.buybacks + r.netBorrowing;
      const exp = expRaw < 0 ? 0 : expRaw;
      const t = magnitudeTolerance(exp, r.cash, MONEY_BRIDGE_TOL);
      if (!t.pass && t.material) {
        out.push(fail("cash-roll-forward", "blocker", fmt0(exp), fmt0(r.cash), `Cash close ≠ open + CFO − capex − div − buyback + netBorrowing: ${t.detail}`, r.label));
      }
      if (expRaw < 0 && !(r.fundingGap > 0)) {
        out.push(fail("cash-roll-forward", "blocker", `fundingGap ${fmt0(-expRaw)}`, "0", `Cash would go negative with NO recorded funding gap — shortfall hidden, not disclosed.`, r.label));
      }
      if (r.cash < 0) {
        out.push(fail("cash-roll-forward", "blocker", "≥ 0", fmt0(r.cash), `Negative forecast cash printed — floor at zero with explicit funding gap instead.`, r.label));
      }
      open = r.cash;
    });
  }
  // Debt: close = max(0, open × (1 − amort)); netBorrowing = Δdebt
  {
    let open = rows[0].totalDebt - rows[0].netBorrowing;
    rows.forEach((r) => {
      const exp = Math.max(0, open * (1 - a.debtAmortizationRate));
      const t = magnitudeTolerance(exp, r.totalDebt, MONEY_BRIDGE_TOL);
      if (!t.pass && t.material) out.push(fail("debt-roll-forward", "blocker", fmt0(exp), fmt0(r.totalDebt), `Debt close ≠ amortized opening: ${t.detail}`, r.label));
      const nb = magnitudeTolerance(r.totalDebt - open, r.netBorrowing, MONEY_BRIDGE_TOL);
      if (!nb.pass && nb.material) out.push(fail("debt-roll-forward", "blocker", fmt0(r.totalDebt - open), fmt0(r.netBorrowing), `netBorrowing ≠ Δdebt: ${nb.detail}`, r.label));
      open = r.totalDebt;
    });
  }
  // PP&E: close = open + capex − dep
  {
    // Opening stock backs out of Y1 (builder always recurses ppe[t] = open + capex − dep).
    let open = rows[0].ppe - rows[0].capex + rows[0].depreciation;
    rows.forEach((r) => {
      const exp = open + r.capex - r.depreciation;
      const t = magnitudeTolerance(exp, r.ppe, MONEY_BRIDGE_TOL);
      if (!t.pass && t.material) out.push(fail("ppe-roll-forward", "blocker", fmt0(exp), fmt0(r.ppe), `PP&E close ≠ open + capex − D&A: ${t.detail}`, r.label));
      open = r.ppe;
    });
  }
  // Share count: constant at the resolved base (buybacks modeled 0 — disclosed)
  {
    const base = a.sharesOutstanding;
    rows.forEach((r) => {
      if (!(base > 0)) {
        out.push(fail("share-count-roll-forward", "blocker", "> 0 resolved shares", String(base), `Unresolved share count used in per-share valuation — no per-share value may print.`, r.label));
      } else if (r.shares !== base) {
        const t = magnitudeTolerance(base, r.shares, { absTol: 1, relTol: 0.001, materiality: 1 });
        if (!t.pass) out.push(fail("share-count-roll-forward", "blocker", fmt0(base), fmt0(r.shares), `Share count drifted from resolved base (buybacks modeled 0): ${t.detail}`, r.label));
      }
    });
  }

  // ── DCF linkage (re-derive priced outputs from forecast rows) ──
  if (inputs.enforceDcfLinkage !== false && inputs.dcfOutputs) {
    const o = inputs.dcfOutputs;
    const f = forecast.dcf;
    const link = (name: string, exp: number, act: number | null | undefined, tol = MONEY_BRIDGE_TOL) => {
      if (act === null || act === undefined || !Number.isFinite(act)) {
        out.push(fail("dcf-linkage", "blocker", fmt0(exp), String(act), `${name} missing/non-finite on the DCF side — unresolved valuation value must not publish.`));
        return;
      }
      const t = magnitudeTolerance(exp, act, tol);
      if (!t.pass && t.material) out.push(fail("dcf-linkage", "blocker", fmt0(exp), fmt0(act), `DCF ${name} ≠ forecast re-derivation: ${t.detail}`));
    };
    link("sumPvFcff", f.sumPvFcff, o.sumPvFcff);
    link("enterpriseValue", f.enterpriseValue, o.enterpriseValue);
    link("equityValue", f.equityValue, o.equityValue);
    if (f.fairValuePerShare !== null && o.fairValuePerShare !== null) {
      const t = magnitudeTolerance(f.fairValuePerShare, o.fairValuePerShare ?? NaN, { absTol: 1.0, relTol: 0.01, materiality: 1.0 });
      if (!t.pass && t.material) out.push(fail("dcf-linkage", "blocker", (f.fairValuePerShare ?? NaN).toFixed(2), (o.fairValuePerShare ?? NaN).toFixed(2), `DCF per-share ≠ forecast re-derivation: ${t.detail}`));
    } else if ((f.fairValuePerShare === null) !== (o.fairValuePerShare === null)) {
      out.push(fail("dcf-linkage", "blocker", String(f.fairValuePerShare), String(o.fairValuePerShare), `Per-share null-state disagrees — one side prices what the other cannot.`));
    }
    // Assumption vectors: the DCF must price THESE vectors, not parallel ones.
    if (inputs.dcfAssumptions) {
      const da = inputs.dcfAssumptions;
      const vecEq = (name: string, exp: number[], act: number[] | undefined) => {
        if (!act || act.length !== exp.length) {
          out.push(fail("dcf-linkage", "blocker", `${name}[${exp.length}]`, act ? `${name}[${act.length}]` : "missing", `DCF ${name} vector length/shape ≠ forecast — parallel assumptions detected.`));
          return;
        }
        for (let i = 0; i < exp.length; i++) {
          const t = magnitudeTolerance(exp[i], act[i], { absTol: 0.0005, relTol: 0.01, materiality: 0.001 });
          if (!t.pass && t.material) {
            out.push(fail("dcf-linkage", "blocker", exp.map((v) => v.toFixed(4)).join(","), act.map((v) => v.toFixed(4)).join(","), `DCF ${name} ≠ forecast vector at Y${i + 1}: ${t.detail}`));
            return;
          }
        }
      };
      vecEq("revenueGrowthRates", forecast.revenueGrowthRates, da.revenueGrowthRates);
      vecEq("ebitMargins", forecast.ebitMargins, da.ebitMargins);
      if (da.wacc !== undefined) {
        const t = magnitudeTolerance(forecast.wacc, da.wacc, { absTol: 0.0005, relTol: 0.02, materiality: 0.005 });
        if (!t.pass && t.material) out.push(fail("dcf-linkage", "blocker", forecast.wacc.toFixed(4), da.wacc.toFixed(4), `DCF WACC ≠ forecast WACC: ${t.detail}`));
      }
      if (da.terminalGrowthRate !== undefined) {
        const t = magnitudeTolerance(forecast.terminalGrowthRate, da.terminalGrowthRate, { absTol: 0.0005, relTol: 0.02, materiality: 0.005 });
        if (!t.pass && t.material) out.push(fail("dcf-linkage", "blocker", forecast.terminalGrowthRate.toFixed(4), da.terminalGrowthRate.toFixed(4), `DCF terminal growth ≠ forecast: ${t.detail}`));
      }
    }
    // EV bridge unresolved (enterpriseValue ≤ 0 or non-finite on FCFF path).
    if (!(forecast.dcf.enterpriseValue > 0)) {
      out.push(fail("dcf-linkage", "blocker", "> 0 enterprise value", fmt0(forecast.dcf.enterpriseValue), `Unresolved enterprise-value bridge — no target price may derive from it.`));
    }
  }

  // ── Margin continuity (trailing actuals → Y1; the MSFT tripwire) ──
  {
    const c = forecast.continuity;
    const gap = c.forecastY1Margin - c.trailingEbitMargin;
    const agap = Math.abs(gap);
    const y1 = rows[0]?.label ?? "Y1";
    if (agap > MARGIN_CLIFF_BLOCK_PP || (c.trailingEbitMargin > MARGIN_HIGH_BASE && gap < -MARGIN_HIGH_BASE_DROP_PP)) {
      out.push(fail(
        "margin-continuity", "blocker",
        `Y1 ≈ trailing ${fmtPct1(c.trailingEbitMargin)}`, `Y1 ${fmtPct1(c.forecastY1Margin)}`,
        `Forecast margin cliff: trailing ${fmtPct1(c.trailingEbitMargin)} → Y1 ${fmtPct1(c.forecastY1Margin)} (${gap >= 0 ? "+" : ""}${(gap * 100).toFixed(1)}pp) at ${y1} — no disclosed mid-cycle basis can excuse a break this large; re-anchor the seed.`,
        y1
      ));
    } else if (agap > MARGIN_MATERIAL_GAP_PP) {
      out.push(fail(
        "margin-continuity", "material",
        `Y1 ≈ trailing ${fmtPct1(c.trailingEbitMargin)}`, `Y1 ${fmtPct1(c.forecastY1Margin)}`,
        `Material forecast discontinuity (${(gap * 100).toFixed(1)}pp) at ${y1} — requires disclosed mid-cycle anchoring in the forecast basis.`,
        y1
      ));
    } else {
      out.push(ok("margin-continuity", `Y1 ${fmtPct1(c.forecastY1Margin)} continuous with trailing ${fmtPct1(c.trailingEbitMargin)} (gap ${(gap * 100).toFixed(1)}pp).`, y1));
    }
  }

  // ── Funding / liquidity (explicit explanation, never silent) ──
  for (const gap of forecast.funding.gaps) {
    out.push(fail(
      "funding-liquidity", "material",
      "self-funded explicit years", `shortfall ${fmt0(gap.amount)}`,
      `${gap.year}: forecast cash requires external funding of ${fmt0(gap.amount)} — ${forecast.funding.explanation.slice(0, 160)}`,
      gap.year
    ));
  }
  if (forecast.funding.gaps.length === 0) {
    out.push(ok("funding-liquidity", "Forecast cash stays non-negative in every explicit year."));
  }

  // ── Scenario vector identity (ledger base vectors ≡ forecast vectors) ──
  if (inputs.scenarioBaseVector) {
    const sv = inputs.scenarioBaseVector;
    const eqVec = (name: string, exp: number[], act: number[] | undefined) => {
      if (!act || act.length !== exp.length) {
        out.push(fail("scenario-vector-identity", "blocker", `${name}[${exp.length}]`, act ? `${name}[${act.length}]` : "missing", `Scenario base ${name} not derived from the forecast schema — parallel forecast values detected.`));
        return;
      }
      for (let i = 0; i < exp.length; i++) {
        const t = magnitudeTolerance(exp[i], act[i], { absTol: 0.0005, relTol: 0.01, materiality: 0.001 });
        if (!t.pass && t.material) {
          out.push(fail("scenario-vector-identity", "blocker", exp.map((v) => v.toFixed(4)).join(","), act.map((v) => v.toFixed(4)).join(","), `Scenario base ${name} ≠ forecast at Y${i + 1}: ${t.detail}`));
          return;
        }
      }
    };
    eqVec("revenueGrowth", forecast.revenueGrowthRates, sv.revenueGrowth);
    eqVec("ebitMargin", forecast.ebitMargins, sv.ebitMargin);
  }

  return out;
}

/** Split findings for QA mapping: blockers/material vs the rest. */
export function splitFindings(findings: ReconFinding[]): {
  blockers: ReconFinding[];
  material: ReconFinding[];
  warns: ReconFinding[];
  infos: ReconFinding[];
} {
  return {
    blockers: findings.filter((f) => !f.pass && f.severity === "blocker"),
    material: findings.filter((f) => !f.pass && f.severity === "material"),
    warns: findings.filter((f) => !f.pass && f.severity === "warn"),
    infos: findings.filter((f) => f.pass || f.severity === "info"),
  };
}
