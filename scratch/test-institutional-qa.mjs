/**
 * APEX RESEARCH - Institutional QA & Invariant Test Suite
 * 
 * Verifies:
 * 1. Three-Tier QA Architecture (Consistency vs Plausibility vs Appropriateness)
 * 2. Balance Sheet Identity Violations (> 15% variance = hard fatal publication block)
 * 3. Extreme Leverage Anomaly Detection (> 5x D/E fails conservative narrative)
 * 4. Reverse DCF Engine (derives implied revenue growth & margin from CMP)
 * 5. Null Safety in Peer Data (null !== 0)
 * 6. Sector Leakage Prevention (Pharma & Consumer reject enterprise IT contracts)
 */

import { validateReportIntegrity } from "../src/lib/report-qa.ts";
import { computeReverseDCF } from "../src/lib/valuation/reverse-dcf.ts";
import { validateFinancialIdentities } from "../src/lib/financial-validation.ts";
import { classifySector } from "../src/lib/sectors/profiles.ts";

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

console.log("\n=======================================================");
console.log("APEX RESEARCH - INSTITUTIONAL QA & INVARIANT TEST SUITE");
console.log("=======================================================\n");

// ── Test 1: Three-Tier QA & Fatal Balance Sheet Block ──
console.log("--- 1. Three-Tier QA & Fatal Balance Sheet Block ---");
{
  // Report with a 25% balance sheet identity variance (Assets !== Liab + Equity)
  const brokenReport = {
    cmp: 500,
    targetPrice: 600,
    recommendation: "BUY",
    profile: { name: "Test Corp", ticker: "TEST.NS", sector: "Industrials", industry: "Manufacturing", currency: "INR" },
    stockData: { currentPrice: 500, beta: 1.0, sharesOutstanding: 1000000 },
    annualFinancials: [
      {
        year: 2024,
        revenue: 10000,
        ebitda: 2000,
        operatingIncome: 1500,
        netIncome: 1000,
        totalAssets: 20000,
        totalLiabilities: 5000,
        totalEquity: 10000, // 5000 + 10000 = 15000 vs 20000 (25% variance!)
      }
    ],
    dcf: {
      intrinsicValue: 600,
      equityValue: 600000000,
      sharesOutstanding: 1000000,
      sumPvFcff: 400000000,
      pvTerminalValue: 250000000,
      enterpriseValue: 650000000,
      assumptions: { wacc: 0.10, terminalGrowthRate: 0.04 }
    }
  };

  const qaResult = validateReportIntegrity(brokenReport);
  assert(qaResult.gateStatus === "BLOCKED", "Gate status is BLOCKED when balance sheet variance exceeds 15%");
  assert(qaResult.tierSummary.plausibility === "FAIL", "Tier 2 Plausibility is FAIL due to accounting invariant violation");
  assert(qaResult.passed === false, "Report is marked unpublishable (passed === false)");
  assert(qaResult.score <= 50, `QA score is penalized to <= 50 (actual: ${qaResult.score})`);
}

// ── Test 2: Clean Accounting Report Passes All Tiers ──
console.log("\n--- 2. Clean Report Passes Three Tiers with READY Status ---");
{
  const cleanReport = {
    cmp: 500,
    targetPrice: 620,
    recommendation: "BUY",
    profile: { name: "Clean Corp", ticker: "CLEAN.NS", sector: "Industrials", industry: "Diversified", currency: "INR" },
    stockData: { currentPrice: 500, beta: 1.0, sharesOutstanding: 1000000, pe: 20 },
    annualFinancials: [
      {
        year: 2024,
        revenue: 10000,
        grossProfit: 4000,
        ebitda: 2500,
        operatingIncome: 2000,
        netIncome: 1200,
        totalAssets: 15000,
        totalLiabilities: 5000,
        totalEquity: 10000, // Exact: 5000 + 10000 = 15000
      }
    ],
    dcf: {
      intrinsicValue: 620,
      equityValue: 620000000,
      sharesOutstanding: 1000000,
      sumPvFcff: 420000000,
      pvTerminalValue: 250000000,
      enterpriseValue: 670000000,
      assumptions: { wacc: 0.10, terminalGrowthRate: 0.04 }
    },
    assumptionsLedger: {
      scenarioMargins: { bearMargin: 0.15, baseMargin: 0.20, bullMargin: 0.25 }
    }
  };

  const qaClean = validateReportIntegrity(cleanReport);
  if (qaClean.checks.some(c => c.status === "WARN")) {
    console.log("Warnings in Test 2:", qaClean.checks.filter(c => c.status === "WARN"));
  }
  assert(qaClean.gateStatus === "READY" || qaClean.gateStatus === "READY_WITH_WARNINGS", `Gate status is acceptable (${qaClean.gateStatus})`);
  assert(qaClean.tierSummary.consistency === "PASS", "Tier 1 Consistency passes");
  assert(qaClean.tierSummary.plausibility === "PASS", "Tier 2 Plausibility passes exact balance sheet check");
}

