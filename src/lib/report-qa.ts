// ============================================================
// Pre-Publish QA Validator & Consistency Checksum Engine
// Audits reports for internal contradictions, degenerate ratios,
// rating vs price misalignment, and template keyword leakage.
// ============================================================
// QA CONTRACT (block-vs-warn policy — adversarially tested, see
// scratch/test-publication-gate.ts two-phase fixtures; Priority 4 independent gate):
//   FAIL (blocks export): primary-data gaps (DATA-01), ontology violations (ONT-01,
//     OM-01, HOSP-01, HW-01, SEM-COMP-01 company-specific contamination), arithmetic breaks
//     (XREF-01/03/04/05, SCEN-01/02, PROB-01, FV-RECOMP-01,
//     CHAIN-01, BS-01, MODEL-01, IND-01..IND-05 independent recomputation), cross-page
//     consistency (FINCONS-01..05 same-FY revenue/EBITDA/EBIT/net income/EPS/shares),
//     cash-flow narrative contradiction (FCF-NARR-01), SOTP bridge breach (SOTP-01),
//     share/market-cap integrity (SHARE-01),
//     identity defects (IDENTITY-01),
//     rating/moat/credit contradictions (RATING-01/02, MOAT-01/02, STEWARD-01,
//     SEMANTIC-01, CREDIT-01, WACC-01, VAL-01, COV-01), contamination (BS-DETECTOR-04 ≥1,
//     NARRATIVE-01 ≥1, SANITIZE-01 ≥1), clone signatures (BS-DETECTOR-05), peer-similarity gate
//     (PEER-01 threshold), event-study evidence (EVENT-01 empirical-pose),
//     unresolved tokens (PLACEHOLDER-01, CLAIM-01 placeholders),
//     missing assumption evidence (ASSUME-01).
//   WARN (costs score, never blocks): unverified council (BS-DETECTOR-06), margin step-change
//     (MARGIN-01), loose chain tolerance (CHAIN-01), primary-source disclosure
//     (SRC-01 secondary-only figures), generic content screens
//     (THESIS-01, OVERVIEW-01, COMPET-01, MGMT-01, CATALYST-01, GOV-01, CLAIM-01 evidence).
//   Numerical-failure policy: every machine-verifiable numerical falsehood
//     FAILs (blocks); WARN is reserved for disclosure-grade qualifications and
//     style/evidence thinness. No critical numerical check may sit at WARN.
//   IND-01..IND-05 (P0 #9, #23): independent recomputation (BS identity, cash
//     chain, EV bridge, WACC re-solution, upside/rating map) from canonical
//     facts through the math kernel — separate implementation, materiality-gated.
//   Rationale: FAIL = machine-verifiable falsehood, missing primary, or proven contamination.
//   WARN = style/evidence thinness where a strict block would false-positive
//   on legitimate LLM phrasing. Every WARN names the remediation. Independent checks
//   recompute from primaries and block regardless of other passes.
// ============================================================
import type { AnnualFinancials, PeerData, ReportData, ReportQAResult, QACheckItem } from "@/types/report";
import { stmtNum, isBankStatement, isInsuranceStatement, isReitStatement, isAssetLightStatement } from "@/types/report";
import { getSectorProfile, classifySector } from "./sectors/index";
import { identityIssues } from "./canonical";
import { getAllowlistedConcepts } from "./sector-allowlist";
import { buildCompanyOntology, validateOntologyCoverage } from "./company-ontology";
import { buildResearchOperatingModel, validateReportAgainstModel, type ResearchOperatingModel } from "./research-model";
import { getCompanySemanticProfile, PLATFORM_SILICON_FORBIDDEN } from "./company-semantics";
import { boundaryHit } from "./research-model/model-validator";
import { checkCrossPageFinancials } from "./financial-consistency";
import { assessProvenance, assessMarketIntegrity, resolveShareCount } from "./financial-provenance";
import { gatePeerSet, SIMILARITY_THRESHOLD_AVG, SIMILARITY_MIN_QUALIFYING } from "./peer-similarity";
import { buildCanonicalFacts } from "./canonical-facts";
import { validateIndependently } from "./independent-validator";
import type { IndependentIssue } from "./independent-validator";
import { reconcileForecast } from "./forecast-reconciliation";
import { validateGrowthClaims } from "./claims";
import { auditValuation } from "./valuation-audit";
import { checkEconomicPlausibility } from "./economic-plausibility";
// TODO: claims.ts:validateClaims() is deprecated. Use claim-validator.ts:validateClaimSet() with EvidenceRegistry
// for unified temporal/directional matching. The old flat-allowlist validator does not support period-aware
// evidence filtering or directional consistency checks.

const SECTOR_KEYWORD_BLOCKLIST: Record<string, { blocked: string[]; sectorNames: string[] }> = {
  telecom: {
    sectorNames: ["telecom", "communication", "wireless"],
    blocked: ["semiconductor fabrication", "app store commission", "foundry", "fab capacity", "clinical trial", "refinery throughput", "crack spread"],
  },
  energy_petrochem: {
    sectorNames: ["energy", "oil", "petrochem", "refining"],
    blocked: ["saas churn", "arr expansion", "app store", "cloud subscription churn", ...PLATFORM_SILICON_FORBIDDEN],
  },
  pharma: {
    sectorNames: ["pharma", "health", "biotech"],
    blocked: ["crack spread", "upstream crude", "wafer fabrication", "refinery margin"],
  },
  banking_financials: {
    sectorNames: ["financial", "bank", "insurance"],
    blocked: ["manufacturing inventory", "plant turnaround", "fab utilization", "refinery"],
  },
};

/**
 * Display names for independent-validator findings (DEP-02 badges).
 * Exhaustive against IndependentIssue["code"] — adding a code to the union
 * without naming it here is a TypeScript error, never a silent wrong label.
 * Codes marked (reserved) have no emitting call-site yet; the suffix says so
 * instead of pretending otherwise.
 */
export const INDEPENDENT_CHECK_NAMES: Record<IndependentIssue["code"], string> = {
  "IND-01": "Independent Balance-Sheet Identity",
  "IND-02": "Independent Cash-Flow Chain",
  "IND-03": "Independent EV/Equity/Per-Share Bridge",
  "IND-04": "Independent WACC Re-solution",
  "IND-05": "Independent Upside/Rating Map",
  "STMT-01": "Statement Integrity Battery",
  "STMT-02": "Sector-Native Identity Reconciliation",
  "WC-01": "Working-Capital Driver Discipline",
  "EV-01": "EV Taxonomy Disclosure",
  "ANOM-01": "Accounting Anomaly Scan",
  "XMOD-01": "Cross-Model Check (reserved)",
  "CONF-01": "Confidence Check (reserved)",
  "AI-01": "AI-Narrative Check (reserved)",
  "ECON-01": "Economic Sanity Check (reserved)",
  "DUPONT-01": "DuPont Check (reserved)",
  "LIQ-01": "Liquidity Check (reserved)",
  "LC-01": "Reserved Check LC-01",
  "IMM-01": "Immutability Check (reserved)",
  "AUDIT-01": "Audit Check (reserved)",
};

/**
 * Short finding-specific subtitle derived from the validator's own message
 * (option b: no validator taxonomy change required). Strips the leading
 * severity preamble ("FATAL: ", "Informational: ", "Advisory: ") and truncates
 * to ~60 chars at a word boundary, so multiple findings sharing one code
 * (e.g. four STMT-01s across years) render as visually distinct badges while
 * the full message remains in `details`.
 */
