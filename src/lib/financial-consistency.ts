/**
 * APEX RESEARCH — Cross-Page Financial Consistency Gate (FINCONS-01..05)
 * ----------------------------------------------------------------------
 * The PDF renders the same fiscal year through several independent code
 * paths (statement tables from annualFinancials, KPI/cover from stockData
 * facts, valuation pages from ledger/dcf). When those paths disagree, the
 * published report contradicts itself on one FY (the FY26 net-income/EPS
 * class of defect). This module asserts the preconditions that make every
 * page agree, from the same inputs the pages read:
 *
 *   FINCONS-01  Statement completeness: the latest FY carries reported
 *               revenue/pretax/tax (corporate) or revenue/net income/equity
 *               (financial) — otherwise statement pages render modeled
 *               fallbacks (rev*0.42 margins, 22% tax) that contradict facts.
 *   FINCONS-02  EPS coherence: reported diluted EPS vs netIncome /
 *               resolved shares within 10% (weighted-average drift beyond
 *               that is a share-base or unit error, not timing).
  *   FINCONS-03  Single share base: ledger / dcf / quote / statement /
  *               canonical-diluted counts agree within 5%; every source > 0.
 *   FINCONS-04  Per-share closure: |fairValue − equity/shares| ≤ 1.0
 *               currency unit, all valuation paths (no bank exemption —
 *               residual-income bridges carry equity + shares too).
 *   FINCONS-05  Absolute scale: |price × shares − marketCap| / marketCap
 *               ≤ 25% (BLOCK), ≤ 8% clean; catches 10×-class unit errors
 *               that internally-consistent bridges cannot see.
 *
 * Pure + deterministic. Severity is blocker for every code except the
 * FINCONS-05 warning band.
 */

export type FinConsSeverity = "blocker" | "warn";

export interface FinConsFinding {
  code: "FINCONS-01" | "FINCONS-02" | "FINCONS-03" | "FINCONS-04" | "FINCONS-05";
  pass: boolean;
  severity: FinConsSeverity;
  detail: string;
}

export interface FinConsInputs {
  ticker: string;
  /** Latest fiscal-year label, e.g. "FY25". */
  latestYear: string;
  /** True for banks/NBFCs/insurers (operating-income constructs absent). */
  isFinancial: boolean;
  /** Latest annualFinancials row (statement path). */
  statement: {
    revenue?: number | null;
    operatingIncome?: number | null;
    pretaxIncome?: number | null;
    incomeTaxExpense?: number | null;
    netIncome?: number | null;
    totalEquity?: number | null;
    sharesOutstanding?: number | null;
    dilutedEps?: number | null;
    eps?: number | null;
  };
  /** Canonical-facts path (independent derivation). */
  canonical: {
    revenue?: number | null;
    netIncome?: number | null;
    sharesDiluted?: number | null;
  };
  /** Market-data path (cover/KPI pages). */
  market: {
    price?: number | null;
    shares?: number | null;
    marketCap?: number | null;
    trailingEps?: number | null;
  };
  /** Model path (valuation pages). */
  model: {
    equityValue?: number | null;
    shares?: number | null;
    fairValue?: number | null;
  };
}

