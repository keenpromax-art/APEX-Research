// ============================================================
// APEX RESEARCH — Independent Recomputation Validator (P0 #9, #23)
// ------------------------------------------------------------
// A SEPARATE implementation that recomputes every load-bearing number
// from canonical facts through the math kernel. It never calls
// computeDCF, computeWACC, computeRatios, createAssumptionsLedger, or
// any螢幕 model/ledger code path — agreement between two independent
// implementations is the evidence; self-agreement is not.
// ============================================================
import {
  decomposeCapital,
  magnitudeTolerance,
  MONEY_BRIDGE_TOL,
  PER_SHARE_TOL,
  RATIO_TOL,
  WACCFormulaEngine,
  type ToleranceVerdict,
} from "./financial-kernel";
import { COUNTRY_CAPITAL_PARAMS } from "./calculations";
import type { CanonicalFactGraph } from "./canonical-facts";

export type IndependentSeverity = "FAIL" | "WARN" | "PASS";

export interface IndependentIssue {
  code: "IND-01" | "IND-02" | "IND-03" | "IND-04" | "IND-05";
  severity: Exclude<IndependentSeverity, "PASS">;
  message: string;
  expected: string;
  actual: string;
  magnitude: ToleranceVerdict;
}

export interface IndependentReport {
  issues: IndependentIssue[];
  passes: string[];
  checked: number;
}

export interface IndependentInputs {
  facts: CanonicalFactGraph;
  isFinancialInstitution: boolean;
  archetype?: string;
  country?: string;
  beta?: number;
  dcf: {
    enterpriseValue: number;
    sumPvFcff: number;
    pvTerminalValue: number;
    equityValue: number;
    netDebt?: number;
    financeReceivablesOffset?: number;
    intrinsicValue: number;
    fairValuePerShare?: number | null;
    sharesOutstanding: number;
    currentMarketPrice: number;
    assumptions?: { revenueGrowthRates?: number[]; ebitMargins?: number[]; wacc?: number; terminalGrowthRate?: number };
  };
  ledger: {
    fairValue: number;
    targetPrice: number;
    currentPrice: number;
    enterpriseValue?: number;
    equityValue?: number;
    netDebt?: number;
    sharesOutstanding?: number;
    wacc?: number;
    rating?: string;
  };
}

const fmt0 = (n: number) => (Number.isFinite(n) ? n.toFixed(0) : "n/a");

function pushFail(issues: IndependentIssue[], issue: IndependentIssue): void {
  issues.push(issue);
}

/**
 * IND-01: balance-sheet identity on every ACTUAL/ESTIMATE year.
 * FAIL beyond 5% relative AND material; WARN beyond 1%.
 */
function checkBsIdentity(facts: CanonicalFactGraph, issues: IndependentIssue[], passes: string[]): void {
  let evaluated = 0;
  for (const y of facts.years) {
    if (y.totalAssets.value === null || y.totalLiabilities.value === null || y.totalEquity.value === null) continue;
    evaluated++;
    const expected = y.totalAssets.value;
    const actual = (y.totalLiabilities.value as number) + (y.totalEquity.value as number);
    const v = magnitudeTolerance(expected, actual, { absTol: Math.max(1000, expected * 0.001), relTol: 0.01, materiality: Math.max(1000, expected * 0.05) });
    if (!v.pass && v.material && v.gapRel > 0.05) {
      pushFail(issues, {
        code: "IND-01", severity: "FAIL",
        message: `Independent BS identity breach in ${y.year}: assets ${fmt0(expected)} vs L+E ${fmt0(actual)} (${(v.gapRel * 100).toFixed(1)}%).`,
        expected: fmt0(expected), actual: fmt0(actual), magnitude: v,
      });
    } else if (!v.pass) {
      issues.push({
        code: "IND-01", severity: "WARN",
        message: `Independent BS identity drift in ${y.year}: ${v.detail}.`,
        expected: fmt0(expected), actual: fmt0(actual), magnitude: v,
      });
    }
  }
  if (evaluated === 0) {
    issues.push({
      code: "IND-01", severity: "WARN",
      message: `Balance-sheet identity not independently assessable — asset/liability/equity facts missing (see DATA-01).`,
      expected: "assessable identity", actual: "missing inputs",
      magnitude: magnitudeTolerance(0, 0, { absTol: 0, relTol: 0 }),
    });
  } else if (!issues.some((i) => i.code === "IND-01")) {
    passes.push(`IND-01: BS identity independently reconciled across ${evaluated} year(s).`);
  }
}

/**
 * IND-02: FCF = CFO − capex and NWC = CA − CL per year (both must be present).
 */
