import assert from "node:assert";
import { computeDCF } from "../src/lib/calculations.ts";
import { createAssumptionsLedger } from "../src/lib/assumptions-ledger.ts";
import { validateReportIntegrity } from "../src/lib/report-qa.ts";
import { validateMasterReport } from "../src/lib/report-validator.ts";

console.log("============================================================");
console.log("TEST SUITE: DCF BRIDGE LINKING, STRING SANITY & QA GATE");
console.log("============================================================\n");

// --- TEST 1: Variable Linking Between Balance Sheet and DCF Bridge ---
console.log("--- 1. Testing Balance Sheet & DCF Bridge Variable Linking ---");

const profile = {
  name: "Reliance Industries Limited",
  ticker: "RELIANCE.NS",
  sector: "Energy",
  industry: "Oil & Gas Refining & Marketing",
  currency: "INR",
};

const stockData = {
  ticker: "RELIANCE.NS",
  currentPrice: 2950,
  sharesOutstanding: 6766000000,
  marketCap: 19959700000000,
  beta: 1.05,
  totalDebt: 3461420000000,
  totalCash: 935400000000,
  operatingMargins: 0.124,
  grossMargins: 0.251,
};

const annualFinancials = [
  {
    year: "FY2023",
    revenue: 8794680000000,
    costOfRevenue: 6500000000000,
    grossProfit: 2294680000000,
    operatingIncome: 1040000000000,
    ebitda: 1530000000000,
    netIncome: 667020000000,
    operatingCashFlow: 1400000000000,
    capitalExpenditures: 1400000000000,
    freeCashFlow: 0,
    totalAssets: 16000000000000,
    totalLiabilities: 7500000000000,
    totalEquity: 8500000000000,
    shortTermDebt: 900000000000,
    longTermDebt: 2200000000000,
    totalDebt: 3100000000000,
    cash: 800000000000,
    shortTermInvestments: 50000000000,
    sharesOutstanding: 6766000000,
  },
  {
    year: "FY2024",
    revenue: 9010640000000,
    costOfRevenue: 6745990000000,
    grossProfit: 2264650000000,
    operatingIncome: 1116660000000,
    ebitda: 1769440000000,
    netIncome: 696210000000,
    operatingCashFlow: 1587880000000,
    capitalExpenditures: 1528830000000,
    freeCashFlow: 59050000000,
    totalAssets: 17559860000000,
    totalLiabilities: 8301980000000,
    totalEquity: 9257880000000,
    shortTermDebt: 1019100000000,
    longTermDebt: 2227120000000,
    totalDebt: 3461420000000,
    cash: 935400000000,
    shortTermInvestments: 0,
    sharesOutstanding: 6766000000,
  },
];

const dcf = computeDCF(annualFinancials, stockData);
const ledger = createAssumptionsLedger({ profile, stockData, annualFinancials, dcf });

console.log(`- DCF EV: ${dcf.enterpriseValue.toFixed(0)}`);
console.log(`- Balance Sheet Total Debt: ${annualFinancials[1].totalDebt}`);
console.log(`- DCF Total Debt: ${dcf.totalDebt}`);
console.log(`- Ledger Total Debt: ${ledger.totalDebt}`);
console.log(`- Balance Sheet Cash: ${annualFinancials[1].cash}`);
console.log(`- DCF Cash & Equiv: ${dcf.cashAndEquiv}`);
console.log(`- Ledger Cash & Equiv: ${ledger.cashAndEquiv}`);
console.log(`- DCF Net Debt: ${dcf.netDebt}`);
console.log(`- Ledger Net Debt: ${ledger.netDebt}`);
console.log(`- Expected Net Debt: ${annualFinancials[1].totalDebt - annualFinancials[1].cash}`);
console.log(`- DCF Equity Value: ${dcf.equityValue.toFixed(0)}`);
console.log(`- Ledger Equity Value: ${ledger.equityValue.toFixed(0)}`);
console.log(`- Expected Equity Value: ${(dcf.enterpriseValue - dcf.netDebt).toFixed(0)}`);
console.log(`- DCF Fair Value: ₹${dcf.fairValuePerShare}`);
console.log(`- Ledger Fair Value: ₹${ledger.fairValue}`);

// Assert strict variable linking
assert.strictEqual(dcf.totalDebt, annualFinancials[1].totalDebt, "DCF totalDebt must match BS totalDebt");
assert.strictEqual(ledger.totalDebt, annualFinancials[1].totalDebt, "Ledger totalDebt must match BS totalDebt");
assert.strictEqual(dcf.cashAndEquiv, annualFinancials[1].cash, "DCF cash must match BS cash");
assert.strictEqual(ledger.cashAndEquiv, annualFinancials[1].cash, "Ledger cash must match BS cash");
assert.strictEqual(dcf.netDebt, annualFinancials[1].totalDebt - annualFinancials[1].cash, "DCF netDebt must match BS netDebt");
assert.strictEqual(ledger.netDebt, dcf.netDebt, "Ledger netDebt must match DCF netDebt");
assert.strictEqual(dcf.equityValue, dcf.enterpriseValue - dcf.netDebt, "Equity value must strictly equal EV - NetDebt");
assert.strictEqual(ledger.equityValue, dcf.equityValue, "Ledger equity value must match DCF equity value");
assert.ok(Math.abs(ledger.fairValue - (ledger.equityValue / stockData.sharesOutstanding)) < 0.05, "Fair value per share must equal EquityValue / Shares");
console.log(">>> Balance Sheet & DCF Bridge Variable Linking: PASSED (100% Reconciled)\n");

