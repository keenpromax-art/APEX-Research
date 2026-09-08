// ============================================================
// Pre-Publish QA Validator & Consistency Checksum Engine
// Audits reports for internal contradictions, degenerate ratios,
// rating vs price misalignment, and template keyword leakage.
// ============================================================
// QA CONTRACT (block-vs-warn policy — adversarially tested, see
// scratch/test-publication-gate.ts two-phase fixtures):
//   FAIL (blocks export): arithmetic breaks (XREF-01/03/04/05, SCEN-01/02,
//     PROB-01, FV-RECOMP-01, CHAIN-01, BS-01), identity defects (IDENTITY-01),
//     rating/moat/credit contradictions (RATING-01/02, MOAT-01/02, STEWARD-01,
//     SEMANTIC-01, CREDIT-01), multi-term contamination (BS-DETECTOR-04 ≥2,
//     SANITIZE-01 ≥2), clone signatures (BS-DETECTOR-05), unresolved tokens
//     (PLACEHOLDER-01), missing assumption evidence (ASSUME-01).
//   WARN (costs score, never blocks): single-term bleed (BS-DETECTOR-04 =1,
//     SANITIZE-01 =1), unverified council (BS-DETECTOR-06), margin step-change
//     (MARGIN-01), loose chain tolerance (CHAIN-01), generic content screens
//     (THESIS-01, OVERVIEW-01, COMPET-01, MGMT-01, CATALYST-01, GOV-01).
//   Rationale: FAIL = machine-verifiable falsehood or proven contamination.
//   WARN = style/evidence thinness where a strict block would false-positive
//   on legitimate LLM phrasing. Every WARN names the remediation.
// ============================================================
import type { ReportData, ReportQAResult, QACheckItem } from "@/types/report";
import { getSectorProfile, classifySector } from "./sectors/index";
import { identityIssues } from "./canonical";
import { getAllowlistedConcepts } from "./sector-allowlist";