function checkCashChain(facts: CanonicalFactGraph, isFinancial: boolean, issues: IndependentIssue[], passes: string[]): void {
  let fcfChecked = 0;
  let nwcChecked = 0;
  for (const y of facts.years) {
    const rev = Math.abs(y.revenue.value ?? 0);
    if (y.freeCashFlow.value !== null && y.operatingCashFlow.value !== null && y.capitalExpenditures.value !== null) {
      fcfChecked++;
      const expected = (y.operatingCashFlow.value as number) - Math.abs(y.capitalExpenditures.value as number);
      const v = magnitudeTolerance(expected, y.freeCashFlow.value as number, { absTol: Math.max(1, rev * 0.005), relTol: 0.02, materiality: Math.max(1, rev * 0.02) });
      if (!v.pass && v.material) {
        const entry: IndependentIssue = {
          code: "IND-02", severity: isFinancial ? "WARN" : "FAIL",
          message: `${isFinancial ? "Informational" : "FATAL"}: ${y.year} FCF≠CFO−capex (${v.detail}).${isFinancial ? " Banks report FCF≈CFO; loan-book flows dominate." : ""}`,
          expected: fmt0(expected), actual: fmt0(y.freeCashFlow.value as number), magnitude: v,
        };
        if (isFinancial) issues.push({ ...entry, severity: "WARN" }); else pushFail(issues, entry);
      }
    }
    if (y.netWorkingCapital.value !== null && y.currentAssets.value !== null && y.currentLiabilities.value !== null) {
      nwcChecked++;
      const expected = (y.currentAssets.value as number) - (y.currentLiabilities.value as number);
      const v = magnitudeTolerance(expected, y.netWorkingCapital.value as number, { absTol: Math.max(1, rev * 0.005), relTol: 0.005, materiality: Math.max(1, rev * 0.005) });
      if (!v.pass && v.material) {
        pushFail(issues, {
          code: "IND-02", severity: "FAIL",
          message: `FATAL: ${y.year} NWC≠CA−CL (${v.detail}).`,
          expected: fmt0(expected), actual: fmt0(y.netWorkingCapital.value as number), magnitude: v,
        });
      }
    }
  }
  if (fcfChecked + nwcChecked === 0) {
    issues.push({
      code: "IND-02", severity: "WARN",
      message: `Cash/NWC chain not independently assessable — flow facts missing (see DATA-01).`,
      expected: "assessable chain", actual: "missing inputs",
      magnitude: magnitudeTolerance(0, 0, { absTol: 0, relTol: 0 }),
    });
  } else if (!issues.some((i) => i.code === "IND-02")) {
    passes.push(`IND-02: FCF/NWC chains independently reconciled (${fcfChecked} FCF, ${nwcChecked} NWC checks).`);
  }
}

/**
 * IND-03: EV bridge + per-share from canonical capital decomposition.
 * Net debt is re-derived (grossDebt − cash − liquidInvestments), never trusted.
 */