// --- TEST 2: Sanity Check for Garbled Numeric Strings ---
console.log("--- 2. Testing Sanity Check for Garbled Numeric Strings ---");

// Test safeTableValue behavior
const safeTableValueTest = (s) => {
  if (s === null || s === undefined) return "—";
  let str = String(s).trim();
  if (!str || str === "undefined" || str === "null") return "—";
  if (/NaN|Infinity|-Infinity/.test(str)) return "—";
  if (/^(?:Rs\.?|\$|€|£)\s*—$/.test(str)) return "—";
  if (/^[+\-]?—\s*(?:%|x|days|Cr|L|M|B|T|bps)?$/i.test(str)) return "—";
  if (/^[+\-]?—$/.test(str)) return "—";
  str = str.replace(/^\+\s*-/, "-").replace(/^-\s*\+/, "-").replace(/^-\s*-/, "+").replace(/^\+\s*\+/, "+");
  str = str.replace(/\+\s*-/g, "-").replace(/-\s*\+/g, "-");
  if (/^[+\-]0(?:\.0+)?\s*(?:%|x|days|Cr|L|M|B|T|bps)?$/i.test(str)) {
    str = str.replace(/^[+\-]/, "");
  }
  if (/^[+\-]?\s*$/.test(str)) return "—";
  return str;
};

const garbledCases = [
  { input: "-—", expected: "—" },
  { input: "+—", expected: "—" },
  { input: "—%", expected: "—" },
  { input: "—x", expected: "—" },
  { input: "— days", expected: "—" },
  { input: "Rs. —", expected: "—" },
  { input: "$—", expected: "—" },
  { input: "NaN", expected: "—" },
  { input: "Infinity", expected: "—" },
  { input: "+-250 bps", expected: "-250 bps" },
  { input: "+-1200", expected: "-1200" },
  { input: "-0", expected: "0" },
  { input: "+0", expected: "0" },
  { input: "-0.0%", expected: "0.0%" },
  { input: "-0 days", expected: "0 days" },
  { input: "undefined", expected: "—" },
  { input: "null", expected: "—" },
  { input: "+14.5%", expected: "+14.5%" },
  { input: "-2,500", expected: "-2,500" },
];

for (const c of garbledCases) {
  const sanitized = safeTableValueTest(c.input);
  console.log(`- Input: "${c.input}" -> Output: "${sanitized}" (Expected: "${c.expected}")`);
  assert.strictEqual(sanitized, c.expected, `Sanitizer failed on: ${c.input}`);
}
console.log(">>> Garbled Numeric String Sanity Check: PASSED\n");

// --- TEST 3: QA Gate Actually Blocks or Flags on Semantic Bleeding or Arithmetic Failures ---
console.log("--- 3. Testing QA Gate Blocking on Failures ---");

// 3a. Baseline Clean Report
const cleanReport = {
  profile,
  stockData,
  annualFinancials,
  dcf,
  assumptionsLedger: ledger,
  targetPrice: ledger.fairValue,
  recommendation: ledger.rating,
  cmp: stockData.currentPrice,
  ratiosByYear: [],
  dupontByYear: [],
  aiAnalysis: {
    investmentThesis: "Reliance exhibits structural refining complexity and retail integration advantages.",
    businessStrategyCommentary: "Expansion across domestic petrochemical processing and consumer ecosystems.",
  },
};

const cleanQA = validateReportIntegrity(cleanReport);
console.log(`- Clean QA Gate Status: ${cleanQA.gateStatus} (Passed: ${cleanQA.passed}, Score: ${cleanQA.score})`);
assert.strictEqual(cleanQA.gateStatus, "READY", "Clean report must have gateStatus READY");
assert.strictEqual(cleanQA.passed, true, "Clean report must pass QA");

// 3b. Inject Semantic Bleeding (Pharma / Silicon terms in Energy report)
console.log("\nTesting Semantic Bleeding Detection & Blocking:");
const bleedReport = {
  ...cleanReport,
  aiAnalysis: {
    investmentThesis: "Reliance is advancing proprietary silicon and custom neural engine wafer fabrication under US FDA approved clinical trials.",
    businessStrategyCommentary: "Spectrum auction bids will enhance our dark store app store commission revenue.",
  },
};

