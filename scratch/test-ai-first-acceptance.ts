/**
 * APEX AI-FIRST — ACCEPTANCE (mocked AI transports)
 *
 * Proves the SAME pipeline dynamically produces materially different
 * business models / KPIs / formulas / valuation methods for different
 * companies with ZERO hardcoded company/sector rules in the pipeline.
 */
import { runAiFirstResearch } from "../src/lib/ai-first/pipeline";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? " -- " + detail : ""}`); }
}

function basePayload(name: string, desc: string): Record<string, unknown> {
  const row = (end: string, vals: Record<string, number>) => ({
    endDate: { fmt: end },
    ...Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, { raw: v }])),
  });
  return {
    assetProfile: { longBusinessSummary: desc, sector: "s", industry: "i", country: "c" },
    price: { longName: name, shortName: name, currency: "USD", regularMarketPrice: { raw: 100 }, marketCap: { raw: 1e11 } },
    summaryDetail: {},
    financialData: {},
    defaultKeyStatistics: { sharesOutstanding: { raw: 1e9 }, bookValue: { raw: 20 } },
    incomeStatementHistory: { incomeStatementHistory: [row("2024-12-31", { totalRevenue: 1e10, netIncome: 1e9 })] },
    balanceSheetHistory: { balanceSheetHistory: [row("2024-12-31", { totalAssets: 5e10, totalEquity: 2e10 })] },
    cashflowStatementHistory: { cashflowStatementHistory: [row("2024-12-31", { totalCashFromOperatingActivities: 2e9 })] },
    earningsTrend: { trend: [] },
    majorHoldersBreakdown: {},
  };
}

function understandingJson(kind: "bank" | "ads" | "auto"): string {
  if (kind === "bank") return JSON.stringify({
    whatItDoes: "Commercial bank taking deposits and making advances",
    howItMakesMoney: "Net interest income plus fees",
    businessSegments: [], economicUnits: ["deposits", "advances"],
    primaryEconomicAbstraction: "net interest income",
    revenueDrivers: [{ name: "NIM", mechanism: "spread", sourceFacts: [], statementLine: null }],
    costDrivers: [], marginDrivers: [], cashGenerationDrivers: [],
    balanceSheetDrivers: [], returnsDrivers: [],
    keyKpis: [{ name: "NIM", rationale: "bank spread", availability: "modeled", unit: "%" }],
    metricsToAvoid: [{ metric: "EBITDA", reason: "meaningless for banks" }, { metric: "EV/EBITDA", reason: "meaningless for banks" }],
    statementsThatMatterMost: ["balanceSheet"], industryContext: "banking",
    appropriateValuationMethods: [{ method: "Residual Income", why: "book value + ROE" }],
    confidence: { overall: 0.9, dataQuality: "good", reasoning: "mock" },
  });
  if (kind === "ads") return JSON.stringify({
    whatItDoes: "Internet advertising platform",
    howItMakesMoney: "Advertising monetization of queries",
    businessSegments: [], economicUnits: ["queries"],
    primaryEconomicAbstraction: "advertising monetization",
    revenueDrivers: [{ name: "queries", mechanism: "search activity", sourceFacts: [], statementLine: null }],
    costDrivers: [], marginDrivers: [], cashGenerationDrivers: [],
    balanceSheetDrivers: [], returnsDrivers: [],
    keyKpis: [{ name: "ARPU", rationale: "monetization", availability: "modeled", unit: "currency" }],
    metricsToAvoid: [{ metric: "NIM", reason: "not a bank" }, { metric: "P/B", reason: "asset-light" }],
    statementsThatMatterMost: ["incomeStatement"], industryContext: "internet",
    appropriateValuationMethods: [{ method: "DCF", why: "cash generative" }],
    confidence: { overall: 0.9, dataQuality: "good", reasoning: "mock" },
  });
  return JSON.stringify({
    whatItDoes: "Automotive manufacturer of electric vehicles and batteries",
    howItMakesMoney: "Vehicle volumes times ASP",
    businessSegments: [], economicUnits: ["vehicles"],
    primaryEconomicAbstraction: "vehicle volumes",
    revenueDrivers: [{ name: "vehicle volumes", mechanism: "units", sourceFacts: [], statementLine: null }],
    costDrivers: [], marginDrivers: [], cashGenerationDrivers: [],
    balanceSheetDrivers: [], returnsDrivers: [],
    keyKpis: [{ name: "ASP", rationale: "mix", availability: "modeled", unit: "currency" }],
    metricsToAvoid: [{ metric: "NIM", reason: "not a bank" }],
    statementsThatMatterMost: ["incomeStatement"], industryContext: "autos",
    appropriateValuationMethods: [{ method: "DCF", why: "capex cycle" }],
    confidence: { overall: 0.9, dataQuality: "good", reasoning: "mock" },
  });
}

function modelJson(kind: "bank" | "ads" | "auto"): string {
  if (kind === "bank") return JSON.stringify({
    horizonYears: 5, horizonRationale: "mock",
    variables: [
      { name: "interestIncome", label: "Interest income", baseValue: 620, unit: "currency", kind: "input", statementLine: null },
      { name: "interestExpense", label: "Interest expense", baseValue: 440, unit: "currency", kind: "input", statementLine: null },
      { name: "nii", label: "Net interest income", baseValue: 180, unit: "currency", kind: "computed", statementLine: null },
      { name: "revenue", label: "Revenue", baseValue: 300, unit: "currency", kind: "computed", statementLine: null },
      { name: "netIncome", label: "Net income", baseValue: 100, unit: "currency", kind: "computed", statementLine: null },
    ],
    formulas: [
      { id: "F1", equation: "NII = Interest income - Interest expense", expression: "interestIncome - interestExpense", output: "nii", variables: ["interestIncome", "interestExpense"], explanation: "bank spread", sourceFacts: [], confidence: 0.9 },
      { id: "F2", equation: "Net income = NII x 0.55", expression: "nii * 0.55", output: "netIncome", variables: ["nii"], explanation: "mock", sourceFacts: [], confidence: 0.7 },
      { id: "F3", equation: "Revenue = NII x 1.6", expression: "nii * 1.6", output: "revenue", variables: ["nii"], explanation: "mock", sourceFacts: [], confidence: 0.7 },
    ],
    assumptions: [{ id: "A1", assumption: "NII +8%", variable: "interestIncome", value: 0.08, unit: "%", period: "Y1", rationale: "mock", historicalEvidence: "", confidence: 0.8 }],
    driverPaths: { interestIncome: [0.08, 0.08, 0.08, 0.08, 0.08], interestExpense: [0.06, 0.06, 0.06, 0.06, 0.06] },
  });
  if (kind === "ads") return JSON.stringify({
    horizonYears: 5, horizonRationale: "mock",
    variables: [
      { name: "queries", label: "Queries", baseValue: 1000, unit: "count", kind: "input", statementLine: null },
      { name: "monetization", label: "Monetization", baseValue: 10, unit: "currency", kind: "input", statementLine: null },
      { name: "revenue", label: "Revenue", baseValue: 10000, unit: "currency", kind: "computed", statementLine: null },
      { name: "netIncome", label: "Net income", baseValue: 2000, unit: "currency", kind: "computed", statementLine: null },
    ],
    formulas: [
      { id: "F1", equation: "Revenue = Queries x Monetization", expression: "queries * monetization", output: "revenue", variables: ["queries", "monetization"], explanation: "ad platform", sourceFacts: [], confidence: 0.9 },
      { id: "F2", equation: "Net income = Revenue x 0.2", expression: "revenue * 0.2", output: "netIncome", variables: ["revenue"], explanation: "mock", sourceFacts: [], confidence: 0.7 },
    ],
    assumptions: [{ id: "A1", assumption: "queries +6%", variable: "queries", value: 0.06, unit: "%", period: "Y1", rationale: "mock", historicalEvidence: "", confidence: 0.8 }],
    driverPaths: { queries: [0.06, 0.06, 0.06, 0.06, 0.06], monetization: [0.03, 0.03, 0.03, 0.03, 0.03] },
  });
  return JSON.stringify({
    horizonYears: 5, horizonRationale: "mock",
    variables: [
      { name: "volume", label: "Vehicle volume", baseValue: 100, unit: "units", kind: "input", statementLine: null },
      { name: "asp", label: "ASP", baseValue: 100, unit: "currency", kind: "input", statementLine: null },
      { name: "revenue", label: "Revenue", baseValue: 10000, unit: "currency", kind: "computed", statementLine: null },
      { name: "netIncome", label: "Net income", baseValue: 800, unit: "currency", kind: "computed", statementLine: null },
    ],
    formulas: [
      { id: "F1", equation: "Revenue = Volume x ASP", expression: "volume * asp", output: "revenue", variables: ["volume", "asp"], explanation: "auto", sourceFacts: [], confidence: 0.9 },
      { id: "F2", equation: "Net income = Revenue x 0.08", expression: "revenue * 0.08", output: "netIncome", variables: ["revenue"], explanation: "mock", sourceFacts: [], confidence: 0.7 },
    ],
    assumptions: [{ id: "A1", assumption: "volume +12%", variable: "volume", value: 0.12, unit: "%", period: "Y1", rationale: "mock", historicalEvidence: "", confidence: 0.8 }],
    driverPaths: { volume: [0.12, 0.12, 0.12, 0.12, 0.12], asp: [0.02, 0.02, 0.02, 0.02, 0.02] },
  });
}

function valuationJson(kind: "bank" | "ads" | "auto"): string {
  if (kind === "bank") return JSON.stringify({
    methodology: "Residual Income", rationale: "bank book value economics",
    variablesDrivingValuation: ["nii"], assumptions: [],
    discountRate: 0.12, discountRateRationale: "mock",
    terminalAssumptions: { growth: 0.04, rationale: "mock" },
    methodsConsidered: [
      { method: "Residual Income", verdict: "selected", reason: "book value" },
      { method: "EV/EBITDA", verdict: "rejected", reason: "meaningless for banks" },
    ],
  });
  return JSON.stringify({
    methodology: "DCF", rationale: "cash generative",
    variablesDrivingValuation: ["revenue"], assumptions: [],
    discountRate: 0.1, discountRateRationale: "mock",
    terminalAssumptions: { growth: 0.04, rationale: "mock" },
    methodsConsidered: [{ method: "DCF", verdict: "selected", reason: "mock" }],
  });
}

function mockTransport(kind: "bank" | "ads" | "auto") {
  return async ({ system }: { system: string; user: string }) => {
    const s = system.toLowerCase();
    // Order matters: specific stage markers first, generic understanding last.
    if (s.includes("research plan")) return JSON.stringify({
      questions: [{ question: `Mock question for ${kind}`, why: "mock", requiredFor: "model", yfinanceAvailable: false, evidenceNeeded: "mock filing" }],
      unknowns: ["mock unknown"], requiredResearch: ["mock report"], epistemicSummary: `KNOWN: ${kind} facts | INFERRED: mock | UNKNOWN: mock`,
    });
    if (s.includes("most important debates") || s.includes("thesis engine")) return JSON.stringify({
      debates: [{ debate: `Mock debate for ${kind}`, evidenceFor: [{ evidence: "mock for", factIds: ["[F-totalRevenue]"], tier: 4 }], evidenceAgainst: [{ evidence: "mock against", factIds: [], tier: 6 }], mechanism: "mock", significance: "mock" }],
      centralDebateIndex: 0, thesis: `Mock ${kind} debate thesis`, thesisEvidence: ["mock evidence [F-totalRevenue]"], thesisCounterEvidence: ["mock counter"], keyUncertainty: "mock uncertainty", invalidationCondition: "mock invalidation", monitoringKpi: "Revenue", confidence: 0.8,
    });
    if (s.includes("valuation specialist")) return valuationJson(kind);
    if (s.includes("three scenarios")) return JSON.stringify({
      scenarios: [
        { name: "bear", changedVariables: [{ variable: "revenue", baseValue: 0.08, scenarioValue: 0.04, rationale: "mock" }] },
        { name: "base", changedVariables: [{ variable: "revenue", baseValue: 0.08, scenarioValue: 0.08, rationale: "mock" }] },
        { name: "bull", changedVariables: [{ variable: "revenue", baseValue: 0.08, scenarioValue: 0.12, rationale: "mock" }] },
      ],
      generationRationale: "mock", scenarioDriverSummary: "mock",
    });
    if (s.includes("financial modeling agent")) return modelJson(kind);
    if (s.includes("qualitative research narrative") || s.includes("investment thesis") || s.includes("writer role")) return JSON.stringify({
      thesis: { thesis: `Mock ${kind} thesis`, bullCase: [], bearCase: [], keyDebate: "", keyInflectionPoints: [], whatMarketMayBeMissing: "", whatCouldInvalidate: [] },
      catalysts: [], risks: [{ risk: "mock risk", mechanism: "mock mechanism for this company", affectedKpi: "revenue", financialConsequence: "mock", valuationConsequence: "mock", monitoringIndicator: "mock" }],
      competitiveAnalysis: { competitors: [], insufficient: true },
      moat: { hasMoat: false, sources: [], verdict: "mock" },
    });
    return understandingJson(kind);
  };
}

async function main() {
  console.log("\nAI-FIRST ACCEPTANCE (mocked AI, same pipeline, 3 companies)");
  const sbin = await runAiFirstResearch("SBIN.NS", basePayload("SBIN", "bank"), { transport: mockTransport("bank") });
  const goog = await runAiFirstResearch("GOOG", basePayload("GOOG", "ads"), { transport: mockTransport("ads") });
  const byd = await runAiFirstResearch("BYD", basePayload("BYD", "auto"), { transport: mockTransport("auto") });

  check("SBIN understood as bank (NII abstraction)", /net interest income/i.test(sbin.understanding.primaryEconomicAbstraction));
  check("GOOG understood as ad platform", /advertising monetization/i.test(goog.understanding.primaryEconomicAbstraction));
  check("BYD understood as volume business", /vehicle/i.test(byd.understanding.primaryEconomicAbstraction));
  check("SBIN model uses NII formula", sbin.forecastSpec.formulas.some((f) => /interestIncome/i.test(f.expression)));
  check("GOOG model uses queries x monetization", goog.forecastSpec.formulas.some((f) => /queries/i.test(f.expression) && /monetization/i.test(f.expression)));
  check("BYD model uses volume x ASP", byd.forecastSpec.formulas.some((f) => /volume/i.test(f.expression) && /asp/i.test(f.expression)));
  check("SBIN valuation is Residual Income (not EV/EBITDA)", sbin.report.valuation.methodology === "Residual Income", `${sbin.report.valuation.methodology}; selected=${sbin.report.valuationMatrix?.selectedMethod}; primary=${sbin.report.valuationMatrix?.primaryMethod}`);
  check("GOOG valuation is DCF (not bank Residual Income)", goog.report.valuation.methodology === "DCF", `${goog.report.valuation.methodology}; selected=${goog.report.valuationMatrix?.selectedMethod}; primary=${goog.report.valuationMatrix?.primaryMethod}`);

  const sbinBlob = JSON.stringify(sbin.report).toLowerCase();
  check("SBIN avoids platform concepts", !/search index|advertiser bidding|custom silicon|hyperscale/.test(sbinBlob));

  console.log(`\nRESULTS: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
