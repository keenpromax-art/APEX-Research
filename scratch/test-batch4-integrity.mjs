// ============================================================
// APEX RESEARCH - BATCH 4 INTEGRITY VERIFICATION SUITE
// ============================================================

import assert from "node:assert";
import { classifySector, validateSectorConcepts, UTILITIES_PROFILE, AGROCHEMICAL_PROFILE, CEMENT_PROFILE } from "../src/lib/sectors/profiles.ts";
import { createAssumptionsLedger } from "../src/lib/assumptions-ledger.ts";

console.log("=======================================================");
console.log("APEX RESEARCH - BATCH 4 INTEGRITY TEST SUITE");
console.log("=======================================================\n");

let passed = 0;
let total = 0;

function it(desc, fn) {
  total++;
  try {
    fn();
    console.log(`  ✓ PASS: ${desc}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${desc}`);
    console.error(`    ${err.message}`);
  }
}

// ── 1. Business-Model Sector Ontologies ──
console.log("--- 1. Business-Model Sector Ontologies & Concept Filtering ---");

it("Utilities sector correctly classified", () => {
  const profile = classifySector("Utilities", "Electric Utilities", "NTPC is India's largest power generation conglomerate operating thermal, hydro, and solar plants with long-term PPAs.");
  assert.strictEqual(profile.id, "utilities");
  assert.ok(profile.allowedKPIs.includes("Plant Load Factor (PLF)"));
  assert.ok(profile.allowedKPIs.includes("Regulated Return on Equity (ROE)"));
});

it("Agrochemicals sector correctly classified", () => {
  const profile = classifySector("Materials", "Agrochemicals & Specialty Chemicals", "PI Industries operates in complex chemistry synthesis, active ingredients, and crop protection formulations.");
  assert.strictEqual(profile.id, "agrochemical");
  assert.ok(profile.allowedKPIs.includes("Active Ingredients (AI) Volume Growth"));
  assert.ok(profile.allowedKPIs.includes("Channel Inventory Days"));
});

it("Cement sector correctly classified", () => {
  const profile = classifySector("Materials", "Cement & Building Materials", "UltraTech Cement produces grey cement, white cement, clinker, and ready-mix concrete across India.");
  assert.strictEqual(profile.id, "cement");
  assert.ok(profile.allowedKPIs.includes("EBITDA per Tonne"));
  assert.ok(profile.allowedKPIs.includes("Clinker Capacity Utilization"));
});

it("Utility ontology blocks out-of-sector concept: 'dealer network'", () => {
  const check = validateSectorConcepts(UTILITIES_PROFILE, "The company leverages an extensive dealer network across northern India to expand retail distribution.");
  assert.strictEqual(check.valid, false);
  assert.ok(check.leakedConcepts.includes("dealer network"));
});

it("Utility ontology blocks out-of-sector concept: 'assembly line'", () => {
  const check = validateSectorConcepts(UTILITIES_PROFILE, "Capital investments targeted assembly line automation and robotic throughput.");
  assert.strictEqual(check.valid, false);
  assert.ok(check.leakedConcepts.includes("assembly line"));
});

it("Utility ontology blocks out-of-sector concept: 'enterprise contract'", () => {
  const check = validateSectorConcepts(UTILITIES_PROFILE, "Secured multi-year enterprise contract renewals with Tier-1 multinational clients.");
  assert.strictEqual(check.valid, false);
  assert.ok(check.leakedConcepts.includes("enterprise contract"));
});

it("Agrochemical ontology blocks out-of-sector concept: 'enterprise contracts'", () => {
  const check = validateSectorConcepts(AGROCHEMICAL_PROFILE, "Management signed new enterprise contracts for SaaS cloud analytics.");
  assert.strictEqual(check.valid, false);
  assert.ok(check.leakedConcepts.includes("enterprise contracts"));
});

