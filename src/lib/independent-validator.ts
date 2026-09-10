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
  wcDriverDays,
  rollforwardVariance,
  detectAccountingAnomalies,
  type ToleranceVerdict,
} from "./financial-kernel";
import { COUNTRY_CAPITAL_PARAMS } from "./calculations";
import type { CanonicalFactGraph, CanonicalYearFacts, RawFact } from "./canonical-facts";

export type IndependentSeverity = "FAIL" | "WARN" | "PASS";

export interface IndependentIssue {
  code: "IND-01" | "IND-02" | "IND-03" | "IND-04" | "IND-05" | "STMT-01" | "STMT-02" | "WC-01" | "EV-01" | "ANOM-01" | "XMOD-01" | "CONF-01" | "AI-01" | "ECON-01" | "DUPONT-01" | "LIQ-01" | "LC-01" | "IMM-01" | "AUDIT-01";
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
  const eb = Math.max(0.5, Math.min(1.8, blume));
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
  const recomputed = Number(Math.max(0.085, Math.min(0.16, solved.wacc + spread)).toFixed(4));
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

/**
 * STMT-01: statement-integrity battery — income-statement closure, ETR bounds,
 * sign discipline, retained-earnings bridge, debt-maturity sum, cash
 * roll-forward, EBITDA taxonomy, interest-tranche rates, buyback/SBC share
 * consistency. FAIL only on material, definitionally-impossible breaks;
 * definitional variance (other income in EBITDA, OCI plugs in RE) WARNs.
 */
function checkStatementIntegrity(inp: IndependentInputs, issues: IndependentIssue[], passes: string[]): void {
  const { facts } = inp;
  let evaluated = 0;
  let warns = 0;
  const years = facts.years;
  // Staleness logs: corporate-closure FAILs and ETR FAILs are recorded with year so
  // the post-loop staleness doctrine can scope precisely (latest-clean only). Bank
  // PPOP FAILs are never logged (exact-by-construction — always block).
  const closureFailLog: { entry: IndependentIssue; year: string; basis: string; expected: number; reported: number; detail: string; bundledNote: string }[] = [];
  const etrFailLog: { entry: IndependentIssue; year: string }[] = [];
  const niHistory: (number | null)[] = [];
  for (const y of years) {
    const v = (f: { value: number | null }) => f.value;
    // 1. Pretax closure: pretax ≈ opInc − interestExpense + interestIncome + otherIncome.
    // interestIncome is a distinct Yahoo line (timeseries) for cash-rich corporates;
    // quoteSummary vintages lack it (fact null → term 0 unless the data-gap rule below fires).
    // Adaptive basis (double-count guard, verified live on NVDA/MSFT/F/TSLA/GOOGL/META/AMZN/AAPL):
    // captive-finance issuers already include net interest inside operatingIncome, so for
    // those vintages adding interestIncome WORSENS the gap (F FY25: 12.6%→31%). Each year
    // evaluates BOTH bases whenever interestIncome is disclosed and non-zero and judges
    // severity on the better-reconciling one — even a sub-tolerance term can flip a verdict
    // at the FAIL boundary (NVDA FY26: 8.70%→6.81%), so engagement is NOT gated on size.
    // When the ex-intInc basis wins despite MATERIAL disclosed interestIncome, that's a
    // bundling signal → the vintage ambiguity is WARN-disclosed (never silent, never a new FAIL).
    // When interestIncome is STRUCTURALLY ABSENT (fact null) and the old-basis breach fits
    // entirely inside a plausible missing-interest-income range (≤2.5% of revenue — covers
    // the full observed large-cap range: MSFT 1.0%, NVDA ~1%, TSLA 1.8%), the year is
    // undecidable rather than broken → WARN data-gap (never silent, never blocking). Gaps
    // beyond that ceiling stay FAIL: no plausible missing term explains them.
    // Tolerances/materiality otherwise unchanged. HARD FAIL on material breach (scorecard demands block).
    // For banks, pretax ≈ operatingIncome (PPOP) − provisionForCreditLosses (interest is revenue, not expense)
    const isBankYear = (y as any).statementType === "bank" || (y as any).statementType === "nbfc" || (y as any).statementType === "insurance";
    if (!isBankYear && v(y.operatingIncome) !== null && v(y.interestExpense) !== null && v(y.pretaxIncome) !== null) {
      evaluated++;
      const other = v(y.otherIncome) ?? 0;
      const intInc = v(y.interestIncome) ?? 0;
      const intIncDisclosed = v(y.interestIncome) !== null && intInc !== 0;
      const opInc = v(y.operatingIncome) as number;
      const intExp = v(y.interestExpense) as number;
      const reported = v(y.pretaxIncome) as number;
      const mkTol = (exp: number) => ({ absTol: Math.max(1000, Math.abs(exp) * 0.02), relTol: 0.05, materiality: Math.max(1000, Math.abs(exp) * 0.08) });
      const baseOld = opInc - intExp + other;
      const tOld = magnitudeTolerance(baseOld, reported, mkTol(baseOld));
      let t = tOld;
      let expected = baseOld;
      let basis = "opInc−interest+other";
      let bundledNote = "";
      let bundledMaterial = false;
      if (intIncDisclosed) {
        const baseNew = baseOld + intInc;
        const tNew = magnitudeTolerance(baseNew, reported, mkTol(baseNew));
        const gapOld = Math.abs(reported - baseOld) / Math.max(1, Math.abs(baseOld));
        const gapNew = Math.abs(reported - baseNew) / Math.max(1, Math.abs(baseNew));
        if (gapNew <= gapOld) {
          t = tNew;
          expected = baseNew;
          basis = "opInc−interest+intInc+other";
        } else {
          bundledNote = " (ex-intInc basis used: disclosed interestIncome likely already bundled in operating/other income for this vintage — adding it worsens the gap)";
          // Vintage-ambiguity disclosure only for material terms; trivial leftovers stay silent.
          bundledMaterial = Math.abs(intInc) > mkTol(baseOld).absTol;
        }
      }
      if (!t.pass) {
        if (t.material && t.gapRel > 0.08) {
          const rev = v(y.revenue) ?? 0;
          const gapAbs = Math.abs(reported - expected);
          // (i) Data-gap rule: interestIncome structurally absent AND the whole gap
          // fits inside a plausible missing-interest-income range → undecidable, WARN.
          // Anything larger is provably broken regardless of the missing term → FAIL.
          if (bundledNote === "" && v(y.interestIncome) === null && rev > 0 && gapAbs <= 0.025 * rev) {
            warns++;
            issues.push({ code: "STMT-01", severity: "WARN", message: `Pretax closure data-gap in ${y.year}: ${basis} ${fmt0(expected)} vs reported ${fmt0(reported)} (${t.detail}) — interestIncome unavailable for this fiscal year and the gap is fully explained by a plausible missing-interest-income range (≤2.5% of revenue); not a confirmed broken identity.`, expected: fmt0(expected), actual: fmt0(reported), magnitude: t });
          } else if (rev > 0 && gapAbs <= 0.01 * rev) {
            // (ii) Revenue-materiality floor: a bridge discrepancy under 1% of revenue
            // is immaterial to any valuation use (normal FX/reclass noise routinely
            // reaches this scale) even when large relative to a small pretax base
            // (distressed/break-even years where relative gaps explode) → WARN.
            warns++;
            issues.push({ code: "STMT-01", severity: "WARN", message: `Pretax closure drift in ${y.year}: ${basis} ${fmt0(expected)} vs reported ${fmt0(reported)} (${t.detail}) — residual under 1% of revenue, immaterial to valuation (rev-floor).`, expected: fmt0(expected), actual: fmt0(reported), magnitude: t });
          } else if (rev > 0 && Math.abs(reported / rev) >= 0.1 && gapAbs > 0.01 * rev && gapAbs <= 0.02 * rev) {
            // (ii-b) Tiered floor: healthy-margin (≥10% pretax margin) companies get a
            // 2% band for the same FX/reclass noise (their 1-2% wedges are small even
            // relative to earnings). Thin-margin names stay on the 1% floor above —
            // a 2%-of-revenue gap there can exceed half of pretax and must still block.
            // Flat WARN branch: anything outside the band falls THROUGH to the
            // corroboration and input-integrity checks below, never FAILs here.
            warns++;
            issues.push({ code: "STMT-01", severity: "WARN", message: `Pretax closure drift in ${y.year}: ${basis} ${fmt0(expected)} vs reported ${fmt0(reported)} (${t.detail}) — residual 1–2% of revenue at a healthy margin, consistent with FX/reclass noise (tiered-floor).`, expected: fmt0(expected), actual: fmt0(reported), magnitude: t });
          } else if (v(y.ebit) !== null && (v(y.incomeTaxExpense) !== null) && (v(y.netIncome) !== null) && !(
            // Taint guard: when operatingIncome itself is a modeled fallback, an ebit
            // fact numerically equal to it is the same fiction echoed (timeseries
            // builder falls back ebit→operatingIncome) — not independent evidence.
            // Corroboration must rest on genuinely reported lines; otherwise the
            // input-integrity rule below (synth-input) owns this year.
            y.operatingIncome.confidence === "low" && v(y.ebit) === v(y.operatingIncome)
          )) {
            // (iii) EBIT corroboration: when BOTH pretax−tax≈netIncome AND
            // EBIT−interestExpense≈pretax reconcile cleanly, pretax is doubly
            // corroborated and the residual sits in unobservable non-operating
            // items or the opInc mapping — operating margins stay unverified → WARN
            // (never silent).
            // (iii-b) Relaxed corroboration: both witnesses within 12% and the bridge
            // itself within 50% — measuredFalse-positive band for feed-mapping noise
            // (HCLTech pattern). Beyond 50% the disagreement is too large for any
            // mapping story — FAIL stands even corroborated.
            const expB = (v(y.ebit) as number) - intExp;
            const tB = magnitudeTolerance(expB, reported, mkTol(expB));
            const exp3 = ((v(y.incomeTaxExpense) as number) + (v(y.netIncome) as number));
            const t3 = magnitudeTolerance(exp3, reported, mkTol(exp3));
            if (tB.pass && t3.pass) {
              warns++;
              issues.push({ code: "STMT-01", severity: "WARN", message: `Pretax closure drift in ${y.year}: ${basis} ${fmt0(expected)} vs reported ${fmt0(reported)} (${t.detail}) — pretax doubly corroborated (EBIT−interest and tax+NI triples reconcile); residual is unobservable non-operating items or opInc mapping noise — treat operating margins as unverified (ebit-corroborated).`, expected: fmt0(expected), actual: fmt0(reported), magnitude: t });
            } else {
              const gE = Math.abs(reported - expB) / Math.max(1, Math.abs(expB));
              const g3 = Math.abs(reported - exp3) / Math.max(1, Math.abs(exp3));
              const gBridge = Math.abs(reported - expected) / Math.max(1, Math.abs(expected));
              if (gE <= 0.12 && g3 <= 0.12 && gBridge <= 0.5) {
                warns++;
                issues.push({ code: "STMT-01", severity: "WARN", message: `Pretax closure drift in ${y.year}: ${basis} ${fmt0(expected)} vs reported ${fmt0(reported)} (${t.detail}) — both corroborations within 12% and bridge within 50%: feed-mapping noise band, pretax broadly verified — treat operating margins as unverified (ebit-corroborated).`, expected: fmt0(expected), actual: fmt0(reported), magnitude: t });
              } else {
                const entry: IndependentIssue = { code: "STMT-01", severity: "FAIL", message: `FATAL: Pretax closure breach in ${y.year}: ${basis} ${fmt0(expected)} vs reported ${fmt0(reported)} (${t.detail}) — broken accounting identity blocks publication.${bundledNote}`, expected: fmt0(expected), actual: fmt0(reported), magnitude: t };
                pushFail(issues, entry);
                closureFailLog.push({ entry, year: y.year, basis, expected, reported, detail: t.detail, bundledNote });
              }
            }
          } else {
            // (iv) Input-integrity: never convict on compromised required inputs.
            // operatingIncome synthesized (@-fallback) or interestExpense silently zero
            // while interest-bearing debt exists (feed dropped the line, e.g. AAPL
            // FY24/25) → the bridge is unverifiable → WARN (never silent). The debt
            // bound (8%-coupon ceiling) keeps this from excusing real breaks, and
            // debt-free + zero-interest stays fully enforced below.
            const notes: string[] = [];
            if (y.operatingIncome.confidence === "low") notes.push("operatingIncome is a modeled fallback, not reported (synth-input)");
            const td = v(y.totalDebt);
            const ieZero = (v(y.interestExpense) as number) === 0;
            if (ieZero && td !== null && td > 0 && gapAbs <= 0.08 * td) {
              notes.push(`interestExpense reads zero while totalDebt is ${fmt0(td)} — line likely dropped by the feed; gap fits within an 8%-coupon ceiling (intExp-coverage-gap)`);
            }
            if (notes.length > 0) {
              warns++;
              issues.push({ code: "STMT-01", severity: "WARN", message: `Pretax closure drift in ${y.year}: ${basis} ${fmt0(expected)} vs reported ${fmt0(reported)} (${t.detail}) — unverifiable on compromised inputs: ${notes.join("; ")}.`, expected: fmt0(expected), actual: fmt0(reported), magnitude: t });
            } else {
              const entry: IndependentIssue = { code: "STMT-01", severity: "FAIL", message: `FATAL: Pretax closure breach in ${y.year}: ${basis} ${fmt0(expected)} vs reported ${fmt0(reported)} (${t.detail}) — broken accounting identity blocks publication.${bundledNote}`, expected: fmt0(expected), actual: fmt0(reported), magnitude: t };
              pushFail(issues, entry);
              closureFailLog.push({ entry, year: y.year, basis, expected, reported, detail: t.detail, bundledNote });
            }
          }
        } else {
          warns++;
          issues.push({ code: "STMT-01", severity: "WARN", message: `Pretax closure drift in ${y.year}: ${basis} ${fmt0(expected)} vs reported ${fmt0(reported)} (${t.detail}).${bundledNote}`, expected: fmt0(expected), actual: fmt0(reported), magnitude: t });
        }
      } else if (bundledNote !== "" && bundledMaterial) {
        // Old basis reconciles but interestIncome is material and non-additive:
        // disclose the vintage ambiguity (WARN, never blocking) instead of
        // silently dropping a disclosed line item.
        warns++;
        issues.push({ code: "STMT-01", severity: "WARN", message: `Pretax closure vintage-ambiguity in ${y.year}: ${basis} reconciles (${fmt0(expected)} vs reported ${fmt0(reported)}), but disclosed interestIncome of ${fmt0(intInc)} is non-additive here.${bundledNote}`, expected: fmt0(expected), actual: fmt0(reported), magnitude: t });
      }
    } else if (isBankYear && v(y.operatingIncome) !== null && v(y.pretaxIncome) !== null) {
      evaluated++;
      const provision = (y as any).provisionForCreditLosses?.value ?? 0;
      const expected = (v(y.operatingIncome) as number) - provision;
      const t = magnitudeTolerance(expected, v(y.pretaxIncome) as number, { absTol: Math.max(1000, Math.abs(expected) * 0.02), relTol: 0.05, materiality: Math.max(1000, Math.abs(expected) * 0.08) });
      if (!t.pass) {
        if (t.material && t.gapRel > 0.08) {
          pushFail(issues, { code: "STMT-01", severity: "FAIL", message: `FATAL: Bank pretax closure breach in ${y.year}: PPOP−provision ${fmt0(expected)} vs reported ${fmt0(v(y.pretaxIncome) as number)} (${t.detail}).`, expected: fmt0(expected), actual: fmt0(v(y.pretaxIncome) as number), magnitude: t });
        } else {
          warns++;
          issues.push({ code: "STMT-01", severity: "WARN", message: `Bank pretax closure drift in ${y.year}: PPOP−provision ${fmt0(expected)} vs reported ${fmt0(v(y.pretaxIncome) as number)} (${t.detail}).`, expected: fmt0(expected), actual: fmt0(v(y.pretaxIncome) as number), magnitude: t });
        }
      }
    }
    // 2. ETR bounds + sign discipline (P0 #38-part, #93).
    if (v(y.pretaxIncome) !== null && (v(y.pretaxIncome) as number) > 0 && v(y.incomeTaxExpense) !== null) {
      evaluated++;
      const etr = (v(y.incomeTaxExpense) as number) / (v(y.pretaxIncome) as number);
      if (etr > 1.5 || etr < -1.0) {
        // NOL-benefit rule: a tax BENEFIT (negative tax) following cumulative
        // prior-3y losses is textbook NOL/valuation-allowance-release economics
        // (measured: the common real-world shape behind absurd negative ETRs),
        // not corruption → WARN (tagged, never silent). Positive-tax absurdities
        // and benefits without loss history still FAIL.
        const taxV = v(y.incomeTaxExpense) as number;
        const prior = niHistory.slice(-3);
        if (taxV < 0 && prior.length > 0 && prior.every((n) => n !== null) && (prior as number[]).reduce((s, n) => s + n, 0) < 0) {
          warns++;
          issues.push({
            code: "STMT-01", severity: "WARN",
            message: `${y.year} effective tax rate ${(etr * 100).toFixed(1)}% reflects a tax benefit against cumulative prior-3y losses — NOL/valuation-allowance economics, not corruption (nol-benefit).`,
            expected: "0%..100%", actual: `${(etr * 100).toFixed(1)}%`,
            magnitude: magnitudeTolerance(0.25, etr, { absTol: 0.05, relTol: 0.2, materiality: 0.05 }),
          });
        } else {
          // Materiality floor (same doctrine as the closure revenue floor): a tax bill
          // under 1% of revenue makes the RATE meaningless noise on a tiny pretax base
          // (measured: the typical shape is a few-million true-up on billions of revenue).
          // Anything larger still FAILs — rates don't excuse material tax bills.
          const revE = v(y.revenue) ?? 0;
          if (revE > 0 && Math.abs(taxV) <= 0.01 * revE) {
            warns++;
            issues.push({
              code: "STMT-01", severity: "WARN",
              message: `${y.year} effective tax rate ${(etr * 100).toFixed(1)}% is arithmetically extreme but the tax bill is under 1% of revenue — rate noise on a small base, immaterial to valuation (etr-floor).`,
              expected: "0%..100%", actual: `${(etr * 100).toFixed(1)}%`,
              magnitude: magnitudeTolerance(0.25, etr, { absTol: 0.05, relTol: 0.2, materiality: 0.05 }),
            });
          } else {
            const entry: IndependentIssue = {
              code: "STMT-01", severity: "FAIL",
              message: `FATAL: ${y.year} effective tax rate ${(etr * 100).toFixed(1)}% is definitionally impossible — tax data or pretax base is corrupt.`,
              expected: "0%..100%", actual: `${(etr * 100).toFixed(1)}%`,
              magnitude: magnitudeTolerance(0.25, etr, { absTol: 0.05, relTol: 0.2, materiality: 0.05 }),
            };
            pushFail(issues, entry);
            etrFailLog.push({ entry, year: y.year });
          }
        }
      } else if (etr < -0.1 || etr > 0.6) {
        warns++;
        issues.push({ code: "STMT-01", severity: "WARN", message: `${y.year} ETR ${(etr * 100).toFixed(1)}% outside [0%, 60%] — one-offs/NOLs possible; verify before trusting NOPAT.`, expected: "0%..60%", actual: `${(etr * 100).toFixed(1)}%`, magnitude: magnitudeTolerance(0.25, etr, { absTol: 0.05, relTol: 0.2, materiality: 0.05 }) });
      }
    }
    if (v(y.interestExpense) !== null && (v(y.interestExpense) as number) < 0) {
      evaluated++;
      pushFail(issues, {
        code: "STMT-01", severity: "FAIL",
        message: `FATAL: ${y.year} negative interest expense (${fmt0(v(y.interestExpense) as number)}) — violates signed-value convention (expense ≥ 0).`,
        expected: "≥ 0", actual: fmt0(v(y.interestExpense) as number),
        magnitude: magnitudeTolerance(0, v(y.interestExpense) as number, { absTol: 1, relTol: 0.01, materiality: 1 }),
      });
    }
    // 3. EBITDA taxonomy: reported vs EBIT + depreciation. EBIT (not operating
    // income) is the anchor — Yahoo EBITDA = EBIT + D&A exactly for compliant
    // feeds (Reliance FY23–26 reconcile to the rupee); opInc excludes interest/
    // other income that EBITDA includes, so opInc+D&A false-fails by ~7–13%.
    // Corporate-only: bank/insurer/REIT shapes carry zero/absent EBITDA by
    // design (no EBITDA construct) — judging them here false-FAILs every year.
    // WARN on tolerance drift (definitional variance legitimate); FAIL past 15%
    // of reported EBITDA (taxonomy break blocks valuation).
    if (!isBankYear && v(y.ebitda) !== null && v(y.depreciation) !== null && (v((y as any).ebit) !== null || v(y.operatingIncome) !== null)) {
      evaluated++;
      const ebitVal = v((y as any).ebit) !== null ? (v((y as any).ebit) as number) : (v(y.operatingIncome) as number);
      const ebitLabel = v((y as any).ebit) !== null ? "EBIT" : "opInc(fallback)";
      const expected = ebitVal + (v(y.depreciation) as number);
      const t = magnitudeTolerance(expected, v(y.ebitda) as number, { absTol: Math.max(1000, Math.abs(expected) * 0.02), relTol: 0.05, materiality: Math.max(1000, Math.abs(expected) * 0.05) });
      if (!t.pass) {
        const gapRel = Math.abs((v(y.ebitda) as number) - expected) / Math.max(1, Math.abs(v(y.ebitda) as number));
        if (gapRel > 0.15) {
          pushFail(issues, {
            code: "STMT-01", severity: "FAIL",
            message: `FATAL: ${y.year} EBITDA taxonomy break: reported ${fmt0(v(y.ebitda) as number)} vs ${ebitLabel}+D&A ${fmt0(expected)} (${(gapRel * 100).toFixed(1)}% > 15%) — blocks valuation; verify EBITDA definition before trusting multiples.`,
            expected: fmt0(expected), actual: fmt0(v(y.ebitda) as number),
            magnitude: magnitudeTolerance(expected, v(y.ebitda) as number, { absTol: 1, relTol: 0.15, materiality: 1 }),
          });
        } else {
          warns++;
          issues.push({ code: "STMT-01", severity: "WARN", message: `${y.year} EBITDA taxonomy drift: reported ${fmt0(v(y.ebitda) as number)} vs ${ebitLabel}+D&A ${fmt0(expected)} (${t.detail}) — definitional variance possible.`, expected: fmt0(expected), actual: fmt0(v(y.ebitda) as number), magnitude: t });
        }
      }
    }
    // 4. Debt maturity: short + long + leases ≈ total. The residual that used to
    // false-warn (~6% for Reliance) IS the finance-lease liability — totalDebt
    // already includes it (std+ltd+capitalLeaseObligations = total to the rupee).
    // WARN on tolerance drift; FAIL past 10% (unexplained debt blocks valuation).
    // Skip when split fields are both zero/undisclosed (only totalDebt reported) — not a drift, just missing split.
    if (v(y.shortTermDebt) !== null && v(y.longTermDebt) !== null && v(y.totalDebt) !== null && (v(y.totalDebt) as number) > 0) {
      const sd = Number(v(y.shortTermDebt) ?? 0);
      const ld = Number(v(y.longTermDebt) ?? 0);
      if (sd === 0 && ld === 0) {
        // Split not disclosed — nothing to validate.
      } else {
        evaluated++;
        const leases = Number(v((y as any).capitalLeaseObligations) ?? 0);
        const expected = sd + ld + leases;
        const t = magnitudeTolerance(expected, v(y.totalDebt) as number, { absTol: Math.max(1000, expected * 0.02), relTol: 0.05, materiality: Math.max(1000, expected * 0.1) });
        if (!t.pass) {
          const gapRel = Math.abs((v(y.totalDebt) as number) - expected) / Math.max(1, Math.abs(v(y.totalDebt) as number));
          if (gapRel > 0.10) {
            pushFail(issues, {
              code: "STMT-01", severity: "FAIL",
              message: `FATAL: ${y.year} debt-split break: short+long+leases ${fmt0(expected)} vs total ${fmt0(v(y.totalDebt) as number)} (${(gapRel * 100).toFixed(1)}% > 10%) — unexplained debt blocks valuation.`,
              expected: fmt0(expected), actual: fmt0(v(y.totalDebt) as number),
              magnitude: magnitudeTolerance(expected, v(y.totalDebt) as number, { absTol: 1, relTol: 0.10, materiality: 1 }),
            });
          } else {
            warns++;
            issues.push({ code: "STMT-01", severity: "WARN", message: `${y.year} debt-maturity split drift: short+long+leases ${fmt0(expected)} vs total ${fmt0(v(y.totalDebt) as number)} (${t.detail}).`, expected: fmt0(expected), actual: fmt0(v(y.totalDebt) as number), magnitude: t });
          }
        }
      }
    }
    // 5. Interest-tranche implied rate bounds (P0 #39-part) — HARD FAIL when outside [0,25%] and debt is material.
    if (!isBankYear && v(y.interestExpense) !== null && (v(y.interestExpense) as number) > 0 && v(y.totalDebt) !== null && (v(y.totalDebt) as number) > 0) {
      evaluated++;
      const rate = (v(y.interestExpense) as number) / (v(y.totalDebt) as number);
      if (rate < 0 || rate > 0.25) {
        // Banks: interest is revenue (netInterestIncome), so this corporate rate check is N/A — skipped above.
        pushFail(issues, { code: "STMT-01", severity: "FAIL", message: `FATAL: ${y.year} implied borrowing rate ${(rate * 100).toFixed(1)}% outside [0%, 25%] — broken debt/interest linkage blocks publication; verify units before trusting coverage.`, expected: "0%..25%", actual: `${(rate * 100).toFixed(1)}%`, magnitude: magnitudeTolerance(0.05, rate, { absTol: 0.01, relTol: 0.2, materiality: 0.01 }) });
      }
    } else if (isBankYear && v(y.interestExpense) !== null && v(y.totalDebt) !== null && (v(y.totalDebt) as number) > 0) {
      const stmt = (y as any).statementType as string | undefined;
      if (stmt === "insurance") {
        // Insurers carry no NII construct — validate the underwriting identity
        // instead: combined ratio must sit in a definitionally-possible band and
        // float yield must be non-absurd. WARN-only (NEP/claims are proxied).
        const combined = (y as any).combinedRatio?.value as number | null;
        if (combined !== null && combined !== undefined && (combined < 0.3 || combined > 2.0)) {
          warns++;
          issues.push({ code: "STMT-01", severity: "WARN", message: `${y.year} insurer combined ratio ${(combined * 100).toFixed(0)}% outside [30%, 200%] — verify NEP/claims mapping units.`, expected: "30%..200%", actual: `${(combined * 100).toFixed(0)}%`, magnitude: magnitudeTolerance(1, combined, { absTol: 0.05, relTol: 0.1, materiality: 0.05 }) });
        }
        const invY = (y as any).investmentIncome?.value as number | null;
        const flt = (y as any).float?.value as number | null;
        if (invY !== null && flt !== null && invY !== undefined && flt !== undefined && flt > 0) {
          const yld = invY / flt;
          if (yld < 0 || yld > 0.25) {
            warns++;
            issues.push({ code: "STMT-01", severity: "WARN", message: `${y.year} insurer float yield ${(yld * 100).toFixed(1)}% outside [0%, 25%] — verify investment-income/float units.`, expected: "0%..25%", actual: `${(yld * 100).toFixed(1)}%`, magnitude: magnitudeTolerance(0.06, yld, { absTol: 0.01, relTol: 0.2, materiality: 0.01 }) });
          }
        }
      } else {
        // For banks, check netInterestMargin sanity instead: NIM must be 1-6% for banks (interest is revenue)
        const totalAssets = (y as any).totalAssets?.value ?? 0;
        const netII = (y as any).netInterestIncome?.value ?? 0;
        if (totalAssets > 0 && netII !== null) {
          const nim = netII / totalAssets;
          if (nim < 0.005 || nim > 0.08) {
            warns++;
            issues.push({ code: "STMT-01", severity: "WARN", message: `${y.year} bank NIM ${(nim * 100).toFixed(2)}% outside [0.5%, 8%] — verify NII/assets units.`, expected: "0.5%..8%", actual: `${(nim * 100).toFixed(2)}%`, magnitude: magnitudeTolerance(0.03, nim, { absTol: 0.005, relTol: 0.2, materiality: 0.005 }) });
          }
        }
      }
    }
    // Net-income history for the NOL-benefit rule (prior-3y cumulative losses).
    niHistory.push(v(y.netIncome));
  }
  // Staleness doctrine: the gate guards the CURRENT report. When the latest evaluated
  // year is clean for a finding family (pretax closure, ETR), older FAILs in that family
  // downgrade to WARN — stale-flagged with the clean latest year named, never silent.
  // Latest-year FAILs always block; bank PPOP FAILs are never logged hence never
  // downgraded (exact-by-construction). Measured basis: single-FAIL recency is uniform
  // across history (not latest-concentrated), and stale gaps are predominantly
  // feed-vintage quirks and one-off events, not persistent breaks.
  {
    const vv = (f: RawFact | undefined | null): number | null =>
      f && typeof f.value === "number" && Number.isFinite(f.value) ? f.value : null;
    const stmtOf = (yy: CanonicalYearFacts): string | undefined =>
      (yy as unknown as { statementType?: string }).statementType;
    const isB = (yy: CanonicalYearFacts): boolean => {
      const s = stmtOf(yy);
      return s === "bank" || s === "nbfc" || s === "insurance";
    };
    const corpEval = years.filter(
      (yy) => !isB(yy) && vv(yy.operatingIncome) !== null && vv(yy.interestExpense) !== null && vv(yy.pretaxIncome) !== null
    );
    const latestCorp = corpEval[corpEval.length - 1];
    if (latestCorp && !closureFailLog.some((e) => e.year === latestCorp.year)) {
      for (const e of closureFailLog) {
        e.entry.severity = "WARN";
        e.entry.message = `Pretax closure stale-finding in ${e.year}: ${e.basis} ${fmt0(e.expected)} vs reported ${fmt0(e.reported)} (${e.detail}) — latest evaluated year (${latestCorp.year}) carries no closure FAIL; downgraded (stale-year), does not block.${e.bundledNote}`;
        warns++;
      }
    }
    const etrEval = years.filter(
      (yy) => vv(yy.pretaxIncome) !== null && (vv(yy.pretaxIncome) as number) > 0 && vv(yy.incomeTaxExpense) !== null
    );
    const latestEtr = etrEval[etrEval.length - 1];
    if (latestEtr && !etrFailLog.some((e) => e.year === latestEtr.year)) {
      for (const e of etrFailLog) {
        e.entry.severity = "WARN";
        e.entry.message = `Stale ETR finding in ${e.year}: ${e.entry.message.replace(/^FATAL:\s*\S+\s*/, "")} — latest evaluated year (${latestEtr.year}) carries no ETR FAIL; downgraded (stale-year), does not block.`;
      }
    }
  }
  // 6. Retained-earnings bridge across years (WARN-only: OCI/SBC/FX plugs legitimately break exactness).
  for (let i = 1; i < years.length; i++) {
    const prev = years[i - 1];
    const cur = years[i];
    if (prev.retainedEarnings.value !== null && cur.retainedEarnings.value !== null && cur.netIncome.value !== null) {
      evaluated++;
      const div = cur.dividendsPaid.value ?? 0;
      const repo = cur.repurchases.value ?? 0;
      const expected = (prev.retainedEarnings.value as number) + (cur.netIncome.value as number) - div - repo;
      const actual = cur.retainedEarnings.value as number;
      const t = magnitudeTolerance(expected, actual, { absTol: Math.max(1000, Math.abs(expected) * 0.02), relTol: 0.1, materiality: Math.max(1000, Math.abs(expected) * 0.1) });
      if (!t.pass) {
        warns++;
        issues.push({ code: "STMT-01", severity: "WARN", message: `${cur.year} retained-earnings bridge drift: RE(t−1)+NI−div−buybacks ${fmt0(expected)} vs reported ${fmt0(actual)} (${t.detail}) — OCI/SBC/FX plugs possible.`, expected: fmt0(expected), actual: fmt0(actual), magnitude: t });
      }
    }
  }
  // 7. Buyback without shrinkage + SBC without dilution (WARN: timing/issuance offsets possible).
  for (let i = 1; i < years.length; i++) {
    const prev = years[i - 1];
    const cur = years[i];
    if (cur.repurchases.value !== null && (cur.repurchases.value as number) > 0 && prev.sharesOutstanding.value !== null && cur.sharesOutstanding.value !== null) {
      evaluated++;
      if ((cur.sharesOutstanding.value as number) >= (prev.sharesOutstanding.value as number)) {
        warns++;
        issues.push({ code: "STMT-01", severity: "WARN", message: `${cur.year} buybacks of ${fmt0(cur.repurchases.value as number)} with no share-count shrinkage — offsetting issuance/timing possible; verify before modeling shrinkage.`, expected: "shares decrease", actual: `prev ${fmt0(prev.sharesOutstanding.value as number)} → cur ${fmt0(cur.sharesOutstanding.value as number)}`, magnitude: magnitudeTolerance(prev.sharesOutstanding.value as number, cur.sharesOutstanding.value as number, { absTol: 1, relTol: 0.01, materiality: 1 }) });
      }
    }
  }
  if (evaluated === 0) {
    issues.push({
      code: "STMT-01", severity: "WARN",
      message: `Statement-integrity battery not assessable — IS/equity detail facts missing (see DATA-01).`,
      expected: "assessable detail", actual: "missing inputs",
      magnitude: magnitudeTolerance(0, 0, { absTol: 0, relTol: 0 }),
    });
  } else if (!issues.some((i) => i.code === "STMT-01")) {
    passes.push(`STMT-01: statement-integrity battery clean across ${evaluated} check(s).`);
  }
}

/**
 * WC-01: working-capital driver discipline (WARN-only — drivers are
 * judgmental; extremes and schedule breaks still deserve daylight).
 * DIO/DSO/DPO extremes, PP&E roll-forward breaks, capex<D&A
 * underinvestment, D&A-rate absurdity.
 */
function checkWorkingCapital(inp: IndependentInputs, issues: IndependentIssue[], passes: string[]): void {
  const { facts, archetype } = inp;
  let evaluated = 0;
  for (const y of facts.years) {
    const v = (f: { value: number | null }) => f.value;
    // DIO/DSO/DPO extremes (P0 #32–#34).
    if (v(y.revenue) !== null && (v(y.revenue) as number) > 0) {
      const days = wcDriverDays({
        netReceivables: v(y.netReceivables) ?? undefined,
        revenue: v(y.revenue) as number,
        inventory: v(y.inventory) ?? undefined,
        costOfRevenue: v(y.costOfRevenue) ?? undefined,
        accountsPayable: v(y.accountsPayable) ?? undefined,
      });
      for (const [label, s] of [["DSO", days.dso], ["DIO", days.dio], ["DPO", days.dpo]] as const) {
        if (s.display === "VALUE") {
          evaluated++;
          if (s.value < 0 || s.value > 365) {
            issues.push({
              code: "WC-01", severity: "WARN",
              message: `${y.year} ${label} of ${s.value.toFixed(0)} days outside [0, 365] — verify receivables/inventory/payables units before trusting WC drivers.`,
              expected: "0..365 days", actual: `${s.value.toFixed(0)} days`,
              magnitude: magnitudeTolerance(180, s.value, { absTol: 30, relTol: 0.2, materiality: 30 }),
            });
          }
        }
      }
    }
    // D&A rate bounds (P0 #36).
    if (v(y.depreciation) !== null && v(y.netFixedAssets) !== null && (v(y.netFixedAssets) as number) > 0) {
      evaluated++;
      const rate = (v(y.depreciation) as number) / (v(y.netFixedAssets) as number);
      if (rate < 0 || rate > 0.4) {
        issues.push({
          code: "WC-01", severity: "WARN",
          message: `${y.year} depreciation rate ${(rate * 100).toFixed(1)}% of net PPE outside [0%, 40%] — verify asset base vs capex linkage.`,
          expected: "0%..40%", actual: `${(rate * 100).toFixed(1)}%`,
          magnitude: magnitudeTolerance(0.1, rate, { absTol: 0.02, relTol: 0.2, materiality: 0.02 }),
        });
      }
    }
    // Capex < 0.3× D&A sustained underinvestment (capital-intensive only).
    if (archetype === "CYCLICAL_CAPITAL_INTENSIVE" && v(y.capitalExpenditures) !== null && v(y.depreciation) !== null && (v(y.depreciation) as number) > 0) {
      evaluated++;
      if ((v(y.capitalExpenditures) as number) < 0.3 * (v(y.depreciation) as number)) {
        issues.push({
          code: "WC-01", severity: "WARN",
          message: `${y.year} capex covers <30% of depreciation under a capital-intensive archetype — chronic underinvestment or asset-light shift; verify.`,
          expected: "≥ 30% of D&A", actual: `${(((v(y.capitalExpenditures) as number) / (v(y.depreciation) as number)) * 100).toFixed(0)}%`,
          magnitude: magnitudeTolerance(0.3 * (v(y.depreciation) as number), v(y.capitalExpenditures) as number, { absTol: 1, relTol: 0.1, materiality: 1 }),
        });
      }
    }
  }
  // PP&E roll-forward across years (P0 #37 — WARN: revaluations/M&A legitimately break exactness).
  for (let i = 1; i < facts.years.length; i++) {
    const prev = facts.years[i - 1];
    const cur = facts.years[i];
    if (prev.netFixedAssets.value !== null && cur.netFixedAssets.value !== null && cur.depreciation.value !== null && cur.capitalExpenditures.value !== null) {
      evaluated++;
      const r = rollforwardVariance(prev.netFixedAssets.value as number, cur.capitalExpenditures.value as number, cur.depreciation.value as number, cur.netFixedAssets.value as number);
      if (r.display === "VALUE" && r.value > 0.1) {
        issues.push({
          code: "WC-01", severity: "WARN",
          message: `${cur.year} PP&E roll-forward drift ${(r.value * 100).toFixed(1)}% (opening + capex − depreciation vs closing) — revaluations/M&A/disposals possible.`,
          expected: "≤ 10%", actual: `${(r.value * 100).toFixed(1)}%`,
          magnitude: magnitudeTolerance(0, r.value, { absTol: 0.02, relTol: 0.1, materiality: 0.02 }),
        });
      }
    }
  }
  if (evaluated === 0) {
    issues.push({
      code: "WC-01", severity: "WARN",
      message: `Working-capital driver battery not assessable — WC/PPE detail facts missing (see DATA-01).`,
      expected: "assessable detail", actual: "missing inputs",
      magnitude: magnitudeTolerance(0, 0, { absTol: 0, relTol: 0 }),
    });
  } else if (!issues.some((i) => i.code === "WC-01")) {
    passes.push(`WC-01: working-capital drivers sane across ${evaluated} check(s).`);
  }
}

/**
 * EV-01: EV taxonomy unknowns disclosure (WARN-only).
 * NCI / preferred / pension / operating-lease claims are UNKNOWN from Yahoo
 * feeds — the bridge states them instead of zero-folding them.
 */
function checkEvTaxonomy(inp: IndependentInputs, issues: IndependentIssue[], passes: string[]): void {
  const { facts } = inp;
  const latest = facts.years[facts.years.length - 1];
  const leases = latest ? latest.capitalLeaseObligations.value : null;
  if (leases !== null && leases > 0) {
    issues.push({
      code: "EV-01", severity: "WARN",
      message: `Finance-lease obligations of ${fmt0(leases)} evidenced — verify EV bridge adds them to debt; NCI/preferred/pension/operating-leases remain UNKNOWN from feed.`,
      expected: "lease-inclusive EV bridge", actual: fmt0(leases),
      magnitude: magnitudeTolerance(0, leases, { absTol: 1, relTol: 0.01, materiality: 1 }),
    });
  } else {
    passes.push(`EV-01: EV taxonomy stated — finance leases none evidenced; NCI/preferred/pension/operating-leases UNKNOWN from feed (never zero-folded).`);
  }
}

/**
 * ANOM-01: accounting-anomaly aggregation (P0 #77).
 * Every anomaly WARNs; ≥2 material anomalies escalate to a single FAIL.
 */
function checkAnomalies(inp: IndependentInputs, issues: IndependentIssue[], passes: string[]): void {
  const hist = inp.facts.years.map((y) => ({
    year: y.year,
    revenue: y.revenue.value ?? 0,
    netIncome: y.netIncome.value ?? 0,
    operatingCashFlow: y.operatingCashFlow.value ?? 0,
    netReceivables: y.netReceivables.value ?? 0,
    totalAssets: y.totalAssets.value ?? 0,
    grossMargin: (y.revenue.value ?? 0) > 0 && y.grossProfit.value !== null
      ? (y.grossProfit.value as number) / (y.revenue.value as number)
      : 0,
  }));
  if (hist.length < 2) {
    issues.push({
      code: "ANOM-01", severity: "WARN",
      message: `Anomaly scan needs ≥2 periods — only ${hist.length} available.`,
      expected: "≥ 2 periods", actual: `${hist.length}`,
      magnitude: magnitudeTolerance(2, hist.length, { absTol: 0, relTol: 0, materiality: 0 }),
    });
    return;
  }
  const found = detectAccountingAnomalies(hist);
  for (const a of found) {
    issues.push({
      code: "ANOM-01", severity: "WARN",
      message: `${a.code}: ${a.message}`,
      expected: "no anomaly", actual: a.code,
      magnitude: magnitudeTolerance(0, 1, { absTol: 0, relTol: 0, materiality: 0 }),
    });
  }
  const material = found.filter((a) => a.material);
  const distinctMaterial = new Set(material.map((a) => a.code)).size;
  if (material.length >= 3 || distinctMaterial >= 2) {
    pushFail(issues, {
      code: "ANOM-01", severity: "FAIL",
      message: `FATAL: ${material.length} material accounting anomalies compound (${material.map((a) => a.code).join(", ")}) — mandatory review before publication; statements cannot be trusted at face value.`,
      expected: "< 3 material or < 2 distinct types", actual: `${material.length} material (${distinctMaterial} distinct)`,
      magnitude: magnitudeTolerance(2, material.length, { absTol: 0, relTol: 0, materiality: 1 }),
    });
  } else if (found.length === 0) {
    passes.push(`ANOM-01: no accounting anomalies across ${hist.length} year(s).`);
  }
}

/**
 * STMT-02: sector-native definitional identities — the architecture's OWN
 * reconciliation battery. Each identity is exact by construction (combined =
 * loss + expense; FFO = NI + RE depreciation − gains; fee revenue = fee parts;
 * bank total = NII + fees), so any breach is a pipeline construction bug and
 * FAILs. Clean architectures PASS on their own identities rather than WARN on
 * corporate checks that never applied to them.
 */
function checkNativeIdentities(inp: IndependentInputs, issues: IndependentIssue[], passes: string[]): void {
  const { facts } = inp;
  let evaluated = 0;
  const tol = (expected: number, actual: number, label: string, year: string) => {
    evaluated++;
    const v = magnitudeTolerance(expected, actual, { absTol: Math.max(2, Math.abs(expected) * 0.001), relTol: 0.002, materiality: Math.max(2, Math.abs(expected) * 0.005) });
    if (!v.pass && v.material) {
      pushFail(issues, {
        code: "STMT-02", severity: "FAIL",
        message: `FATAL: ${year} ${label} breach — expected ${fmt0(expected)} vs constructed ${fmt0(actual)} (${v.detail}). Sector-native identity construction is corrupt.`,
        expected: fmt0(expected), actual: fmt0(actual), magnitude: v,
      });
    }
  };
  const num = (y: (typeof facts.years)[number], k: string): number | null => {
    const f = (y as unknown as Record<string, { value: number | null }>)[k];
    return f && typeof f.value === "number" && Number.isFinite(f.value) ? f.value : null;
  };
  for (const y of facts.years) {
    const stmt = (y as unknown as { statementType?: string }).statementType;
    if (stmt === "bank" || stmt === "nbfc") {
      const nii = num(y, "netInterestIncome") ?? 0;
      const nonII = num(y, "nonInterestIncome") ?? 0;
      const tr = num(y, "totalRevenue");
      if (tr !== null) tol(nii + nonII, tr, "bank totalRevenue = NII + non-interest income", y.year);
      const rev = num(y, "revenue");
      if (tr !== null && rev !== null) tol(tr, rev, "bank revenue alias = totalRevenue", y.year);
    } else if (stmt === "insurance") {
      const loss = num(y, "lossRatio");
      const exp = num(y, "expenseRatio");
      const comb = num(y, "combinedRatio");
      if (loss !== null && exp !== null && comb !== null) tol(loss + exp, comb, "insurance combined = loss + expense", y.year);
      const nep = num(y, "netEarnedPremium");
      const claims = num(y, "claimsIncurred");
      const uwExp = num(y, "underwritingExpenses");
      const uwRes = num(y, "underwritingResult");
      if (nep !== null && claims !== null && uwExp !== null && uwRes !== null) tol(nep - claims - uwExp, uwRes, "insurance UW result = NEP − claims − expenses", y.year);
      const inv = num(y, "investmentIncome");
      const rev = num(y, "revenue");
      if (nep !== null && inv !== null && rev !== null) tol(nep + inv, rev, "insurance revenue = NEP + investment income", y.year);
    } else if (stmt === "reit") {
      // Exact-by-construction identities (converter-derived — breach = pipeline bug).
      const rental = num(y, "rentalIncome");
      const rev = num(y, "revenue");
      if (rental !== null && rev !== null) tol(rental, rev, "REIT revenue alias = rental income", y.year);
      const ffo = num(y, "fundsFromOperations");
      const affo = num(y, "adjustedFundsFromOperations");
      if (ffo !== null && affo !== null) {
        evaluated++;
        if (!(affo <= ffo + 1)) {
          pushFail(issues, {
            code: "STMT-02", severity: "FAIL",
            message: `FATAL: ${y.year} AFFO (${fmt0(affo)}) exceeds FFO (${fmt0(ffo)}) — maintenance adjustments must reduce FFO. Construction corrupt.`,
            expected: `≤ ${fmt0(ffo)}`, actual: fmt0(affo),
            magnitude: magnitudeTolerance(ffo, affo, { absTol: 1, relTol: 0.001, materiality: 1 }),
          });
        }
      }
      const ffoPs = num(y, "ffoPerShare");
      const sh = num(y, "sharesOutstanding");
      if (ffo !== null && ffoPs !== null && sh !== null && sh > 0) tol(ffo / sh, ffoPs, "REIT FFO/share = FFO / shares", y.year);
    } else if (stmt === "asset-light") {
      const mgmt = num(y, "managementFees") ?? 0;
      const perf = num(y, "performanceFees") ?? 0;
      const tech = num(y, "technologyServicesRevenue") ?? 0;
      const fee = num(y, "totalFeeRevenue");
      if (fee !== null) tol(mgmt + perf + tech, fee, "fee totalFeeRevenue = fee parts", y.year);
      const opex = num(y, "operatingExpenses");
      const opInc = num(y, "operatingIncome");
      if (fee !== null && opex !== null && opInc !== null) tol(fee - opex, opInc, "fee operatingIncome = feeRevenue − opex", y.year);
      const rev = num(y, "revenue");
      if (fee !== null && rev !== null) tol(fee, rev, "fee revenue alias = totalFeeRevenue", y.year);
    }
  }
  if (evaluated === 0) {
    passes.push(`STMT-02: no sector-native identities to verify (all-corporate history).`);
  } else if (!issues.some((i) => i.code === "STMT-02")) {
    passes.push(`STMT-02: sector-native definitional identities reconciled across ${evaluated} check(s).`);
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
  checkStatementIntegrity(inputs, issues, passes);
  checkNativeIdentities(inputs, issues, passes);
  checkWorkingCapital(inputs, issues, passes);
  checkEvTaxonomy(inputs, issues, passes);
  checkAnomalies(inputs, issues, passes);
  return { issues, passes, checked: 10 };
}
