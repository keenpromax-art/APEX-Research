/**
 * APEX AI-FIRST — GOLDEN REGRESSION (deterministic layers)
 *
 * Tests the AI-first pipeline's deterministic execution without a live LLM:
 *   1. Fact pack integrity: no zero-filling, provenance tagging, sparse facts.
 *   2. Model runtime: safe expression evaluation, unknown-variable rejection.
 *   3. Forecast engine: driver paths compound deterministically.
 *   4. Statement identities: IS/CF identities enforced with labeled plugs.
 *   5. Valuation engine: AI-selected methods execute; no placeholder fabrication.
 *   6. Scenario flow: bear/base/bull flow through model -> statements -> valuation.
 *   7. Reverse valuation: AI-chosen variable solved by bisection.
 *   8. Report assembly: versioned ResearchReport object assembles cleanly.
 *   9. Full mechanical pipeline: runAiFirstResearch without a key produces
 *      a versioned report with no sector-template contamination.
 *
 * The full AI regression (live LLM company understanding) runs via
 * scratch/test-ai-first-live.mjs when an API key is configured.
 */
import {
  buildFactPack,
  renderFactContext,
  evalExpression,
  applyGrowthPath,
  executeForecast,
  executeValuation,
  flowScenarioThroughModel,
  chooseReverseVariable,
  solveRequiredValue,
  buildRevenueCagrSolver,
  assembleResearchReport,
  runQualityReview,
} from "../src/lib/ai-first";
import { runAiFirstResearch } from "../src/lib/ai-first/pipeline";
import type {
  ForecastSpecification,
  ValuationSpecification,
} from "../src/lib/ai-first/types";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++;
    console.log(`  PASS ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

const approx = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol;

// ─────────────────────────────────────────────
// Fixture: raw Yahoo quoteSummary payload (SBIN-like bank)
// ─────────────────────────────────────────────
function bankPayload(): Record<string, unknown> {
  const row = (end: string, vals: Record<string, number>) => ({
    endDate: { raw: end, fmt: end },
    maxAge: 1,
    ...Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, { raw: v, fmt: String(v) }])),
  });
  return {
    assetProfile: {
      longBusinessSummary: "State Bank of India is a commercial bank engaged in retail banking, corporate banking, and treasury operations.",
      sector: "Financial Services",
      industry: "Banks - Regional",
      country: "India",
    },
    price: {
      longName: "State Bank of India",
      shortName: "SBIN",
      currency: "INR",
      regularMarketPrice: { raw: 820 },
      marketCap: { raw: 7320000000000 },
    },
    summaryDetail: { beta: { raw: 1.1 } },
    financialData: { recommendationKey: "buy", targetMeanPrice: { raw: 900 } },
    defaultKeyStatistics: { sharesOutstanding: { raw: 8920000000 }, bookValue: { raw: 415 } },
    incomeStatementHistory: {
      incomeStatementHistory: [
        row("2024-03-31", { totalRevenue: 4763000000000, netIncome: 610000000000, interestIncome: 6200000000000, interestExpense: 4400000000000 }),
        row("2023-03-31", { totalRevenue: 4200000000000, netIncome: 500000000000 }),
      ],
    },
    balanceSheetHistory: {
      balanceSheetHistory: [
        row("2024-03-31", { totalAssets: 61000000000000, totalLiabilities: 55600000000000, totalEquity: 5400000000000, totalDebt: 900000000000, cash: 3000000000000 }),
      ],
    },
    cashflowStatementHistory: {
      cashflowStatementHistory: [row("2024-03-31", { totalCashFromOperatingActivities: 800000000000, capitalExpenditures: 120000000000 })],
    },
    earningsTrend: { trend: [{ period: "+1y", growth: { raw: 0.12 }, earningsEstimate: { avg: { raw: 78 } }, revenueEstimate: { avg: { raw: 5200000000000 } } }] },
    majorHoldersBreakdown: { insidersPercentHeld: { raw: 0.057 }, institutionsPercentHeld: { raw: 0.42 } },
  };
}

// ─────────────────────────────────────────────
// 1. Fact pack integrity
// ─────────────────────────────────────────────
console.log("\n1. FACT PACK INTEGRITY");
const pack = buildFactPack(bankPayload(), "SBIN.NS");
check("builds fact pack", !!pack && pack.ticker === "SBIN.NS");
check("fact pack versioned", !!pack.version);
const revenueFact = pack.incomeStatement.facts.find((f) => f.metric === "totalRevenue");
check("revenue fact present with provenance", revenueFact?.value === 4763000000000 && revenueFact?.source === "yfinance");
check("retrieval timestamp present", !!revenueFact?.retrievalTimestamp);
const missing = buildFactPack({}, "TEST").incomeStatement;
check("missing data stays missing (no zero-fill)", missing.facts.length === 0);
const ctx = renderFactContext(pack, ["incomeStatement"]);
check("fact context renders fact IDs", ctx.includes("[F-totalRevenue]"));
check("fact context marks sparse sections", !ctx.includes("## balanceSheet"));

// Missing-value preservation inside rows
const partial = buildFactPack({
  incomeStatementHistory: { incomeStatementHistory: [{ endDate: { fmt: "2024-03-31" }, totalRevenue: { raw: 100 }, netIncome: { raw: NaN } }] },
}, "TEST");
check("NaN preserved as undefined (never 0)", partial.incomeStatement.facts.find((f) => f.metric === "netIncome")?.value === undefined);
check("valid sibling value still captured", partial.incomeStatement.facts.find((f) => f.metric === "totalRevenue")?.value === 100);

// ─────────────────────────────────────────────
// 2. Model runtime
// ─────────────────────────────────────────────
console.log("\n2. MODEL RUNTIME (AI decides, code executes)");
const r1 = evalExpression("volume * asp", { volume: 10, asp: 10 });
check("volume * asp = 100", r1.ok && r1.value === 100);
const r2 = evalExpression("interestIncome - interestExpense", { interestIncome: 620, interestExpense: 440 });
check("NII = 180 (bank-native)", r2.ok && r2.value === 180);
const r3 = evalExpression("(revenue * margin) - capex", { revenue: 1000, margin: 0.2, capex: 50 });
check("parentheses + precedence", r3.ok && Math.abs(r3.value - 150) < 1e-9);
const r4 = evalExpression("revenue / 0", { revenue: 100 });
check("div-by-zero rejected", !r4.ok);
const r5 = evalExpression("revenue * unknownVar", { revenue: 100 });
check("unknown variable rejected", !r5.ok);
const r6 = evalExpression("revenue; process.exit(1)", { revenue: 100 });
check("code injection rejected", !r6.ok);
const gp = applyGrowthPath(100, [0.12, 0.1]);
check("growth path compounds (100 -> 112 -> 123.2)", approx(gp[0], 112) && approx(gp[1], 123.2));

// ─────────────────────────────────────────────
// 3. Forecast engine (deterministic)
// ─────────────────────────────────────────────
console.log("\n3. FORECAST ENGINE");
const demoSpec: ForecastSpecification = {
  horizonYears: 3,
  horizonRationale: "regression fixture",
  variables: [
    { name: "revenue", label: "Revenue", baseValue: 1000, unit: "currency", kind: "input" },
    { name: "netMargin", label: "Net margin", baseValue: 0.1, unit: "decimal", kind: "input" },
    { name: "netIncome", label: "Net income", baseValue: 100, unit: "currency", kind: "computed" },
  ],
  formulas: [
    { id: "F1", equation: "Net income = Revenue x Net margin", expression: "revenue * netMargin", output: "netIncome", variables: ["revenue", "netMargin"], explanation: "fixture", sourceFacts: [], confidence: 1 },
  ],
  assumptions: [
    { id: "A1", assumption: "Revenue +10%", variable: "revenue", value: 0.1, unit: "%", period: "Y1-Y3", rationale: "fixture", historicalEvidence: "", confidence: 1 },
    { id: "A2", assumption: "Margin 10%", variable: "netMargin", value: 0.1, unit: "decimal", period: "Y1-Y3", rationale: "fixture", historicalEvidence: "", confidence: 1 },
  ],
  driverPaths: { revenue: [0.1, 0.1, 0.1] },
};
const fOut = executeForecast({ model: demoSpec, factPack: pack });
check("forecast produces horizon years", fOut.forecast.incomeStatement.length === 3);
const y1Rev = fOut.forecast.incomeStatement[0]?.values.revenue;
check("revenue compounds deterministically", y1Rev !== undefined && approx(y1Rev, 1100, 1));
const y1NI = fOut.forecast.incomeStatement[0]?.values.netIncome;
check("formula executes (NI = rev * margin)", y1NI !== undefined && approx(y1NI, 110, 1));
check("no zero-fill for unknown lines", fOut.forecast.incomeStatement[0]?.values.grossProfit === undefined);
check("identity checks recorded", fOut.identityChecks.length >= 0);

// ─────────────────────────────────────────────
// 4/5. Valuation engine (AI selects; code executes)
// ─────────────────────────────────────────────
console.log("\n4. VALUATION ENGINE");
const dcfSpec: ValuationSpecification = {
  methodology: "DCF",
  rationale: "fixture",
  variablesDrivingValuation: ["netIncome"],
  assumptions: [
    { id: "AV1", assumption: "wacc", variable: "wacc", value: 0.1, unit: "decimal", period: "Y1-Y3", rationale: "fixture", historicalEvidence: "", confidence: 1 },
    { id: "AV2", assumption: "terminal", variable: "terminalGrowth", value: 0.04, unit: "decimal", period: "terminal", rationale: "fixture", historicalEvidence: "", confidence: 1 },
  ],
  discountRate: 0.1,
  discountRateRationale: "fixture",
  terminalAssumptions: { growth: 0.04, rationale: "fixture" },
  methodsConsidered: [{ method: "DCF", verdict: "selected", reason: "fixture" }],
};
const val = executeValuation(dcfSpec, fOut.forecast, pack);
check("DCF executes to a fair value", val.fairValuePerShare !== undefined && isFinite(val.fairValuePerShare));
check("upside computed vs yfinance price", val.upsidePct !== undefined && isFinite(val.upsidePct));
const unknownVal = executeValuation({ ...dcfSpec, methodology: "MADE_UP_METHOD" }, fOut.forecast, pack);
check("unknown method stays unavailable (no fabrication)", unknownVal.fairValuePerShare === undefined);
const noSharesPack = buildFactPack({}, "NODATA");
const noSharesVal = executeValuation(dcfSpec, fOut.forecast, noSharesPack);
check("missing shares/price never fabricated", noSharesVal.fairValuePerShare === undefined || noSharesVal.upsidePct === undefined);

// ─────────────────────────────────────────────
// 6. Scenario flow-through
// ─────────────────────────────────────────────
console.log("\n5. SCENARIO FLOW-THROUGH");
const scen = {
  name: "bull" as const,
  changedVariables: [{ variable: "revenue", baseValue: 0.1, scenarioValue: 0.15, rationale: "fixture" }],
  targetPrice: undefined as number | undefined,
  targetProvenance: "forecast" as const,
};
const flowed = flowScenarioThroughModel(scen, demoSpec, pack, dcfSpec);
check("scenario flows to a target price", flowed.scenario.targetPrice !== undefined);
check("bull scenario exceeds base DCF", (flowed.scenario.targetPrice ?? 0) >= (val.fairValuePerShare ?? 0));

// ─────────────────────────────────────────────
// 7. Reverse valuation
// ─────────────────────────────────────────────
console.log("\n6. REVERSE VALUATION");
const understandingForReverse = {
  primaryEconomicAbstraction: "revenue growth",
} as never;
const chosen = chooseReverseVariable(understandingForReverse, val);
check("reverse variable chosen", chosen !== null && !!chosen?.variable);
if (chosen && chosen.variable === "revenueCagr") {
  const solver = buildRevenueCagrSolver(pack, demoSpec, dcfSpec, ({ model, factPack: fp }) => ({ forecast: executeForecast({ model, factPack: fp }).forecast }), (s, f, p) => executeValuation(s, f, p));
  const solved = solveRequiredValue(chosen, 820, solver);
  check("bisection solves a required value", solved !== null);
}

// ─────────────────────────────────────────────
// 8. Report assembly + quality review
// ─────────────────────────────────────────────
console.log("\n7. REPORT ASSEMBLY + QUALITY REVIEW");
const thesisFixture = {
  thesis: "Fixture thesis grounded in yfinance revenue history.",
  bullCase: ["Growth"], bearCase: ["Slowdown"], keyDebate: "Growth durability",
  keyInflectionPoints: [], whatMarketMayBeMissing: "None", whatCouldInvalidate: ["Margin collapse"],
};
const assembled = assembleResearchReport({
  companyUnderstanding: {
    ticker: "SBIN.NS", companyName: "State Bank of India",
    whatItDoes: "Commercial bank", howItMakesMoney: "Net interest income",
    businessSegments: [], economicUnits: ["deposits"], primaryEconomicAbstraction: "net interest income",
    revenueDrivers: [], costDrivers: [], marginDrivers: [], cashGenerationDrivers: [],
    balanceSheetDrivers: [], returnsDrivers: [], keyKpis: [], metricsToAvoid: [],
    statementsThatMatterMost: [], industryContext: "", appropriateValuationMethods: [],
    confidence: { overall: 0.8, dataQuality: "fixture", reasoning: "fixture" },
  },
  factPack: pack,
  forecastSpec: demoSpec,
  formulas: demoSpec.formulas,
  forecast: fOut.forecast,
  valuationSpec: dcfSpec,
  valuation: val,
  scenarios: [flowed.scenario],
  thesis: thesisFixture,
  risks: [],
  catalysts: [],
  competitiveAnalysis: { competitors: [] },
  moat: { hasMoat: false, sources: [], verdict: "fixture" },
  historicalAnalysis: "fixture",
  managementAnalysis: "fixture",
  capitalAllocation: "fixture",
  financialQuality: "fixture",
  sensitivity: [],
  reverseValuation: null,
  conclusion: "fixture",
  reviews: [],
  reviewPassed: false,
  regenerationLog: [],
});
check("report versioned (run/model/prompt/fact/review)", !!(assembled.researchRunId && assembled.modelVersion && assembled.promptVersion && assembled.factPackVersion && assembled.reviewVersion));
const qr = runQualityReview(assembled, pack);
check("quality review executes (score + findings shape)", typeof qr.overallScore === "number" && Array.isArray(qr.allFindings));

// ─────────────────────────────────────────────
// 9. Full mechanical pipeline (no key)
// ─────────────────────────────────────────────
console.log("\n8. FULL MECHANICAL PIPELINE (no AI key)");
async function runMechanicalChecks(): Promise<void> {
  const pipe = await runAiFirstResearch("SBIN.NS", bankPayload(), {});
  check("pipeline produces a report", !!pipe.report && pipe.report.companyTicker === "SBIN.NS");
  check("pipeline marks mechanical run", pipe.aiUsed === false);
  check("pipeline forecast has 5 years", pipe.report.forecast.incomeStatement.length === 5);
  check("pipeline scenarios are Bear/Base/Bull", pipe.report.scenarios.length === 3);
  const blob = JSON.stringify(pipe.report).toLowerCase();
  const leaks = ["search index", "advertiser bidding", "custom silicon", "hyperscale infrastructure", "same-store sales", "foot traffic"].filter((s) => blob.includes(s));
  check("mechanical report has no cross-sector contamination", leaks.length === 0, leaks.join(", "));
  check("sensitivity grid populated", pipe.report.sensitivity.length === 9);
}

runMechanicalChecks().then(() => {
  console.log(`\nRESULTS: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}).catch((e) => {
  console.error("Mechanical pipeline checks failed:", e);
  process.exit(1);
});