function checkEvBridge(inp: IndependentInputs, issues: IndependentIssue[], passes: string[]): void {
  const { facts, dcf, ledger, isFinancialInstitution } = inp;
  const latest = facts.years[facts.years.length - 1];
  if (!latest) return;
  const dec = decomposeCapital({
    totalDebt: latest.totalDebt.value ?? 0,
    cash: latest.cash.value ?? 0,
    shortTermInvestments: latest.shortTermInvestments.value ?? 0,
  });
  const canonicalNetDebt = dec.netDebt;

  const ev = Number(dcf.enterpriseValue) || 0;
  const sumPv = Number(dcf.sumPvFcff) || 0;
  const pvTv = Number(dcf.pvTerminalValue) || 0;
  if (!isFinancialInstitution && ev > 0) {
    const v = magnitudeTolerance(sumPv + pvTv, ev, MONEY_BRIDGE_TOL);
    if (!v.pass && v.material) {
      pushFail(issues, {
        code: "IND-03", severity: "FAIL",
        message: `FATAL: independent EV bridge breach — EV ${fmt0(ev)} vs ΣPV(FCFF)+PV(TV) ${fmt0(sumPv + pvTv)} (${v.detail}).`,
        expected: fmt0(sumPv + pvTv), actual: fmt0(ev), magnitude: v,
      });
    }
    const publishedNetDebt = Number(ledger.netDebt ?? dcf.netDebt) || 0;
    const offset = Number(dcf.financeReceivablesOffset) || 0;
    const expectedNet = canonicalNetDebt - (offset > 0 ? offset : 0);
    const nv = magnitudeTolerance(expectedNet, publishedNetDebt, MONEY_BRIDGE_TOL);
    if (!nv.pass && nv.material) {
      pushFail(issues, {
        code: "IND-03", severity: "FAIL",
        message: `FATAL: independent net-debt breach — published ${fmt0(publishedNetDebt)} vs canonical ${fmt0(expectedNet)} (${nv.detail}).`,
        expected: fmt0(expectedNet), actual: fmt0(publishedNetDebt), magnitude: nv,
      });
    }
    const eq = Number(ledger.equityValue ?? dcf.equityValue) || 0;
    const expEq = ev - publishedNetDebt;
    const ev2 = magnitudeTolerance(expEq, eq, MONEY_BRIDGE_TOL);
    if (eq > 0 && !ev2.pass && ev2.material) {
      pushFail(issues, {
        code: "IND-03", severity: "FAIL",
        message: `FATAL: independent equity bridge breach — EV−netDebt ${fmt0(expEq)} vs published ${fmt0(eq)} (${ev2.detail}).`,
        expected: fmt0(expEq), actual: fmt0(eq), magnitude: ev2,
      });
    }
  }
  // Per-share on the diluted base (P0 #10): basic must match; diluted only widens.
  // The published denominator must be the canonical basic or diluted count —
  // any third share base is an ungrounded per-share fantasy.
  const fv = Number(ledger.fairValue ?? ledger.targetPrice) || 0;
  const basic = facts.market.sharesBasic.value;
  const diluted = facts.market.sharesDiluted.value;
  const pubSh = Number(ledger.sharesOutstanding ?? dcf.sharesOutstanding) || 0;
  const pubEq = Number(ledger.equityValue ?? dcf.equityValue) || 0;
  if (fv > 0 && pubEq > 0 && pubSh > 0) {
    const expFv = pubEq / pubSh;
    const pv = magnitudeTolerance(expFv, fv, PER_SHARE_TOL);
    if (!pv.pass && pv.material) {
      pushFail(issues, {
        code: "IND-03", severity: "FAIL",
        message: `FATAL: independent per-share breach — equity/shares ${expFv.toFixed(2)} vs published FV ${fv.toFixed(2)} (${pv.detail}).`,
        expected: expFv.toFixed(2), actual: fv.toFixed(2), magnitude: pv,
      });
    }
    if (basic !== null && basic > 0) {
      const baseOk = magnitudeTolerance(basic, pubSh, { absTol: Math.max(1, basic * 0.01), relTol: 0.01, materiality: Math.max(1, basic * 0.01) });
      const dilOk = diluted !== null && diluted > 0
        ? magnitudeTolerance(diluted, pubSh, { absTol: Math.max(1, diluted * 0.01), relTol: 0.01, materiality: Math.max(1, diluted * 0.01) })
        : { pass: false, gapAbs: Infinity, gapRel: Infinity, material: false, detail: "no diluted base" };
      if (!baseOk.pass && !dilOk.pass) {
        pushFail(issues, {
          code: "IND-03", severity: "FAIL",
          message: `FATAL: published share base ${fmt0(pubSh)} matches neither canonical basic (${fmt0(basic)}) nor diluted (${diluted !== null ? fmt0(diluted) : "n/a"}) — ungrounded denominator.`,
          expected: `basic ${fmt0(basic)} or diluted`, actual: fmt0(pubSh), magnitude: baseOk,
        });
      }
    }
    if (diluted !== null && diluted > 0 && basic !== null && basic > 0 && diluted < basic * 0.999) {
      issues.push({
        code: "IND-03", severity: "FAIL",
        message: `FATAL: diluted shares (${fmt0(diluted)}) below basic (${fmt0(basic as number)}) — impossible capital structure.`,
        expected: `≥ ${fmt0(basic as number)}`, actual: fmt0(diluted),
        magnitude: magnitudeTolerance(basic as number, diluted, { absTol: 1, relTol: 0.001, materiality: 1 }),
      } as IndependentIssue);
    }
  }
  if (!issues.some((i) => i.code === "IND-03")) {
    passes.push(isFinancialInstitution
      ? `IND-03: residual-income path — per-share and diluted-base checks independently reconciled.`
      : `IND-03: EV/equity/per-share bridges independently reconciled from canonical capital.`);
  }
}

/**
 * IND-04: WACC independently re-sourced and re-solved (P0 #15).
 * Same public inputs (country table, beta rule, market weights, archetype
 * spreads), SEPARATE code — no computeWACC call. Drift beyond 50bps FAILs.
 */