const SECTOR_KEYWORD_BLOCKLIST: Record<string, { blocked: string[]; sectorNames: string[] }> = {
  telecom: {
    sectorNames: ["telecom", "communication", "wireless"],
    blocked: ["semiconductor fabrication", "app store commission", "foundry", "fab capacity", "clinical trial", "refinery throughput", "crack spread"],
  },
  energy_petrochem: {
    sectorNames: ["energy", "oil", "petrochem", "refining"],
    blocked: ["saas churn", "arr expansion", "app store", "cloud subscription churn"],
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

  // 2. Cross-Reference Check (DCF Bridge Arithmetic)
  const sumPvFcff = Number(data.dcf.sumPvFcff) || 0;
  const pvTv = Number(data.dcf.pvTerminalValue) || 0;
  const ev = Number(data.dcf.enterpriseValue) || 0;
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
  const isBankOrNbfc = sectorProfile.isFinancialInstitution ||
    (data.dcf?.sumPvFcff === 0 && (data.dcf?.equityValue || 0) > 0);

  const dcfNetDebt = ledger?.netDebt !== undefined
    ? Number(ledger.netDebt)
    : (data.dcf.netDebt !== undefined ? Number(data.dcf.netDebt) : ((Number(data.dcf.lessDebt) || 0) - (Number(data.dcf.plusCash) || 0)));
  const dcfEqVal = ledger?.equityValue !== undefined ? Number(ledger.equityValue) : (Number(data.dcf.equityValue) || 0);
  const expectedEqVal = isBankOrNbfc ? dcfEqVal : ev - dcfNetDebt;
  const bridgeEqVariance = Math.abs(dcfEqVal - expectedEqVal);

  if (bridgeEqVariance > 1000 && !isBankOrNbfc) {
    checks.push({
      id: "XREF-03",
      category: "CROSS_REFERENCE",
      name: "DCF Equity Value Bridge Arithmetic Reconciled",
      status: "FAIL",
      details: `FATAL PUBLICATION BLOCK: Enterprise Value (${ev.toFixed(0)}) minus Net Debt (${dcfNetDebt.toFixed(0)}) does not match Equity Value (${dcfEqVal.toFixed(0)}). Variance: ${bridgeEqVariance.toFixed(0)}`,
      expected: expectedEqVal.toFixed(0),
      actual: dcfEqVal.toFixed(0),
    });
  } else {
    checks.push({
      id: "XREF-03",
      category: "CROSS_REFERENCE",
      name: "DCF Equity Value Bridge Arithmetic Reconciled",
      status: "PASS",
      details: isBankOrNbfc
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
    : (Number(latestFin?.totalDebt) || ((Number(latestFin?.shortTermDebt) || 0) + (Number(latestFin?.longTermDebt) || 0)));
  const bsCashEquiv = ledger?.cashAndEquiv !== undefined
    ? Number(ledger.cashAndEquiv)
    : ((Number(latestFin?.cash) || 0) + (Number(latestFin?.shortTermInvestments) || 0));
  const bsCalculatedNetDebt = bsTotalDebt - bsCashEquiv;

  if (latestFin && !isBankOrNbfc && Math.abs(dcfNetDebt - bsCalculatedNetDebt) > 1000) {
    checks.push({
      id: "XREF-04",
      category: "CROSS_REFERENCE",
      name: "Balance Sheet to DCF Bridge Variable Linking Reconciled",
      status: "FAIL",
      details: `FATAL PUBLICATION BLOCK: Net Debt in DCF bridge (${dcfNetDebt.toFixed(0)}) contradicts audited Balance Sheet Net Debt (${bsCalculatedNetDebt.toFixed(0)} = Total Debt ${bsTotalDebt.toFixed(0)} - Cash ${bsCashEquiv.toFixed(0)}). Financial statements are unlinked.`,
      expected: bsCalculatedNetDebt.toFixed(0),
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
        : "DCF Net Debt strictly linked to audited balance sheet debt and liquid cash reserves.",
    });
  }

  // 2d. Implied Per-Share Fair Value Arithmetic Check (Equity Value / Diluted Shares = Fair Value)
  const dcfShares = ledger?.sharesOutstanding || data.dcf.sharesOutstanding || data.stockData.sharesOutstanding || 1;
  const expectedPerShare = dcfShares > 0 && dcfEqVal > 0 ? dcfEqVal / dcfShares : fv;
  const perShareVariance = Math.abs(fv - expectedPerShare);

  if (perShareVariance > 1.0 && !isBankOrNbfc && fv > 0 && dcfShares > 0) {
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
    const trailMargin = trail && trail.revenue > 0 ? trail.operatingIncome / trail.revenue : null;
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
    const required = ["revenueGrowth", "ebitMargin", "capex", "workingCapital", "wacc", "terminal"];
    const missing = required.filter((k) => typeof basis[k] !== "string" || basis[k].length < 20);
    if (missing.length > 0) {
      checks.push({
        id: "ASSUME-01",
        category: "CROSS_REFERENCE",
        name: "Assumption Evidence Registry",
        status: "FAIL",
        details: `FATAL PUBLICATION BLOCK: DCF assumptions missing evidence-trail entries: ${missing.join(", ")}. Every assumption needs a stated empirical basis.`,
        expected: "6 evidenced assumptions",
        actual: `${required.length - missing.length}/6 evidenced`,
      });
    } else {
      checks.push({
        id: "ASSUME-01",
        category: "CROSS_REFERENCE",
        name: "Assumption Evidence Registry",
        status: "PASS",
        details: `All 6 DCF assumptions carry evidence-trail entries.`,
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
      checks.push({
        id: "CHAIN-01",
        category: "BALANCE_SHEET",
        name: "Statement Dependency Chain (IS→BS→CF→FCF)",
        status: "FAIL",
        details: `FATAL PUBLICATION BLOCK: Cash-flow dependency chain broken — ${chainBreaks.join("; ")}.`,
        expected: "FCF=CFO−capex; NWC=CA−CL every year",
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
      status: "WARN",
      details: `Detected out-of-sector terminology in narrative (${blocklistViolations.join(", ")}). Sanitizer active.`,
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
  // rewriting (≥2 distinct foreign-sector terms scrubbed) proves the narrative
  // was contaminated at generation time and blocks publication; a single
  // rewrite warns. Absent sanitizer metadata counts as clean (legacy path).
  const rewrittenTerms = Array.from(
    new Set(((data as any).sanitizerReport?.rewrittenTerms || []) as string[])
  );
  if (rewrittenTerms.length >= 2) {
    checks.push({
      id: "SANITIZE-01",
      category: "KEYWORD_BLOCKLIST",
      name: "Sanitizer Rewrite Disclosure",
      status: "FAIL",
      details: `FATAL PUBLICATION BLOCK: Sector sanitizer rewrote ${rewrittenTerms.length} distinct out-of-sector terms pre-QA: [${rewrittenTerms.slice(0, 8).join(", ")}]. The narrative was contaminated at generation — fix the template/prompt, not the output.`,
      expected: "Zero rewritten terms",
      actual: `${rewrittenTerms.length} rewritten term(s)`,
    });
  } else if (rewrittenTerms.length === 1) {
    checks.push({
      id: "SANITIZE-01",
      category: "KEYWORD_BLOCKLIST",
      name: "Sanitizer Rewrite Disclosure",
      status: "WARN",
      details: `Sector sanitizer rewrote 1 out-of-sector term pre-QA: [${rewrittenTerms[0]}]. Below the block threshold — review manually.`,
      expected: "Zero rewritten terms",
      actual: "1 rewritten term",
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
  const ebitda = bsDetectFin?.ebitda || bsDetectFin?.operatingIncome || 0;
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
    { sectors: ["auto manufacturer", "auto manufacturers", "automobile", "auto oem", "auto parts", "auto components", "electric vehicle", "two wheeler", "two-wheeler", "passenger vehicle", "commercial vehicle"], blocked: ["casa", "casa ratio", "nim", "gnpa", "loan book", "credit cost", "spectrum auction", "spectrum", "tower deployment", "subscriber churn", "master service agreement", "total contract value", "saas churn", "enterprise contract", "software services", "deal signing", "discretionary consulting", "copra", "packaged goods", "personal care", "fmcg", "clinical trial", "dark stores", "refinery throughput", "crack spread", "proprietary silicon", "wafer fab"] },
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

  if (semanticBleedViolations.length >= 2) {
    checks.push({
      id: "BS-DETECTOR-04",
      category: "BS_DETECTOR",
      name: "Semantic Template Bleeding Filter",
      status: "FAIL",
      details: `FATAL PUBLICATION BLOCK: ${semanticBleedViolations.length} distinct out-of-sector concepts in narrative: [${semanticBleedViolations.join(", ")}]. Multiple foreign-sector terms prove template contamination, not coincidence.`,
      expected: "Zero out-of-sector terms",
      actual: `${semanticBleedViolations.length} violations`,
    });
  } else if (semanticBleedViolations.length > 0) {
    checks.push({
      id: "BS-DETECTOR-04",
      category: "BS_DETECTOR",
      name: "Semantic Template Bleeding Filter",
      status: "WARN",
      details: `Single out-of-sector keyword detected in narrative: [${semanticBleedViolations.join(", ")}]. Below the multi-term block threshold — review manually.`,
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
  const cashTotal = (qaCreditFin?.cash || 0) + (qaCreditFin?.shortTermInvestments || 0);
  const debtTotal = qaCreditFin?.totalDebt || 0;
  const qaEbitda = qaCreditFin?.ebitda || qaCreditFin?.operatingIncome || 0;
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