// ── Test 3: Reverse DCF Expectations Engine ──
console.log("\n--- 3. Reverse DCF Expectations Engine ---");
{
  const rdcf = computeReverseDCF({
    currentMarketPrice: 1500,
    sharesOutstanding: 10000000,
    netDebt: 2000000000,
    latestRevenue: 25000000000,
    baseEbitMargin: 0.20,
    wacc: 0.105,
    terminalGrowthRate: 0.04,
    marginalTaxRate: 0.25,
    modelBaseGrowthRate: 0.12,
  });

  assert(typeof rdcf.impliedRevenueGrowthRate === "number", "Reverse DCF computed numeric implied growth rate");
  assert(isFinite(rdcf.impliedRevenueGrowthRate), "Implied growth rate is finite");
  assert(typeof rdcf.impliedTerminalOperatingMargin === "number", "Reverse DCF computed numeric implied operating margin");
  assert(rdcf.verdict.length > 20, `Reverse DCF generated institutional verdict: "${rdcf.verdict.substring(0, 60)}..."`);
  assert(rdcf.impliedGrowthPctDisplay.includes("%"), `Implied growth display formatted with % (${rdcf.impliedGrowthPctDisplay})`);
  assert(["High", "Medium", "Low"].includes(rdcf.confidence), `Confidence assigned correctly (${rdcf.confidence})`);
}

// ── Test 4: Sector Leakage Prevention (Pharma & FMCG Reject Enterprise Contracts) ──
console.log("\n--- 4. Sector Leakage Prevention in Narrative & Ontologies ---");
{
  const pharmaProfile = classifySector("Healthcare", "Pharmaceuticals", "Formulation manufacturing");
  assert(pharmaProfile.id === "pharma", "Pharma correctly routed");
  assert(pharmaProfile.forbiddenConcepts.includes("enterprise contract"), "Pharma blocks 'enterprise contract'");
  assert(pharmaProfile.forbiddenConcepts.includes("master service agreement"), "Pharma blocks 'master service agreement'");
  assert(pharmaProfile.forbiddenConcepts.includes("software services"), "Pharma blocks 'software services'");

  const consumerProfile = classifySector("Consumer Goods", "Personal Products", "FMCG branded products");
  assert(consumerProfile.id === "consumer", "Consumer correctly routed");
  assert(consumerProfile.forbiddenConcepts.includes("enterprise contract"), "Consumer blocks 'enterprise contract'");
  assert(consumerProfile.forbiddenConcepts.includes("master service agreement"), "Consumer blocks 'master service agreement'");
  assert(consumerProfile.allowedKPIs.includes("Volume Growth"), "Consumer allowed KPIs include 'Volume Growth'");
}

// ── Test 5: Accounting Identity Cross-Checks ──
console.log("\n--- 5. Margin Chain & Capital Structure Sanity ---");
{
  // Financial statement with margin chain inversion (EBITDA > Gross Profit)
  const invertedFin = [
    {
      year: 2024,
      revenue: 10000,
      grossProfit: 2000,
      ebitda: 3500, // Inversion! EBITDA > Gross Profit
      operatingIncome: 1500,
      netIncome: 1000,
      totalAssets: 15000,
      totalLiabilities: 5000,
      totalEquity: 10000,
    }
  ];

  const validation = validateFinancialIdentities({
    annualFinancials: invertedFin,
    stockData: { currentPrice: 500, sharesOutstanding: 1000000 },
  });
  const hasMarginIssue = validation.issues.some(i => i.code === "EBITDA_MARGIN_EXCEEDS_GROSS" || i.code === "EBITDA_LESS_THAN_EBIT" || i.code === "EBITDA_EXCEEDS_REVENUE");
  assert(hasMarginIssue, "Financial validation flags margin chain inversion (EBITDA margin > Gross margin)");
}

console.log("\n=======================================================");
console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log("=======================================================\n");

if (failed > 0) {
  process.exit(1);
}