function checkWacc(inp: IndependentInputs, issues: IndependentIssue[], passes: string[]): void {
  const { facts, beta, country, archetype, ledger, dcf, isFinancialInstitution } = inp;
  // Financial institutions are hurdled on cost-of-equity alone (residual-income
  // path: India-fixed Rf 6.85% + ERP 6.0%, beta→Blume→[0.65,1.35], CoE∈[9.5,14.5] —
  // deposits are operating liabilities, so market-weight blending is forbidden).
  if (isFinancialInstitution) {
    let rb = Number(beta);
    if (!Number.isFinite(rb) || rb <= 0) rb = 0.85;
    else if (rb < 0.35) rb = 0.35;
    else if (rb > 2.5) rb = 2.5;
    const eb = Math.max(0.65, Math.min(1.35, 0.67 * rb + 0.33 * 1.0));
    const recomputed = Math.max(0.095, Math.min(0.145, 0.0685 + eb * 0.06));
    const published = Number(ledger.wacc ?? (dcf.assumptions as unknown as { wacc?: number } | undefined)?.wacc) || 0;
    const v = magnitudeTolerance(recomputed, published, { absTol: 0.0025, relTol: 0.02, materiality: 0.005 });
    if (!v.pass && v.material && Math.abs(recomputed - published) > 0.005) {
      pushFail(issues, {
        code: "IND-04", severity: "FAIL",
        message: `FATAL: independent CoE-hurdle re-solution ${(recomputed * 100).toFixed(2)}% vs published ${(published * 100).toFixed(2)}% (${v.detail}).`,
        expected: `${(recomputed * 100).toFixed(2)}%`, actual: `${(published * 100).toFixed(2)}%`, magnitude: v,
      });
    } else if (!v.pass) {
      issues.push({
        code: "IND-04", severity: "WARN",
        message: `CoE-hurdle re-solution drift: ${v.detail}.`,
        expected: `${(recomputed * 100).toFixed(2)}%`, actual: `${(published * 100).toFixed(2)}%`, magnitude: v,
      });
    } else {
      passes.push(`IND-04: CoE hurdle independently re-solved to ${(recomputed * 100).toFixed(2)}% — matches published.`);
    }
    return;
  }
  // Country resolution mirrors resolveCountryParams predicate-for-predicate
  // (kept inline so the validator never imports the model's code path).
  const c = (country || "").toUpperCase();
  const cp = c.includes("INDIA") || c === "IN" || c === "INR" ? COUNTRY_CAPITAL_PARAMS.IN
    : c.includes("UNITED STATES") || c.includes("USA") || c === "US" || c === "USD" ? COUNTRY_CAPITAL_PARAMS.US
    : c.includes("UNITED KINGDOM") || c.includes("BRITAIN") || c === "GB" || c === "UK" ? COUNTRY_CAPITAL_PARAMS.GB
    : c.includes("EUROPE") || c.includes("GERMANY") || c.includes("FRANCE") || c === "EU" || c === "EUR" ? COUNTRY_CAPITAL_PARAMS.EU
    : { ...COUNTRY_CAPITAL_PARAMS.US };
  let rawBeta = Number(beta);
  if (!Number.isFinite(rawBeta) || rawBeta <= 0) rawBeta = 0.85;
  else if (rawBeta < 0.35) rawBeta = 0.35;
  else if (rawBeta > 2.5) rawBeta = 2.5;
  const blume = 0.67 * rawBeta + 0.33 * 1.0;
  const eb = Math.max(0.5, Math.min(1.8, Number(blume.toFixed(3))));
  const price = facts.market.price.value ?? 0;
  const basic = facts.market.sharesBasic.value ?? 0;
  const mktCap = price > 0 && basic > 0 ? price * basic : (facts.market.marketCap.value ?? 0);
  const latest = facts.years[facts.years.length - 1];
  const debt = latest?.totalDebt.value ?? 0;
  const tot = mktCap + (debt > 0 ? debt : 0);
  const wE = tot > 0 ? mktCap / tot : 0.95;
  const spread = archetype === "DISTRESSED" ? 0.02 : archetype === "EARLY_PLATFORM_GROWTH" ? 0.015 : 0;
  const solved = WACCFormulaEngine.compute({
    riskFreeRate: cp.riskFreeRate, equityRiskPremium: cp.equityRiskPremium, beta: eb,
    preTaxCostOfDebt: cp.costOfDebtPreTax, marginalTaxRate: cp.marginalTaxRate, equityWeight: wE,
  });
  if (!solved.valid) {
    issues.push({
      code: "IND-04", severity: "WARN",
      message: `WACC inputs non-viable for independent re-solution (${solved.reason}).`,
      expected: "viable inputs", actual: solved.reason,
      magnitude: magnitudeTolerance(0, 0, { absTol: 0, relTol: 0 }),
    });
    return;
  }
  const recomputed = Math.max(0.085, Math.min(0.16, Number((solved.wacc + spread).toFixed(4))));
  const published = Number(ledger.wacc ?? (dcf.assumptions as unknown as { wacc?: number } | undefined)?.wacc) || 0;
  const v = magnitudeTolerance(recomputed, published, { absTol: 0.0025, relTol: 0.02, materiality: 0.005 });
  if (!v.pass && v.material && Math.abs(recomputed - published) > 0.005) {
    pushFail(issues, {
      code: "IND-04", severity: "FAIL",
      message: `FATAL: independent WACC re-solution ${(recomputed * 100).toFixed(2)}% vs published ${(published * 100).toFixed(2)}% (${v.detail}).`,
      expected: `${(recomputed * 100).toFixed(2)}%`, actual: `${(published * 100).toFixed(2)}%`, magnitude: v,
    });
  } else if (!v.pass) {
    issues.push({
      code: "IND-04", severity: "WARN",
      message: `WACC re-solution drift: ${v.detail}.`,
      expected: `${(recomputed * 100).toFixed(2)}%`, actual: `${(published * 100).toFixed(2)}%`, magnitude: v,
    });
  } else {
    passes.push(`IND-04: WACC independently re-solved to ${(recomputed * 100).toFixed(2)}% — matches published.`);
  }
}