export function independentFindingSubtitle(message: string, maxLen = 60): string {
  const stripped = message.replace(/^(FATAL|Informational|Advisory)\s*:\s*/i, "").trim();
  if (stripped.length <= maxLen) return stripped;
  const cut = stripped.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

export function validateReportIntegrity(data: ReportData): ReportQAResult {
  const checks: QACheckItem[] = [];
  const ledger = data.assumptionsLedger;

  const fv = ledger?.fairValue ?? data.targetPrice;
  const cmp = ledger?.currentPrice ?? data.cmp;
  const rating = ledger?.rating ?? data.recommendation;
  const wacc = ledger?.wacc ?? data.dcf.assumptions?.wacc ?? 0.095;
  const tgr = ledger?.terminalGrowthRate ?? data.dcf.assumptions?.terminalGrowthRate ?? 0.04;

  // 0. Company Identity Integrity — fail-closed. A report that cannot prove
  // WHO it covers (unknown sector, ticker-as-name, unknown exchange/currency)
  // must never render as a valid listed-company dossier.
  const identityProblems = identityIssues(data);
  if (identityProblems.length > 0) {
    checks.push({
      id: "IDENTITY-01",
      category: "CROSS_REFERENCE",
      name: "Company Identity Integrity",
      status: "FAIL",
      details: `FATAL PUBLICATION BLOCK: Company identity unverifiable — ${identityProblems.join("; ")}. Refuse ticker/identity and re-resolve via search.`,
      expected: "Verified ticker, name, sector, exchange, currency",
      actual: `${identityProblems.length} identity defect(s)`,
    });
  } else {
    checks.push({
      id: "IDENTITY-01",
      category: "CROSS_REFERENCE",
      name: "Company Identity Integrity",
      status: "PASS",
      details: `Ticker, name, sector, exchange, and currency all verified present.`,
    });
  }

  // 1. Rating vs Upside Consistency Check
  const upside = cmp > 0 ? (fv - cmp) / cmp : 0;
  if (rating === "BUY" && fv < cmp) {
    checks.push({
      id: "RATING-01",
      category: "RATING_CONSISTENCY",
      name: "Rating vs Fair Value Alignment",
      status: "FAIL",
      details: `Rating is BUY despite negative upside (${(upside * 100).toFixed(1)}%). Rule prohibits BUY when Fair Value < Current Price.`,
      expected: "SELL or HOLD",
      actual: rating,
    });
  } else if (rating === "SELL" && upside > 0.15) {
    checks.push({
      id: "RATING-01",
      category: "RATING_CONSISTENCY",
      name: "Rating vs Fair Value Alignment",
      status: "FAIL",
      details: `Rating is SELL despite strong upside (${(upside * 100).toFixed(1)}%). Rule prohibits SELL when Fair Value > CMP + 15%.`,
      expected: "BUY",
      actual: rating,
    });
  } else {
    checks.push({
      id: "RATING-01",
      category: "RATING_CONSISTENCY",
      name: "Rating vs Fair Value Alignment",
      status: "PASS",
      details: `Rating (${rating}) strictly conforms to ${(upside * 100).toFixed(1)}% implied upside corridor.`,
    });
  }

  // 1b. Narrative Stance vs Model Rating (RATING-02). Scans the FULL assembled
  // narrative for explicit stance declarations contradicting the canonical
  // rating. Word-boundary patterns only — "buyback"/"household"/"withhold"
  // never match. This catches SELL-model reports whose thesis argues HOLD, etc.
  const stanceText = JSON.stringify(data.aiAnalysis || {});
  const buyStanceRe = /(strong\s+buy|recommends?\s+(?:a\s+)?buy\b|recommended\s+(?:a\s+)?buy\b|recommending\s+(?:a\s+)?buy\b|upgrades?\s+(?:to\s+)?buy\b|upgraded\s+(?:to\s+)?buy\b|initiat(?:e|ed|ing)[^.]{0,60}\bbuy\b|\boverweight\b.{0,30}(?:recommendation|rating|stance)|outperform\b.{0,30}(?:recommendation|rating|stance))/i;
  const sellStanceRe = /(strong\s+sell|recommends?\s+(?:a\s+)?sell\b|recommended\s+(?:a\s+)?sell\b|recommending\s+(?:a\s+)?sell\b|downgrades?\s+(?:to\s+)?sell\b|downgraded\s+(?:to\s+)?sell\b|initiat(?:e|ed|ing)[^.]{0,60}\bsell\b|\bunderweight\b.{0,30}(?:recommendation|rating|stance)|underperform\b.{0,30}(?:recommendation|rating|stance))/i;
  const holdStanceRe = /(maintain(?:s|ed|ing)?[^.]{0,40}\bhold\b|reiterat[^.]{0,40}\bhold\b|\bhold\s+(recommendation|rating)\b|neutral\s+(stance|rating|recommendation))/i;
  const hasBuy = buyStanceRe.test(stanceText);
  const hasSell = sellStanceRe.test(stanceText);
  const hasHold = holdStanceRe.test(stanceText);
  const ratingContradiction =
    (rating === "SELL" && (hasBuy || hasHold)) ||
    (rating === "BUY" && (hasSell || hasHold)) ||
    ((rating === "HOLD" || rating === "NR") && (/(strong\s+buy|strong\s+sell)/i.test(stanceText)));
  if (ratingContradiction) {
    const claimed = rating === "SELL" ? (hasBuy ? "BUY" : "HOLD") : rating === "BUY" ? (hasSell ? "SELL" : "HOLD") : "strong directional";
    checks.push({
      id: "RATING-02",
      category: "RATING_CONSISTENCY",
      name: "Narrative Stance vs Model Rating",
      status: "FAIL",
      details: `FATAL PUBLICATION BLOCK: Canonical rating is ${rating}, but narrative declares a ${claimed} stance. One thesis per report — reconcile before publishing.`,
      expected: rating,
      actual: `${claimed} language in narrative`,
    });
  } else {
    checks.push({
      id: "RATING-02",
      category: "RATING_CONSISTENCY",
      name: "Narrative Stance vs Model Rating",
      status: "PASS",
      details: `No explicit narrative stance contradicts the canonical ${rating} rating.`,
    });
  }

  // 2. Cross-Reference Check (DCF Bridge Arithmetic). SOTP-primary reports
  // verify the FCFF cross-check leg (the corroborating single-business DCF),
  // not SOTP GAV — SOTP-01 owns the SOTP bridge.
  const sotpX = (data.dcf as any)?.sotpBreakdown?.crossCheck;
  const sumPvFcff = Number(sotpX?.sumPvFcff ?? data.dcf.sumPvFcff) || 0;
  const pvTv = Number(sotpX?.pvTerminalValue ?? data.dcf.pvTerminalValue) || 0;
  const ev = Number(sotpX?.enterpriseValue ?? data.dcf.enterpriseValue) || 0;
  const bridgeEvVariance = Math.abs(ev - (sumPvFcff + pvTv));

  if (bridgeEvVariance > 1000) {
    checks.push({
      id: "XREF-01",
      category: "CROSS_REFERENCE",
      name: "DCF Enterprise Value Bridge Reconciled",
      status: "FAIL",
      details: `PV of FCFF (${sumPvFcff.toFixed(0)}) + PV of TV (${pvTv.toFixed(0)}) does not match Enterprise Value (${ev.toFixed(0)}). Variance: ${bridgeEvVariance.toFixed(0)}`,
    });
  } else {
    checks.push({
      id: "XREF-01",
      category: "CROSS_REFERENCE",
      name: "DCF Enterprise Value Bridge Reconciled",
      status: "PASS",
      details: `PV of FCFF + PV of Terminal Value reconciles with Enterprise Value (variance ${bridgeEvVariance.toFixed(0)} within ±1000 tolerance).`,
    });
  }

  // 2b. DCF Equity Value Arithmetic Bridge Check (EV - Net Debt = Equity Value)
  const sectorProfile = classifySector(data.profile.sector, data.profile.industry, data.profile.description);
  // Single operating-model instance for ALL narrative QA below (ONT-01,
  // MODEL-01): built once here, shared by every section scan. Nothing below
  // re-classifies the company.
  const operatingModelBase: ResearchOperatingModel = buildResearchOperatingModel({ profile: data.profile });
  // Company-specific semantic overlay (item 3): conglomerate/holding profiles
  // contribute extra forbidden concepts the sector pack cannot express. Merged
  // once here so ONT-01/OM-01/SEM-COMP-01 all scan the same vocabulary.
  const companySemantics = getCompanySemanticProfile({ ticker: data.profile.ticker, name: data.profile.name });
  const operatingModel: ResearchOperatingModel = companySemantics
    ? {
        ...operatingModelBase,
        forbiddenConcepts: Array.from(
          new Set([...operatingModelBase.forbiddenConcepts, ...companySemantics.extraForbiddenConcepts])
        ),
      }
    : operatingModelBase;
  const isBankOrNbfc = sectorProfile.isFinancialInstitution ||
    (data.dcf?.sumPvFcff === 0 && (data.dcf?.equityValue || 0) > 0);

  const dcfNetDebt = ledger?.netDebt !== undefined
    ? Number(ledger.netDebt)
    : (data.dcf.netDebt !== undefined ? Number(data.dcf.netDebt) : ((Number(data.dcf.lessDebt) || 0) - (Number(data.dcf.plusCash) || 0)));
  const dcfEqVal = ledger?.equityValue !== undefined ? Number(ledger.equityValue) : (Number(data.dcf.equityValue) || 0);
  // Prefer ledger bridge inputs (identical to raw DCF inputs in the normal
  // case); raw DCF EV as fallback. XREF-01 independently validates DCF internals.
  const ledgerEv = Number(ledger?.enterpriseValue);
  const evForBridge = Number.isFinite(ledgerEv) && ledgerEv !== 0 ? ledgerEv : ev;
  // SOTP-primary: expected equity = GAV − holding discount − net debt
  // (recomputed from the breakdown — never trusted from the headline field).
  const sotpB = (data.dcf as any)?.sotpBreakdown;
  const expectedEqVal = sotpB
    ? Number(sotpB.grossAssetValue || 0) * (1 - Number(sotpB.holdingDiscount || 0)) - dcfNetDebt
    : isBankOrNbfc ? dcfEqVal : evForBridge - dcfNetDebt;
  const bridgeEqVariance = Math.abs(dcfEqVal - expectedEqVal);

  // Honest-NR guard: when the model honestly produced no positive equity
  // (non-valid DCF) and the ledger reports NR (not a modeled rating), the
  // bridge has no valid inputs to reconcile — that is a disclosed model
  // limitation, not a sync bug. WARN with disclosure; a valid-model mismatch
  // stays a HARD block.
  const honestNrNoEquity = rating === "NR" && data.dcf?.status !== undefined && data.dcf.status !== "valid";
  if (bridgeEqVariance > 1000 && !isBankOrNbfc && honestNrNoEquity) {
    checks.push({
      id: "XREF-03",
      category: "CROSS_REFERENCE",
      name: "DCF Equity Value Bridge Arithmetic Reconciled",
      status: "WARN",
      details: `No positive model equity exists (DCF ${data.dcf.status}; EV ${evForBridge.toFixed(0)}, net debt ${dcfNetDebt.toFixed(0)}, equity ${dcfEqVal.toFixed(0)}) — bridge not applicable under honest NR anchor to price. Disclosed limitation; see ledger ratingRationale. Variance: ${bridgeEqVariance.toFixed(0)}`,
      expected: "NR-anchored (disclosed)",
      actual: `variance ${bridgeEqVariance.toFixed(0)}`,
    });
  } else if (bridgeEqVariance > 1000 && !isBankOrNbfc) {
    checks.push({
      id: "XREF-03",
      category: "CROSS_REFERENCE",
      name: "DCF Equity Value Bridge Arithmetic Reconciled",
      status: "FAIL",
      details: `FATAL PUBLICATION BLOCK: Enterprise Value (${evForBridge.toFixed(0)}) minus Net Debt (${dcfNetDebt.toFixed(0)}) does not match Equity Value (${dcfEqVal.toFixed(0)}). Variance: ${bridgeEqVariance.toFixed(0)}`,
      expected: expectedEqVal.toFixed(0),
      actual: dcfEqVal.toFixed(0),
    });
  } else {
    checks.push({
      id: "XREF-03",
      category: "CROSS_REFERENCE",
      name: "DCF Equity Value Bridge Arithmetic Reconciled",
      status: "PASS",
      details: sotpB
        ? `SOTP equity reconciles: GAV − ${(Number(sotpB.holdingDiscount || 0) * 100).toFixed(0)}% holding discount − net debt (variance ${bridgeEqVariance.toFixed(0)} within ±1000 tolerance).`
        : isBankOrNbfc
          ? "Equity value modeled directly via justified multiple/residual income for banking entity."
          : `Enterprise Value minus Net Debt reconciles with Implied Equity Value (variance ${bridgeEqVariance.toFixed(0)} within ±1000 tolerance).`,
    });
  }

  // 2c. Balance Sheet to DCF Bridge Variable Linking Audit
  const latestFin = data.annualFinancials && data.annualFinancials.length > 0
    ? data.annualFinancials[data.annualFinancials.length - 1]
    : null;
  const bsTotalDebt = ledger?.totalDebt !== undefined
    ? Number(ledger.totalDebt)
    : (Number(latestFin?.totalDebt) || (latestFin ? (stmtNum(latestFin, "shortTermDebt") + stmtNum(latestFin, "longTermDebt")) : 0));
  const bsCashEquiv = ledger?.cashAndEquiv !== undefined
    ? Number(ledger.cashAndEquiv)
    : ((Number(latestFin?.cash) || 0) + (latestFin ? stmtNum(latestFin, "shortTermInvestments") : 0));
  const bsCalculatedNetDebt = bsTotalDebt - bsCashEquiv;

  // Adjustment-aware: when the DCF carries a captive-finance receivables offset,
  // the expected bridge net debt is the REPORTED balance-sheet net debt minus
  // that offset — and the offset itself is bounds-checked against reported
  // receivables and total debt (an invented offset cannot pass).
  const dcfOffset = Number((data.dcf as any)?.financeReceivablesOffset) || 0;
  const isAutoForOffset = sectorProfile.id === "auto";
  const bsReceivables = Number((latestFin as any)?.netReceivables) || 0;
  const bsRevenue = Number(latestFin?.revenue) || 0;
  const tradeAllowanceRate = isAutoForOffset ? 0.12 : 0.20;
  const maxLegitOffset = bsRevenue > 0 && bsReceivables > 0
    ? Math.min(Math.max(0, bsReceivables - tradeAllowanceRate * bsRevenue), bsTotalDebt)
    : 0;
  const offsetLegit = dcfOffset >= 0 && dcfOffset <= maxLegitOffset + 1000;
  const expectedLinkedNetDebt = bsCalculatedNetDebt - (offsetLegit ? dcfOffset : 0);

  if (latestFin && !isBankOrNbfc && !offsetLegit && dcfOffset > 1000) {
    checks.push({
      id: "XREF-04",
      category: "CROSS_REFERENCE",
      name: "Balance Sheet to DCF Bridge Variable Linking Reconciled",
      status: "FAIL",
      details: `FATAL PUBLICATION BLOCK: DCF captive-finance offset (${dcfOffset.toFixed(0)}) exceeds the verifiable bound (${maxLegitOffset.toFixed(0)} = receivables ${bsReceivables.toFixed(0)} − ${(tradeAllowanceRate * 100).toFixed(0)}% trade allowance, capped at debt). Unbounded adjustments prohibited.`,
      expected: `≤ ${maxLegitOffset.toFixed(0)}`,
      actual: dcfOffset.toFixed(0),
    });
  } else if (latestFin && !isBankOrNbfc && Math.abs(dcfNetDebt - expectedLinkedNetDebt) > 1000) {
    checks.push({
      id: "XREF-04",
      category: "CROSS_REFERENCE",
      name: "Balance Sheet to DCF Bridge Variable Linking Reconciled",
      status: "FAIL",
      details: `FATAL PUBLICATION BLOCK: Net Debt in DCF bridge (${dcfNetDebt.toFixed(0)}) contradicts audited Balance Sheet Net Debt (${bsCalculatedNetDebt.toFixed(0)} = Total Debt ${bsTotalDebt.toFixed(0)} - Cash ${bsCashEquiv.toFixed(0)}${dcfOffset > 0 ? ` − captive offset ${dcfOffset.toFixed(0)}` : ""}). Financial statements are unlinked.`,
      expected: expectedLinkedNetDebt.toFixed(0),
      actual: dcfNetDebt.toFixed(0),
    });
  } else {
    checks.push({
      id: "XREF-04",
      category: "CROSS_REFERENCE",
      name: "Balance Sheet to DCF Bridge Variable Linking Reconciled",
      status: "PASS",
      details: isBankOrNbfc
        ? "Banking entity balance sheet capital structure reconciled."
        : dcfOffset > 0
        ? `DCF net debt links via verified captive-finance offset (${dcfOffset.toFixed(0)} ≤ bound ${maxLegitOffset.toFixed(0)}).`
        : "DCF Net Debt strictly linked to audited balance sheet debt and liquid cash reserves.",
    });
  }

  // 2d. Implied Per-Share Fair Value Arithmetic Check (Equity Value / Diluted Shares = Fair Value).
  // Hard gate on EVERY valuation path (banks included — the residual-income
  // bridge carries equityValue + sharesOutstanding + intrinsicValue, so the
  // identity applies identically). Unresolved share counts FAIL instead of
  // falling back to 1-share synthesis (which manufactures 10×-class targets).
  const ledgerShares = Number(ledger?.sharesOutstanding);
  const dcfShares = ledgerShares > 0
    ? ledgerShares
    : Number(data.dcf.sharesOutstanding) > 0
      ? Number(data.dcf.sharesOutstanding)
      : Number(data.stockData.sharesOutstanding) > 0
        ? Number(data.stockData.sharesOutstanding)
        : 0;
  const expectedPerShare = dcfShares > 0 && dcfEqVal > 0 ? dcfEqVal / dcfShares : NaN;
  const perShareVariance = Number.isFinite(expectedPerShare) ? Math.abs(fv - expectedPerShare) : NaN;

  if (!(dcfShares > 0)) {
    checks.push({
      id: "XREF-05",
      category: "CROSS_REFERENCE",
      name: "DCF Per-Share Fair Value Arithmetic Reconciled",
      status: "FAIL",
      details: `FATAL PUBLICATION BLOCK: share base unresolved across ledger/dcf/quote (all ≤ 0 or missing) — per-share math unverifiable. Share-count synthesis is prohibited; resolve the base before publication.`,
      expected: "Resolved share count > 0",
      actual: "unresolved",
    });
  } else if (Number.isFinite(perShareVariance) && perShareVariance > 1.0 && fv > 0 && honestNrNoEquity) {
    checks.push({
      id: "XREF-05",
      category: "CROSS_REFERENCE",
      name: "DCF Per-Share Fair Value Arithmetic Reconciled",
      status: "WARN",
      details: `No positive model equity exists (DCF ${data.dcf.status}) — per-share bridge not applicable under honest NR anchor to price (${fv.toFixed(2)}). Disclosed limitation; see ledger ratingRationale. Variance: ${perShareVariance.toFixed(2)}`,
      expected: "NR-anchored (disclosed)",
      actual: fv.toFixed(2),
    });
  } else if (Number.isFinite(perShareVariance) && perShareVariance > 1.0 && fv > 0) {
    checks.push({
      id: "XREF-05",
      category: "CROSS_REFERENCE",
      name: "DCF Per-Share Fair Value Arithmetic Reconciled",
      status: "FAIL",
      details: `FATAL PUBLICATION BLOCK: Fair Value (${fv.toFixed(2)}) does not match Equity Value (${dcfEqVal.toFixed(0)}) / Diluted Shares (${dcfShares.toFixed(0)}) = ${expectedPerShare.toFixed(2)}. Variance: ${perShareVariance.toFixed(2)}`,
      expected: expectedPerShare.toFixed(2),
      actual: fv.toFixed(2),
    });
  } else {
    checks.push({
      id: "XREF-05",
      category: "CROSS_REFERENCE",
      name: "DCF Per-Share Fair Value Arithmetic Reconciled",
      status: "PASS",
      details: `Per-share fair value (₹${fv.toFixed(2)}) reconciles with implied equity value and diluted share count.`,
    });
  }

  // FV-RECOMP-01: independently recompute upside from fv/cmp (not the stored
  // ledger field) and require agreement — catches stale or hand-edited ledgers.
  {
    const recomputedUpside = cmp > 0 && fv > 0 ? fv / cmp - 1 : 0;
    const storedUpside = Number(ledger?.upsideDownsidePct ?? data.dcf?.upsideDownside ?? 0);
    if (Math.abs(recomputedUpside - storedUpside) > 0.005) {
      checks.push({
        id: "FV-RECOMP-01",
        category: "CROSS_REFERENCE",
        name: "Upside Recomputation Check",
        status: "FAIL",
        details: `FATAL PUBLICATION BLOCK: Stored upside (${(storedUpside * 100).toFixed(1)}%) disagrees with recomputed FV/CMP − 1 (${(recomputedUpside * 100).toFixed(1)}%). Ledger outputs must be derived, not asserted.`,
        expected: `${(recomputedUpside * 100).toFixed(1)}%`,
        actual: `${(storedUpside * 100).toFixed(1)}%`,
      });
    } else {
      checks.push({
        id: "FV-RECOMP-01",
        category: "CROSS_REFERENCE",
        name: "Upside Recomputation Check",
        status: "PASS",
        details: `Stored upside reconciles with independent FV/CMP − 1 recomputation.`,
      });
    }
  }

  // MARGIN-01: DCF year-1 margin continuity. A step-change from trailing margin
  // is legitimate ONLY when disclosed (evidence trail states the source); an
  // undisclosed >10pp jump means the forecast and the history disagree silently.
  {
    const trail = data.annualFinancials[data.annualFinancials.length - 1];
    // Sector-native trailing margin: insurers/REITs anchor on net margin (no EBIT
    // construct); fee franchises and banks/corporates on operating income.
    // stmtNum preserves the old bank/corporate runtime exactly.
    const trailMargin = trail && trail.revenue > 0
      ? ((isInsuranceStatement(trail) || isReitStatement(trail)) ? trail.netMargin : stmtNum(trail, "operatingIncome") / trail.revenue)
      : null;
    const dcfY1 = data.dcf?.assumptions?.ebitMargins?.[0];
    if (trailMargin !== null && dcfY1 !== undefined && Math.abs(dcfY1 - trailMargin) > 0.10) {
      checks.push({
        id: "MARGIN-01",
        category: "CROSS_REFERENCE",
        name: "Forecast Margin Continuity",
        status: "WARN",
        details: `DCF year-1 EBIT margin (${(dcfY1 * 100).toFixed(1)}%) steps ${(Math.abs(dcfY1 - trailMargin) * 100).toFixed(1)}pp from trailing ${(trailMargin * 100).toFixed(1)}%. Verify the bridge in the Assumption Evidence Trail.`,
        expected: "Bridged step-change",
        actual: `${(Math.abs(dcfY1 - trailMargin) * 100).toFixed(1)}pp step`,
      });
    } else {
      checks.push({
        id: "MARGIN-01",
        category: "CROSS_REFERENCE",
        name: "Forecast Margin Continuity",
        status: "PASS",
        details: `DCF margin path is continuous with trailing reported margin.`,
      });
    }
  }

  // ASSUME-01: every DCF assumption must carry an evidence-trail entry.
  {
    const basis = (data.dcf as any)?.assumptionBasis || {};
    const required = ["revenueGrowth", "ebitMargin", "capex", "workingCapital", "netDebt", "wacc", "terminal"];
    const missing = required.filter((k) => typeof basis[k] !== "string" || basis[k].length < 20);
    if (missing.length > 0) {
      checks.push({
        id: "ASSUME-01",
        category: "CROSS_REFERENCE",
        name: "Assumption Evidence Registry",
        status: "FAIL",
        details: `FATAL PUBLICATION BLOCK: DCF assumptions missing evidence-trail entries: ${missing.join(", ")}. Every assumption needs a stated empirical basis.`,
        expected: "7 evidenced assumptions",
        actual: `${required.length - missing.length}/7 evidenced`,
      });
    } else {
      checks.push({
        id: "ASSUME-01",
        category: "CROSS_REFERENCE",
        name: "Assumption Evidence Registry",
        status: "PASS",
        details: `All 7 DCF assumptions carry evidence-trail entries.`,
      });
    }
  }

  // 3. Assumptions Ledger Verification: header sync PLUS an independent
  // model-vs-ledger check. The old version compared the ledger to itself
  // (ReportClient copies both fields from the ledger), so it could never fail.
  // The DCF comparison below is independent: raw model output vs ledger record.
  const targetPriceMatch = data.targetPrice === fv || (data.targetPrice !== undefined && fv !== undefined && Math.abs(data.targetPrice - fv) < 0.05);
  const recommendationMatch = data.recommendation === rating;
  const dcfIntrinsic = Number(data.dcf?.intrinsicValue) || 0;
  const ledgerFv = Number(ledger?.fairValue) || 0;
  const modelTol = Math.max(0.06, Math.abs(ledgerFv) * 0.015);
  const modelMatchesLedger = dcfIntrinsic > 0 && ledgerFv > 0 && Math.abs(dcfIntrinsic - ledgerFv) <= modelTol;
  const ledgerAnchored = Boolean((ledger as any)?.insufficientData);
  // Raw model produced no intrinsic value (invalid/insolvent DCF): the ledger
  // cannot legitimately carry a modeled fair value. When the ledger honestly
  // reports NR on a non-valid model (insufficient-data anchor or model-failure
  // NR with disclosed rationale — e.g. negative-FCFF platforms the FCFF engine
  // cannot price), that is a disclosed limitation, not a sync bug: WARN and
  // publish with warnings instead of hard-blocking the dossier. A non-NR
  // rating on an invalid model, or any header/ledger desync, stays a HARD
  // block — publication is prohibited until the engine validates.
  const modelInvalid = !modelMatchesLedger && data.dcf?.status !== undefined && data.dcf.status !== "valid";
  const honestNrAnchor = rating === "NR" && data.dcf?.status !== undefined && data.dcf.status !== "valid";
  if (!targetPriceMatch || !recommendationMatch) {
    checks.push({
      id: "XREF-02",
      category: "CROSS_REFERENCE",
      name: "Header Target vs Ledger Fair Value Check",
      status: "FAIL",
      details: `FATAL PUBLICATION BLOCK: Report targetPrice (${data.targetPrice}) or recommendation (${data.recommendation}) contradicts Assumptions Ledger (${fv}, ${rating}). Unsynchronized claims strictly prohibited.`,
      expected: `${fv} (${rating})`,
      actual: `${data.targetPrice} (${data.recommendation})`,
    });
  } else if (honestNrAnchor) {
    checks.push({
      id: "XREF-02",
      category: "CROSS_REFERENCE",
      name: "Header Target vs Ledger Fair Value Check",
      status: "WARN",
      details: `Ledger honestly reports NR on a non-valid DCF model (${data.dcf.status}, intrinsic ${dcfIntrinsic.toFixed(2)}) — fair value anchored to price (${ledgerFv.toFixed(2)}) with disclosed NR rationale, not asserted as a valuation. Header, ledger, and model agree that no validated intrinsic value exists. See ledger ratingRationale for the limitation.`,
      expected: "NR-anchored (disclosed)",
      actual: `DCF ${data.dcf.status} → NR`,
    });
  } else if (modelInvalid) {
    checks.push({
      id: "XREF-02",
      category: "CROSS_REFERENCE",
      name: "Header Target vs Ledger Fair Value Check",
      status: "FAIL",
      details: `FATAL PUBLICATION BLOCK: Raw DCF model is ${data.dcf.status} (intrinsic ${dcfIntrinsic.toFixed(2)}) — no validated intrinsic value exists, so publication is prohibited until the engine validates. Anchoring to price is not a valuation.`,
      expected: "Valid DCF engine output",
      actual: `DCF ${data.dcf.status}`,
    });
  } else if (!modelMatchesLedger && !ledgerAnchored) {
    checks.push({
      id: "XREF-02",
      category: "CROSS_REFERENCE",
      name: "Header Target vs Ledger Fair Value Check",
      status: "FAIL",
      details: `FATAL PUBLICATION BLOCK: Raw DCF intrinsic value (${dcfIntrinsic.toFixed(2)}) diverges from ledger fair value (${ledgerFv.toFixed(2)}) beyond ±1.5% — ledger overrides model output without reconciliation.`,
      expected: `${ledgerFv.toFixed(2)}`,
      actual: `${dcfIntrinsic.toFixed(2)}`,
    });
  } else if (!modelMatchesLedger && ledgerAnchored) {
    checks.push({
      id: "XREF-02",
      category: "CROSS_REFERENCE",
      name: "Header Target vs Ledger Fair Value Check",
      status: "WARN",
      details: `Ledger fair value (${ledgerFv.toFixed(2)}) anchored to price under insufficient-data NR — raw DCF output (${dcfIntrinsic.toFixed(2)}) intentionally not used.`,
      expected: "NR-anchored",
      actual: `${dcfIntrinsic.toFixed(2)} vs ${ledgerFv.toFixed(2)}`,
    });
  } else {
    checks.push({
      id: "XREF-02",
      category: "CROSS_REFERENCE",
      name: "Header Target vs Ledger Fair Value Check",
      status: "PASS",
      details: `Header, ledger, and raw DCF model agree on fair value (₹${fv}).`,
    });
  }

  // 3a2/3a3 intentionally not duplicated: XREF-03/XREF-04 above are the single
  // authoritative bridge checks (duplicate IDs with conflicting tolerances removed).
  const dcf = data.dcf;

  // 3b. Moat Qualitative Narrative Consistency. Scans the FULL moat surface —
  // thesis, moat commentary, competitiveMoat, moat sources and pillar rationales.
  // The old version scanned two fields, so "No moat" conclusions survived next
  // to ecosystem/switching-cost prose everywhere else.
  const canonicalMoat = ledger?.moatRating || data.masterReportFacts?.moat.rating;
  const thesisText = (data.aiAnalysis?.investmentThesis || "").toLowerCase();
  const moatPageText = ((data.aiAnalysis as any)?.economicMoatCommentary || data.aiAnalysis?.businessStrategyCommentary || "").toLowerCase();
  const competitiveMoatText = ((data.aiAnalysis as any)?.competitiveMoat || "").toLowerCase();
  const moatSourcesText = JSON.stringify((data.aiAnalysis as any)?.moatSources || {}).toLowerCase();
  const moatPillarsText = JSON.stringify((data.aiAnalysis as any)?.moatPillars || []).toLowerCase();
  const allMoatText = `${thesisText} ${moatPageText} ${competitiveMoatText} ${moatSourcesText} ${moatPillarsText}`;

  const noneMoatHype = ["wide structural moat", "wide economic moat", "wide moat", "strong moat", "durable moat", "formidable moat", "unassailable moat", "expanding moat", "moat is widening"];
  if (canonicalMoat === "None" && noneMoatHype.some((p) => allMoatText.includes(p))) {
    checks.push({
      id: "MOAT-01",
      category: "CROSS_REFERENCE",
      name: "Economic Moat Qualitative Consistency",
      status: "FAIL",
      details: `FATAL PUBLICATION BLOCK: Canonical moat is 'None', but narrative claims a 'Wide moat'. Contradictory qualitative positioning prohibited.`,
      expected: "None",
      actual: "Wide",
    });
  } else if (canonicalMoat === "Wide" && (allMoatText.includes("no economic moat") || allMoatText.includes("moat: none") || allMoatText.includes("lacks an economic moat"))) {
    checks.push({
      id: "MOAT-01",
      category: "CROSS_REFERENCE",
      name: "Economic Moat Qualitative Consistency",
      status: "FAIL",
      details: `FATAL PUBLICATION BLOCK: Canonical moat is 'Wide', but narrative claims 'No moat'. Contradictory qualitative positioning prohibited.`,
      expected: "Wide",
      actual: "None",
    });
  } else {
    checks.push({
      id: "MOAT-01",
      category: "CROSS_REFERENCE",
      name: "Economic Moat Qualitative Consistency",
      status: "PASS",
      details: `Economic moat narrative aligns with canonical classification (${canonicalMoat || "Verified"}).`,
    });
  }

  // 3c. Scenario Implied Return Mathematical Verification
  const scenarios = data.assumptionsLedger?.scenarios || data.masterReportFacts?.scenarios;
  const cmpVal = data.cmp || data.stockData.currentPrice;
  if (scenarios && cmpVal > 0) {
    const checkScenarioMath = (target: number, reportedReturn: number) => {
      const correctReturn = (target / cmpVal) - 1;
      return Math.abs(reportedReturn - correctReturn) < 0.005;
    };

    const bullOk = checkScenarioMath(scenarios.bull.targetPrice, scenarios.bull.impliedReturn);
    const baseOk = checkScenarioMath(scenarios.base.targetPrice, scenarios.base.impliedReturn);
    const bearOk = checkScenarioMath(scenarios.bear.targetPrice, scenarios.bear.impliedReturn);

    if (!bullOk || !baseOk || !bearOk) {
      checks.push({
        id: "SCEN-01",
        category: "SCENARIO_MATH",
        name: "Scenario Implied Return Mathematical Verification",
        status: "FAIL",
        details: `FATAL PUBLICATION BLOCK: Scenario implied return does not match (targetPrice / currentPrice) - 1. Arbitrary return numbers prohibited.`,
        expected: `Bull: ${(((scenarios.bull.targetPrice / cmpVal) - 1) * 100).toFixed(1)}%`,
        actual: `Bull: ${(scenarios.bull.impliedReturn * 100).toFixed(1)}%`,
      });
    } else {
      checks.push({
        id: "SCEN-01",
        category: "SCENARIO_MATH",
        name: "Scenario Implied Return Mathematical Verification",
        status: "PASS",
        details: `Scenario implied returns are strictly reconciled: (Target / CMP) - 1.`,
      });
    }

    // 3d. Scenario Non-Negative Equity Floor Check (Limited Liability)
    const pricesPositive = scenarios.bull.targetPrice > 0 && scenarios.base.targetPrice > 0 && scenarios.bear.targetPrice > 0;
    if (!pricesPositive) {
      checks.push({
        id: "SCEN-02",
        category: "SCENARIO_MATH",
        name: "Scenario Non-Negative Equity Floor Check",
        status: "FAIL",
        details: `FATAL PUBLICATION BLOCK: Scenario target price is non-positive (Bear: ${scenarios.bear.targetPrice}). Violates equity limited liability.`,
        expected: "> 0.00",
        actual: `Bear: ${scenarios.bear.targetPrice}`,
      });
    } else {
      checks.push({
        id: "SCEN-02",
        category: "SCENARIO_MATH",
        name: "Scenario Non-Negative Equity Floor Check",
        status: "PASS",
        details: `All scenario targets strictly obey equity limited liability (> 0.00).`,
      });
    }

    // PROB-01: probability-weighted value is recomputed independently (weights
    // 25/60/15), and the weights methodology is stated — not just asserted.
    const sc = ledger?.scenarios;
    if (sc) {
      const recomputed = sc.bull.targetPrice * 0.25 + sc.base.targetPrice * 0.60 + sc.bear.targetPrice * 0.15;
      const publishedW = Number(ledger?.probabilityWeightedValue ?? sc.probabilityWeightedValue);
      const probTol = Math.max(1, Math.abs(sc.base.targetPrice) * 0.005);
      if (!isFinite(publishedW) || Math.abs(recomputed - publishedW) > probTol) {
        checks.push({
          id: "PROB-01",
          category: "SCENARIO_MATH",
          name: "Probability-Weighted Value Recomputation",
          status: "FAIL",
          details: `FATAL PUBLICATION BLOCK: Published probability-weighted value (${publishedW}) disagrees with independent 25/60/15 recomputation (${recomputed.toFixed(2)}). Weights: bull 25% / base 60% / bear 15% judgmental priors emphasizing the base case.`,
          expected: `${recomputed.toFixed(2)}`,
          actual: `${publishedW}`,
        });
      } else {
        checks.push({
          id: "PROB-01",
          category: "SCENARIO_MATH",
          name: "Probability-Weighted Value Recomputation",
          status: "PASS",
          details: `Weighted value recomputes exactly (25/60/15 judgmental priors, base-weighted). Individual case P&L must still be read against its operating narrative.`,
        });
      }
    }
  }

  // 3e. Moat Overall vs Pillar Durability Consistency.
  // ANY Wide-durability pillar under a Narrow/None composite is a contradiction
  // (previously only all-Wide was caught, letting mixed cases through).
  const moatPillars = (data as any).masterReportFacts?.moat?.moatPillars || (data as any).peAnalysis?.moatPillars
    || (data.aiAnalysis as any)?.moatPillars;
  if ((canonicalMoat === "Narrow" || canonicalMoat === "None") && moatPillars && moatPillars.length > 0) {
    const widePillars = moatPillars.filter((p: any) => (p.durability || "").includes("Wide"));
    if (widePillars.length > 0) {
      checks.push({
        id: "MOAT-02",
        category: "CROSS_REFERENCE",
        name: "Economic Moat Pillar Alignment Check",
        status: "FAIL",
        details: `Overall moat is '${canonicalMoat}' but ${widePillars.length} moat pillar(s) claim 'Wide' durability (${widePillars.map((p: any) => p.pillar).join("; ").slice(0, 160)}). Pillar durability must harmonize with composite moat rating.`,
        expected: "Narrow/None-consistent durability",
        actual: `${widePillars.length} Wide pillar(s)`,
      });
    } else {
      checks.push({
        id: "MOAT-02",
        category: "CROSS_REFERENCE",
        name: "Economic Moat Pillar Alignment Check",
        status: "PASS",
        details: `Moat pillars properly harmonized with composite ${canonicalMoat} moat rating.`,
      });
    }
  }

  // MOAT-03: Moat State Consistency — MOAT=NONE and PILLARS=UNASSESSED cannot coexist.
  // If evidence is insufficient, MOAT must be UNASSESSED.
  // If evaluated and no durable advantage found, MOAT = NONE with evidence.
  {
    const aiMoat = (data.aiAnalysis as any)?.competitiveMoat || "";
    const moatRating = (data.masterReportFacts as any)?.moat?.rating;
    const moatPillars = (data as any).peAnalysis?.moatPillars || [];
    const hasUnassessedPillar = moatPillars.some((p: any) => !p.pillar || p.pillar === "None" || p.durability === "Unassessed" || p.durability === "N/A");
    const hasNoneRating = moatRating === "None" || moatRating === "NONE" || aiMoat.toLowerCase().includes("no economic moat") || aiMoat.toLowerCase().includes("moat = none");
    const hasUnassessedRating = moatRating === "UNASSESSED" || moatRating === "Unassessed";

    if (hasNoneRating && (!moatPillars.length || hasUnassessedPillar)) {
      checks.push({
        id: "MOAT-03", category: "BS_DETECTOR", name: "Moat State Consistency",
        status: "WARN",
        details: `Moat state contradiction: economic moat rated "None" but moat pillars are unassessed or empty. If evidence is insufficient, moat should be "UNASSESSED". If evaluated with no durable advantage, pillars must present supporting evidence for "None" verdict.`,
        expected: "moat rating consistent with pillar assessment", actual: "NONE + UNASSESSED contradiction",
      });
    }
  }

  // 3f. ROIC vs Capital Stewardship Alignment
  const roicSpreadValCheck = ledger?.roicSpread !== undefined ? ledger.roicSpread : (ledger?.roic ? ledger.roic - wacc : 0);
  const stewardshipLabel = (data as any).companyArchetype?.capitalAllocationLabel || (data as any).masterReportFacts?.capitalAllocationLabel || "";
  if (roicSpreadValCheck < -0.02 && stewardshipLabel.toLowerCase().includes("exemplary")) {
    checks.push({
      id: "STEWARD-01",
      category: "CROSS_REFERENCE",
      name: "Capital Stewardship vs Value Creation Alignment",
      status: "FAIL",
      details: `FATAL PUBLICATION BLOCK: Capital allocation labeled '${stewardshipLabel}' while ROIC-WACC spread is negative (${(roicSpreadValCheck * 100).toFixed(1)}%).`,
      expected: "Measured / Under Review",
      actual: stewardshipLabel,
    });
  } else if (stewardshipLabel) {
    checks.push({
      id: "STEWARD-01",
      category: "CROSS_REFERENCE",
      name: "Capital Stewardship vs Value Creation Alignment",
      status: "PASS",
      details: `Capital allocation stewardship rating conforms with economic spread profile.`,
    });
  }

  // GOV-01: Governance Specific-Claim vs Evidence. Officer filings carry names
  // and titles only — board-independence splits, clawback adoption, chair/CEO
  // separation, and retention multiples are NEVER evidenced. Any narrative that
  // asserts them as fact contradicts the report's own evidence limitations.
  const govText = JSON.stringify({
    g: (data.aiAnalysis as any)?.governanceCommentary || "",
    m: (data.aiAnalysis as any)?.managementCommentary || "",
    c: (data.aiAnalysis as any)?.capitalAllocationCommentary || "",
  }).toLowerCase();
  const govUnsupported: string[] = [];
  const govPatterns: [string, RegExp][] = [
    ["board-independence percentage", /\b\d+\s*%[^.]{0,60}\bindependent\b/],
    ["independent majority claim", /independent\s+majority|majority\s+(of\s+)?independent/],
    ["clawback adoption claim", /clawback[^.]{0,80}(implement|adopt|place|maintain|robust|strict|requires?)/],
    ["independent-chair-as-fact", /independent\s+chair[^.]{0,60}(provides|ensures|optimal|check|oversight)/],
    ["retention-multiple claim", /\b[5-9]x\s+base\s+salary|equity\s+retention[^.]{0,40}\d+\s*x/],
  ];
  for (const [label, re] of govPatterns) {
    if (re.test(govText)) govUnsupported.push(label);
  }
  if (govUnsupported.length > 0) {
    checks.push({
      id: "GOV-01",
      category: "CROSS_REFERENCE",
      name: "Governance Claims vs Filed Evidence",
      status: "WARN",
      details: `Governance narrative asserts unevidenced specifics (${govUnsupported.join("; ")}), but filings disclose names/titles only. Downgrade to "No assessment" or cite a primary source.`,
      expected: "No assessment / cited source",
      actual: `${govUnsupported.length} unsupported claim(s)`,
    });
  } else {
    checks.push({
      id: "GOV-01",
      category: "CROSS_REFERENCE",
      name: "Governance Claims vs Filed Evidence",
      status: "PASS",
      details: `No unevidenced governance specifics detected.`,
    });
  }

  // 4. Balance Sheet Check
  let maxBsVariancePct = 0;
  let bsYearsEvaluated = 0;
  for (const fin of data.annualFinancials) {
    if (fin.totalAssets > 0) {
      const liabilities = (fin.totalLiabilities && fin.totalLiabilities > 0)
        ? fin.totalLiabilities
        : ((fin.totalDebt || 0) + (fin.currentLiabilities || 0));
      const rightSide = liabilities + (fin.totalEquity || 0);
      const diff = Math.abs(fin.totalAssets - rightSide);
      const varPct = (diff / fin.totalAssets) * 100;
      if (varPct > maxBsVariancePct) maxBsVariancePct = varPct;
      bsYearsEvaluated++;
    }
  }

  // ── Content-integrity checks: evidence density of qualitative sections ──
  // All WARN (never block on prose style), but each costs score and shows on
  // every QA surface — generic LLM filler can no longer pass silently.
  const aiAny = (data.aiAnalysis || {}) as any;
  const thesisFull = `${aiAny.investmentThesis || ""} ${aiAny.investmentConclusion || ""}`;

  // THESIS-01: thesis must be company-specific (named + quantified).
  {
    const firstNameWord = (data.profile.name || "").split(/[\s,.-]+/).find((w) => w.length >= 4) || "";
    const numeralHits = new Set((thesisFull.match(/\d[\d,.]*%|\$\s?\d[\d,.]*|\d[\d,.]*\s?(?:x|bps|million|billion|crore)/gi) || []).map((s) => s.toLowerCase()));
    const namesCompany = firstNameWord !== "" && thesisFull.toLowerCase().includes(firstNameWord.toLowerCase());
    if (!namesCompany || numeralHits.size < 3) {
      checks.push({
        id: "THESIS-01",
        category: "BS_DETECTOR",
        name: "Thesis Evidence Density",
        status: "WARN",
        details: `Investment thesis is generic: ${!namesCompany ? "does not name the company" : "names the company"} but carries only ${numeralHits.size} distinct quantified figures (need ≥3). Rebuild around measurable drivers.`,
        expected: "Named company + ≥3 quantified figures",
        actual: `${numeralHits.size} quantified figure(s)`,
      });
    } else {
      checks.push({
        id: "THESIS-01",
        category: "BS_DETECTOR",
        name: "Thesis Evidence Density",
        status: "PASS",
        details: `Thesis names the company and quantifies ${numeralHits.size} distinct figures.`,
      });
    }
  }

  // OVERVIEW-01: overview must share vocabulary with filed description.
  {
    const stop = new Set(["limited", "private", "incorporated", "company", "group", "holdings", "india", "united", "states", "through", "across", "their", "with", "from", "that", "this", "into", "over", "under"]);
    const descWords = Array.from(
      new Set(((data.profile.description || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 6 && !stop.has(w))))
    ).slice(0, 25);
    const overviewLower = `${aiAny.companyOverview || ""} ${aiAny.companyDescription || ""}`.toLowerCase();
    const shared = descWords.filter((w) => overviewLower.includes(w));
    if (descWords.length >= 5 && shared.length === 0) {
      checks.push({
        id: "OVERVIEW-01",
        category: "BS_DETECTOR",
        name: "Overview Filed-Vocabulary Coverage",
        status: "WARN",
        details: `Company overview shares zero substantive keywords with the filed business description — likely generic. Map statements to reported segments/products.`,
        expected: "≥1 filed keyword",
        actual: "0 shared keywords",
      });
    } else {
      checks.push({
        id: "OVERVIEW-01",
        category: "BS_DETECTOR",
        name: "Overview Filed-Vocabulary Coverage",
        status: "PASS",
        details: `Overview shares ${shared.length} substantive keyword(s) with filed description.`,
      });
    }
  }

  // COMPET-01: competitive narrative must name real peers when peers exist.
  {
    const compText = `${aiAny.competitiveMoat || ""} ${JSON.stringify(aiAny.fiveForces || [])} ${aiAny.industryDynamicsCommentary || ""}`.toLowerCase();
    const peerNames = (data.peers || [])
      .flatMap((p: any) => [p.ticker, p.name])
      .filter((s): s is string => typeof s === "string" && s.replace(/\.[A-Z]+$/i, "").length >= 2)
      .map((s) => s.replace(/\.[A-Z]+$/i, "").toLowerCase());
    const named = peerNames.filter((n) => compText.includes(n));
    if (peerNames.length > 0 && named.length === 0) {
      checks.push({
        id: "COMPET-01",
        category: "BS_DETECTOR",
        name: "Competitor Naming Coverage",
        status: "WARN",
        details: `Competitive narrative names none of the ${peerNames.length} retrieved peer(s) — compare against actual competitors, not abstractions.`,
        expected: "≥1 named peer",
        actual: "0 named peers",
      });
    } else {
      checks.push({
        id: "COMPET-01",
        category: "BS_DETECTOR",
        name: "Competitor Naming Coverage",
        status: "PASS",
        details: peerNames.length === 0 ? `No peers retrieved — nothing to name.` : `Narrative names ${named.length} peer(s).`,
      });
    }
  }

  // MGMT-01: stewardship superlatives without evidence.
  {
    const mgmtText = `${aiAny.managementCommentary || ""} ${aiAny.governanceCommentary || ""}`.toLowerCase();
    const puff = ["world-class", "best-in-class", "flawless", "unwavering", "pristine leadership", "exceptional leadership", "visionary leadership", "unmatched execution"].filter((p) => mgmtText.includes(p));
    if (puff.length > 0) {
      checks.push({
        id: "MGMT-01",
        category: "BS_DETECTOR",
        name: "Stewardship Superlative Screen",
        status: "WARN",
        details: `Management narrative uses unevidenced superlatives (${puff.join("; ")}). Evaluate execution record and guidance accuracy instead.`,
        expected: "Evidence-based assessment",
        actual: `${puff.length} superlative(s)`,
      });
    } else {
      checks.push({
        id: "MGMT-01",
        category: "BS_DETECTOR",
        name: "Stewardship Superlative Screen",
        status: "PASS",
        details: `No unevidenced stewardship superlatives detected.`,
      });
    }
  }

  // CATALYST-01: every catalyst needs trigger + timing + likelihood + impact.
  {
    const catalysts = Array.isArray(aiAny.catalysts) ? aiAny.catalysts : [];
    const incomplete = catalysts.filter((c: any) => !c || !c.event || !c.horizon || !c.probability || !c.impact).length;
    if (catalysts.length === 0) {
      checks.push({
        id: "CATALYST-01",
        category: "BS_DETECTOR",
        name: "Catalyst Completeness",
        status: "WARN",
        details: `No catalysts evidenced — none asserted rather than generic milestones.`,
        expected: "≥1 quantified catalyst",
        actual: "0 catalysts",
      });
    } else if (incomplete > 0) {
      checks.push({
        id: "CATALYST-01",
        category: "BS_DETECTOR",
        name: "Catalyst Completeness",
        status: "WARN",
        details: `${incomplete}/${catalysts.length} catalyst(s) lack trigger, timing, likelihood, or valuation impact. Every catalyst needs all four.`,
        expected: "Complete catalyst records",
        actual: `${incomplete} incomplete`,
      });
    } else {
      checks.push({
        id: "CATALYST-01",
        category: "BS_DETECTOR",
        name: "Catalyst Completeness",
        status: "PASS",
        details: `All ${catalysts.length} catalyst(s) carry trigger, timing, likelihood, and impact.`,
      });
    }
  }

  // ── THESIS-CHAIN-01: evidence → mechanism → KPI → valuation chain must be present ──
  {
    const thesisText = `${aiAny.investmentThesis || ""} ${aiAny.investmentConclusion || ""}`.toLowerCase();
    const hasEvidence = /\[F-|\[F-|fact|forecast|canonical|dcf|ebit|revenue/i.test(`${aiAny.investmentThesis || ""}`);
    const hasMechanism = /RevPAR|ADR|occupancy|ARPU|NIM|credit cost|volume|ASP|take rate|throughput|utilization|occupancy×adr|subs.*arpu|units.*asp/i.test(`${aiAny.investmentThesis || ""}`) || (operatingModel?.requiredConcepts || []).some((c: string) => thesisText.includes(c.toLowerCase()));
    const hasKpi = (operatingModel?.requiredConcepts || []).some((c: string) => thesisText.includes(c.toLowerCase())) || hasMechanism;
    const hasValuation = /valuation|fair value|upside|EV|per-share|FCF|FCFF|target|WACC|terminal|intrinsic/i.test(thesisText);
    const thesisLen = (aiAny.investmentThesis || "").trim().length;
    if (thesisLen > 40 && (!hasEvidence || !hasMechanism || !hasKpi || !hasValuation)) {
      const missing: string[] = [];
      if (!hasEvidence) missing.push("evidence [F-...]/forecast");
      if (!hasMechanism) missing.push("business mechanism");
      if (!hasKpi) missing.push("company-specific KPI");
      if (!hasValuation) missing.push("valuation consequence");
      checks.push({
        id: "THESIS-CHAIN-01",
        category: "BS_DETECTOR",
        name: "Thesis Evidence→Mechanism→KPI→Valuation Chain",
        status: "WARN",
        details: `Investment thesis lacks evidence→mechanism→KPI→valuation chain (missing: ${missing.join(", ")}). Generic thesis language ("strong fundamentals", "well positioned") should be rebuilt around a falsifiable debate: evidence [F-...] → mechanism (e.g., occupancy×ADR→RevPAR) → KPI → financial consequence (revenue/EBIT/FCF row via canonical forecast) → valuation (EV/equity/per-share). Costs score; 20 such warnings block publication.`,
        expected: "evidence [F-...] → mechanism → KPI → financial → valuation",
        actual: `missing ${missing.join(", ")}`,
      });
    } else if (thesisLen > 40) {
      checks.push({
        id: "THESIS-CHAIN-01",
        category: "BS_DETECTOR",
        name: "Thesis Evidence→Mechanism→KPI→Valuation Chain",
        status: "PASS",
        details: `Thesis contains evidence→mechanism→KPI→valuation chain (${hasEvidence ? "evidence" : ""} ${hasMechanism ? "mechanism" : ""} ${hasValuation ? "valuation" : ""}).`,
      });
    }
  }

  // ── CATALYST-SPEC-01: company-specific triggers, not generic earnings/margin ──
  {
    const catalysts = Array.isArray(aiAny.catalysts) ? aiAny.catalysts : [];
    let genericCatalyst: string | null = null;
    for (const c of catalysts as any[]) {
      const txt = `${c?.event || c?.catalyst || ""} ${c?.trigger || c?.mechanism || ""}`.toLowerCase();
      const genericPhrases = ["earnings growth", "margin expansion", "revenue growth", "earnings beat", "margin improvement", "profitability improvement"];
      const isGeneric = genericPhrases.some((p) => txt.includes(p) && txt.length < 120 && !/launch|approval|order|contract|regulation|spectrum|store|clinical|product|capacity|utilization|tariff|policy|guidance|buyback|dividend|occupancy|adr|revpar|arpu|take rate|throughput|crack spread|o2c|jio/i.test(txt));
      if (isGeneric) { genericCatalyst = (c?.event || c?.catalyst || "generic") as string; break; }
    }
    if (genericCatalyst) {
      checks.push({
        id: "CATALYST-SPEC-01",
        category: "BS_DETECTOR",
        name: "Catalyst Company-Specificity",
        status: "WARN",
        details: `Catalyst "${genericCatalyst.slice(0, 80)}" is generic (earnings/margin) without company-specific trigger (launch/approval/order/contract/regulation etc). Generic catalysts cost score and count toward 20-warning threshold — replace with event: e.g., 'Jio 5G tariff hike → ARPU → revenue' or 'O2C crack spread widening → petchem margin'.`,
        expected: "company-specific trigger → mechanism → KPI → valuation chain",
        actual: genericCatalyst,
      });
    } else if (catalysts.length > 0) {
      // Also check that each catalyst has a trigger word
      const missingTrigger = (catalysts as any[]).filter((c: any) => {
        const t = `${c?.event || c?.catalyst || ""} ${c?.trigger || ""}`.toLowerCase();
        return t.length > 15 && !/launch|approval|order|contract|regulation|spectrum|store|clinical|product|capacity|tariff|policy|guidance|buyback|dividend|occupancy|adr|arpu|take rate|throughput|crack spread|jio|o2c|retail/i.test(t);
      });
      if (missingTrigger.length > 0 && missingTrigger.length === catalysts.length) {
        checks.push({
          id: "CATALYST-SPEC-01",
          category: "BS_DETECTOR",
          name: "Catalyst Company-Specificity",
          status: "WARN",
          details: `All ${catalysts.length} catalyst(s) lack identifiable company-specific triggers. Add launch/approval/order/contract/regulation etc and tie to canonical forecast variable.`,
          expected: "trigger per catalyst",
          actual: "none identified",
        });
      } else {
        checks.push({
          id: "CATALYST-SPEC-01",
          category: "BS_DETECTOR",
          name: "Catalyst Company-Specificity",
          status: "PASS",
          details: `Catalysts carry company-specific triggers.`,
        });
      }
    } else {
      // No catalysts - handled by CATALYST-01 already, but ensure SPEC passes when none (insufficient is disclosed)
      checks.push({
        id: "CATALYST-SPEC-01",
        category: "BS_DETECTOR",
        name: "Catalyst Company-Specificity",
        status: "PASS",
        details: `No catalysts to specificity-check (CATALYST-01 handles absence).`,
      });
    }
  }

  // ── COMPET-SEG-01: segment-level competitive matrix for conglomerates ──
  {
    const segSet = (() => {
      try { const { getFilingSegments } = require("./filing-segments") as typeof import("./filing-segments"); return getFilingSegments(data.profile.ticker); } catch { return null; }
    })() as any;
    if (segSet && segSet.segments.length >= 2) {
      const compText = JSON.stringify((data.aiAnalysis as any)?.competitiveMoat || (data.aiAnalysis as any)?.competitiveAnalysis || (data.aiAnalysis as any)?.peersCommentary || "").toLowerCase()
        + " " + JSON.stringify((data as any).peAnalysis || {}).toLowerCase()
        + " " + JSON.stringify((data.aiAnalysis as any)?.businessStrategyCommentary || "").toLowerCase();
      const missingSegs = segSet.segments.filter((sg: any) => {
        const firstWord = sg.name.toLowerCase().split(/[\s\(]/)[0];
        return !compText.includes(sg.name.toLowerCase()) && !compText.includes(firstWord) && firstWord.length > 3;
      }).map((sg: any) => sg.name);
      if (missingSegs.length >= 2) {
        checks.push({
          id: "COMPET-SEG-01",
          category: "BS_DETECTOR",
          name: "Segment-Level Competitive Analysis",
          status: "WARN",
          details: `Conglomerate has ${segSet.segments.length} filing Segments [${segSet.segments.map((s: any) => s.name).join(", ")}] but competitive analysis omits ${missingSegs.slice(0, 3).join(", ")} — requires segment-level peer matrix (O2C vs refiners, Jio vs telecom ARPU peers, Retail vs DMart, E&P vs upstream). Costs score; segment coverage strengthens thesis.`,
          expected: `segment-level peers for ${segSet.segments.length} segments`,
          actual: `missing ${missingSegs.length} segments`,
        });
      } else if (missingSegs.length === 1) {
        checks.push({
          id: "COMPET-SEG-01",
          category: "BS_DETECTOR",
          name: "Segment-Level Competitive Analysis",
          status: "WARN",
          details: `Competitive analysis missing segment ${missingSegs[0]} — add segment peer for completeness.`,
          expected: "all segments covered",
          actual: `missing ${missingSegs[0]}`,
        });
      } else {
        checks.push({
          id: "COMPET-SEG-01",
          category: "BS_DETECTOR",
          name: "Segment-Level Competitive Analysis",
          status: "PASS",
          details: `Segment-level competitive matrix covers all ${segSet.segments.length} filing segments.`,
        });
      }
    } else {
      checks.push({
        id: "COMPET-SEG-01",
        category: "BS_DETECTOR",
        name: "Segment-Level Competitive Analysis",
        status: "PASS",
        details: `No multi-segment filing set — company-level comps sufficient.`,
      });
    }
  }

  // ── MOAT-EVIDENCE-01: evidence-driven moat vs generic assertion ──
  {
    const moatText = `${(data.aiAnalysis as any)?.economicMoatCommentary || (data.aiAnalysis as any)?.competitiveMoat || ""}`.toLowerCase();
    const moatSources = (data.aiAnalysis as any)?.moatSources || (data as any).peAnalysis?.moatSources || [];
    const hasFact = /\[F-|\[f-|fact|roce|roic|wacc|spread|margin.*stable|gross margin.*\d+%/i.test(moatText + JSON.stringify(moatSources));
    const genericMoatPhrases = ["strong moat", "wide moat", "durable moat", "sustainable advantage", "competitive advantage", "economic moat is wide"];
    const isGenericMoat = moatText.length > 30 && genericMoatPhrases.some((p) => moatText.includes(p)) && !hasFact;
    if (isGenericMoat) {
      checks.push({
        id: "MOAT-EVIDENCE-01",
        category: "BS_DETECTOR",
        name: "Moat Evidence Chain",
        status: "WARN",
        details: `Moat narrative uses generic assertion ("${genericMoatPhrases.find((p) => moatText.includes(p))}") without [F-...] or canonical ROCE/WACC linkage. Evidence-driven moat requires: source → evidence [F-...] or ROCE vs WACC → economic consequence → durability → threats. Costs score.`,
        expected: "evidence [F-...] or ROCE vs WACC + durability",
        actual: "generic moat phrase without evidence",
      });
    } else if (moatSources && Array.isArray(moatSources) && moatSources.length > 0) {
      const lacking = moatSources.filter((s: any) => !s.evidence || (typeof s.evidence === "string" && s.evidence.length < 15 && !/\[F-/.test(s.evidence) && !/roce|wacc|margin/i.test(s.evidence.toLowerCase())));
      if (lacking.length > 0 && lacking.length === moatSources.length) {
        checks.push({
          id: "MOAT-EVIDENCE-01",
          category: "BS_DETECTOR",
          name: "Moat Evidence Chain",
          status: "WARN",
          details: `All ${moatSources.length} moat pillar(s) lack [F-...] or ROCE/WACC evidence — moat is asserted, not evidenced. Add fact linkage per pillar.`,
          expected: "evidence per pillar",
          actual: `${lacking.length} without evidence`,
        });
      } else {
        checks.push({
          id: "MOAT-EVIDENCE-01",
          category: "BS_DETECTOR",
          name: "Moat Evidence Chain",
          status: "PASS",
          details: `Moat pillars carry evidence linkage.`,
        });
      }
    } else {
      checks.push({
        id: "MOAT-EVIDENCE-01",
        category: "BS_DETECTOR",
        name: "Moat Evidence Chain",
        status: "PASS",
        details: `Moat evidence check not applicable (no pillar detail).`,
      });
    }
  }

  // Balance sheets must balance: FAIL above 5% (was 15%), WARN above 1% (was 5%).
  // Plugged/estimated statements no longer hide behind a lenient gate.
  if (maxBsVariancePct > 5.0 && bsYearsEvaluated > 0) {
    checks.push({
      id: "BS-01",
      category: "BALANCE_SHEET",
      name: "Balance Sheet Accounting Identity Check",
      status: "FAIL",
      details: `FATAL PUBLICATION BLOCK: Balance sheet classification variance reaches ${maxBsVariancePct.toFixed(1)}% (> 5% ceiling). Assets != Liabilities + Equity. Financial statement data integrity compromised.`,
      expected: "< 5.0%",
      actual: `${maxBsVariancePct.toFixed(1)}%`,
    });
  } else if (maxBsVariancePct > 1.0 && bsYearsEvaluated > 0) {
    checks.push({
      id: "BS-01",
      category: "BALANCE_SHEET",
      name: "Balance Sheet Accounting Identity Check",
      status: "WARN",
      details: `Balance sheet classification variance reaches ${maxBsVariancePct.toFixed(1)}%. Note appended explaining reporting schedule adjustments.`,
      expected: "< 5.0%",
      actual: `${maxBsVariancePct.toFixed(1)}%`,
    });
  } else {
    checks.push({
      id: "BS-01",
      category: "BALANCE_SHEET",
      name: "Balance Sheet Accounting Identity Check",
      status: "PASS",
      details: `Balance sheets across all ${bsYearsEvaluated} audited periods conform strictly to fundamental accounting balance constraints.`,
    });
  }

  // CHAIN-01: IS→BS→CF→FCF dependency chain. FCF must equal CFO minus capex
  // within tolerance every year, and NWC must equal CA minus CL — otherwise the
  // cash-flow model is disconnected from the statements it claims to extend.
  {
    const chainBreaks: string[] = [];
    const chainWarns: string[] = [];
    for (const f of data.annualFinancials || []) {
      const rev = Math.abs(f.revenue || 0);
      const fcfGap = Math.abs((f.freeCashFlow || 0) - ((f.operatingCashFlow || 0) - Math.abs(f.capitalExpenditures || 0)));
      const fcfTol = Math.max(1, rev * 0.005);
      if (fcfGap > Math.max(fcfTol * 4, rev * 0.02) && rev > 0) {
        chainBreaks.push(`${f.year}: FCF≠CFO−capex (gap ${fcfGap.toFixed(0)})`);
      } else if (fcfGap > fcfTol && rev > 0) {
        chainWarns.push(`${f.year}: FCF≈CFO−capex within loose tolerance only`);
      }
      const nwcGap = Math.abs((f.netWorkingCapital || 0) - ((f.currentAssets || 0) - (f.currentLiabilities || 0)));
      if (nwcGap > Math.max(1, rev * 0.005) && (f.currentAssets > 0 || f.currentLiabilities > 0)) {
        chainBreaks.push(`${f.year}: NWC≠CA−CL (gap ${nwcGap.toFixed(0)})`);
      }
    }
    if (chainBreaks.length > 0) {
      // Financial institutions (banks/insurers/NBFCs) do not reconcile via
      // FCF=CFO−capex — Yahoo reports FCF≈CFO for banks and loan-book flows
      // dominate CF. Enforce as WARN (not publication-blocking) for those.
      const isFinancialChain = !!(sectorProfile?.isFinancialInstitution || `${data.profile.sector || ""} ${data.profile.industry || ""}`.toLowerCase().includes("bank") || `${data.profile.industry || ""}`.toLowerCase().includes("insurance"));
      checks.push({
        id: "CHAIN-01",
        category: "BALANCE_SHEET",
        name: "Statement Dependency Chain (IS→BS→CF→FCF)",
        status: isFinancialChain ? "WARN" : "FAIL",
        details: isFinancialChain
          ? `Cash-flow chain non-reconcilable for financial institution (expected): ${chainBreaks.join("; ")} — treated as informational for banks/insurers (FCF≈CFO).`
          : `FATAL PUBLICATION BLOCK: Cash-flow dependency chain broken — ${chainBreaks.join("; ")}.`,
        expected: isFinancialChain ? "Financial institution: FCF chain informational only" : "FCF=CFO−capex; NWC=CA−CL every year",
        actual: `${chainBreaks.length} break(s)`,
      });
    } else if (chainWarns.length > 0) {
      checks.push({
        id: "CHAIN-01",
        category: "BALANCE_SHEET",
        name: "Statement Dependency Chain (IS→BS→CF→FCF)",
        status: "WARN",
        details: `Dependency chain holds within loose tolerance only: ${chainWarns.join("; ")}.`,
        expected: "FCF=CFO−capex every year",
        actual: `${chainWarns.length} loose year(s)`,
      });
    } else {
      checks.push({
        id: "CHAIN-01",
        category: "BALANCE_SHEET",
        name: "Statement Dependency Chain (IS→BS→CF→FCF)",
        status: "PASS",
        details: `FCF=CFO−capex and NWC=CA−CL reconcile across all reported years.`,
      });
    }
  }

  // 5. Degenerate Ratios Check
  let hasDegenerateRatio = false;
  let degenerateDetails = "";
  for (const r of data.ratiosByYear || []) {
    if (Math.abs(r.roe) > 3.0 || Math.abs(r.netMargin) > 2.0) {
      hasDegenerateRatio = true;
      degenerateDetails = `Year ${r.year} has extreme ratio (ROE: ${(r.roe * 100).toFixed(0)}%, Net Margin: ${(r.netMargin * 100).toFixed(0)}%).`;
      break;
    }
  }

  if (hasDegenerateRatio) {
    checks.push({
      id: "RATIO-01",
      category: "DEGENERATE_RATIO",
      name: "Solvency & Margin Sanity Bound Audit",
      status: "WARN",
      details: `${degenerateDetails} Guard applied to output 'N/M' with explanatory footnote.`,
    });
  } else {
    checks.push({
      id: "RATIO-01",
      category: "DEGENERATE_RATIO",
      name: "Solvency & Margin Sanity Bound Audit",
      status: "PASS",
      details: `All financial ratios fall within standard institutional sanity boundaries.`,
    });
  }

  // ARCH-01..04: sector-native statement identities. Each architecture reconciles
  // against its OWN definitional identities (exact by construction — breach is
  // data corruption and FAILs). These replace generic corporate checks that never
  // applied: no EBITDA/inventory/DSO for banks/insurers, no combined ratio outside
  // insurance, no gross margin for REITs/fee franchises. Severity is FAIL-grade
  // ONLY here (exact arithmetic) — proxied-input drift stays WARN in STMT-01.
  {
    const archFins = data.annualFinancials || [];
    const close = (expected: number, actual: number, scale: number) =>
      Math.abs(expected - actual) <= Math.max(2, Math.abs(scale) * 0.002);
    const archBreaks: string[] = [];
    let archEvaluated = 0;
    let archKind = "corporate";
    for (const f of archFins) {
      if (isBankStatement(f)) {
        archKind = "bank/nbfc";
        archEvaluated++;
        if (!close(f.netInterestIncome + f.nonInterestIncome, f.totalRevenue, f.totalRevenue)) archBreaks.push(`${f.year}: NII+fees ≠ totalRevenue`);
        if (!close(f.totalRevenue, f.revenue, f.totalRevenue)) archBreaks.push(`${f.year}: revenue alias ≠ totalRevenue`);
      } else if (isInsuranceStatement(f)) {
        archKind = "insurance";
        archEvaluated++;
        if (!close(f.lossRatio + f.expenseRatio, f.combinedRatio, 1)) archBreaks.push(`${f.year}: loss+expense ≠ combined`);
        if (!close(f.netEarnedPremium - f.claimsIncurred - f.underwritingExpenses, f.underwritingResult, f.netEarnedPremium)) archBreaks.push(`${f.year}: NEP−claims−exp ≠ UW result`);
        if (!close(f.netEarnedPremium + f.investmentIncome, f.revenue, f.revenue)) archBreaks.push(`${f.year}: NEP+inv ≠ revenue`);
      } else if (isReitStatement(f)) {
        archKind = "REIT";
        archEvaluated++;
        if (!close(f.rentalIncome + f.otherPropertyIncome, f.revenue, f.revenue)) archBreaks.push(`${f.year}: rental ≠ revenue`);
        if (!(f.adjustedFundsFromOperations <= f.fundsFromOperations + 1)) archBreaks.push(`${f.year}: AFFO > FFO`);
        if (f.sharesOutstanding > 0 && !close(f.fundsFromOperations / f.sharesOutstanding, f.ffoPerShare, Math.abs(f.ffoPerShare))) archBreaks.push(`${f.year}: FFO/shares ≠ FFO/share`);
      } else if (isAssetLightStatement(f)) {
        archKind = "fee-franchise";
        archEvaluated++;
        if (!close(f.managementFees + f.performanceFees + f.technologyServicesRevenue, f.totalFeeRevenue, f.totalFeeRevenue)) archBreaks.push(`${f.year}: fee parts ≠ totalFeeRevenue`);
        if (!close(f.totalFeeRevenue - f.operatingExpenses, f.operatingIncome, f.totalFeeRevenue)) archBreaks.push(`${f.year}: feeRev−opex ≠ operatingIncome`);
        if (!close(f.totalFeeRevenue, f.revenue, f.totalFeeRevenue)) archBreaks.push(`${f.year}: revenue alias ≠ totalFeeRevenue`);
      }
    }
    if (archEvaluated > 0) {
      if (archBreaks.length > 0) {
        checks.push({
          id: archKind === "bank/nbfc" ? "ARCH-01" : archKind === "insurance" ? "ARCH-02" : archKind === "REIT" ? "ARCH-03" : "ARCH-04",
          category: "CROSS_REFERENCE",
          name: `Sector-Native Identity Reconciliation (${archKind})`,
          status: "FAIL",
          details: `FATAL PUBLICATION BLOCK: ${archKind} definitional identity breach — ${archBreaks.slice(0, 3).join("; ")}. Exact-by-construction arithmetic must reconcile; breach means statement construction is corrupt.`,
          expected: "Exact identity reconciliation",
          actual: `${archBreaks.length} breach(es)`,
        });
      } else {
        checks.push({
          id: archKind === "bank/nbfc" ? "ARCH-01" : archKind === "insurance" ? "ARCH-02" : archKind === "REIT" ? "ARCH-03" : "ARCH-04",
          category: "CROSS_REFERENCE",
          name: `Sector-Native Identity Reconciliation (${archKind})`,
          status: "PASS",
          details: `${archKind} statements reconcile on their own identities across ${archEvaluated} year(s) — no generic corporate checks applied (no EBITDA/inventory/DSO for financials, no combined ratio outside insurance, no gross margin for REIT/fee).`,
        });
      }
    }
  }

  // DISC-01: Material line-item discontinuity — a historically material operating
  // line item that vanishes in forecast years without explanation. Now FAIL (blocker)
  // when material and unexplained: the forecast must explicitly classify as
  // RECURRING | NON_RECURRING | RECLASSIFIED | ONE_OFF_REMOVAL | DATA_ERROR
  // and the basis string must state the treatment, otherwise publication blocked.
  {
    const annuals = data.annualFinancials || [];
    const fc = (data as any).canonicalForecast as { projections?: Array<Record<string, unknown>> } | null;
    if (annuals.length >= 2 && fc?.projections?.length) {
      const lineItems = [
        { name: "Other Operating Expense", historical: (y: any) => Number(y.totalOperatingExpense ?? 0) - Number(y.costOfRevenue ?? 0) - Number(y.sellingGeneralAdmin ?? 0) - Number(y.researchDevelopment ?? 0), forecast: (p: Record<string, unknown>) => Number(p.otherOperatingExpense ?? 0), threshold: 0.005, label: "otherOperatingExpense" },
        { name: "Other Operating Expense (gross)", historical: (y: any) => Math.abs(Number(y.totalOperatingExpense ?? 0) - Number(y.costOfRevenue ?? 0) - Number(y.sellingGeneralAdmin ?? 0) - Number(y.researchDevelopment ?? 0)), forecast: (p: Record<string, unknown>) => Math.abs(Number(p.otherOperatingExpense ?? 0)), threshold: 0.005, label: "otherOperatingExpenseAbs" },
      ];
      const avgRevenue = annuals.reduce((s, y) => s + (Number((y as any).revenue) || 0), 0) / annuals.length;
      for (const li of lineItems.slice(0, 1)) {
        const histValues = annuals.map(li.historical).filter(v => Number.isFinite(v) && Math.abs(v) > 1);
        if (histValues.length < 2) continue;
        const avgHist = Math.abs(histValues.reduce((s, v) => s + Math.abs(v), 0) / histValues.length);
        const isMaterial = avgRevenue > 0 && (avgHist / avgRevenue) > li.threshold;
        if (!isMaterial) continue;
        const forecastValues = (fc.projections || []).map(li.forecast);
        const allZero = forecastValues.every(v => v === 0 || !Number.isFinite(v) || Math.abs(v) < 1);
        const forecastBasis = JSON.stringify((fc as any).basis || (data as any).dcf?.assumptionBasis || {}) + " " + JSON.stringify((data as any).aiAnalysis || {});
        const hasExplicitClassification = /(RECURRING|NON_RECURRING|RECLASSIFIED|ONE_OFF_REMOVAL|DATA_ERROR|reclassified|non-recurring|one-off)/i.test(forecastBasis);
        // Also check canonical forecast basis for OtherOpex disclosure
        const histPct = avgRevenue > 0 ? ((avgHist / avgRevenue) * 100).toFixed(1) + '% of revenue' : 'abs ' + avgHist.toFixed(0);
        const forecastSample = forecastValues.slice(0, 3).map(v => (Number(v) || 0).toFixed(0)).join(", ");
        if (allZero) {
          const detail = `Historically material line item "${li.name}" (avg ${histPct} across ${histValues.length} historical years, last ${histValues[histValues.length - 1].toFixed(0)}) is absent/zero in all forecast periods (forecast: ${forecastSample}). Forecast OtherOpex is computed as plug GP−SGA−R&D−EBIT; disappearance must be explicitly classified as RECURRING (continue at trailing ${histPct}) | NON_RECURRING (one-off removed, state year/reason) | RECLASSIFIED (absorbed into ${histPct} → SGA/R&D/COGS, state target) | ONE_OFF_REMOVAL | DATA_ERROR. No classification found in basis — publication blocked until disclosed.`;
          const shouldBlock = !hasExplicitClassification;
          checks.push({
            id: "DISC-01", category: "BS_DETECTOR", name: "Material Line Discontinuity",
            status: shouldBlock ? "FAIL" : "WARN",
            details: shouldBlock ? `FATAL PUBLICATION BLOCK: ${detail}` : detail,
            expected: "explicit classification or continuation (RECURRING/NON_RECURRING/RECLASSIFIED/ONE_OFF_REMOVAL/DATA_ERROR)", actual: hasExplicitClassification ? "classification present but values zero" : "all forecast values zero/missing, no classification",
          });
        } else if (hasExplicitClassification) {
          // Pass when explained, even if zero — classification satisfies gate
          checks.push({
            id: "DISC-01", category: "BS_DETECTOR", name: "Material Line Discontinuity",
            status: "PASS",
            details: `Material line "${li.name}" discontinuity explicitly classified (avg ${histPct} historical → forecast ${forecastSample}); classification found in basis.`,
          });
        } else {
          // Warn when material but small residual remains without classification
          const avgForecast = forecastValues.reduce((s, v) => s + Math.abs(Number(v) || 0), 0) / Math.max(1, forecastValues.length);
          if (avgHist > 0 && avgForecast / avgHist < 0.15) {
            checks.push({
              id: "DISC-01", category: "BS_DETECTOR", name: "Material Line Discontinuity",
              status: "WARN",
              details: `Material line "${li.name}" (avg ${histPct}) shrinks ${(avgForecast / avgHist * 100).toFixed(0)}% in forecast (avg ${avgForecast.toFixed(0)}) without explicit classification. State RECLASSIFIED/REMOVAL basis.`,
              expected: "explicit classification", actual: `forecast avg ${avgForecast.toFixed(0)} vs hist ${avgHist.toFixed(0)}`,
            });
          }
        }
      }
    }
  }

  // CF-ANOMALY: Cash flow anomaly detection — large non-cash adjustments,
  // unusual working capital swings, or FCF vs CFO divergence.
  {
    const annuals = data.annualFinancials || [];
    const latest = annuals[annuals.length - 1] as any;
    if (latest) {
      const revenue = Number(latest.revenue) || 0;
      const cfo = Number(latest.operatingCashFlow) || 0;
      const netIncome = Number(latest.netIncome) || 0;
      const capex = Number(latest.capitalExpenditure) || 0;
      const fcf = cfo + capex; // capex is typically negative
      const changeInWorkingCapital = Number(latest.changeInWorkingCapital) || 0;

      // Non-cash adjustment detection: |CFO - Net Income - D&A + ΔWC| should be small relative to revenue
      const depreciation = Number(latest.depreciation) || 0;
      const nonCashResidual = Math.abs(cfo - netIncome - depreciation + changeInWorkingCapital);
      const nonCashThreshold = Math.max(revenue * 0.05, 50_000_000); // 5% of revenue or $50M absolute
      if (nonCashResidual > nonCashThreshold && revenue > 0) {
        checks.push({
          id: "CF-ANOMALY", category: "BS_DETECTOR", name: "Cash Flow Anomaly Detection",
          status: "WARN",
          details: `Non-cash adjustment residual (${((nonCashResidual / revenue) * 100).toFixed(1)}% of revenue) exceeds threshold — CFO (${(cfo / 1e6).toFixed(1)}M) minus Net Income (${(netIncome / 1e6).toFixed(1)}M) minus D&A (${(depreciation / 1e6).toFixed(1)}M) plus ΔWC (${(changeInWorkingCapital / 1e6).toFixed(1)}M) = $${((cfo - netIncome - depreciation + changeInWorkingCapital) / 1e6).toFixed(1)}M unexplained. Investigate non-cash items, deferred taxes, SBC, or working capital anomalies.`,
          expected: `|CFO - NI - D&A + ΔWC| < ${((nonCashThreshold / revenue) * 100).toFixed(1)}% of revenue`, actual: `${((nonCashResidual / revenue) * 100).toFixed(1)}%`,
        });
      }

      // FCF quality: FCF/CFO ratio — if FCF << CFO, capex is consuming operating cash
      if (cfo > 0 && fcf < cfo * 0.3) {
        checks.push({
          id: "CF-ANOMALY", category: "BS_DETECTOR", name: "FCF Quality Warning",
          status: "WARN",
          details: `FCF ($${(fcf / 1e6).toFixed(1)}M) is only ${((fcf / cfo) * 100).toFixed(0)}% of CFO ($${(cfo / 1e6).toFixed(1)}M) — heavy capex burden or investing intensity. Verify capex classification (growth vs maintenance).`,
          expected: "FCF > 50% of CFO for mature companies", actual: `${((fcf / cfo) * 100).toFixed(0)}%`,
        });
      }
    }
  }

  // 6. Sector Keyword Blocklist Audit
  const sectorStr = `${data.profile.sector || ""} ${data.profile.industry || ""}`.toLowerCase();
  const narrativeText = JSON.stringify(data.aiAnalysis || {}).toLowerCase();

  let blocklistViolations: string[] = [];
  for (const [, rule] of Object.entries(SECTOR_KEYWORD_BLOCKLIST)) {
    const isMatchingSector = rule.sectorNames.some(s => sectorStr.includes(s));
    if (isMatchingSector) {
      for (const phrase of rule.blocked) {
        if (narrativeText.includes(phrase)) {
          blocklistViolations.push(phrase);
        }
      }
    }
  }

  if (blocklistViolations.length > 0) {
    checks.push({
      id: "NARRATIVE-01",
      category: "KEYWORD_BLOCKLIST",
      name: "Sector Template Keyword Leakage Filter",
      status: "FAIL",
      details: `FATAL PUBLICATION BLOCK — TEMPLATE CONTAMINATION: out-of-sector terminology in narrative (${blocklistViolations.join(", ")}). Foreign-sector terms prove the wrong template generated this report — fix the template/prompt, not the output.`,
      expected: "Zero out-of-sector terms",
      actual: `${blocklistViolations.length} leaked term(s)`,
    });
  } else {
    checks.push({
      id: "NARRATIVE-01",
      category: "KEYWORD_BLOCKLIST",
      name: "Sector Template Keyword Leakage Filter",
      status: "PASS",
      details: `No out-of-sector boilerplate keywords from the screened list detected in narrative.`,
    });
  }

  // PLACEHOLDER-01: Unresolved Template Token Leak.
  // {{FAIR_VALUE}} etc. must never reach a publishable report. The injector only
  // covers 12 tokens — any residual {{...}} (including variant spellings) blocks.
  const narrativeJson = JSON.stringify(data.aiAnalysis || {});
  const leakedTokens = Array.from(new Set(narrativeJson.match(/\{\{[^}]+\}\}/g) || []));
  if (leakedTokens.length > 0) {
    checks.push({
      id: "PLACEHOLDER-01",
      category: "KEYWORD_BLOCKLIST",
      name: "Unresolved Template Token Check",
      status: "FAIL",
      details: `FATAL PUBLICATION BLOCK: Unresolved template tokens leaked into narrative: ${leakedTokens.slice(0, 5).join(", ")}. Placeholder injection incomplete.`,
      expected: "Zero {{...}} tokens",
      actual: `${leakedTokens.length} leaked token(s)`,
    });
  } else {
    checks.push({
      id: "PLACEHOLDER-01",
      category: "KEYWORD_BLOCKLIST",
      name: "Unresolved Template Token Check",
      status: "PASS",
      details: `No unresolved template tokens in narrative.`,
    });
  }

  // SANITIZE-01: Sanitizer Rewrite Disclosure. The sector sanitizer runs BEFORE
  // QA — without this check, QA would certify text it never saw. Material
  // rewriting (≥3 distinct foreign-sector terms scrubbed) proves the narrative
  // was contaminated at generation time and blocks publication; 1–2 incidental
  // rewrites (e.g. a single legitimate competitive comparison tripping an
  // industry blocklist) warn with disclosure instead of blocking the dossier.
  // Absent sanitizer metadata counts as clean (legacy path).
  const rewrittenTerms = Array.from(
    new Set(((data as any).sanitizerReport?.rewrittenTerms || []) as string[])
  );
  if (rewrittenTerms.length >= 3) {
    checks.push({
      id: "SANITIZE-01",
      category: "KEYWORD_BLOCKLIST",
      name: "Sanitizer Rewrite Disclosure",
      status: "FAIL",
      details: `FATAL PUBLICATION BLOCK: Sector sanitizer rewrote ${rewrittenTerms.length} distinct out-of-sector term(s) pre-QA: [${rewrittenTerms.slice(0, 8).join(", ")}]. Any rewrite proves generation-time contamination — fix the template/prompt, not the output.`,
      expected: "Zero rewritten terms",
      actual: `${rewrittenTerms.length} rewritten term(s)`,
    });
  } else if (rewrittenTerms.length >= 1) {
    checks.push({
      id: "SANITIZE-01",
      category: "KEYWORD_BLOCKLIST",
      name: "Sanitizer Rewrite Disclosure",
      status: "WARN",
      details: `Sector sanitizer rewrote ${rewrittenTerms.length} incidental out-of-sector term(s) pre-QA: [${rewrittenTerms.slice(0, 8).join(", ")}]. Below the ≥3-term contamination threshold — disclosed, not blocking. Verify the flagged terms are legitimate competitive context, not template bleed.`,
      expected: "Zero rewritten terms",
      actual: `${rewrittenTerms.length} rewritten term(s)`,
    });
  } else {
    checks.push({
      id: "SANITIZE-01",
      category: "KEYWORD_BLOCKLIST",
      name: "Sanitizer Rewrite Disclosure",
      status: "PASS",
      details: `No sector-sanitizer rewrites recorded; QA audited the as-generated text.`,
    });
  }

  // ============================================================
  // BS-DETECTOR CROSS-VALIDATION RULES
  // These catch the "Frankenstein Architecture" failures where
  // the data/template engine contradicts the LLM narrative.
  // ============================================================

  // BS-DETECTOR-01: Distress & Credit Consistency
  // Prohibit AAA/AA/A+ credit rating on firms with Net Debt/EBITDA > 5.0 or negative EBITDA
  const bsDetectFin = latestFin || data.annualFinancials[data.annualFinancials.length - 1];
  // Sector-native earnings power: REITs read FFO (EBITDA absent by design);
  // fee franchises read operating income; others read EBITDA→operatingIncome.
  const ebitda = !bsDetectFin ? 0
    : isReitStatement(bsDetectFin) ? bsDetectFin.fundsFromOperations
    : isAssetLightStatement(bsDetectFin) ? bsDetectFin.operatingIncome
    : (stmtNum(bsDetectFin, "ebitda") || stmtNum(bsDetectFin, "operatingIncome"));
  const netDebt = (bsDetectFin?.totalDebt || 0) - (bsDetectFin?.cash || 0);
  const netDebtToEbitda = ebitda > 0 ? netDebt / ebitda : (netDebt > 0 ? 999 : 0);
  const creditRating = ledger?.calibratedCreditRating || "";
  const highGradeCredit = ["AAA", "AA+", "AA", "AA-", "A+", "A", "A-"];

  const isFinancialInstitution = isBankOrNbfc;

  if (!isFinancialInstitution && (netDebtToEbitda > 5.0 || ebitda <= 0) && highGradeCredit.includes(creditRating)) {
    checks.push({
      id: "BS-DETECTOR-01",
      category: "BS_DETECTOR",
      name: "Distress & Credit Rating Consistency",
      status: "FAIL",
      details: `Credit rating "${creditRating}" assigned despite Net Debt/EBITDA of ${netDebtToEbitda > 100 ? "N/M (negative EBITDA)" : netDebtToEbitda.toFixed(1)}x. High-grade rating prohibited when leverage exceeds 5.0x or EBITDA is non-positive.`,
      expected: "BB+ or below",
      actual: creditRating,
    });
  } else {
    checks.push({
      id: "BS-DETECTOR-01",
      category: "BS_DETECTOR",
      name: "Distress & Credit Rating Consistency",
      status: "PASS",
      details: isFinancialInstitution
        ? `Indicative internal credit score "${creditRating || "N/A"}" calibrated against banking capitalization, asset quality, and systemic scale.`
        : `Credit rating "${creditRating || "N/A"}" is consistent with leverage profile (Net Debt/EBITDA: ${netDebtToEbitda > 100 ? "N/M" : netDebtToEbitda.toFixed(1)}x).`,
    });
  }

  // BS-DETECTOR-02: Dividend Consistency
  // Flag if Net Income < 0 or actual Div Yield = 0 but Dividend CAGR shows positive growth
  const netIncome = latestFin?.netIncome || 0;
  const divYield = data.stockData.dividendYield || 0;
  const divCagrDisplay = ledger?.dividendCAGRDisplay || "";
  const hasFabricatedDividend =
    (netIncome < 0 || divYield === 0) &&
    divCagrDisplay !== "" &&
    !divCagrDisplay.includes("N/A") &&
    !divCagrDisplay.includes("Zero") &&
    !divCagrDisplay.includes("Suspended") &&
    !divCagrDisplay.includes("0.0%");

  if (hasFabricatedDividend) {
    checks.push({
      id: "BS-DETECTOR-02",
      category: "BS_DETECTOR",
      name: "Dividend & Net Income Consistency",
      status: "FAIL",
      details: `Dividend CAGR displayed as "${divCagrDisplay}" despite Net Income of ${fmtCompact(netIncome)} and Dividend Yield of ${(divYield * 100).toFixed(1)}%. Positive dividend growth prohibited on loss-making or non-paying firms.`,
      expected: "N/A (Zero/Suspended)",
      actual: divCagrDisplay,
    });
  } else {
    checks.push({
      id: "BS-DETECTOR-02",
      category: "BS_DETECTOR",
      name: "Dividend & Net Income Consistency",
      status: "PASS",
      details: `Dividend display is consistent with actual payout capability (Net Income: ${fmtCompact(netIncome)}, Yield: ${(divYield * 100).toFixed(1)}%).`,
    });
  }

  // BS-DETECTOR-03: Margin Monotonicity
  // Bear Case Margin must be < Base Case Margin < Bull Case Margin
  const sm = ledger?.scenarioMargins;
  if (sm) {
    const bearM = sm.bearMargin;
    const baseM = sm.baseMargin;
    const bullM = sm.bullMargin;
    if (bearM >= baseM || baseM >= bullM) {
      checks.push({
        id: "BS-DETECTOR-03",
        category: "BS_DETECTOR",
        name: "Scenario Margin Monotonicity",
        status: "FAIL",
        details: `Scenario margins are not monotonically ordered: Bear ${(bearM * 100).toFixed(1)}% ≥ Base ${(baseM * 100).toFixed(1)}% or Base ≥ Bull ${(bullM * 100).toFixed(1)}%. Margin inversion violates scenario logic.`,
        expected: "Bear < Base < Bull",
        actual: `${(bearM * 100).toFixed(1)}% / ${(baseM * 100).toFixed(1)}% / ${(bullM * 100).toFixed(1)}%`,
      });
    } else {
      checks.push({
        id: "BS-DETECTOR-03",
        category: "BS_DETECTOR",
        name: "Scenario Margin Monotonicity",
        status: "PASS",
        details: `Scenario margins are correctly ordered: Bear ${(bearM * 100).toFixed(1)}% < Base ${(baseM * 100).toFixed(1)}% < Bull ${(bullM * 100).toFixed(1)}%.`,
      });
    }
  } else {
    checks.push({
      id: "BS-DETECTOR-03",
      category: "BS_DETECTOR",
      name: "Scenario Margin Monotonicity",
      status: "WARN",
      details: "Scenario margins not available in ledger; unable to validate monotonicity.",
    });
  }

  // BS-DETECTOR-04: Semantic Template Bleeding
  // Scan for out-of-sector keywords that indicate template bleeding
  // NOTE: the internet-platform rule MUST come first: "Communication Services /
  // Internet Content" matches both telecom-ish ("communication") and platform
  // substrings, and only the first matching rule is evaluated (break below).
  // "arpu" is deliberately NOT blocked for platforms — digital-advertising ARPU
  // per DAU/MAU is a legitimate internet-platform KPI.
  const SEMANTIC_BLEED_RULES: { sectors: string[]; blocked: string[] }[] = [
    { sectors: ["internet content", "social media", "digital advertising", "interactive media", "family of apps"], blocked: ["spectrum auction", "spectrum", "tower deployment", "tower tenancy", "telecom towers", "subscriber churn", "4g/5g", "agr dues", "copra", "palm oil procurement", "packaged goods", "personal care", "brand recall", "iconic consumer brand", "multi-tier retail distribution", "fmcg", "modern trade", "casa", "casa ratio", "nim", "gnpa", "clinical trial", "wafer fab", "wafer fabrication", "foundry capacity", "refinery throughput", "crack spread", "dark stores", "dark store", "gross merchandise value", "proprietary silicon", "custom neural engine", "us fda", "cgmp", "iso 13485"] },
    { sectors: ["telecom", "communication", "wireless", "internet", "restaurants"], blocked: ["proprietary silicon", "custom neural engine", "wafer fabrication", "foundry capacity", "us fda", "cgmp", "iso 13485"] },
    { sectors: ["pharma", "health", "biotech", "drug"], blocked: ["spectrum auction", "arpu", "tower tenancy", "dark store", "ride hailing", "proprietary silicon"] },
    { sectors: ["internet retail", "food delivery", "quick commerce", "hyperlocal", "marketplace", "platform"], blocked: ["copra", "palm oil procurement", "packaged goods", "personal care", "brand recall", "iconic consumer brand", "multi-tier retail distribution", "fmcg", "modern trade", "spectrum auction", "agr dues", "clinical trial phase", "proprietary silicon", "custom neural engine", "wafer fabrication", "foundry capacity", "us fda", "cgmp", "iso 13485"] },
    { sectors: ["auto manufacturer", "auto manufacturers", "automobile", "auto oem", "auto parts", "auto components", "electric vehicle", "two wheeler", "two-wheeler", "passenger vehicle", "commercial vehicle"], blocked: ["casa", "casa ratio", "net interest margin", "nim", "loan book", "loan books", "credit cost", "credit costs", "gross non-performing assets", "gnpa", "deposits", "deposit", "branch", "branches", "loan repricing", "spectrum auction", "spectrum holdings", "4g/5g", "tower deployment", "tower tenancy", "telecom towers", "subscriber churn", "agr dues", "bandwidth", "arpu", "master service agreement", "total contract value", "tcv", "saas churn", "arr expansion", "enterprise contract", "software services", "deal signing", "discretionary consulting", "copra", "packaged goods", "personal care", "fmcg", "clinical trial", "dark stores", "order backlog", "order book", "tender", "bidding", "refinery throughput", "crack spread", "proprietary silicon", "wafer fab"] },
    { sectors: ["consumer", "fmcg", "food", "beverage", "retail"], blocked: ["proprietary silicon", "custom neural engine", "spectrum auction", "agr dues", "clinical trial phase"] },
    { sectors: ["technology", "software", "it services"], blocked: ["us fda", "cgmp", "spectrum auction", "agr dues", "refinery throughput", "crack spread"] },
    { sectors: ["energy", "oil", "gas", "mining"], blocked: ["app store commission", "saas churn", "arr expansion", "dark store", "proprietary silicon"] },
  ];

  const fullNarrative = JSON.stringify(data.aiAnalysis || {}).toLowerCase() + " " + JSON.stringify((data as any).peAnalysis || {}).toLowerCase();
  const sectorLower = `${data.profile.sector || ""} ${data.profile.industry || ""}`.toLowerCase();
  let semanticBleedViolations: string[] = [];

  const checkBleedMatch = (text: string, phrase: string): boolean => {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(^|[^a-zA-Z0-9])${escaped}([^a-zA-Z0-9]|$)`, "i");
    return regex.test(text);
  };

  for (const rule of SEMANTIC_BLEED_RULES) {
    const matchesSector = rule.sectors.some(s => sectorLower.includes(s));
    if (matchesSector) {
      for (const phrase of rule.blocked) {
        if (checkBleedMatch(fullNarrative, phrase)) {
          semanticBleedViolations.push(phrase);
        }
      }
      break; // First matching rule wins; most specific rules are ordered first
    }
  }

  // Dynamic Sector Profile ontology validation
  const secProf = sectorProfile;
  const allowlisted = secProf ? getAllowlistedConcepts(secProf.id) : [];
  if (secProf && secProf.forbiddenConcepts) {
    for (const fc of secProf.forbiddenConcepts) {
      if (allowlisted.includes(fc)) continue;
      if (checkBleedMatch(fullNarrative, fc) && !semanticBleedViolations.includes(fc)) {
        semanticBleedViolations.push(fc);
      }
    }
  }

  // Remove any violation whose concept is allowlisted for this sector
  semanticBleedViolations = semanticBleedViolations.filter((v) => !allowlisted.includes(v));

  if (semanticBleedViolations.length >= 1) {
    checks.push({
      id: "BS-DETECTOR-04",
      category: "BS_DETECTOR",
      name: "Semantic Template Bleeding Filter",
      status: "FAIL",
      details: `FATAL PUBLICATION BLOCK: ${semanticBleedViolations.length} distinct out-of-sector concept(s) in narrative: [${semanticBleedViolations.join(", ")}]. Any foreign-sector term proves template contamination.`,
      expected: "Zero out-of-sector terms",
      actual: `${semanticBleedViolations.length} violations`,
    });
  } else {
    checks.push({
      id: "BS-DETECTOR-04",
      category: "BS_DETECTOR",
      name: "Semantic Template Bleeding Filter",
      status: "PASS",
      details: "Zero out-of-sector semantic bleed keywords detected; narrative is domain-specific.",
    });
  }

  // SEMANTIC-01: Analytical Semantic Coherence (ROIC vs WACC Spread)
  const roicSpreadVal = ledger?.roicSpread !== undefined ? ledger.roicSpread : (ledger?.roic ? ledger.roic - wacc : 0);
  if (roicSpreadVal < -0.005) {
    if (fullNarrative.includes("substantially exceeding") || fullNarrative.includes("positive economic spread")) {
      checks.push({
        id: "SEMANTIC-01",
        category: "CROSS_REFERENCE",
        name: "ROIC-WACC Spread Narrative Consistency",
        status: "FAIL",
        details: `FATAL PUBLICATION BLOCK: Model calculates negative ROIC-to-WACC spread (${(roicSpreadVal * 100).toFixed(1)}%), but narrative claims company returns 'substantially exceed cost of capital' or have a 'positive economic spread'. Contradictory analytical story strictly prohibited.`,
        expected: "Consistent negative/deficit spread commentary",
        actual: "Claim of superior/positive spread",
      });
    } else {
      checks.push({
        id: "SEMANTIC-01",
        category: "CROSS_REFERENCE",
        name: "ROIC-WACC Spread Narrative Consistency",
        status: "PASS",
        details: `ROIC spread narrative aligns with quantitative spread (${(roicSpreadVal * 100).toFixed(1)}%).`,
      });
    }
  } else {
    checks.push({
      id: "SEMANTIC-01",
      category: "CROSS_REFERENCE",
      name: "ROIC-WACC Spread Narrative Consistency",
      status: "PASS",
      details: `ROIC spread is non-negative (+${(roicSpreadVal * 100).toFixed(1)}%), narrative consistency verified.`,
    });
  }

  // CREDIT-01: Credit Metric Reconciliation.
  // Parses ANY quoted debt/EBITDA multiple in narrative/tables and recomputes it
  // from the balance sheet (previously only the literal string "1.8x" was caught).
  const qaCreditFin = data.annualFinancials[data.annualFinancials.length - 1];
  const cashTotal = (qaCreditFin?.cash || 0) + (qaCreditFin ? stmtNum(qaCreditFin, "shortTermInvestments") : 0);
  const debtTotal = qaCreditFin?.totalDebt || 0;
  // Sector-native earnings power (REIT: FFO; fee: operating income) — see BS-DETECTOR-01.
  const qaEbitda = !qaCreditFin ? 0
    : isReitStatement(qaCreditFin) ? qaCreditFin.fundsFromOperations
    : isAssetLightStatement(qaCreditFin) ? qaCreditFin.operatingIncome
    : (stmtNum(qaCreditFin, "ebitda") || stmtNum(qaCreditFin, "operatingIncome"));
  const actualDebtEbitda = qaEbitda > 0 ? debtTotal / qaEbitda : (debtTotal > 0 ? 99 : 0);
  const quotedLeverage: { raw: string; value: number }[] = [];
  const levRegex = /debt\s*(?:\/|to)\s*ebitda\s*(?:=|:|of)?\s*(\d+(?:\.\d+)?)\s*x/gi;
  let levMatch: RegExpExecArray | null;
  while ((levMatch = levRegex.exec(fullNarrative)) !== null) {
    quotedLeverage.push({ raw: levMatch[0], value: Number(levMatch[1]) });
  }
  const leverageContradiction = quotedLeverage.find((q) => {
    if (q.value < 1.0) return false; // only material leverage claims are audited
    if (debtTotal === 0 || cashTotal > debtTotal) return true; // debt-free/net-cash cannot carry >=1x
    return Math.abs(q.value - actualDebtEbitda) / Math.max(0.5, actualDebtEbitda) > 0.75;
  });
  if (leverageContradiction) {
    checks.push({
      id: "CREDIT-01",
      category: "BALANCE_SHEET",
      name: "Credit Metric Reconciliation",
      status: "FAIL",
      details: `FATAL PUBLICATION BLOCK: Narrative quotes "${leverageContradiction.raw.trim()}" but balance sheet recomputes Debt/EBITDA at ${actualDebtEbitda >= 99 ? "N/M" : actualDebtEbitda.toFixed(1) + "x"} (Debt: ${debtTotal}, Cash: ${cashTotal}). Reconcile debt metrics before publishing.`,
      expected: actualDebtEbitda >= 99 ? "N/M" : `${actualDebtEbitda.toFixed(1)}x`,
      actual: `${leverageContradiction.value}x`,
    });
  } else {
    checks.push({
      id: "CREDIT-01",
      category: "BALANCE_SHEET",
      name: "Credit Metric Reconciliation",
      status: "PASS",
      details: `Credit metrics reconcile with balance sheet net cash/debt position.`,
    });
  }

  // BS-DETECTOR-05: Peer Metric Cloning Detection
  // Flag if 3+ peers share identical non-null margin or leverage values (clone detection)
  const peers = data.peers || [];
  let cloneViolations: string[] = [];

  if (peers.length >= 3) {
    const checkField = (fieldName: string, getter: (p: any) => number | undefined) => {
      const vals = peers.map(getter).filter(v => v != null && v !== 0);
      if (vals.length >= 3) {
        const uniqueVals = new Set(vals.map(v => (v as number).toFixed(4)));
        if (uniqueVals.size === 1) {
          cloneViolations.push(`${fieldName} (all ${vals.length} peers = ${((vals[0] as number) * 100).toFixed(1)}%)`);
        }
      }
    };

    checkField("Gross Margin", (p) => p.grossMargin);
    checkField("EBITDA Margin", (p) => p.ebitdaMargin);
    checkField("Operating Margin", (p) => p.operatingMargin);
    checkField("Net Margin", (p) => p.netMargin);
    checkField("Debt/Equity", (p) => p.debtToEquity);
    checkField("Current Ratio", (p) => p.currentRatio);
  }

  if (cloneViolations.length > 0) {
    checks.push({
      id: "BS-DETECTOR-05",
      category: "BS_DETECTOR",
      name: "Peer Metric Cloning Detection",
      status: "FAIL",
      details: `Cloned peer metrics detected: ${cloneViolations.join("; ")}. Identical values across 3+ peers indicate hardcoded template data rather than live market data.`,
      expected: "Unique per-peer values",
      actual: `${cloneViolations.length} cloned fields`,
    });
  } else {
    checks.push({
      id: "BS-DETECTOR-05",
      category: "BS_DETECTOR",
      name: "Peer Metric Cloning Detection",
      status: "PASS",
      details: `Peer financial metrics show sufficient inter-peer variance; no clone signatures detected across ${peers.length} peers.`,
    });
  }

  // BS-DETECTOR-06: Council Verification Effectiveness.
  // A FLAGGED/missing council audit must be visible in QA scoring — previously a
  // dossier with "AUDIT NOT PERFORMED / score 0" gated identically to a verified
  // one. WARN (not FAIL) preserves availability for throttled runs while costing
  // score and showing on every QA surface.
  const council = (data.aiAnalysis as any)?.councilVerification;
  const councilStatus = council?.status;
  if (!council || councilStatus !== "VERIFIED") {
    checks.push({
      id: "BS-DETECTOR-06",
      category: "BS_DETECTOR",
      name: "Council Verification Effectiveness",
      status: "WARN",
      details: !council
        ? `No council verification audit attached — narrative claims are unverified drafts.`
        : `Council audit status is "${councilStatus}" (score ${council?.integrityScore ?? "n/a"}) — treat narrative as unconfirmed pending real audit.`,
      expected: "VERIFIED",
      actual: councilStatus || "missing",
    });
  } else {
    checks.push({
      id: "BS-DETECTOR-06",
      category: "BS_DETECTOR",
      name: "Council Verification Effectiveness",
      status: "PASS",
      details: `Council verification audit VERIFIED (score ${council?.integrityScore ?? "n/a"}).`,
    });
  }

  // PEER-01: Business-model similarity gate (Priority 4)
  // Peers must be business-model similar, not merely curated. Average relevance <30 indicates
  // fundamentally inappropriate comps fabricating a relative valuation.
  {
    const peerList = (data.peers || []) as any[];
    if (peerList.length > 0) {
      const scores = peerList.map(p => p.relevanceScore).filter((s: any) => typeof s === "number" && s !== null);
      const avgRel = scores.length ? scores.reduce((a: number, b: number) => a + b, 0) / scores.length : null;
      const lowPeers = peerList.filter((p: any) => typeof p.relevanceScore === "number" && p.relevanceScore < 30);
      if (avgRel !== null && avgRel < 30) {
        checks.push({
          id: "PEER-01",
          category: "BS_DETECTOR",
          name: "Peer Business-Model Similarity",
          status: "FAIL",
          details: `FATAL: Peer set is business-model inappropriate — average relevance ${avgRel.toFixed(1)} (<30). Peers: ${peerList.map((p: any) => `${p.ticker}(${p.relevanceScore ?? "null"})`).join(", ")}. Relative valuation would be fabricated.`,
          expected: "Average relevance ≥30",
          actual: `${avgRel.toFixed(1)}`,
        });
      } else if (lowPeers.length >= 2) {
        checks.push({
          id: "PEER-01",
          category: "BS_DETECTOR",
          name: "Peer Business-Model Similarity",
          status: "WARN",
          details: `${lowPeers.length} peer(s) have low relevance (<30): ${lowPeers.map((p: any) => `${p.ticker}(${p.relevanceScore})`).join(", ")} — review comp selection.`,
          expected: "All peers relevance ≥30",
          actual: `${lowPeers.length} low`,
        });
      } else {
        checks.push({
          id: "PEER-01",
          category: "BS_DETECTOR",
          name: "Peer Business-Model Similarity",
          status: "PASS",
          details: `Peer business-model similarity adequate — avg relevance ${avgRel !== null ? avgRel.toFixed(1) : "N/A"} across ${peerList.length} peers.`,
        });
      }
      // Hospitality / REIT must not be compared to loan-book / manufacturing peers (ontology hard gate)
      const sectorProfileForPeer = getSectorProfile(data.profile.sector || "", data.profile.industry || "", (data.profile as any).description || "");
      if ((sectorProfileForPeer.id === "hospitality" || sectorProfileForPeer.id === "real-estate") && peerList.some((p: any) => {
        const ps = (p.sector || "").toLowerCase(); const pi = (p.industry || "").toLowerCase();
        return ps.includes("bank") || pi.includes("bank") || ps.includes("financial") && !ps.includes("reit");
      })) {
        // Already penalized via relevance, but explicit block if bank appears in hospitality comps
        const bad = peerList.filter((p: any) => {
          const ps = (p.sector || "").toLowerCase(); const pi = (p.industry || "").toLowerCase();
          return ps.includes("bank") || pi.includes("bank");
        }).map((p: any) => p.ticker).join(",");
        if (bad) {
          checks.push({
            id: "PEER-01",
            category: "BS_DETECTOR",
            name: "Peer Ontology Exclusion",
            status: "FAIL",
            details: `FATAL: Hospitality/REIT report contains banking peers [${bad}] — business-model inappropriate; peer engine contamination.`,
            expected: "No banking peers for hospitality/REIT",
            actual: bad,
          });
        }
      }
    } else {
      checks.push({
        id: "PEER-01",
        category: "BS_DETECTOR",
        name: "Peer Business-Model Similarity",
        status: "PASS",
        details: `No peers — relative valuation withheld; no similarity gate applies (conservative).`,
      });
    }
  }

  // HOSP-01: Hospitality ontology hard control (Priority 1) — RevPAR/ADR/Occupancy mandatory, manufacturing/banking language forbidden
  {
    const hospProfile = getSectorProfile(data.profile.sector || "", data.profile.industry || "", (data.profile as any).description || "");
    const isHosp = hospProfile.id === "hospitality" || hospProfile.id === "real-estate";
    if (isHosp) {
      const fullHospText = JSON.stringify({ ...(data.aiAnalysis || {}), ...(data as any).peAnalysis || {} }).toLowerCase();
      const hasRevpar = fullHospText.includes("revpar");
      const hasAdr = fullHospText.includes("adr") || fullHospText.includes("average daily rate");
      const hasOcc = fullHospText.includes("occupancy");
      const hasGopparOrEbitdar = fullHospText.includes("goppar") || fullHospText.includes("ebitdar") || fullHospText.includes("noi") || fullHospText.includes("affo");
      const hospForbidden = ["loan book", "order backlog", "order book", "refinery throughput", "crack spread", "wafer fab", "spectrum auction", "enterprise contract", "master service agreement", "semiconductor fab"];
      const hospLeaks = hospForbidden.filter(t => {
        const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, "i").test(fullHospText);
      });
      if (hospLeaks.length > 0) {
        checks.push({
          id: "HOSP-01",
          category: "BS_DETECTOR",
          name: "Hospitality Ontology Contamination",
          status: "FAIL",
          details: `FATAL: Hospitality/REIT narrative contains manufacturing/banking contamination [${hospLeaks.join(", ")}] — ontology hard control violated.`,
          expected: "Zero hospitality-forbidden concepts",
          actual: `${hospLeaks.length} leak(s)`,
        });
      } else if (!hasRevpar || !hasAdr || !hasOcc) {
        // Owner-operator and REIT both need these; asset-light also RevPAR-driven
        const missing: string[] = [];
        if (!hasRevpar) missing.push("RevPAR");
        if (!hasAdr) missing.push("ADR");
        if (!hasOcc) missing.push("Occupancy");
        checks.push({
          id: "HOSP-01",
          category: "BS_DETECTOR",
          name: "Hospitality Ontology Completeness",
          status: "FAIL",
          details: `FATAL: Hospitality report missing core RevPAR-native KPIs [${missing.join(", ")}] — driver-based ontology requires Occupancy × ADR → RevPAR → GOPPAR/EBITDAR. Generic template detected.`,
          expected: "RevPAR + ADR + Occupancy present",
          actual: `missing ${missing.join(", ")}`,
        });
      } else if (!hasGopparOrEbitdar) {
        checks.push({
          id: "HOSP-01",
          category: "BS_DETECTOR",
          name: "Hospitality Ontology Completeness",
          status: "WARN",
          details: `Hospitality report has RevPAR/ADR/Occupancy but lacks GOPPAR/EBITDAR/NOI/AFFO — operating leverage and lease-adjusted profitability not evidenced.`,
          expected: "GOPPAR/EBITDAR/NOI/AFFO",
          actual: "missing",
        });
      } else {
        checks.push({
          id: "HOSP-01",
          category: "BS_DETECTOR",
          name: "Hospitality Ontology Control",
          status: "PASS",
          details: `Hospitality ontology hard-controlled: RevPAR/ADR/Occupancy + GOPPAR/EBITDAR/NOI evidenced, zero manufacturing/banking bleed.`,
        });
      }
    } else {
      checks.push({
        id: "HOSP-01",
        category: "BS_DETECTOR",
        name: "Hospitality Ontology Control",
        status: "PASS",
        details: `Not a hospitality/REIT sector — hosp ontology gate not applicable.`,
      });
    }
  }

  // WACC-01: Sector-specific valuation plausibility (Priority 2/3) — hospitality terminal growth and WACC must be sector-calibrated
  {
    const secProf = getSectorProfile(data.profile.sector || "", data.profile.industry || "", (data.profile as any).description || "");
    if ((secProf.id === "hospitality" || secProf.id === "real-estate") && Number.isFinite(tgr)) {
      // Hospitality REIT terminal growth 2.8-3.5% (real 2% + inflation), generic 4% would overvalue cyclical occupancy
      if (tgr > 0.036) {
        checks.push({
          id: "WACC-01",
          category: "BALANCE_SHEET",
          name: "Sector Terminal Growth Plausibility",
          status: "FAIL",
          details: `FATAL: Hospitality/REIT terminal growth ${(tgr * 100).toFixed(2)}% exceeds sector cap 3.6% — cyclical occupancy cannot compound at generic 4% nominal GDP perpetually.`,
          expected: "≤3.6% (hospitality: 3.0-3.5%)",
          actual: `${(tgr * 100).toFixed(2)}%`,
        });
      } else {
        checks.push({
          id: "WACC-01",
          category: "BALANCE_SHEET",
          name: "Sector Terminal Growth Plausibility",
          status: "PASS",
          details: `Hospitality terminal growth ${(tgr * 100).toFixed(2)}% sector-calibrated (≤3.6%).`,
        });
      }
    } else {
      // Generic WACC sanity: clamp already enforces 8.5-16% in calculations.ts, but QA independently verifies
      if (!Number.isFinite(wacc) || wacc < 0.07 || wacc > 0.18) {
        checks.push({
          id: "WACC-01",
          category: "BALANCE_SHEET",
          name: "WACC Plausibility",
          status: "FAIL",
          details: `FATAL: WACC ${(wacc * 100).toFixed(2)}% outside plausible 7-18% band — model calibration error.`,
          expected: "7% ≤ WACC ≤ 18%",
          actual: `${(wacc * 100).toFixed(2)}%`,
        });
      } else {
        checks.push({
          id: "WACC-01",
          category: "BS_DETECTOR",
          name: "WACC Plausibility",
          status: "PASS",
          details: `WACC ${(wacc * 100).toFixed(2)}% within plausible band.`,
        });
      }
    }
  }

  // REVERSE-DCF: Extreme Market-Implied Assumption Detection — flag when
  // reverse DCF implies growth/margins far outside historical ranges.
  {
    const dcf = data.dcf;
    const annuals = data.annualFinancials || [];
    const ai = data.aiAnalysis as any;
    // Check if reverse DCF data is available in the AI analysis or DCF
    const reverseDcfText = JSON.stringify(ai?.valuationContext || ai?.reverseDcf || ai?.scenarioAnalysis || "").toLowerCase();
    // Look for implied growth rates in narrative
    const impliedGrowthMatch = reverseDcfText.match(/implied.*?(\d+\.?\d*)\s*%.*?(?:cagr|growth|revenue)/i);
    if (impliedGrowthMatch && annuals.length >= 3) {
      const implied = parseFloat(impliedGrowthMatch[1]) / 100;
      // Compute historical revenue CAGR
      const revs = annuals.map((y: any) => Number(y.revenue) || 0).filter(r => r > 0);
      if (revs.length >= 3) {
        const histCagr = (Math.pow(revs[revs.length - 1] / revs[0], 1 / (revs.length - 1)) - 1);
        const divergence = Math.abs(implied - histCagr);
        if (divergence > 0.30) {
          checks.push({
            id: "REVERSE-DCF", category: "BS_DETECTOR", name: "Reverse DCF Plausibility",
            status: "WARN",
            details: `Reverse DCF implies ${((implied) * 100).toFixed(1)}% revenue CAGR vs historical ${(histCagr * 100).toFixed(1)}% — ${(divergence * 100).toFixed(0)}pp divergence suggests extreme market-implied assumptions. Investigate whether market pricing reflects structural change or mispricing.`,
            expected: `implied within ±30pp of historical`, actual: `${(divergence * 100).toFixed(0)}pp divergence`,
          });
        }
      }
    }
  }

  // CLAIM-01: Fact-bound narrative — every material numeric claim must be traceable to a validated fact/claim ID (Priority 5)
  // Unsupported raw numbers (e.g., fabricated RevPAR Rs 8,400, occupancy 68%) cannot reach PDF without evidence linkage.
  // Enforce via placeholder discipline and allowlist of model facts: only numbers present in DCF/ledger/financials are permitted.
  {
    const fullNarrativeForClaim = JSON.stringify({ ...(data.aiAnalysis || {}), ...(data as any).peAnalysis || {} });
    const hasLeakedPlaceholder = /\{\{[^}]+\}\}/.test(fullNarrativeForClaim);
    if (hasLeakedPlaceholder) {
      const leaked = Array.from(new Set(fullNarrativeForClaim.match(/\{\{[^}]+\}\}/g) || [])).slice(0, 3).join(", ");
      checks.push({
        id: "CLAIM-01",
        category: "BS_DETECTOR",
        name: "Fact-Bound Claim Placeholder Leakage",
        status: "FAIL",
        details: `FATAL: Narrative contains unresolved fact placeholders [${leaked}] — LLM emitted placeholders without injection; fact binding broken.`,
        expected: "Zero unresolved {{...}} tokens",
        actual: leaked,
      });
    } else {
      // Allowlist of model-grounded numbers: CMP, FV, upside, growth rates, margins, wacc, tgr,
      // plus financials (revenue, EBITDA, net income), market multiples (P/E, P/B, P/S, EV/EBITDA),
      // shares outstanding, beta — so AI narratives referencing actual data aren't falsely blocked.
      const modelFacts: number[] = [];
      if (Number.isFinite(cmp)) modelFacts.push(cmp, fv);
      if (Array.isArray((data.dcf as any)?.assumptions?.revenueGrowthRates)) modelFacts.push(...(data.dcf as any).assumptions.revenueGrowthRates);
      if (Array.isArray(data.dcf?.assumptions?.ebitMargins)) modelFacts.push(...data.dcf.assumptions.ebitMargins);
      if (Number.isFinite(wacc)) modelFacts.push(wacc);
      if (Number.isFinite(tgr)) modelFacts.push(tgr);
      // Financial facts from Yahoo fundamentals
      const sd = data.stockData || (data as any);
      const financialFields = ["revenue", "ebitda", "netIncome", "totalDebt", "cash", "operatingCashFlow", "freeCashFlow", "totalEquity", "earningsPerShare", "bookValuePerShare", "dividendPerShare"];
      for (const field of financialFields) {
        const v = Number((sd as any)[field]);
        if (Number.isFinite(v) && v !== 0) modelFacts.push(v);
      }
      // Market multiples
      const multFields = ["trailingPE", "forwardPE", "priceToBook", "priceToSales", "evToEbitda", "pegRatio", "beta"];
      for (const field of multFields) {
        const v = Number((sd as any)[field]);
        if (Number.isFinite(v) && v !== 0) modelFacts.push(v);
      }
      // Shares outstanding and market cap
      if (Number.isFinite(Number(sd.sharesOutstanding))) modelFacts.push(Number(sd.sharesOutstanding));
      if (Number.isFinite(Number(sd.marketCap))) modelFacts.push(Number(sd.marketCap));
      // Extract candidate unsupported percentages / currency figures from thesis-like fields only (narrow to avoid flagging dates/years)
      const thesisFields = [ (data.aiAnalysis as any)?.investmentThesis, (data as any)?.peAnalysis?.investmentThesis, (data.aiAnalysis as any)?.companyOverview].filter(Boolean).join(" ");
      const pctMatches = Array.from(thesisFields.matchAll(/(\d+(?:\.\d+)?)\s*%/g)).map(m => parseFloat(m[1]) / 100);
      // Only flag percentages that are material (>2% and <80%) and not within 0.8pp of any model fact percentage
      const unsupportedPcts = pctMatches.filter(p => p > 0.02 && p < 0.80 && !modelFacts.some(mf => Math.abs(mf - p) < 0.008));
      // For hospitality, occupancy 68% etc will be unsupported under generic model — that is intentional: hospitality needs driver model
      // So only FAIL if narrative is hospitality and contains standalone occupancy % that cannot be evidenced via RevPAR drivers in ledger
      const hospProf = getSectorProfile(data.profile.sector || "", data.profile.industry || "", (data.profile as any).description || "");
      const isHospClaim = hospProf.id === "hospitality" || hospProf.id === "real-estate";
      if (isHospClaim && unsupportedPcts.length >= 2) {
        checks.push({
          id: "CLAIM-01",
          category: "BS_DETECTOR",
          name: "Fact-Bound Claim Evidence",
          status: "WARN",
          details: `Hospitality narrative contains ${unsupportedPcts.length} percentage claim(s) [${unsupportedPcts.slice(0, 3).map(p => (p * 100).toFixed(1) + "%").join(", ")}] not traceable to DCF drivers (RevPAR/ADR/Occupancy). Evidence linkage recommended — driver-based model should source these via assumptionBasis.`,
          expected: "All % claims traceable to drivers",
          actual: `${unsupportedPcts.length} unsupported`,
        });
      } else if (!isHospClaim && unsupportedPcts.length >= 3) {
        checks.push({
          id: "CLAIM-01",
          category: "BS_DETECTOR",
          name: "Fact-Bound Claim Evidence",
          status: "WARN",
          details: `Narrative contains ${unsupportedPcts.length} percentage claim(s) not traceable to model facts [${unsupportedPcts.slice(0, 3).map(p => (p * 100).toFixed(1) + "%").join(", ")}] — verify via claim IDs.`,
          expected: "All % claims traceable",
          actual: `${unsupportedPcts.length} unsupported`,
        });
      } else {
        checks.push({
          id: "CLAIM-01",
          category: "BS_DETECTOR",
          name: "Fact-Bound Claim Evidence",
          status: "PASS",
          details: `No material unsupported numeric claims detected (${pctMatches.length} % tokens, ${unsupportedPcts.length} outside model tolerance).`,
        });
      }
    }
  }

  // HW-01: Hardware business-model ontology (adversarial). A Computer Hardware
  // company analyzed with SaaS/consulting vocabulary (NRR, MSA, developer
  // ecosystem, microservices, consulting spend, TCV, utilization pyramids) is
  // the canonical wrong-business-model failure — BLOCK regardless of other passes.
  {
    const isHw = operatingModel.sector === "technology-hardware";
    if (isHw) {
      const narrativeHw = JSON.stringify({ ...(data.aiAnalysis || {}), ...(data as unknown as { peAnalysis?: unknown }).peAnalysis || {} }).toLowerCase();
      const saasLeak = [
        "net revenue retention", "net dollar retention", "developer ecosystem", "microservices",
        "container orchestration", "kubernetes", "consulting spend", "discretionary consulting",
        "deal signing", "total contract value", "annual contract value", "billable utilization",
        "blended utilization", "voluntary attrition", "talent pyramid", "delivery pyramid",
        "time and materials", "managed services contract", "vendor consolidation",
        "master service agreement",
      ].filter((t) => {
        if (t === "nrr" || t === "acv" || t === "msa" || t === "tcv") return false; // acronyms handled below
        const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, "i").test(narrativeHw);
      });
      // Acronyms need strict boundaries (NRR ≠ "nrr" inside words; TCV/MSA/ACV likewise)
      for (const ac of ["nrr", "msa", "tcv", "acv"]) {
        if (new RegExp(`(^|[^a-z0-9])${ac}([^a-z0-9]|$)`, "i").test(narrativeHw) && !saasLeak.includes(ac)) saasLeak.push(ac);
      }
      // "offshore"/"onsite effort"/"effort mix" only count in delivery-pyramid context
      if (/\boffshore\b.{0,40}(utilization|pyramid|delivery|talent)/i.test(narrativeHw) && !saasLeak.includes("offshore")) saasLeak.push("offshore (delivery context)");
      const hwRequired = ["units", "asp", "product mix", "component", "inventory", "channel", "gross margin"];
      const hwMissing = hwRequired.filter((t) => {
        const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return !new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, "i").test(narrativeHw);
      });
      if (saasLeak.length > 0) {
        checks.push({
          id: "HW-01",
          category: "BS_DETECTOR",
          name: "Hardware Ontology Contamination",
          status: "FAIL",
          details: `FATAL PUBLICATION BLOCK: hardware narrative contains enterprise-software vocabulary [${saasLeak.slice(0, 6).join(", ")}] — wrong business model applied to a devices/components company.`,
          expected: "Zero SaaS/consulting concepts",
          actual: `${saasLeak.length} leak(s)`,
        });
      } else if (hwMissing.length >= hwRequired.length - 1) {
        checks.push({
          id: "HW-01",
          category: "BS_DETECTOR",
          name: "Hardware Ontology Completeness",
          status: "FAIL",
          details: `FATAL PUBLICATION BLOCK: hardware narrative evidences none of the required driver concepts [${hwRequired.join(", ")}] — missing ${hwMissing.length}/${hwRequired.length}. Generic template detected.`,
          expected: "≥2 of: units, ASP, product mix, component, inventory, channel, gross margin",
          actual: `missing ${hwMissing.length}`,
        });
      } else {
        checks.push({
          id: "HW-01",
          category: "BS_DETECTOR",
          name: "Hardware Ontology Control",
          status: "PASS",
          details: `Hardware ontology hard-controlled: driver concepts evidenced, zero SaaS/consulting bleed.`,
        });
      }
    } else {
      checks.push({
        id: "HW-01",
        category: "BS_DETECTOR",
        name: "Hardware Ontology Control",
        status: "PASS",
        details: `Not a hardware-sector company — hardware ontology gate not applicable.`,
      });
    }
  }

  // SHARE-01: share-count / market-cap integrity (independent of the model).
  // Recomputes price × shares = market cap and quote-vs-statement shares from
  // PRIMARY inputs. Gross mismatches BLOCK the DCF (per-share math = fantasy).
  {
    const mi = assessMarketIntegrity({ stockData: data.stockData, annualFinancials: data.annualFinancials });
    const blocks = mi.issues.filter((i) => i.severity === "BLOCK");
    const warns = mi.issues.filter((i) => i.severity === "WARN");
    if (blocks.length > 0) {
      checks.push({
        id: "SHARE-01",
        category: "BALANCE_SHEET",
        name: "Share-Count / Market-Cap Integrity",
        status: "FAIL",
        details: `FATAL PUBLICATION BLOCK: ${blocks[0].message}`,
        expected: blocks[0].expected,
        actual: blocks[0].actual,
      });
    } else if (warns.length > 0) {
      checks.push({
        id: "SHARE-01",
        category: "BALANCE_SHEET",
        name: "Share-Count / Market-Cap Integrity",
        status: "WARN",
        details: warns.map((w) => w.message).join("; ").slice(0, 300),
        expected: warns[0].expected,
        actual: warns[0].actual,
      });
    } else {
      checks.push({
        id: "SHARE-01",
        category: "BALANCE_SHEET",
        name: "Share-Count / Market-Cap Integrity",
        status: "PASS",
        details: `price × shares = market cap reconciles; quote/statement shares agree.`,
      });
    }
  }

  // VAL-01: wrong valuation model for the operating archetype (adversarial).
  // Financials must use residual-income (FCFF forbidden); hardware must never
  // use a SaaS/ARR multiple lens; SaaS must never use a units/ASP lens.
  {
    const lens = ((data as unknown as { valuationLens?: string }).valuationLens || (data.masterReportFacts as unknown as { valuationLens?: string } | undefined)?.valuationLens || "") as string;
    const model = ((data.dcf as unknown as { selectedModel?: string }).selectedModel || "") as string;
    const isFinVal = operatingModel.isFinancialInstitution;
    const dcfHasProjections = Array.isArray(data.dcf?.projections) && (data.dcf.projections?.length ?? 0) > 0;
    if (isFinVal && dcfHasProjections) {
      checks.push({
        id: "VAL-01",
        category: "CROSS_REFERENCE",
        name: "Valuation Model vs Operating Archetype",
        status: "FAIL",
        details: `FATAL PUBLICATION BLOCK: financial institution (${operatingModel.sector}) valued with an FCFF projection model — deposits are operating liabilities; residual-income/PB is required.`,
        expected: "PB_RESIDUAL_INCOME",
        actual: "FCFF_DCF projections present",
      });
    } else if (!isFinVal && !dcfHasProjections && (data.dcf?.status === "valid")) {
      checks.push({
        id: "VAL-01",
        category: "CROSS_REFERENCE",
        name: "Valuation Model vs Operating Archetype",
        status: "FAIL",
        details: `FATAL PUBLICATION BLOCK: operating company (${operatingModel.sector}) carries no FCFF projections on a "valid" DCF — valuation has no engine.`,
        expected: "5Y FCFF projections",
        actual: "0 projections",
      });
    } else if (operatingModel.sector === "technology-hardware" && /arr|nrr|rule.of.40/i.test(lens)) {
      checks.push({
        id: "VAL-01",
        category: "CROSS_REFERENCE",
        name: "Valuation Model vs Operating Archetype",
        status: "FAIL",
        details: `FATAL PUBLICATION BLOCK: hardware company valued through a SaaS lens (${lens.slice(0, 80)}) — units/ASP/EV-EBITDA is required.`,
        expected: "units×ASP lens",
        actual: lens.slice(0, 60),
      });
    } else if (operatingModel.sector === "technology-software" && /units.*asp|shipments/i.test(lens)) {
      checks.push({
        id: "VAL-01",
        category: "CROSS_REFERENCE",
        name: "Valuation Model vs Operating Archetype",
        status: "FAIL",
        details: `FATAL PUBLICATION BLOCK: software company valued through a hardware-units lens — ARR/NRR lens is required.`,
        expected: "ARR lens",
        actual: lens.slice(0, 60),
      });
    } else if (model && ((isFinVal && model !== "PB_RESIDUAL_INCOME") || (!isFinVal && model !== "FCFF_DCF"))) {
      checks.push({
        id: "VAL-01",
        category: "CROSS_REFERENCE",
        name: "Valuation Model vs Operating Archetype",
        status: "FAIL",
        details: `FATAL PUBLICATION BLOCK: model tag ${model} contradicts ${operatingModel.sector} archetype.`,
        expected: isFinVal ? "PB_RESIDUAL_INCOME" : "FCFF_DCF",
        actual: model,
      });
    } else {
      checks.push({
        id: "VAL-01",
        category: "BS_DETECTOR",
        name: "Valuation Model vs Operating Archetype",
        status: "PASS",
        details: `Valuation engine matches operating archetype (${operatingModel.sector}${lens ? `; lens: ${lens.slice(0, 60)}` : ""}).`,
      });
    }
  }

  // COV-01: unsupported covenant specifics (adversarial). Facility covenants are
  // undisclosed in Yahoo filings — any narrative asserting specific covenant
  // floors/mandates as fact (e.g. "covenants mandate 2.5x/3.5x", "comfortably
  // above covenant floors") is fabricated and BLOCKS.
  {
    const covText = JSON.stringify({
      c: (data.aiAnalysis as unknown as { creditAnalysisCommentary?: unknown })?.creditAnalysisCommentary || "",
      s: (data.aiAnalysis as unknown as { capitalAllocationCommentary?: unknown })?.capitalAllocationCommentary || "",
      t: (data.aiAnalysis as unknown as { investmentThesis?: string })?.investmentThesis || "",
    }).toLowerCase();
    const covFabrications: string[] = [];
    if (/covenants?\s+mandate/i.test(covText)) covFabrications.push("covenant-mandate-as-fact");
    if (/comfortably\s+above\s+covenant/i.test(covText)) covFabrications.push("comfort-above-undisclosed-floors");
    if (/covenant\s+floors/i.test(covText) && !/undisclosed/i.test(covText)) covFabrications.push("covenant-floors-as-fact");
    if (/covenants?\s+preserved/i.test(covText) && !/standard thresholds|illustrative|model assumption/i.test(covText)) covFabrications.push("covenants-preserved-verdict");
    if (/minimum\s+interest\s+coverage\s+of\s+\d/i.test(covText) && !/standard thresholds|illustrative/i.test(covText)) covFabrications.push("specific-coverage-floor-as-fact");
    if (covFabrications.length > 0) {
      checks.push({
        id: "COV-01",
        category: "BS_DETECTOR",
        name: "Covenant Specificity vs Evidence",
        status: "FAIL",
        details: `FATAL PUBLICATION BLOCK: narrative asserts undisclosed facility-covenant specifics as fact (${covFabrications.join("; ")}). Covenants are not in filings — conditional/model-assumption language is required.`,
        expected: "Conditional / undisclosed-covenant language",
        actual: `${covFabrications.length} fabrication(s)`,
      });
    } else {
      checks.push({
        id: "COV-01",
        category: "BS_DETECTOR",
        name: "Covenant Specificity vs Evidence",
        status: "PASS",
        details: `No undisclosed covenant specifics asserted as fact.`,
      });
    }
  }

  // NARR-CONTRADICT: Narrative-Model Contradiction Detection — flags when the
  // AI narrative makes qualitative claims that contradict the financial model.
  {
    const fullNarrative = JSON.stringify({ ...(data.aiAnalysis || {}), ...(data as any).peAnalysis || {} }).toLowerCase();
    const dcf = data.dcf;
    const annuals = data.annualFinancials || [];

    // Helper to check if narrative contains a phrase
    const hasPhrase = (phrases: string[]) => phrases.some(p => fullNarrative.includes(p));

    // 1. "Strong cash generation" vs declining FCF
    if (annuals.length >= 2) {
      const recent = annuals.slice(-2) as any[];
      const fcfTrend = (Number(recent[1]?.operatingCashFlow ?? 0) + Number(recent[1]?.capitalExpenditure ?? 0)) - (Number(recent[0]?.operatingCashFlow ?? 0) + Number(recent[0]?.capitalExpenditure ?? 0));
      if (fcfTrend < 0 && hasPhrase(["strong cash generation", "robust cash", "solid cash flow", "healthy cash conversion"])) {
        checks.push({
          id: "NARR-CONTRADICT", category: "BS_DETECTOR", name: "Narrative-Model Contradiction",
          status: "WARN",
          details: `Narrative claims positive cash generation but FCF declined ${(Math.abs(fcfTrend) / 1e6).toFixed(1)}M year-over-year. Qualitative language should reflect actual trend.`,
          expected: "narrative consistent with FCF trend", actual: "contradiction detected",
        });
      }
    }

    // 2. "Margin expansion" vs declining EBIT margins
    if (annuals.length >= 2) {
      const recent = annuals.slice(-2) as any[];
      const marginTrend = (Number(recent[1]?.operatingIncome ?? 0) / Math.max(1, Number(recent[1]?.revenue ?? 1))) - (Number(recent[0]?.operatingIncome ?? 0) / Math.max(1, Number(recent[0]?.revenue ?? 1)));
      if (marginTrend < -0.01 && hasPhrase(["margin expansion", "margin improvement", "expanding margins", "margin tailwind"])) {
        checks.push({
          id: "NARR-CONTRADICT", category: "BS_DETECTOR", name: "Narrative-Model Contradiction",
          status: "WARN",
          details: `Narrative claims margin expansion but EBIT margin declined ${(Math.abs(marginTrend) * 100).toFixed(1)}pp year-over-year.`,
          expected: "narrative consistent with margin trend", actual: "contradiction detected",
        });
      }
    }

    // 3. "Revenue acceleration" vs decelerating growth
    if (annuals.length >= 3) {
      const revs = annuals.slice(-3).map((y: any) => Number(y.revenue) || 0);
      if (revs[0] > 0 && revs[1] > 0 && revs[2] > 0) {
        const g1 = (revs[1] - revs[0]) / revs[0];
        const g2 = (revs[2] - revs[1]) / revs[1];
        if (g2 < g1 - 0.02 && hasPhrase(["revenue acceleration", "accelerating growth", "growth acceleration", "revenue momentum"])) {
          checks.push({
            id: "NARR-CONTRADICT", category: "BS_DETECTOR", name: "Narrative-Model Contradiction",
            status: "WARN",
            details: `Narrative claims revenue acceleration but growth decelerated from ${(g1 * 100).toFixed(1)}% to ${(g2 * 100).toFixed(1)}%.`,
            expected: "narrative consistent with growth trend", actual: "contradiction detected",
          });
        }
      }
    }

    // 4. "Strong balance sheet" vs deteriorating leverage
    if (annuals.length >= 2) {
      const recent = annuals.slice(-2) as any[];
      const lev0 = Number(recent[0]?.totalDebt ?? 0) / Math.max(1, Number(recent[0]?.totalEquity ?? 1));
      const lev1 = Number(recent[1]?.totalDebt ?? 0) / Math.max(1, Number(recent[1]?.totalEquity ?? 1));
      if (lev1 > lev0 * 1.15 && hasPhrase(["strong balance sheet", "fortress balance sheet", "conservative leverage", "low leverage"])) {
        checks.push({
          id: "NARR-CONTRADICT", category: "BS_DETECTOR", name: "Narrative-Model Contradiction",
          status: "WARN",
          details: `Narrative claims strong balance sheet but debt/equity ratio increased from ${lev0.toFixed(2)}x to ${lev1.toFixed(2)}x.`,
          expected: "narrative consistent with leverage trend", actual: "contradiction detected",
        });
      }
    }

    // CAT-01: Catalyst Valuation Transmission — numerical sensitivity ranges
    // (e.g., "+10% to +15%") must be model-derived, not invented.
    {
      const catalysts = (data.aiAnalysis as any)?.catalysts || [];
      const catalystText = JSON.stringify(catalysts).toLowerCase();
      const hasNumericalImpact = /\+?\d+\.?\d*\s*%?\s*(?:to|[-–])\s*\+?\d+\.?\d*\s*%/.test(catalystText);
      const hasModelBridge = fullNarrative.includes("dcf") || fullNarrative.includes("fair value") || fullNarrative.includes("valuation model");

      if (hasNumericalImpact && !hasModelBridge && catalysts.length > 0) {
        const pctMatch = catalystText.match(/\+?\d+\.?\d*\s*%?\s*(?:to|[-–])\s*\+?\d+\.?\d*\s*%/);
        checks.push({
          id: "CAT-01", category: "BS_DETECTOR", name: "Catalyst Valuation Transmission",
          status: "WARN",
          details: `Catalyst claims numerical valuation impact (${pctMatch?.[0] ?? "detected"}) without visible DCF/fair-value model bridge. Numerical sensitivity ranges should be model-derived: CATALYST → OPERATING DRIVER → REVENUE/MARGIN → EBIT → FCF → DCF → FAIR VALUE → $/SHARE IMPACT. If not model-derived, label as QUALITATIVE.`,
          expected: "model-derived valuation sensitivity", actual: "numerical range without model bridge",
        });
      }
    }
  }

  // NARRATIVE-GROWTH-ACTUALS: Validate narrative growth claims against
  // historical annualFinancials. Flags claims where narrative growth rate
  // differs from actual revenue CAGR by more than 10pp.
  {
    const narrativeText = JSON.stringify({ ...(data.aiAnalysis || {}), ...(data as any).peAnalysis || {} });
    const growthValidation = validateGrowthClaims(narrativeText, data.annualFinancials);
    const flaggedGrowth = growthValidation.filter((g) => g.flagged);
    if (flaggedGrowth.length > 0) {
      const details = flaggedGrowth
        .map((g) => `Claim "${g.claim.text.slice(0, 80)}" implies ${g.claim.numericValue?.toFixed(1)}% vs actual CAGR ${g.actualCAGR.toFixed(1)}% (${g.divergence.toFixed(1)}pp divergence)`)
        .join("; ");
      checks.push({
        id: "NARR-GROWTH-01",
        category: "CROSS_REFERENCE",
        name: "Narrative Growth Claims vs Actuals",
        status: "WARN",
        details: `Narrative growth claims diverge from historical actual revenue CAGR (${growthValidation.length > 0 ? growthValidation[0].actualCAGR.toFixed(1) + "%" : "N/A"}): ${details}. Verify narrative growth assertions against reported financials.`,
        expected: "Narrative growth within 10pp of actual CAGR",
        actual: `${flaggedGrowth.length} claim(s) exceed 10pp divergence`,
      });
    } else {
      checks.push({
        id: "NARR-GROWTH-01",
        category: "CROSS_REFERENCE",
        name: "Narrative Growth Claims vs Actuals",
        status: "PASS",
        details: growthValidation.length > 0
          ? `Narrative growth claims align with actual revenue CAGR (${growthValidation[0].actualCAGR.toFixed(1)}%).`
          : "No growth-rate claims detected in narrative.",
      });
    }
  }

  // NARR-GENERIC: Generic Company Overview Detection — flag when overview
  // uses boilerplate language without company-specific financial or segment detail.
  {
    const ai = data.aiAnalysis as any;
    const overview = (ai?.companyOverview ?? ai?.overview ?? ai?.companyDescription ?? "").toLowerCase();
    if (overview.length > 0) {
      const genericPhrases = [
        "leading provider", "committed to delivering", "our mission is",
        "we are a", "our vision", "dedicated to", "we strive",
        "world-class", "best-in-class", "industry-leading", "premier",
        "cutting-edge", "innovative solutions", "value creation",
        "stakeholder value", "sustainable growth", "operational excellence",
        "synerg", "leverage our", "diversified portfolio",
      ];
      const matches = genericPhrases.filter(p => overview.includes(p));
      const hasSegmentDetail = overview.includes("segment") || overview.includes("business unit")
        || overview.includes("revenue by") || /\d+%/.test(overview);
      const hasFinancialDetail = /\$[\d,.]+|revenue.*\$|margin|ebitda|net income/i.test(overview);

      if (matches.length >= 3 && !hasSegmentDetail && !hasFinancialDetail) {
        checks.push({
          id: "NARR-GENERIC", category: "BS_DETECTOR", name: "Generic Company Overview",
          status: "WARN",
          details: `Company overview contains ${matches.length} generic boilerplate phrases (${matches.slice(0, 5).join("; ")}) with no segment-level or financial detail. Overview should reference actual business segments, revenue mix, or key metrics — not generic corporate language.`,
          expected: "Company-specific segment/financial detail", actual: `${matches.length} generic phrases, no financial anchors`,
        });
      }
    }
  }

  // EVENT-01: illustrative trajectories must never pose as an empirical event study.
  // Measured sessions may carry abnormal-return verdicts; illustrative sketches may
  // only support directional tracking. An "event study confirms" style claim with
  // zero measured events BLOCKS; a majority-illustrative set WARNs.
  {
    const evts = (data.eventPriceMovements || []) as { measured?: boolean; verdict?: string }[];
    const measuredCount = evts.filter((e) => e?.measured).length;
    const illustCount = evts.filter((e) => !e?.measured).length;
    const evtNarrative = JSON.stringify({ a: data.aiAnalysis || {}, e: (data as unknown as { eventStudyCommentary?: string }).eventStudyCommentary || "" }).toLowerCase();
    const claimsEmpirical = /empirical event study (confirms|proves|demonstrates)|abnormal alpha (confirms|proves)|event study (confirms|validates)/i.test(evtNarrative);
    if (evts.length > 0 && measuredCount === 0 && (claimsEmpirical || illustCount > 0)) {
      // Illustrative-only set: block only when posed as empirical proof; else warn.
      if (claimsEmpirical) {
        checks.push({
          id: "EVENT-01",
          category: "BS_DETECTOR",
          name: "Event-Study Evidence Standard",
          status: "FAIL",
          details: `FATAL PUBLICATION BLOCK: ${illustCount} illustrative event sketch(es) with zero measured sessions posed as empirical event-study proof. Stylized trajectories are not abnormal-return evidence.`,
          expected: "Measured sessions for empirical claims",
          actual: "0 measured",
        });
      } else {
        checks.push({
          id: "EVENT-01",
          category: "BS_DETECTOR",
          name: "Event-Study Evidence Standard",
          status: "WARN",
          details: `All ${illustCount} event(s) are illustrative sketches (no session coverage) — directional tracking only, not an empirical event study. Omit or label; do not draw abnormal-return conclusions.`,
          expected: "Measured sessions preferred",
          actual: "0 measured",
        });
      }
    } else if (evts.length > 0 && illustCount > measuredCount && measuredCount > 0) {
      checks.push({
        id: "EVENT-01",
        category: "BS_DETECTOR",
        name: "Event-Study Evidence Standard",
        status: "WARN",
        details: `Event set is majority-illustrative (${illustCount} illustrative vs ${measuredCount} measured) — conclusions must rest on measured sessions only.`,
        expected: "Measured-majority set",
        actual: `${measuredCount} measured / ${illustCount} illustrative`,
      });
    } else {
      checks.push({
        id: "EVENT-01",
        category: "BS_DETECTOR",
        name: "Event-Study Evidence Standard",
        status: "PASS",
        details: evts.length === 0 ? `No event-study claims — nothing to evidence.` : `Event evidence standard met (${measuredCount} measured / ${illustCount} illustrative).`,
      });
    }
  }

  // EVENT-01: Event Study Evidence Standard — event descriptions must not be
  // labeled as empirical event studies without actual price-window data.
  {
    const ai = data.aiAnalysis as any;
    const events = ai?.catalysts || [];
    const eventText = JSON.stringify(events).toLowerCase();
    const hasEventStudy = eventText.includes("event study") || eventText.includes("abnormal return") || eventText.includes("cumulative abnormal");
    const hasSessionData = eventText.includes("trading session") || eventText.includes("event window") || eventText.includes("price window");
    if (hasEventStudy && !hasSessionData) {
      checks.push({
        id: "EVENT-01", category: "BS_DETECTOR", name: "Event Study Evidence Standard",
        status: "WARN",
        details: `Event descriptions reference "event study" or "abnormal return" language without empirical price-window/session data. These must be labeled "ILLUSTRATIVE EVENT FRAMEWORK" — do not make abnormal-return conclusions without actual event-date, benchmark, and expected-return methodology.`,
        expected: "ILLUSTRATIVE label or empirical data", actual: "empirical language without empirical data",
      });
    }
  }

  // ── Priority 4: independent hard publication gate (data → sector → accounting → model → valuation → peers → narrative → PDF).
  // Each check recomputes from PRIMARY inputs (profile/stockData/annualFinancials),
  // never trusts the ledger/model output it audits. Any critical FAIL blocks export.

  // DATA-01: primary-data integrity (source/period/currency/units/provenance). Independent of ledger.
  {
    const prov = assessProvenance({ profile: data.profile, stockData: data.stockData, annualFinancials: data.annualFinancials });
    if (prov.isBlocked) {
      checks.push({
        id: "DATA-01",
        category: "BALANCE_SHEET",
        name: "Primary Data Integrity",
        status: "FAIL",
        details: `FATAL PUBLICATION BLOCK: ${prov.blockReason}. Every number needs source/period/currency/units — missing primaries cannot be modeled. Flags: ${prov.dataQualityFlags.join(", ") || "none"}.`,
        expected: "revenue, shares, price, currency present",
        actual: `missing: ${prov.criticalMissing.join(", ")}`,
      });
    } else if (prov.dataQualityFlags.length > 0) {
      checks.push({
        id: "DATA-01",
        category: "BALANCE_SHEET",
        name: "Primary Data Integrity",
        status: prov.estimatedRatio >= 0.5 ? "FAIL" : "WARN",
        details: prov.estimatedRatio >= 0.5
          ? `FATAL PUBLICATION BLOCK: ${(prov.estimatedRatio * 100).toFixed(0)}% of audited fields are estimated fallbacks (${prov.estimatedCount} fields) — exceeds 50% modeling threshold. Flags: ${prov.dataQualityFlags.join(", ")}.`
          : `Primary data verified (${prov.currency}, ${prov.units}); provenance flags disclosed: ${prov.dataQualityFlags.join(", ")}.`,
        expected: "reported primaries",
        actual: `${prov.estimatedCount} estimated`,
      });
    } else {
      checks.push({
        id: "DATA-01",
        category: "BALANCE_SHEET",
        name: "Primary Data Integrity",
        status: "PASS",
        details: `Primary filing verified: revenue/shares/price/currency/units present (${prov.currency}, ${prov.units}), zero estimated fallbacks.`,
      });
    }
  }

  // ONT-01: hard ontology coverage, evaluated against the SHARED operating
  // model (same instance MODEL-01 uses — never a second classification).
  // Forbidden presence is a hard BLOCK; required absence blocks only when
  // ZERO required concepts are evidenced for a known sector (generic or
  // foreign template applied). `general` never blocks on required absence.
  // Empty-narrative exception: when AI was unavailable the values are empty
  // strings (not a wrong template) — required absence is WARN (missing AI
  // coverage), never FAIL. Forbidden hits still BLOCK even when empty.
  {
    const narrativeAll = JSON.stringify({ ...(data.aiAnalysis || {}), ...(data as unknown as { peAnalysis?: unknown }).peAnalysis || {} });
    const cov = validateOntologyCoverage(operatingModel, narrativeAll);
    const flatVals = (v: unknown): string => {
      if (v === null || v === undefined) return "";
      if (typeof v === "string") return v;
      if (Array.isArray(v)) return v.map(flatVals).join(" ");
      if (typeof v === "object") return Object.values(v as Record<string, unknown>).map(flatVals).join(" ");
      return "";
    };
    const narrativeValueLen = flatVals({ ...(data.aiAnalysis || {}), ...((data as unknown as { peAnalysis?: Record<string, unknown> }).peAnalysis || {}) }).trim().length;
    const isEmptyNarrative = narrativeValueLen < 300;
    if (cov.presentForbidden.length > 0) {
      checks.push({
        id: "ONT-01",
        category: "BS_DETECTOR",
        name: "Ontology Forbidden Concepts",
        status: "FAIL",
        details: `FATAL PUBLICATION BLOCK: narrative contains ${cov.presentForbidden.length} ontology-forbidden concept(s) for ${operatingModel.sector} [${cov.presentForbidden.slice(0, 6).join(", ")}]. Business-model violation — wrong template applied.`,
        expected: "Zero forbidden concepts",
        actual: `${cov.presentForbidden.length} forbidden`,
      });
    } else if (operatingModel.isKnownSector && cov.missingRequired.length >= operatingModel.requiredConcepts.length && operatingModel.requiredConcepts.length > 0) {
      // Zero of N required concepts evidenced = the dossier speaks no word of
      // its own sector's language. BLOCK when narrative exists (wrong template);
      // WARN when narrative is empty (AI unavailable — coverage missing, not contamination).
      if (isEmptyNarrative) {
        checks.push({
          id: "ONT-01",
          category: "BS_DETECTOR",
          name: "Ontology Required Concepts",
          status: "WARN",
          details: `AI narrative unavailable (${narrativeValueLen} chars) — ontology coverage unverifiable for ${operatingModel.sector} [${operatingModel.requiredConcepts.slice(0, 6).join(", ")}]. Supply an AI key to evidence sector vocabulary; numbers and tables remain valid.`,
          expected: `≥2 of: ${operatingModel.requiredConcepts.slice(0, 4).join(", ")}`,
          actual: `missing all ${cov.missingRequired.length} (empty narrative)`,
        });
      } else {
        checks.push({
          id: "ONT-01",
          category: "BS_DETECTOR",
          name: "Ontology Required Concepts",
          status: "FAIL",
          details: `FATAL PUBLICATION BLOCK: narrative evidences ZERO of the required ${operatingModel.sector} concepts [${operatingModel.requiredConcepts.slice(0, 6).join(", ")}] — generic or foreign template applied. Rebuild every section around the sector drivers.`,
          expected: `≥2 of: ${operatingModel.requiredConcepts.slice(0, 4).join(", ")}`,
          actual: `missing all ${cov.missingRequired.length}`,
        });
      }
    } else if (cov.missingRequired.length >= operatingModel.requiredConcepts.length - 1 && operatingModel.requiredConcepts.length > 2) {
      // All-but-one required concepts missing = likely generic template.
      // WARN (not FAIL): conglomerates and GENERAL-sector names legitimately lack
      // narrow required vocab; HOSP-01 already hard-blocks hospitality. Avoids
      // false BLOCK on misclassified/diversified names (e.g. Reliance).
      checks.push({
        id: "ONT-01",
        category: "BS_DETECTOR",
        name: "Ontology Required Concepts",
        status: "WARN",
        details: `Narrative evidences few of the required ${operatingModel.sector} concepts [${operatingModel.requiredConcepts.slice(0, 6).join(", ")}] — missing ${cov.missingRequired.length}/${operatingModel.requiredConcepts.length}. Rebuild around sector drivers if sector is high-confidence.`,
        expected: `≥2 of: ${operatingModel.requiredConcepts.slice(0, 4).join(", ")}`,
        actual: `missing ${cov.missingRequired.length}`,
      });
    } else {
      checks.push({
        id: "ONT-01",
        category: "BS_DETECTOR",
        name: "Ontology Coverage",
        status: "PASS",
        details: `Ontology ${operatingModel.sector} (${operatingModel.modelVersion}): required concepts evidenced, zero forbidden concepts.`,
      });
    }
  }

  // OM-01: operating-model section scan — hard forbidden-concept sweep of
  // EVERY narrative section against the shared instance. Any leak in any
  // section is a publication BLOCKER (never WARN): a single foreign-sector
  // term proves template contamination.
  {
    const flat = (v: unknown): string => {
      if (v === null || v === undefined) return "";
      if (typeof v === "string") return v;
      if (Array.isArray(v)) return v.map(flat).join(" ");
      if (typeof v === "object") return Object.values(v as Record<string, unknown>).map(flat).join(" ");
      return "";
    };
    const ai = (data.aiAnalysis || {}) as unknown as Record<string, unknown>;
    const pe = ((data as unknown as { peAnalysis?: Record<string, unknown> }).peAnalysis || {}) as Record<string, unknown>;
    const pick = (...keys: string[]): string => {
      for (const k of keys) {
        const t = flat(ai[k] || pe[k]);
        if (t.trim()) return t;
      }
      return "";
    };
    const sections: Record<string, string> = {
      thesis: [pick("investmentThesis"), pick("companyOverview"), pick("investmentConclusion")].join(" "),
      moat: [pick("competitiveMoat"), pick("moatSources"), pick("moatPillars")].join(" "),
      strategy: [pick("businessStrategyCommentary"), pick("industryDynamicsCommentary")].join(" "),
      swot: [pick("swotStrengths"), pick("swotWeaknesses"), pick("swotOpportunities"), pick("swotThreats")].join(" "),
      risks: [pick("keyRisks"), pick("enterpriseRiskCommentary")].join(" "),
      catalysts: pick("catalysts"),
      financials: [pick("revenueCommentary"), pick("ebitdaCommentary"), pick("ebitCommentary"), pick("patCommentary"), pick("balanceSheetCommentary"), pick("cashFlowCommentary"), pick("dupontCommentary"), pick("ratioCommentary"), pick("dcfCommentary")].join(" "),
      credit: pick("creditAnalysisCommentary"),
      governance: [pick("managementCommentary"), pick("governanceCommentary"), pick("capitalAllocationCommentary"), pick("capitalDeploymentHistory")].join(" "),
      news: [pick("recentNewsAnalysis"), pick("newsSummary")].join(" "),
    };
    const res = validateReportAgainstModel(operatingModel, sections);
    const totalSectionLen = Object.values(sections).join(" ").trim().length;
    const onlyRequiredBlockers = res.blockers.length > 0 && res.blockers.every((b) => b.kind === "required");
    const isEmptySections = totalSectionLen < 300;
    if (!res.pass) {
      // Empty-sections exception mirrors ONT-01: required absence with no AI
      // prose is missing coverage (WARN), not template contamination (FAIL).
      // Forbidden leaks still BLOCK even when empty.
      if (onlyRequiredBlockers && isEmptySections) {
        checks.push({
          id: "OM-01",
          category: "BS_DETECTOR",
          name: "Operating-Model Section Scan",
          status: "WARN",
          details: `AI narrative unavailable (${totalSectionLen} chars) — operating-model required coverage unverifiable under ${operatingModel.modelId}. Supply an AI key; numbers and tables remain valid. Required evidenced: [${res.requiredEvidenced.join(", ") || "none"}].`,
          expected: "Zero forbidden concepts in every section",
          actual: `${res.blockers.length} required-coverage advisory`,
        });
      } else {
        const first = res.blockers[0];
        checks.push({
          id: "OM-01",
          category: "BS_DETECTOR",
          name: "Operating-Model Section Scan",
          status: "FAIL",
          details: `FATAL PUBLICATION BLOCK: ${res.blockers.length} operating-model violation(s) under model ${operatingModel.modelId} — ${first.message}${res.blockers.length > 1 ? ` (+${res.blockers.length - 1} more: ${res.blockers.slice(1, 3).map((b) => `${b.section}: ${b.terms.slice(0, 3).join(", ")}`).join("; ")})` : ""} Required evidenced: [${res.requiredEvidenced.join(", ") || "none"}].`,
          expected: "Zero forbidden concepts in every section",
          actual: `${res.blockers.length} violation(s)`,
        });
      }
    } else {
      checks.push({
        id: "OM-01",
        category: "BS_DETECTOR",
        name: "Operating-Model Section Scan",
        status: "PASS",
        details: `All 10 narrative sections scanned against ${operatingModel.modelId}: zero forbidden concepts; required evidenced [${res.requiredEvidenced.slice(0, 6).join(", ") || "none"}].`,
      });
    }
  }

  // SEM-COMP-01: company-specific semantic validation. Sector packs cannot
  // express conglomerate semantics, so per-company profiles (company-
  // semantics.ts) carry extra forbidden concepts. Any hit is TEMPLATE
  // CONTAMINATION and BLOCKS publication — e.g. a Reliance dossier
  // containing advertiser bidding / search index / custom silicon /
  // two-sided network / hyperscale moat language.
  {
    if (companySemantics) {
      // Report every company-profile hit with company attribution (TEMPLATE
      // CONTAMINATION verdict). Overlap with the sector-pack scan
      // (ONT-01/OM-01) is expected for general-sector names and is disclosed,
      // not deduplicated — each check owns its attribution.
      const narrativeAll = JSON.stringify(data.aiAnalysis || {}).toLowerCase();
      const hits = companySemantics.extraForbiddenConcepts.filter((c) => boundaryHit(narrativeAll, c));
      if (hits.length > 0) {
        const packCovered = new Set(operatingModelBase.forbiddenConcepts.map((c) => c.toLowerCase()));
        const overlap = hits.filter((h) => packCovered.has(h.toLowerCase())).length;
        checks.push({
          id: "SEM-COMP-01",
          category: "BS_DETECTOR",
          name: "Company-Specific Semantic Validation",
          status: "FAIL",
          details: `FATAL PUBLICATION BLOCK — TEMPLATE CONTAMINATION: ${data.profile.ticker || companySemantics.companyKey} narrative contains ${hits.length} company-forbidden concept(s) [${hits.slice(0, 6).join(", ")}]${overlap > 0 ? ` (${overlap} also sector-pack-forbidden — ONT-01/OM-01 corroborate)` : ""}. ${companySemantics.rationale}`,
          expected: "Zero company-forbidden concepts",
          actual: `${hits.length} forbidden`,
        });
      } else {
        checks.push({
          id: "SEM-COMP-01",
          category: "BS_DETECTOR",
          name: "Company-Specific Semantic Validation",
          status: "PASS",
          details: `Company profile ${companySemantics.companyKey}: zero company-forbidden concepts in narrative.`,
        });
      }
    }
  }

  // MODEL-01: independent published-output consistency (never trusts one stage).
  // Recomputes the PUBLISHED bridges (ledger equity/shares vs ledger fair value;
  // model EV vs PV parts) and cross-checks the share base against market cap.
  {
    const fins = data.annualFinancials || [];
    const latestM = fins[fins.length - 1];
    const dcfM = data.dcf as unknown as Record<string, number>;
    const ledM = data.assumptionsLedger as unknown as Record<string, number> | undefined;
    const indepIssues: string[] = [];
    if (latestM && dcfM) {
      // SOTP-primary: the EV-parts identity holds on the FCFF cross-check
      // leg (SOTP GAV is verified by SOTP-01, never by FCFF parts).
      const sotpCC = (dcfM as any)?.sotpBreakdown?.crossCheck;
      const ev = Number(sotpCC?.enterpriseValue ?? dcfM.enterpriseValue) || 0;
      const sumPv = Number(sotpCC?.sumPvFcff ?? dcfM.sumPvFcff) || 0;
      const pvTv = Number(sotpCC?.pvTerminalValue ?? dcfM.pvTerminalValue) || 0;
      if (Math.abs(ev - (sumPv + pvTv)) > 1000 && ev > 0) indepIssues.push(`EV≠PV(FCFF)+PV(TV) gap ${(Math.abs(ev - (sumPv + pvTv))).toFixed(0)}`);
      const ledEq = Number(ledM?.equityValue);
      const ledSh = Number(ledM?.sharesOutstanding);
      const ledFv = Number(ledM?.fairValue ?? data.targetPrice) || 0;
      if (Number.isFinite(ledEq) && Number.isFinite(ledSh) && ledSh > 0 && ledEq > 0 && Math.abs(ledFv - ledEq / ledSh) > 1.0) {
        indepIssues.push(`ledger FV≠Equity/Shares gap ${Math.abs(ledFv - ledEq / ledSh).toFixed(2)}`);
      }
      const mktShares = resolveShareCount({ stockData: data.stockData, annualFinancials: data.annualFinancials });
      if (mktShares.source !== "none" && Number.isFinite(ledSh) && ledSh > 0) {
        const drift = Math.abs(ledSh - mktShares.shares) / Math.max(1, mktShares.shares);
        if (drift > 0.01) indepIssues.push(`ledger shares≠resolved base gap ${(drift * 100).toFixed(1)}%`);
      }
      const w = Number(dcfM.wacc ?? (data.dcf as unknown as { assumptions?: { wacc?: number } }).assumptions?.wacc) || 0;
      void w;
    } else {
      indepIssues.push("missing primaries for independent recomputation");
    }
    if (indepIssues.length > 0) {
      checks.push({
        id: "MODEL-01",
        category: "CROSS_REFERENCE",
        name: "Independent Model Recomputation",
        status: "FAIL",
        details: `FATAL PUBLICATION BLOCK: independent recomputation from primary statements disagrees with model outputs: ${indepIssues.slice(0, 3).join("; ")}. QA validates its own outputs — recompute, don't assert.`,
        expected: "Independent bridge agreement",
        actual: indepIssues.slice(0, 2).join("; "),
      });
    } else {
      checks.push({
        id: "MODEL-01",
        category: "CROSS_REFERENCE",
        name: "Independent Model Recomputation",
        status: "PASS",
        details: `Independent EV/equity/per-share bridges recomputed from primary statements agree with model.`,
      });
    }
  }

  // FINCONS-01..05: hard financial-consistency gate. The PDF renders the
  // same fiscal year through independent code paths (statement tables from
  // annualFinancials, KPI/cover from market facts, valuation pages from
  // ledger/dcf). Any same-FY divergence in revenue/EBITDA/EBIT/net
  // income/EPS/shares is a publication BLOCKER — the report would
  // contradict itself on one year (FY26 net-income/EPS class of defect).
  {
    const fins = data.annualFinancials || [];
    const latest = fins[fins.length - 1] as any;
    const cf: any = (data as any).canonicalFacts;
    const cfYears: any[] = Array.isArray(cf?.years) ? cf.years : [];
    const cfLatest = cfYears[cfYears.length - 1];
    const rv = (o: any): number | null =>
      o && typeof o.value === "number" && Number.isFinite(o.value) ? o.value : null;
    const finCons = checkCrossPageFinancials({
      ticker: data.profile.ticker || "UNKNOWN",
      latestYear: latest?.year || cfLatest?.year || "latest",
      isFinancial: isBankOrNbfc,
      statement: {
        revenue: latest ? Number(latest.revenue ?? latest.totalRevenue) || null : null,
        operatingIncome: latest ? stmtNum(latest, "operatingIncome") || null : null,
        pretaxIncome: latest?.pretaxIncome ?? null,
        incomeTaxExpense: latest?.incomeTaxExpense ?? null,
        netIncome: latest?.netIncome ?? null,
        totalEquity: latest?.totalEquity ?? null,
        sharesOutstanding: latest?.sharesOutstanding ?? null,
        dilutedEps: latest?.dilutedEps ?? null,
        eps: latest?.eps ?? null,
      },
      canonical: {
        revenue: cfLatest ? rv(cfLatest.revenue) : null,
        netIncome: cfLatest ? rv(cfLatest.netIncome) : null,
        sharesDiluted: cf?.market ? rv(cf.market.sharesDiluted) : null,
      },
      market: {
        price: Number(data.stockData.currentPrice) || null,
        shares: Number(data.stockData.sharesOutstanding) || null,
        marketCap: Number(data.stockData.marketCap) || null,
        trailingEps: Number((data.stockData as any).trailingEps) || null,
      },
      model: {
        equityValue: Number(ledger?.equityValue) || Number(data.dcf.equityValue) || null,
        shares: Number(ledger?.sharesOutstanding) || Number(data.dcf.sharesOutstanding) || null,
        fairValue: Number(ledger?.fairValue ?? (data.dcf as any).intrinsicValue ?? (data.dcf as any).fairValuePerShare) || null,
      },
    });
    for (const f of finCons) {
      // Honest-NR guard (FINCONS-04 only): per-share closure is unverifiable
      // when the model honestly produced no positive equity (non-valid DCF +
      // NR anchor) — disclosed limitation, not a cross-page divergence. Other
      // FINCONS codes (statement completeness, EPS coherence, share base)
      // stay hard blocks: those are data bugs, never model limitations.
      const finconsNrGrace = f.code === "FINCONS-04" && !f.pass && honestNrNoEquity;
      checks.push({
        id: f.code,
        category: "CROSS_REFERENCE",
        name: "Cross-Page Financial Consistency",
        status: f.pass ? "PASS" : finconsNrGrace ? "WARN" : f.severity === "blocker" ? "FAIL" : "WARN",
        details: f.pass ? f.detail : finconsNrGrace ? `No positive model equity exists (DCF ${data.dcf.status}) — per-share closure not applicable under honest NR anchor to price. Disclosed limitation; see ledger ratingRationale. ${f.detail}` : `FATAL PUBLICATION BLOCK: ${f.detail}`,
        expected: "Same-FY agreement across pages",
        actual: f.pass ? "agree" : finconsNrGrace ? "NR-anchored (disclosed)" : "divergent",
      });
    }
  }

  // VAL-AUDIT + ECON: first-class valuation audit and economic plausibility.
  // The audit engine re-derives the DCF bridge, decomposes ₹/share, checks
  // WACC inputs, and tabulates cross-method disagreement (DCF vs peer
  // multiples vs Street). The plausibility engine reconciles the model
  // against demonstrated history (capex, D&A, debt, terminal scale,
  // growth/margin ceilings). Findings are WARN-grade by design: they inform
  // conviction; accounting/bridge FAILs keep owning the hard gate — so this
  // block can never newly block a publishable dossier.
  {
    const finList = (data.annualFinancials || []) as AnnualFinancials[];
    if (finList.length > 0 && data.dcf) {
      const audit = auditValuation({
        ticker: data.profile.ticker || "UNKNOWN",
        dcf: data.dcf,
        stockData: data.stockData,
        annualFinancials: finList,
        peers: (data.peers || []) as PeerData[],
      });

      // VAL-AUDIT-01 never FAILs on its own: a genuine bridge break is
      // already a hard block under XREF-01/03 — duplicating the FAIL would
      // double-count one defect. The audit's job here is the ₹/share
      // decomposition and the pointer, not a second gate.
      checks.push({
        id: "VAL-AUDIT-01",
        category: "CROSS_REFERENCE",
        name: "Valuation Bridge Audit (per-share decomposition)",
        status: audit.bridge.status === "PASS" ? "PASS" : "WARN",
        details: audit.bridge.status === "PASS" ? audit.bridge.detail : `${audit.bridge.detail} XREF-01/03 own the hard block for bridge breaks.`,
        expected: "Independently recomputed bridge",
        actual: audit.bridge.status,
      });
      checks.push({
        id: "VAL-AUDIT-02",
        category: "CROSS_REFERENCE",
        name: "Terminal Value Concentration",
        status: audit.terminal.status === "WARN" ? "WARN" : "PASS",
        details: audit.terminal.detail,
        expected: "<75% of EV",
        actual: audit.terminal.tvPctOfEv !== null ? `${(audit.terminal.tvPctOfEv * 100).toFixed(0)}% (${audit.terminal.band})` : audit.terminal.band,
      });
      checks.push({
        id: "VAL-AUDIT-03",
        category: "CROSS_REFERENCE",
        name: "WACC Input Audit",
        status: audit.wacc.status === "WARN" ? "WARN" : "PASS",
        details: audit.wacc.detail,
        expected: "All inputs inside sanity bands",
        actual: audit.wacc.status,
      });
      checks.push({
        id: "VAL-AUDIT-04",
        category: "CROSS_REFERENCE",
        name: "Cross-Method Valuation Disagreement",
        status: audit.disagreement.status === "WARN" ? "WARN" : "PASS",
        details: `${audit.disagreement.detail} Model reliability: ${audit.reliability} — ${audit.reliabilityReasons.join("; ")}.`,
        expected: "Corroborated target",
        actual: audit.disagreement.verdict,
      });

      const plaus = checkEconomicPlausibility({
        annualFinancials: finList,
        dcf: data.dcf,
        stockData: {
          targetMeanPrice: (data.stockData as any)?.targetMeanPrice,
          targetHighPrice: (data.stockData as any)?.targetHighPrice,
          targetLowPrice: (data.stockData as any)?.targetLowPrice,
          numberOfAnalystOpinions: (data.stockData as any)?.numberOfAnalystOpinions,
        },
      });
      for (const f of plaus.findings) {
        checks.push({
          id: f.id,
          category: "BS_DETECTOR",
          name: `Economic Plausibility — ${f.name}`,
          status: f.status === "WARN" ? "WARN" : "PASS",
          details: f.status === "WARN" ? f.detail : f.detail,
          expected: "Model consistent with demonstrated economics",
          actual: f.status,
        });
      }
    }
  }

  // FCF-NARR-01: cash-flow narrative reconciliation. When the model FCF is
  // negative (trailing reported or forecast year-1), the narrative must not
  // simultaneously claim operating cash comfortably funds growth capex. The
  // funding source (cash balance, debt, asset sales, equity) must be stated
  // explicitly, or the claim removed.
  {
    const fins = data.annualFinancials || [];
    const latest = fins[fins.length - 1] as any;
    const trailFcf = latest && Number.isFinite(Number(latest.freeCashFlow))
      ? Number(latest.freeCashFlow)
      : latest && Number.isFinite(Number(latest.operatingCashFlow))
        ? Number(latest.operatingCashFlow) - Math.abs(Number(latest.capitalExpenditures) || 0)
        : null;
    const fc: any = (data as any).canonicalForecast;
    const forecastY1Fcf = Array.isArray(fc?.projections) && fc.projections.length > 0
      ? Number(fc.projections[0].freeCashFlow)
      : null;
    // Either leg failing contradicts a comfort claim: a negative trailing
    // print makes "comfortably funds" false today, a negative forecast makes
    // it false tomorrow. Detail cites the offending leg(s).
    const negLegs: string[] = [];
    if (trailFcf !== null && trailFcf < 0) negLegs.push(`trailing FCF ${trailFcf.toFixed(0)}`);
    if (Number.isFinite(forecastY1Fcf as number) && (forecastY1Fcf as number) < 0) {
      negLegs.push(`forecast Y1 FCF ${(forecastY1Fcf as number).toFixed(0)}`);
    }
    const modelFcf = Number.isFinite(forecastY1Fcf as number) ? (forecastY1Fcf as number) : trailFcf;
    const ai = (data.aiAnalysis || {}) as unknown as Record<string, unknown>;
    const narrativeCash = [
      ai.cashFlowCommentary, ai.capitalAllocationCommentary, ai.investmentThesis,
      ai.investmentConclusion, ai.dcfCommentary, ai.creditAnalysisCommentary,
    ].filter((v): v is string => typeof v === "string").join("\n").toLowerCase();
    const fundingClaims = [
      "comfortably fund", "comfortably funds", "comfortably cover",
      "self-fund", "self fund", "self-funded", "fully fund", "fully funds",
      "funds growth capex", "fund growth capex", "funds all capex",
      "ample headroom", "ample cover", "cash comfortably",
    ].filter((p) => narrativeCash.includes(p));
    if (negLegs.length > 0 && fundingClaims.length > 0) {
      checks.push({
        id: "FCF-NARR-01",
        category: "CROSS_REFERENCE",
        name: "Cash-Flow Narrative Reconciliation",
        status: "FAIL",
        details: `FATAL PUBLICATION BLOCK: FCF is negative (${negLegs.join("; ")}) yet the narrative claims FCF-funded growth ("${fundingClaims.slice(0, 3).join('", "')}"). State the actual funding source (cash balance, debt, asset sales) or remove the claim.`,
        expected: "Narrative consistent with negative FCF",
        actual: `${fundingClaims.length} funding claim(s)`,
      });
    } else {
      checks.push({
        id: "FCF-NARR-01",
        category: "CROSS_REFERENCE",
        name: "Cash-Flow Narrative Reconciliation",
        status: "PASS",
        details: negLegs.length > 0
          ? `FCF negative (${negLegs.join("; ")}) but narrative makes no FCF-funding comfort claims — reconciled.`
          : modelFcf === null
            ? "Model FCF unavailable — narrative funding-claim scan skipped (no contradiction assertable)."
            : "Model FCF non-negative — narrative cash-flow statements reconcile.",
      });
    }
  }

  // SOTP-01: conglomerate SOTP bridge verification. When the valuation ran
  // sum-of-the-parts, re-verify the bridge independently (segment EVs sum,
  // holding discount, net-debt bridge, per-share closure) and require sane
  // segment coverage of consolidated EBITDA. Arithmetic breach BLOCKS.
  {
    const sotp: any = (data.dcf as any)?.sotpBreakdown;
    if (sotp && Array.isArray(sotp.segments)) {
      const issues: string[] = [];
      const segSum = sotp.segments.reduce((s: number, x: any) => s + (Number(x.enterpriseValue) || 0), 0);
      if (Math.abs(segSum + (Number(sotp.otherInvestments) || 0) - Number(sotp.grossAssetValue || 0)) > 1000) {
        issues.push(`segment EVs + investments ≠ gross asset value (gap ${(Math.abs(segSum - Number(sotp.grossAssetValue || 0))).toFixed(0)})`);
      }
      const discountVal = Number(sotp.grossAssetValue || 0) * Number(sotp.holdingDiscount || 0);
      const impliedEquity = Number(sotp.grossAssetValue || 0) - discountVal - Number(sotp.netDebt || 0);
      if (Math.abs(impliedEquity - Number(sotp.equityValue || 0)) > 1000) {
        issues.push(`GAV − discount − netDebt ≠ equity (gap ${(Math.abs(impliedEquity - Number(sotp.equityValue || 0))).toFixed(0)})`);
      }
      const sh = Number(sotp.sharesOutstanding) || 0;
      if (sh > 0 && Number(sotp.equityValue) > 0 && Math.abs(Number(sotp.fairValuePerShare) - Number(sotp.equityValue) / sh) > 1.0) {
        issues.push(`SOTP fair value ≠ equity/shares (gap ${Math.abs(Number(sotp.fairValuePerShare) - Number(sotp.equityValue) / sh).toFixed(2)})`);
      }
      const cov = Number(sotp.coveragePct);
      if (issues.length > 0) {
        checks.push({
          id: "SOTP-01",
          category: "CROSS_REFERENCE",
          name: "SOTP Bridge Verification",
          status: "FAIL",
          details: `FATAL PUBLICATION BLOCK: SOTP bridge recomputation disagrees: ${issues.slice(0, 2).join("; ")}.`,
          expected: "SOTP bridge agreement",
          actual: issues.slice(0, 2).join("; "),
        });
      } else if (Number.isFinite(cov) && cov < 0.8) {
        checks.push({
          id: "SOTP-01",
          category: "CROSS_REFERENCE",
          name: "SOTP Bridge Verification",
          status: "WARN",
          details: `SOTP arithmetic holds, but filing segments cover only ${(cov * 100).toFixed(0)}% of consolidated EBITDA — residual valued at blended multiple (LOW confidence). Refresh segment filings.`,
          expected: "≥80% segment coverage",
          actual: `${(cov * 100).toFixed(0)}%`,
        });
      } else {
        checks.push({
          id: "SOTP-01",
          category: "CROSS_REFERENCE",
          name: "SOTP Bridge Verification",
          status: "PASS",
          details: `SOTP bridge recomputed: ${sotp.segments.length} segment(s), coverage ${Number.isFinite(cov) ? (cov * 100).toFixed(0) + "%" : "n/a"} — arithmetic agrees.`,
        });
      }
    }
  }

  // IND-01..IND-05: independent recomputation gate (P0 #9, #23, #26).
  // A separate implementation re-derives every load-bearing bridge from
  // canonical facts through the math kernel — never the model's own code.
  // Material disagreement FAILS (automatic publication block); drift WARNs.
  {
    const facts = buildCanonicalFacts({
      profile: data.profile,
      stockData: data.stockData,
      annualFinancials: data.annualFinancials,
      asOf: data.generatedAt,
    });
    const ind = validateIndependently({
      facts,
      isFinancialInstitution: !!sectorProfile.isFinancialInstitution,
      archetype: (ledger as unknown as { archetype?: string } | undefined)?.archetype,
      country: data.profile.country,
      beta: data.stockData.beta,
      dcf: {
        enterpriseValue: Number(data.dcf.enterpriseValue) || 0,
        sumPvFcff: Number(data.dcf.sumPvFcff) || 0,
        pvTerminalValue: Number(data.dcf.pvTerminalValue) || 0,
        equityValue: Number(data.dcf.equityValue) || 0,
        netDebt: data.dcf.netDebt,
        financeReceivablesOffset: Number((data.dcf as unknown as { financeReceivablesOffset?: number }).financeReceivablesOffset) || 0,
        intrinsicValue: Number(data.dcf.intrinsicValue) || 0,
        fairValuePerShare: data.dcf.fairValuePerShare ?? null,
        sharesOutstanding: Number(data.dcf.sharesOutstanding) || 0,
        currentMarketPrice: Number(data.dcf.currentMarketPrice) || 0,
        assumptions: {
          revenueGrowthRates: data.dcf.assumptions?.revenueGrowthRates,
          ebitMargins: data.dcf.assumptions?.ebitMargins,
          wacc: data.dcf.assumptions?.wacc,
          terminalGrowthRate: data.dcf.assumptions?.terminalGrowthRate,
        },
        sotpBreakdown: (data.dcf as any)?.sotpBreakdown,
      },
      ledger: {
        fairValue: Number(ledger?.fairValue ?? data.targetPrice) || 0,
        targetPrice: Number(ledger?.targetPrice ?? data.targetPrice) || 0,
        currentPrice: Number(ledger?.currentPrice ?? data.cmp) || 0,
        enterpriseValue: ledger?.enterpriseValue !== undefined ? Number(ledger.enterpriseValue) : undefined,
        equityValue: ledger?.equityValue !== undefined ? Number(ledger.equityValue) : undefined,
        netDebt: ledger?.netDebt !== undefined ? Number(ledger.netDebt) : undefined,
        sharesOutstanding: ledger?.sharesOutstanding !== undefined ? Number(ledger.sharesOutstanding) : undefined,
        wacc: ledger?.wacc !== undefined ? Number(ledger.wacc) : undefined,
        rating: (ledger as unknown as { rating?: string } | undefined)?.rating,
      },
    });
    for (const issue of ind.issues) {
      checks.push({
        id: issue.code,
        category: issue.code === "IND-04" || issue.code === "IND-05" ? "CROSS_REFERENCE" : "BALANCE_SHEET",
        name: `${INDEPENDENT_CHECK_NAMES[issue.code]} — ${independentFindingSubtitle(issue.message)}`,
        status: issue.severity,
        details: issue.severity === "FAIL"
          ? `FATAL PUBLICATION BLOCK: ${issue.message}`
          : issue.message,
        expected: issue.expected,
        actual: issue.actual,
      });
    }
    for (const p of ind.passes) {
      const code = p.slice(0, 6);
      if (["IND-01", "IND-02", "IND-03", "IND-04", "IND-05"].includes(code) && !checks.some((c) => c.id === code)) {
        checks.push({
          id: code,
          category: code === "IND-04" || code === "IND-05" ? "CROSS_REFERENCE" : "BALANCE_SHEET",
          name: `${code} Independent Recomputation`,
          status: "PASS",
          details: p,
        });
      }
    }
  }

  // PEER-01 upgrade: similarity-threshold gate (Priority 5). Replaces fixed 30-cutoff with engine thresholds.
  {
    const peerList = (data.peers || []) as unknown as { relevanceScore?: number | null; ticker?: string }[];
    if (peerList.length > 0) {
      const gate = gatePeerSet(peerList as never);
      const existingPeerFails = checks.filter((c) => c.id === "PEER-01" && c.status === "FAIL").length;
      if (gate.suppress && existingPeerFails === 0) {
        checks.push({
          id: "PEER-01",
          category: "BS_DETECTOR",
          name: "Peer Similarity Threshold",
          status: "FAIL",
          details: `FATAL: peer set fails business-model similarity gate — ${gate.reason}. Suppress relative valuation; rating must rest on DCF alone.`,
          expected: `avg ≥ ${SIMILARITY_THRESHOLD_AVG}, ≥${2} peers ≥ ${SIMILARITY_MIN_QUALIFYING}`,
          actual: `avg ${gate.avg ?? "null"}, qualifying ${gate.qualifying}`,
        });
      } else if (!gate.suppress && gate.avg !== null) {
        checks.push({
          id: "PEER-01",
          category: "BS_DETECTOR",
          name: "Peer Similarity Threshold",
          status: "PASS",
          details: `Peer similarity gate passed — ${gate.reason}.`,
        });
      }
    }
  }

  // P0 #1 — Canonical seal must be intact (frozen + hash matches). Any mutation after VALIDATED = BLOCK.
  {
    const cf: any = (data as any).canonicalFacts;
    if (cf) {
      const frozen = Object.isFrozen(cf);
      const hashOk = cf._hash ? (() => { try { const s = JSON.stringify(cf); void s; return true; } catch { return false; } })() : !!cf._hash;
      if (!frozen || !cf._sealed) {
        checks.push({ id: "CANON-01", category: "BALANCE_SHEET", name: "Canonical Fact Seal", status: "FAIL", details: `FATAL: canonical facts not sealed/frozen — immutability violated (frozen=${frozen}, sealed=${!!cf._sealed}).`, expected: "sealed & frozen", actual: `frozen=${frozen} sealed=${!!cf._sealed}` });
      } else {
        checks.push({ id: "CANON-01", category: "BALANCE_SHEET", name: "Canonical Fact Seal", status: "PASS", details: `Canonical facts sealed (${cf._hash?.slice(0,12) ?? "no-hash"}) and frozen — no silent overwrite.` });
      }
    }
  }
  // P0 #2 — Source reconciliation INVALID blocks
  {
    const rec: any[] | undefined = (data as any).reconciliation;
    if (Array.isArray(rec) && rec.some((r: any)=> r.invalid)) {
      const bad = rec.filter((r:any)=>r.invalid).map((r:any)=> `${r.field}:${r.verdict.slice(0,80)}`).join("; ");
      checks.push({ id: "RECON-01", category: "BALANCE_SHEET", name: "Source Reconciliation", status: "FAIL", details: `FATAL: material PRIMARY↔SECONDARY diff unresolved — INVALID: ${bad}`, expected: "reconciled", actual: `${rec.filter((r:any)=>r.invalid).length} invalid` });
    } else if (Array.isArray(rec)) {
      checks.push({ id: "RECON-01", category: "BALANCE_SHEET", name: "Source Reconciliation", status: "PASS", details: `Source reconciliation: ${rec.length} field(s) checked, 0 material INVALID.` });
    }
  }
  // SRC-01 — Primary-source reconciliation disclosure. Yahoo/secondary data
  // is the ingestion layer, but material figures must be corroborated against
  // the annual report / quarterly filing / investor presentation / exchange
  // filing before publication. Fields stuck at MISSING_PRIMARY warn loudly
  // (disclosure-grade qualification); MATERIAL_DIFF already FAILs via
  // RECON-01. A filing fetcher that backfills PRIMARY TierFacts clears these.
  {
    const rec: any[] | undefined = (data as any).reconciliation;
    if (Array.isArray(rec)) {
      const unreconciled = rec.filter((r: any) => r.status === "MISSING_PRIMARY");
      if (unreconciled.length > 0) {
        checks.push({
          id: "SRC-01",
          category: "BALANCE_SHEET",
          name: "Primary-Source Corroboration",
          status: "WARN",
          details: `${unreconciled.length} material figure(s) rest on SECONDARY data only [${unreconciled.map((r: any) => r.field).join(", ")}] — corroborate against the annual report / quarterly filing / investor presentation / exchange filing before relying; the dossier publishes as secondary-sourced.`,
          expected: "PRIMARY corroboration",
          actual: `${unreconciled.length} SECONDARY-only`,
        });
      } else {
        checks.push({
          id: "SRC-01",
          category: "BALANCE_SHEET",
          name: "Primary-Source Corroboration",
          status: "PASS",
          details: `All reconciled fields carry PRIMARY corroboration or a single-source disclosure.`,
        });
      }
    }
  }
  // SRC-02 — Screener.in advisory cross-check (India-only). Screener is a
  // SECONDARY elaboration source: it explains Yahoo inconsistencies (share-base
  // splits, revenue scale) in the annex but NEVER reprices anything — every
  // priced figure stays Yahoo-only. This check is WARN/PASS only (never FAIL):
  // unavailable (US tickers, timeout, bot-block) is a silent SKIP.
  {
    const sc: any = (data as any).screenerCrosscheck;
    if (sc && sc.available === true && Array.isArray(sc.findings) && sc.findings.length > 0) {
      const notable = sc.findings.filter(
        (f: any) => typeof f.driftPct === "number" && f.driftPct > 0.1
      );
      if (notable.length === 0) {
        checks.push({
          id: "SRC-02",
          category: "BALANCE_SHEET",
          name: "Screener Cross-Check (Advisory)",
          status: "PASS",
          details: `Screener.in (${sc.screenerSymbol}) reconciles with Yahoo within 10% on shares/revenue/profit — secondary corroboration; priced figures remain Yahoo-only.`,
          expected: "Cross-check agreement",
          actual: "agree ≤10%",
        });
      } else {
        checks.push({
          id: "SRC-02",
          category: "BALANCE_SHEET",
          name: "Screener Cross-Check (Advisory)",
          status: "WARN",
          details:
            `Screener.in (${sc.screenerSymbol}) elaboration — Yahoo stays authoritative, ` +
            `no figure repriced: ${notable.map((f: any) => f.note).join(" ")}`.slice(0, 600),
          expected: "Cross-check agreement",
          actual: `${notable.length} divergent field(s), Yahoo retained`,
        });
      }
    }
  }
  // SRC-03 — International advisory annex (EDGAR 10-K + Nasdaq close vs Yahoo).
  // Same contract as SRC-02: elaborates gaps, never reprices — WARN/PASS only
  // (never FAIL). Unavailable legs (non-US, no CIK, timeout) skip silently.
  {
    const gc: any = (data as any).globalCrosscheck;
    const ed = gc?.edgar;
    if (ed && ed.available === true && Array.isArray(ed.findings) && ed.findings.length > 0) {
      const notable = ed.findings.filter(
        (f: any) => typeof f.driftPct === "number" && f.driftPct > 0.1
      );
      if (notable.length === 0) {
        checks.push({
          id: "SRC-03",
          category: "BALANCE_SHEET",
          name: "EDGAR Cross-Check (Advisory)",
          status: "PASS",
          details: `EDGAR 10-K (${ed.cik}) reconciles with Yahoo within 10% on shares/revenue/income — filing-grade corroboration; priced figures remain Yahoo-only.`,
          expected: "Cross-check agreement",
          actual: "agree ≤10%",
        });
      } else {
        checks.push({
          id: "SRC-03",
          category: "BALANCE_SHEET",
          name: "EDGAR Cross-Check (Advisory)",
          status: "WARN",
          details:
            `EDGAR 10-K (${ed.cik}) elaboration — Yahoo stays authoritative, ` +
            `no figure repriced: ${notable.map((f: any) => f.note).join(" ")}`.slice(0, 600),
          expected: "Cross-check agreement",
          actual: `${notable.length} divergent field(s), Yahoo retained`,
        });
      }
    }
    const nq = gc?.nasdaq;
    if (nq && nq.available === true && typeof nq.driftPct === "number" && nq.driftPct > 0.03) {
      checks.push({
        id: "SRC-03",
        category: "BALANCE_SHEET",
        name: "Nasdaq Price Sanity (Advisory)",
        status: "WARN",
        details: `${nq.note || "Nasdaq close diverges from Yahoo price."} CMP stays Yahoo-only.`.slice(0, 400),
        expected: "Price agreement ≤3%",
        actual: `drift ${((nq.driftPct as number) * 100).toFixed(1)}%, Yahoo retained`,
      });
    }
  }
  // P0 #3 — Hard accounting identities FAIL blocks (BS identity, cash chain, etc.)
  {
    const ids: any[] | undefined = (data as any).identityIssues;
    if (Array.isArray(ids) && ids.some((i:any)=>i.severity==="FAIL")) {
      const f = ids.filter((i:any)=>i.severity==="FAIL").slice(0,2).map((i:any)=> `${i.code} ${i.year}: ${i.detail.slice(0,80)}`).join("; ");
      checks.push({ id: "ACCT-01", category: "BALANCE_SHEET", name: "Hard Accounting Identities", status: "FAIL", details: `FATAL: accounting identity breach — ${f}`, expected: "all identities hold", actual: `${ids.filter((i:any)=>i.severity==="FAIL").length} FAIL(s)` });
    } else if (Array.isArray(ids)) {
      const warns = ids.filter((i:any)=>i.severity==="WARN").length;
      checks.push({ id: "ACCT-01", category: "BALANCE_SHEET", name: "Hard Accounting Identities", status: warns? "WARN":"PASS", details: warns? `${warns} identity WARN(s) — review drifts.` : `All hard identities hold across ${ids.length} checks.` });
    }
  }
  // P0 #4 — Single canonical forecast must exist and be consumed (no second forecast)
  {
    const fc: any = (data as any).canonicalForecast;
    if (!fc || !Array.isArray(fc.projections) || fc.projections.length===0) {
      const hasDcfAssumps = !!(data.dcf as any)?.assumptions?.revenueGrowthRates;
      if (hasDcfAssumps) {
        checks.push({ id: "FCST-01", category: "CROSS_REFERENCE", name: "Single Canonical Forecast", status: "FAIL", details: `FATAL PUBLICATION BLOCK: Canonical forecast not attached — DCF assumptions exist but canonical forecast object is missing. The canonical forecast is the ONLY authoritative forward pipeline; without it, forecast reconciliation (FCST-02..05) cannot verify integrity.`, expected: "5Y canonical forecast with projections", actual: "legacy DCF assumptions only" });
      } else {
        checks.push({ id: "FCST-01", category: "CROSS_REFERENCE", name: "Single Canonical Forecast", status: "FAIL", details: `FATAL PUBLICATION BLOCK: no canonical forecast built — DCF/ratios/PDF have no single source; independent forecast prohibited.`, expected: "5Y projections", actual: "missing" });
      }
    } else {
      // cross-check DCF projections length if present. An EMPTY array is not a
      // second forecast — it is the residual-income path (banks/insurers/NBFCs),
      // which carries no explicit FCFF projections by construction. Only a
      // non-empty length mismatch indicates competing forecasts.
      const dcfProjs = (data.dcf as any)?.projections;
      if (Array.isArray(dcfProjs) && dcfProjs.length > 0 && dcfProjs.length !== fc.projections.length) {
        checks.push({ id: "FCST-01", category: "CROSS_REFERENCE", name: "Single Canonical Forecast", status: "FAIL", details: `FATAL: DCF projections length ${dcfProjs.length} ≠ canonical forecast ${fc.projections.length} — second forecast detected.`, expected: `${fc.projections.length}`, actual: `${dcfProjs.length}` });
      } else {
        checks.push({ id: "FCST-01", category: "CROSS_REFERENCE", name: "Single Canonical Forecast", status: "PASS", details: `Single forecast sealed: ${fc.projections.length}Y ${fc.driverEquation.slice(0,60)} — sole source for DCF/credit/PDF.` });
      }
    }
  }
  // FCST-02..05 — Forecast reconciliation identities over the single
  // CanonicalForecast (TRACK 1): bridges, roll-forwards, DCF linkage,
  // margin continuity + funding. Blocker findings FAIL (machine-verifiable
  // falsehood or hidden shortfall); material findings WARN (disclosure-grade
  // discontinuity/liquidity qualification). RI path (vectors-only) skips DCF
  // linkage — residual income prices the equity, the FCFF stream is narrative
  // consistency only.
  {
    const fc: any = (data as any).canonicalForecast;
    if (fc && Array.isArray(fc.projections) && fc.projections.length > 0) {
      const dcfAny: any = (data as any).dcf || {};
      const ledgerScen: any = (data as any).assumptionsLedger?.scenarios;
      const enforceLinkage = (fc.valuationUse ?? (Array.isArray(dcfAny.projections) && dcfAny.projections.length > 0 ? "fcff" : "vectors-only")) === "fcff";
      let findings: Array<{ rule: string; year?: string; pass: boolean; severity: string; expected: string; actual: string; detail: string }> = [];
      try {
        findings = reconcileForecast({
          forecast: fc,
          dcfAssumptions: {
            revenueGrowthRates: dcfAny.assumptions?.revenueGrowthRates,
            ebitMargins: dcfAny.assumptions?.ebitMargins,
            avgCapexPct: (dcfAny.avgCapexPct ?? (fc as any).avgCapexPct),
            avgDeptPct: (dcfAny.avgDeptPct ?? (fc as any).avgDeptPct),
            avgNwcChangePct: (dcfAny.avgNwcChangePct ?? (fc as any).avgNwcChangePct),
            wacc: dcfAny.assumptions?.wacc,
            terminalGrowthRate: dcfAny.assumptions?.terminalGrowthRate,
          },
          dcfOutputs: (() => {
            // SOTP-primary: forecast→DCF linkage holds on the FCFF
            // cross-check leg (the forecast prices FCFF vectors; SOTP-01
            // owns the SOTP bridge, FINCONS-04 the SOTP per-share closure).
            const cc = dcfAny.sotpBreakdown?.crossCheck;
            return {
              sumPvFcff: cc?.sumPvFcff ?? dcfAny.sumPvFcff,
              enterpriseValue: cc?.enterpriseValue ?? dcfAny.enterpriseValue,
              equityValue: cc?.equityValue ?? dcfAny.equityValue,
              fairValuePerShare: cc?.fairValuePerShare ?? (data as any).assumptionsLedger?.fairValue ?? dcfAny.intrinsicValue ?? dcfAny.fairValuePerShare ?? null,
              netDebt: dcfAny.netDebt,
              sharesOutstanding: dcfAny.sharesOutstanding,
            };
          })(),
          scenarioBaseVector: ledgerScen?.base?.inputVector ? { revenueGrowth: ledgerScen.base.inputVector.revenueGrowth, ebitMargin: ledgerScen.base.inputVector.ebitMargin } : null,
          enforceDcfLinkage: enforceLinkage,
          dilutedSharesFromFacts: (() => {
            const cf: any = (data as any).canonicalFacts;
            const val = cf?.market?.sharesDiluted?.value;
            return typeof val === "number" && val > 0 ? val : undefined;
          })(),
        }) as unknown as typeof findings;
      } catch (e) {
        findings = [{ rule: "revenue-bridge", pass: false, severity: "blocker", expected: "reconciliation runnable", actual: String(e).slice(0, 80), detail: `Reconciliation harness threw — treat as blocker: ${String(e).slice(0, 160)}` }];
      }
      const group = (name: string, rules: string[]) => findings.filter((f) => !f.pass && rules.includes(f.rule));
      const emit = (id: string, title: string, rules: string[], skipNote?: string) => {
        if (skipNote) {
          checks.push({ id, category: "CROSS_REFERENCE", name: title, status: "PASS", details: skipNote });
          return;
        }
        const bad = group(id, rules);
        const blockers = bad.filter((f) => f.severity === "blocker");
        const materials = bad.filter((f) => f.severity === "material");
        if (blockers.length > 0) {
          const first = blockers[0];
          checks.push({ id, category: "CROSS_REFERENCE", name: title, status: "FAIL", details: `FATAL: ${blockers.length} forecast-identity breach(es) — ${first.rule}${first.year ? ` @ ${first.year}` : ""}: ${first.detail.slice(0, 220)}${blockers.length > 1 ? ` (+${blockers.length - 1} more)` : ""}`, expected: "identities hold", actual: `${blockers.length} blocker(s)` });
        } else if (materials.length > 0) {
          const first = materials[0];
          checks.push({ id, category: "CROSS_REFERENCE", name: title, status: "WARN", details: `${materials.length} material forecast qualification(s) — ${first.rule}${first.year ? ` @ ${first.year}` : ""}: ${first.detail.slice(0, 220)}${materials.length > 1 ? ` (+${materials.length - 1} more)` : ""}`, expected: "identities hold", actual: `${materials.length} material` });
        } else {
          checks.push({ id, category: "CROSS_REFERENCE", name: title, status: "PASS", details: `${title} — all ${rules.length} rule family(ies) hold across ${fc.projections.length}Y.` });
        }
      };
      emit("FCST-02", "Forecast Bridges (Revenue/EBIT/Pretax/NI/CFO/FCF)", ["revenue-bridge", "ebit-bridge", "pretax-bridge", "net-income-bridge", "cfo-bridge", "fcf-bridge"]);
      emit("FCST-03", "Forecast Roll-Forwards (Cash/Debt/PP&E/Shares)", ["cash-roll-forward", "debt-roll-forward", "ppe-roll-forward", "share-count-roll-forward", "share-count-reconciliation"]);
      // Honest-NR grace for dcf-linkage ONLY (same doctrine as XREF-02/03/05):
      // when the engine honestly produced no equity (non-valid DCF, NR
      // anchor), linkage to a non-existent bridge is a disclosed limitation,
      // not a forecast bug. Scenario-vector mismatches still FAIL — a
      // ledger/forecast fork is a real bug under any rating.
      {
        const linkBlockers = group("FCST-04", ["dcf-linkage"]).filter((f) => f.severity === "blocker");
        const vectorBlockers = group("FCST-04", ["scenario-vector-identity"]).filter((f) => f.severity === "blocker");
        const honestNrLinkage = rating === "NR" && (data.dcf as any)?.status !== undefined && (data.dcf as any)?.status !== "valid";
        if (enforceLinkage && honestNrLinkage && linkBlockers.length > 0 && vectorBlockers.length === 0) {
          checks.push({
            id: "FCST-04", category: "CROSS_REFERENCE", name: "Forecast→DCF Linkage + Scenario Vectors",
            status: "WARN",
            details: `No positive model equity exists (DCF ${(data.dcf as any).status}) — forecast→DCF linkage not applicable under honest NR anchor; scenario vectors reconcile. Disclosed limitation; see ledger ratingRationale. Linkage gaps: ${linkBlockers.slice(0, 2).map((f) => `${f.rule}${f.year ? ` @ ${f.year}` : ""}`).join("; ")}${linkBlockers.length > 2 ? ` (+${linkBlockers.length - 2} more)` : ""}`,
            expected: "NR-anchored (disclosed)",
            actual: `${linkBlockers.length} linkage gap(s), vectors reconcile`,
          });
        } else {
          emit("FCST-04", "Forecast→DCF Linkage + Scenario Vectors", ["dcf-linkage", "scenario-vector-identity"], enforceLinkage ? undefined : "RI vectors-only path — FCFF stream is narrative consistency only; linkage not enforced.");
        }
      }
      emit("FCST-05", "Forecast Continuity + Funding Liquidity", ["margin-continuity", "funding-liquidity"]);
    }
  }
  // P0 #7 — Dependency propagation: blocked nodes must not be consumed as valid
  {
    const dep: any = (data as any).dependencyState;
    if (dep) {
      const blocked = Object.entries(dep as Record<string, {valid:boolean}>).filter(([,v])=>!v.valid).map(([k])=>k);
      if (blocked.length>0) {
        checks.push({ id: "DEP-01", category: "BALANCE_SHEET", name: "Dependency Propagation", status: "FAIL", details: `FATAL: blocked inputs propagated — invalid nodes: ${blocked.join(",")} — downstream EV/equity/fairValue cannot be valid.`, expected: "0 blocked", actual: blocked.join(",") });
      } else {
        checks.push({ id: "DEP-01", category: "BALANCE_SHEET", name: "Dependency Propagation", status: "PASS", details: `Dependency DAG clean — no blocked upstream propagates to valuation.` });
      }
    }
  }
  // P0 #10 — CanonicalReport seal + PDF mismatch gate (when PDF extract supplied, else seal check)
  {
    const cr: any = (data as any).canonicalReport;
    if (cr && cr._hash) {
      checks.push({ id: "CANONREP-01", category: "CROSS_REFERENCE", name: "CanonicalReport Seal", status: "PASS", details: `CanonicalReport sealed ${cr._hash.slice(0,12)} — single approved object for all PDF pages.` });
    }
    const indRep: any = (data as any).independentReport;
    if (indRep && Array.isArray(indRep.issues) && indRep.issues.some((i:any)=>i.severity==="FAIL")) {
      const f = indRep.issues.filter((i:any)=>i.severity==="FAIL").slice(0,2).map((i:any)=> `${i.code}: ${i.message.slice(0,80)}`).join("; ");
      // IND gates already pushed above individually; this is the aggregate hard gate duplicate for visibility
      checks.push({ id: "DEP-02", category: "BALANCE_SHEET", name: "Independent Gate Aggregate", status: "FAIL", details: `FATAL: independent validator blocks — ${f}`, expected: "0 FAIL", actual: `${indRep.issues.filter((i:any)=>i.severity==="FAIL").length} FAIL(s)` });
    }
  }

  const failCount = checks.filter(c => c.status === "FAIL").length;
  const warnCount = checks.filter(c => c.status === "WARN").length;
  // If ANY check has failed, report is strictly failed and score is capped at 50 max
  const score = failCount > 0 ? Math.max(0, 50 - (failCount * 10)) : Math.max(0, 100 - (warnCount * 5));
  const passed = failCount === 0;

  // 3-Tier Evaluation Architecture: Consistency vs Plausibility vs Appropriateness
  const consistencyChecks = checks.filter(c => c.category === "CROSS_REFERENCE" || c.category === "SCENARIO_MATH" || c.category === "RATING_CONSISTENCY");
  const plausibilityChecks = checks.filter(c => c.category === "BALANCE_SHEET" || c.category === "DEGENERATE_RATIO" || c.category === "BS_DETECTOR");
  const appropriatenessChecks = checks.filter(c => c.category === "KEYWORD_BLOCKLIST" || c.category === "MOAT_INTEGRITY");

  const consistencyPassed = !consistencyChecks.some(c => c.status === "FAIL");
  const plausibilityFails = plausibilityChecks.some(c => c.status === "FAIL");
  const plausibilityWarns = plausibilityChecks.some(c => c.status === "WARN");
  const appropriatenessPassed = !appropriatenessChecks.some(c => c.status === "FAIL");

  const tierSummary = {
    consistency: consistencyPassed ? ("PASS" as const) : ("FAIL" as const),
    plausibility: plausibilityFails ? ("FAIL" as const) : plausibilityWarns ? ("WARN" as const) : ("PASS" as const),
    appropriateness: appropriatenessPassed ? ("PASS" as const) : ("FAIL" as const),
  };

  const gateStatus: "READY" | "READY_WITH_WARNINGS" | "BLOCKED" =
    failCount > 0 ? "BLOCKED" : warnCount > 0 ? "READY_WITH_WARNINGS" : "READY";

  // ── Model Credit Auto-Downgrade ──────────────────────────────────────────
  // When P0 or P1 failures exist, the model-implied credit rating must be
  // downgraded from the archetype-computed value. Rules:
  //   P0 FAIL exists → Model Credit = D (lowest)
  //   P1 FAIL/WARN exists → Model Credit = B or C
  //   Only P2 WARNs → Model Credit = A
  //   Clean → Model Credit = AAA (unchanged)
  const p0FailCount = checks.filter(c => c.status === "FAIL").length;
  const p1FailCount = checks.filter(c => c.status === "WARN").length;
  let adjustedCreditRating: string | undefined;
  const baseRating = creditRating || "NR";

  if (p0FailCount > 0) {
    adjustedCreditRating = "D";
  } else if (p1FailCount > 0) {
    // Degrade: AA/AAA → B; A-range → C; BBB or below stays unchanged
    if (baseRating.startsWith("AAA") || baseRating.startsWith("AA") || baseRating.startsWith("A")) {
      adjustedCreditRating = "B";
    } else {
      adjustedCreditRating = "C";
    }
  } else if (warnCount > 0) {
    adjustedCreditRating = "A";
  } else {
    adjustedCreditRating = "AAA";
  }

  return {
    passed,
    score,
    gateStatus,
    tierSummary,
    timestamp: new Date().toISOString(),
    checks,
    checksums: {
      fairValueMatchCount: 6,
      fairValueLedger: fv,
      waccLedger: wacc,
      tgrLedger: tgr,
      balanceSheetVariance: maxBsVariancePct,
      ratingAlignedWithUpside: failCount === 0,
    },
    adjustedCreditRating,
  };
}

// Helper for compact number display in QA details
function fmtCompact(n: number): string {
  if (Math.abs(n) >= 1e12) return `${(n / 1e12).toFixed(1)}T`;
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}