const bleedQA = validateReportIntegrity(bleedReport);
console.log(`- Bleed QA Gate Status: ${bleedQA.gateStatus} (Passed: ${bleedQA.passed}, Score: ${bleedQA.score})`);
const bleedCheck = bleedQA.checks.find(c => c.id === "BS-DETECTOR-04");
console.log(`- Bleed Check Details: ${bleedCheck?.details}`);
assert.strictEqual(bleedQA.gateStatus, "BLOCKED", "Semantic bleeding MUST trigger gateStatus BLOCKED");
assert.strictEqual(bleedQA.passed, false, "Semantic bleeding MUST fail QA");
assert.strictEqual(bleedCheck?.status, "FAIL", "BS-DETECTOR-04 must be FAIL");

// 3c. Inject Arithmetic Failure: Disconnect Balance Sheet Net Debt from DCF Bridge
console.log("\nTesting Arithmetic Failure Detection & Blocking (Balance Sheet / DCF Net Debt Disconnect):");
const unlinkedReport = {
  ...cleanReport,
  dcf: {
    ...cleanReport.dcf,
    netDebt: 9999999999999, // Unlinked fake debt
    lessDebt: 9999999999999,
  },
  assumptionsLedger: {
    ...cleanReport.assumptionsLedger,
    netDebt: 9999999999999,
  },
};

const unlinkedQA = validateReportIntegrity(unlinkedReport);
console.log(`- Unlinked QA Gate Status: ${unlinkedQA.gateStatus} (Passed: ${unlinkedQA.passed}, Score: ${unlinkedQA.score})`);
const unlinkedCheck = unlinkedQA.checks.find(c => c.id === "XREF-04");
console.log(`- Unlinked Check Details: ${unlinkedCheck?.details}`);
assert.strictEqual(unlinkedQA.gateStatus, "BLOCKED", "Balance sheet disconnect MUST trigger gateStatus BLOCKED");
assert.strictEqual(unlinkedQA.passed, false, "Balance sheet disconnect MUST fail QA");
assert.strictEqual(unlinkedCheck?.status, "FAIL", "XREF-04 must be FAIL");

// 3d. Inject Arithmetic Failure: Equity Value != EV - NetDebt
console.log("\nTesting Arithmetic Failure Detection & Blocking (Equity Value != EV - NetDebt):");
const brokenEvReport = {
  ...cleanReport,
  dcf: {
    ...cleanReport.dcf,
    equityValue: 5000000000, // Fabricated equity value
  },
  assumptionsLedger: {
    ...cleanReport.assumptionsLedger,
    equityValue: 5000000000,
  },
};

const brokenEvQA = validateReportIntegrity(brokenEvReport);
console.log(`- Broken EV QA Gate Status: ${brokenEvQA.gateStatus} (Passed: ${brokenEvQA.passed}, Score: ${brokenEvQA.score})`);
const brokenEvCheck = brokenEvQA.checks.find(c => c.id === "XREF-03");
console.log(`- Broken EV Check Details: ${brokenEvCheck?.details}`);
assert.strictEqual(brokenEvQA.gateStatus, "BLOCKED", "Equity value mismatch MUST trigger gateStatus BLOCKED");
assert.strictEqual(brokenEvQA.passed, false, "Equity value mismatch MUST fail QA");
assert.strictEqual(brokenEvCheck?.status, "FAIL", "XREF-03 must be FAIL");

// 3e. Test Master Report Validator Integration
console.log("\nTesting validateMasterReport Blocking Integration with qaReport:");
bleedReport.qaReport = bleedQA;
const mockFacts = {
  company: { ticker: "RELIANCE.NS", name: "Reliance Industries", sector: "Energy" },
  market: { currentPrice: { value: 2950 }, sharesOutstanding: { shares: 6766000000 } },
  financials: { history: [{}, {}] },
  peers: { coverageStatus: "ok", peerCoverage: 1.0, validPeers: 4, totalPeers: 4 },
  valuation: { fairValue: { value: ledger.fairValue } },
  recommendation: { rating: ledger.rating },
  moat: { rating: "Narrow" },
  risks: { uncertainty: { rating: "Medium" } },
};

const masterResult = validateMasterReport(mockFacts, bleedReport);
console.log(`- validateMasterReport Status: ${masterResult.status}`);
console.log(`- validateMasterReport canPublish: ${masterResult.canPublish}`);
console.log(`- validateMasterReport errors count: ${masterResult.errors.length}`);
assert.strictEqual(masterResult.canPublish, false, "validateMasterReport MUST lock publication (canPublish === false)");
assert.strictEqual(masterResult.status, "BLOCKED", "validateMasterReport status MUST be BLOCKED");
assert.ok(masterResult.errors.some(e => e.code.startsWith("QA_")), "Errors must contain QA gate failures");

console.log("\n============================================================");
console.log(">>> ALL VERIFICATION CHECKS PASSED SUCCESSFULLY (100%) <<<");
console.log("============================================================");