/**
 * IND-05: upside + rating map recomputed with an OWN threshold table
 * (not calculateRecommendation) — catches stale/hand-edited ledgers.
 */
function checkUpsideRating(inp: IndependentInputs, issues: IndependentIssue[], passes: string[]): void {
  const { facts, ledger } = inp;
  const cmp = facts.market.price.value ?? 0;
  const fv = Number(ledger.fairValue ?? ledger.targetPrice) || 0;
  if (!(cmp > 0) || !(fv > 0)) {
    issues.push({
      code: "IND-05", severity: "WARN",
      message: `Upside map not independently assessable — non-positive CMP/FV (see DATA-01).`,
      expected: "positive CMP+FV", actual: `cmp=${cmp}, fv=${fv}`,
      magnitude: magnitudeTolerance(0, 0, { absTol: 0, relTol: 0 }),
    });
    return;
  }
  const upside = fv / cmp - 1;
  const stored = Number((ledger as unknown as { upsideDownsidePct?: number }).upsideDownsidePct ?? NaN);
  const uv = magnitudeTolerance(upside, Number.isFinite(stored) ? stored : upside, RATIO_TOL);
  if (Number.isFinite(stored) && !uv.pass && uv.material) {
    pushFail(issues, {
      code: "IND-05", severity: "FAIL",
      message: `FATAL: stored upside ${(stored * 100).toFixed(1)}% vs recomputed ${(upside * 100).toFixed(1)}% (${uv.detail}).`,
      expected: `${(upside * 100).toFixed(1)}%`, actual: `${(stored * 100).toFixed(1)}%`, magnitude: uv,
    });
    return;
  }
  // Independent threshold map (own constants — deliberately not imported).
  const map = upside >= 0.12 ? "BUY" : upside <= -0.12 ? "SELL" : "HOLD";
  const published = String((ledger as unknown as { rating?: string }).rating || "");
  if (published && published !== "NR" && published !== map) {
    const structural = (map === "BUY" && upside < 0) || (map === "SELL" && upside > 0.15);
    const entry: IndependentIssue = {
      code: "IND-05", severity: structural ? "FAIL" : "WARN",
      message: `${structural ? "FATAL" : "Advisory"}: independent map says ${map} (${(upside * 100).toFixed(1)}%) but ledger asserts ${published}.`,
      expected: map, actual: published,
      magnitude: magnitudeTolerance(upside, upside, RATIO_TOL),
    };
    if (structural) pushFail(issues, entry); else issues.push(entry);
  } else if (!issues.some((i) => i.code === "IND-05")) {
    passes.push(`IND-05: upside ${(upside * 100).toFixed(1)}% and rating map independently reconciled.`);
  }
}

export function validateIndependently(inputs: IndependentInputs): IndependentReport {
  const issues: IndependentIssue[] = [];
  const passes: string[] = [];
  checkBsIdentity(inputs.facts, issues, passes);
  checkCashChain(inputs.facts, inputs.isFinancialInstitution, issues, passes);
  checkEvBridge(inputs, issues, passes);
  checkWacc(inputs, issues, passes);
  checkUpsideRating(inputs, issues, passes);
  return { issues, passes, checked: 5 };
}