it("Clean utility narrative passes concept validation", () => {
  const check = validateSectorConcepts(UTILITIES_PROFILE, "NTPC maintained high plant load factor (PLF) of 78% with long-term 25-year PPAs providing a 15.5% regulated return on equity.");
  assert.strictEqual(check.valid, true);
  assert.strictEqual(check.leakedConcepts.length, 0);
});

// ── 2. Valuation Target Price vs. Probability-Weighted Value ──
console.log("\n--- 2. Valuation Target Price & Probability-Weighted Differentiation ---");

const mockCompanyProfile = {
  ticker: "PIIND.NS",
  name: "PI Industries Ltd",
  sector: "Materials",
  industry: "Agrochemicals",
  currency: "INR",
};

const mockStockData = {
  currentPrice: 3800,
  pe: 35,
  marketCap: 570000000000,
  beta: 0.85,
  debtToEquity: 0.05,
};

const mockFinancials = [
  {
    year: "FY24",
    revenue: 76000000000,
    grossProfit: 35000000000,
    operatingIncome: 18000000000,
    netIncome: 15000000000,
    totalAssets: 95000000000,
    totalLiabilities: 20000000000,
    totalEquity: 75000000000,
    freeCashFlow: 14000000000,
    operatingCashFlow: 17000000000,
    ebitda: 20000000000,
    ebitdaMargin: 0.263,
  },
];

const mockDcf = {
  currentMarketPrice: 3800,
  intrinsicValue: 4200,
  verdict: "BUY",
  assumptions: {
    wacc: 0.10,
    terminalGrowthRate: 0.04,
    revenueGrowthRates: [0.14, 0.13, 0.12, 0.10, 0.09],
    ebitMargins: [0.24, 0.24, 0.24, 0.24, 0.24],
    taxRate: 0.22,
  },
};

const ledger = createAssumptionsLedger({
  profile: mockCompanyProfile,
  stockData: mockStockData,
  annualFinancials: mockFinancials,
  dcf: mockDcf,
});

it("Explicitly distinguishes Base Target from Probability-Weighted Target", () => {
  assert.strictEqual(ledger.dcfBaseTarget, 4200);
  assert.strictEqual(ledger.publishedTargetPrice, 4200);
  // Bull = 4200 * 1.25 = 5250; Base = 4200; Bear = 4200 * 0.75 = 3150
  // ProbWeighted = 5250*0.25 + 4200*0.60 + 3150*0.15 = 1312.5 + 2520 + 472.5 = 4305
  assert.strictEqual(ledger.probabilityWeightedValue, 4305);
  assert.notStrictEqual(ledger.publishedTargetPrice, ledger.probabilityWeightedValue);
  assert.ok(ledger.valuationMethodology.includes("5-Year Explicit DCF Base Case"));
});

it("Single canonical Moat object is generated with verifiable economic spread", () => {
  assert.ok(ledger.moat);
  assert.ok(["Wide", "Narrow", "None"].includes(ledger.moat.rating));
  assert.ok(ledger.moat.confidence >= 70);
  assert.ok(ledger.moat.evidence.length >= 2);
  assert.strictEqual(typeof ledger.moat.economicSpread, "number");
});

// ── 3. Share-Count Unit Representation ──
console.log("\n--- 3. Share-Count Unit Calculation ---");

it("Share count in millions formats properly (e.g. 150M shares, not 150,000,000)", () => {
  const rawShares = mockStockData.marketCap / mockStockData.currentPrice; // 150,000,000
  const sharesInMillions = (rawShares / 1e6).toFixed(2);
  assert.strictEqual(sharesInMillions, "150.00");
  assert.strictEqual(`${sharesInMillions} M`, "150.00 M");
});

console.log("\n=======================================================");
console.log(`TEST SUMMARY: ${passed} PASSED, ${total - passed} FAILED`);
console.log("=======================================================");

if (passed !== total) {
  process.exit(1);
}