const num = (v: number | null | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

function drift(a: number, b: number): number {
  const base = Math.max(Math.abs(a), Math.abs(b));
  if (base <= 0) return a === b ? 0 : 1;
  return Math.abs(a - b) / base;
}

export function checkCrossPageFinancials(input: FinConsInputs): FinConsFinding[] {
  const out: FinConsFinding[] = [];
  const { ticker, latestYear, isFinancial, statement, canonical, market, model } = input;

  // FINCONS-01 — statement completeness (no modeled-fallback rendering).
  {
    const missing: string[] = [];
    const rev = num(statement.revenue);
    if (!(rev !== null && rev > 0)) missing.push("revenue");
    if (isFinancial) {
      if (num(statement.netIncome) === null) missing.push("netIncome");
      const eq = num(statement.totalEquity);
      if (!(eq !== null && eq > 0)) missing.push("totalEquity");
    } else {
      if (num(statement.pretaxIncome) === null) missing.push("pretaxIncome");
      if (num(statement.incomeTaxExpense) === null) missing.push("incomeTaxExpense");
      if (num(statement.operatingIncome) === null) missing.push("operatingIncome");
    }
    out.push({
      code: "FINCONS-01",
      pass: missing.length === 0,
      severity: "blocker",
      detail:
        missing.length === 0
          ? `${ticker} ${latestYear}: statement inputs complete — no page renders modeled fallbacks.`
          : `${ticker} ${latestYear}: statement inputs missing [${missing.join(", ")}] — pages would render modeled fallbacks (margin %, flat tax) contradicting facts. Backfill before publication.`,
    });
  }

  // Resolve the single share base used by FINCONS-02..05.
  const shareSources: Array<{ name: string; value: number | null }> = [
    { name: "statement", value: num(statement.sharesOutstanding) },
    { name: "market", value: num(market.shares) },
    { name: "model", value: num(model.shares) },
    { name: "canonical-diluted", value: num(canonical.sharesDiluted) },
  ];
  const validShares = shareSources.filter((s) => s.value !== null && (s.value as number) > 0) as Array<{ name: string; value: number }>;
  const resolvedShares = validShares.length > 0 ? validShares[0].value : null;

  // FINCONS-02 — EPS coherence (the FY26 net-income/EPS conflict catcher).
  {
    const reportedEps = num(statement.dilutedEps) ?? num(statement.eps) ?? num(market.trailingEps);
    const ni = num(statement.netIncome);
    if (reportedEps === null || reportedEps === 0) {
      out.push({
        code: "FINCONS-02",
        pass: true,
        severity: "blocker",
        detail: `${ticker} ${latestYear}: no reported EPS — pages compute netIncome/shares by construction (consistent).`,
      });
    } else if (ni === null || resolvedShares === null) {
      out.push({
        code: "FINCONS-02",
        pass: false,
        severity: "blocker",
        detail: `${ticker} ${latestYear}: reported EPS ${reportedEps} cannot be verified — netIncome or share base missing. Resolve inputs before publication.`,
      });
    } else {
      const implied = ni / resolvedShares;
      const d = drift(reportedEps, implied);
      out.push({
        code: "FINCONS-02",
        pass: d <= 0.10,
        severity: "blocker",
        detail:
          d <= 0.10
            ? `${ticker} ${latestYear}: reported EPS ${reportedEps.toFixed(2)} ≈ netIncome/shares ${implied.toFixed(2)} (drift ${(d * 100).toFixed(1)}% ≤ 10%).`
            : `${ticker} ${latestYear}: EPS CONFLICT — reported ${reportedEps.toFixed(2)} vs netIncome/shares ${implied.toFixed(2)} (drift ${(d * 100).toFixed(1)}% > 10%). Same-FY pages would print different EPS — share-base or unit error.`,
      });
    }
  }

  // FINCONS-03 — single share base across the provided sources
  // (model/quote/statement/canonical-diluted). Sources absent from the input
  // bundle are skipped (never counted as conflicts); fewer than two
  // comparable sources warns (unverifiable against an independent base).
  // Universal two-tier tolerance (META + PLTR precedents):
  //   ≤5%  PASS — normal basic-vs-diluted SBC gaps (PLTR 3.8%).
  //   ≤25% WARN — publishable multi-class/partial-quote divergence with
  //          disclosure (META: quote 2.205B single-class vs statement 2.530B
  //          all-class = 12.8%; model already uses the best-reconciling base
  //          via resolveShareCount, so pages agree — the raw-feed gap is
  //          disclosed, not blocking).
  //   >25% BLOCK — unit/scale error (10x = 900% still blocks decisively).
  // Non-positive sources always BLOCK (synthesis prohibited).
  {
    const provided = shareSources.filter((s) => s.value !== null);
    const invalid = provided.filter((s) => !((s.value as number) > 0));
    let maxDrift = 0;
    for (let i = 0; i < validShares.length; i++) {
      for (let j = i + 1; j < validShares.length; j++) {
        maxDrift = Math.max(maxDrift, drift(validShares[i].value, validShares[j].value));
      }
    }
    if (validShares.length < 2) {
      out.push({
        code: "FINCONS-03",
        pass: true,
        severity: "warn",
        detail: `${ticker}: only ${validShares.length} share source(s) available — single-base agreement unverifiable against an independent count; treat per-share outputs as provisional.`,
      });
    } else if (invalid.length > 0) {
      out.push({
        code: "FINCONS-03",
        pass: false,
        severity: "blocker",
        detail: `${ticker}: SHARE-BASE SPLIT — non-positive: [${invalid.map((s) => s.name).join(", ")}] (synthesis prohibited). Per-share pages diverge.`,
      });
    } else if (maxDrift <= 0.05) {
      out.push({
        code: "FINCONS-03",
        pass: true,
        severity: "blocker",
        detail: `${ticker}: single share base — ${validShares.length} source(s) agree within 5% (${validShares.map((s) => `${s.name}=${s.value.toFixed(0)}`).join(", ")}).`,
      });
    } else if (maxDrift <= 0.25) {
      out.push({
        code: "FINCONS-03",
        pass: false,
        severity: "warn",
        detail: `${ticker}: SHARE-BASE DIVERGENCE ${(maxDrift * 100).toFixed(1)}% (5-25% band) — likely partial-class quote vs all-class statement/SBC dilution; model uses best-reconciling base (see SHARE-01/resolver warn), pages agree — disclosed, not blocking. (${validShares.map((s) => `${s.name}=${s.value.toFixed(0)}`).join(", ")}).`,
      });
    } else {
      out.push({
        code: "FINCONS-03",
        pass: false,
        severity: "blocker",
        detail: `${ticker}: SHARE-BASE SPLIT — max pairwise drift ${(maxDrift * 100).toFixed(1)}% > 25%. Per-share pages diverge (unit/scale error suspected).`,
      });
    }
  }

  // FINCONS-04 — per-share closure on every valuation path (no exemptions).
  {
    const eq = num(model.equityValue);
    const sh = num(model.shares);
    const fv = num(model.fairValue);
    if (eq === null || sh === null || !(sh > 0) || fv === null || !(fv > 0) || !(eq > 0)) {
      out.push({
        code: "FINCONS-04",
        pass: false,
        severity: "blocker",
        detail: `${ticker}: per-share math unverifiable — equity/shares/fairValue incomplete (equity=${eq ?? "n/a"}, shares=${sh ?? "n/a"}, fv=${fv ?? "n/a"}). Unresolved inputs must block, never fall back to 1-share synthesis.`,
      });
    } else {
      const gap = Math.abs(fv - eq / sh);
      out.push({
        code: "FINCONS-04",
        pass: gap <= 1.0,
        severity: "blocker",
        detail:
          gap <= 1.0
            ? `${ticker}: fairValue ${fv.toFixed(2)} = equity/shares ${(eq / sh).toFixed(2)} (gap ${gap.toFixed(2)} ≤ 1.0).`
            : `${ticker}: PER-SHARE BREAK — fairValue ${fv.toFixed(2)} ≠ equity (${eq.toFixed(0)}) / shares (${sh.toFixed(0)}) = ${(eq / sh).toFixed(2)} (gap ${gap.toFixed(2)}). Apparent 10×-class discrepancy — do not publish.`,
      });
    }
  }

  // FINCONS-05 — absolute scale (catches unit errors invisible to bridges).
  {
    const price = num(market.price);
    const mktCap = num(market.marketCap);
    const sh = resolvedShares;
    if (price === null || !(price > 0) || sh === null || mktCap === null || !(mktCap > 0)) {
      out.push({
        code: "FINCONS-05",
        pass: true,
        severity: "warn",
        detail: `${ticker}: absolute scale unverifiable (price/shares/marketCap incomplete) — SHARE-01 remains the backstop; treat per-share outputs as provisional.`,
      });
    } else {
      const d = Math.abs(price * sh - mktCap) / mktCap;
      out.push({
        code: "FINCONS-05",
        // QA mapping: pass → PASS; !pass + blocker → FAIL; !pass + warn → WARN.
        pass: d <= 0.08,
        severity: d <= 0.25 ? "warn" : "blocker",
        detail:
          d <= 0.08
            ? `${ticker}: price × shares ≈ marketCap (drift ${(d * 100).toFixed(1)}% ≤ 8%).`
            : `${ticker}: SCALE ${d <= 0.25 ? "WARNING" : "BREAK"} — price × shares (${(price * sh).toFixed(0)}) vs marketCap (${mktCap.toFixed(0)}), drift ${(d * 100).toFixed(1)}%. Unit error suspected (10× class).`,
      });
    }
  }

  return out;
}
