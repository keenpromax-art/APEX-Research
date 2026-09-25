import assert from "node:assert/strict";
import { buildFactPack } from "../src/lib/ai-first/fact-pack";
import { executeForecast } from "../src/lib/ai-first/forecast-engine";
import { getAccountingArchitecture } from "../src/lib/ai-first/accounting-architecture";
import { executeValuation, executeValuationMatrix } from "../src/lib/ai-first/valuation-engine";
import { buildValuationViabilityMatrix, normalizeValuationMethod, VALUATION_METHODS } from "../src/lib/ai-first/valuation-methods";
import { runValuationSensitivity, toLegacySensitivityGrid } from "../src/lib/ai-first/sensitivity-engine";
import { runMonteCarlo } from "../src/lib/ai-first/monte-carlo";
import { executeScenarioSet, validateScenarioSet } from "../src/lib/ai-first/scenarios-builder";
import { solveOneVariable, applyReverseVariable, solveReverseValuation } from "../src/lib/ai-first/reverse-valuation";
import { validateReverseValuationPlan } from "../src/lib/ai-first/reverse-planner";
import { runAiFirstResearch } from "../src/lib/ai-first/pipeline";
import type {
  Assumption,
  FactPack,
  ForecastResult,
  ForecastSpecification,
  ReverseValuationPlan,
  ScenarioSpecification,
  ValuationMethodPlan,
  ValuationSpecification,
} from "../src/lib/ai-first/types";

const timestamp = "2026-09-25T12:00:00.000Z";
const row = (period: string, values: Record<string, number>): Record<string, unknown> => ({
  endDate: { raw: period, fmt: period },
  maxAge: 1,
  ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { raw: value, fmt: String(value) }])),
});
const older = row("2023-12-31", { volume: 9, price: 9, totalRevenue: 81, grossProfit: 32, ebit: 16, pretaxIncome: 12, pbt: 12, tax: 2, netIncome: 9, totalOpex: 16, grossMargin: 0.4, ebitMargin: 0.2, taxRate: 0.2, netInterest: 1 });
const newer = row("2024-12-31", { volume: 10, price: 10, totalRevenue: 100, grossProfit: 40, ebit: 20, pretaxIncome: 15, pbt: 15, tax: 3, netIncome: 12, totalOpex: 20, grossMargin: 0.4, ebitMargin: 0.2, taxRate: 0.2, netInterest: 1 });
const balance = row("2024-12-31", { cash: 20, totalAssets: 200, totalLiabilities: 120, totalEquity: 80, totalDebt: 40, retainedEarnings: 50, propertyPlantAndEquipment: 60, accountsReceivable: 15, inventory: 10, accountsPayable: 12 });
const cash = row("2024-12-31", { totalCashFromOperatingActivities: 15, totalCashFromInvestingActivities: -5, totalCashFromFinancingActivities: 0, capitalExpenditures: 5, depreciation: 2, dividends: 1 });
const pack: FactPack = buildFactPack({
  price: { currency: "USD", regularMarketPrice: { raw: 50 } },
  defaultKeyStatistics: { sharesOutstanding: { raw: 10 } },
  incomeStatementHistory: { incomeStatementHistory: [newer, older] },
  balanceSheetHistory: { balanceSheetHistory: [balance] },
  cashflowStatementHistory: { cashflowStatementHistory: [cash] },
}, "VALFOCUS", { retrievalTimestamp: timestamp });

const factId = (metric: string): string => {
  const fact = [...pack.market.facts, ...pack.shares.facts, ...pack.incomeStatement.facts, ...pack.balanceSheet.facts, ...pack.cashFlow.facts].find((candidate) => candidate.metric === metric && candidate.value !== undefined);
  assert.ok(fact?.factId, metric);
  return fact.factId;
};

const variable = (name: string, label: string, baseValue: number, unit: string, statementLine: string, kind: "input" | "computed" = "input") => ({ id: `V-${name}`, name, label, baseValue, ...(kind === "input" ? { baseFactId: factId(statementLine) } : {}), unit, kind, statementLine });
const formula = (id: string, expression: string, output: string, variables: string[], metrics: string[]) => ({ id, equation: `${output} equation`, expression, output, variables, explanation: "Deterministic focused relationship", sourceFacts: metrics.map(factId), confidence: 0.9 });
const model: ForecastSpecification = {
  horizonYears: 3,
  horizonRationale: "Focused three-year model",
  modelId: "MODEL-FOCUS",
  variables: [
    variable("volume", "Volume", 10, "count", "volume"),
    variable("price", "Price", 10, "currency", "price"),
    variable("grossMargin", "Gross margin", 0.4, "decimal", "grossMargin"),
    variable("ebitMargin", "EBIT margin", 0.2, "decimal", "ebitMargin"),
    variable("taxRate", "Tax rate", 0.2, "decimal", "taxRate"),
    variable("netInterest", "Net interest", 1, "currency", "netInterest"),
    variable("revenue", "Revenue", 100, "currency", "totalRevenue", "computed"),
    variable("grossProfit", "Gross profit", 40, "currency", "grossProfit", "computed"),
    variable("ebit", "EBIT", 20, "currency", "ebit", "computed"),
    variable("totalOpex", "Total operating expense", 20, "currency", "totalOpex", "computed"),
    variable("pbt", "Profit before tax", 15, "currency", "pbt", "computed"),
    variable("tax", "Tax", 3, "currency", "tax", "computed"),
    variable("netIncome", "Net income", 12, "currency", "netIncome", "computed"),
  ],
  formulas: [
    formula("F1", "volume * price", "revenue", ["volume", "price"], ["volume", "price"]),
    formula("F2", "revenue * grossMargin", "grossProfit", ["revenue", "grossMargin"], ["totalRevenue", "grossMargin"]),
    formula("F3", "revenue * ebitMargin", "ebit", ["revenue", "ebitMargin"], ["totalRevenue", "ebitMargin"]),
    formula("F4", "grossProfit - ebit", "totalOpex", ["grossProfit", "ebit"], ["grossProfit", "ebit"]),
    formula("F5", "ebit - netInterest", "pbt", ["ebit", "netInterest"], ["ebit", "netInterest"]),
    formula("F6", "pbt * taxRate", "tax", ["pbt", "taxRate"], ["pretaxIncome", "taxRate"]),
    formula("F7", "pbt - tax", "netIncome", ["pbt", "tax"], ["netIncome", "tax"]),
  ],
  assumptions: [],
  driverPaths: { volume: [0.1, 0.2, 0.1], price: [0, 0, 0], grossMargin: [0, 0, 0], ebitMargin: [0, 0, 0], taxRate: [0, 0, 0], netInterest: [0, 0, 0] },
  architecture: "corporate",
};
const forecastOut = executeForecast({ model, factPack: pack, architecture: getAccountingArchitecture("corporate") });
const forecast: ForecastResult = { ...forecastOut.forecast, modelId: model.modelId, forecastId: "FCST-FOCUS" };
const valuationForecast: ForecastResult = {
  ...forecast,
  cashFlow: forecast.cashFlow.map((year, index) => ({ ...year, values: { ...year.values, fcfe: [4, 5, 6][index] } })),
};

const assumption = (variableName: string, value: number, evidenceMetric = "totalRevenue", extra: Partial<Assumption> = {}): Assumption => ({
  id: `A-${variableName}`,
  assumption: `${variableName} assumption`,
  variable: variableName,
  value,
  unit: "decimal",
  period: "Y1-Y3",
  rationale: "Focused deterministic assumption",
  historicalEvidence: `[${factId(evidenceMetric)}]`,
  factIds: [factId(evidenceMetric)],
  confidence: 0.9,
  ...extra,
});
const plan = (method: string, rationale: string, assumptions: Assumption[], extra: Partial<ValuationMethodPlan> = {}): ValuationMethodPlan => ({ method, rationale, variablesDrivingValuation: [], assumptions, ...extra });
const terminal = (metric: "fcff" | "fcfe" | "residual_income" | "dividend") => ({ growth: 0.03, maxValueShare: 0.9, terminalMetric: metric, rationale: "Explicit terminal policy", evidenceIds: [factId("totalRevenue")] });
const componentEvidence = factId("totalRevenue");
const plans: ValuationMethodPlan[] = [
  plan("FCFF DCF", "Primary FCFF", [assumption("wacc", 0.1, "ebit"), assumption("terminalGrowth", 0.03)], { discountRate: 0.1, terminalPolicy: terminal("fcff"), sensitivityVariables: ["wacc", "terminalGrowth"] }),
  plan("FCFE", "Levered cash flow", [assumption("costOfEquity", 0.11, "netIncome"), assumption("terminalGrowth", 0.03)], { terminalPolicy: terminal("fcfe"), sensitivityVariables: ["costOfEquity", "terminalGrowth"] }),
  plan("Residual Income", "Book-value returns", [assumption("costOfEquity", 0.1, "totalEquity"), assumption("terminalGrowth", 0.03)], { terminalPolicy: terminal("residual_income"), sensitivityVariables: ["costOfEquity", "terminalGrowth"] }),
  plan("DDM", "Dividend path", [assumption("dps", 1, "dividends", { valuePath: [1, 1.1, 1.2] }), assumption("costOfEquity", 0.1, "dividends"), assumption("terminalGrowth", 0.03, "dividends")], { terminalPolicy: terminal("dividend"), sensitivityVariables: ["costOfEquity", "terminalGrowth"] }),
  plan("P/E", "Earnings multiple", [assumption("targetPE", 18, "netIncome")]),
  plan("EV/EBITDA", "EBITDA multiple", [assumption("targetEVEBITDA", 12, "ebit")]),
  plan("EV/Sales", "Sales multiple", [assumption("targetEVSales", 2, "totalRevenue")]),
  plan("P/B", "Book multiple", [assumption("targetPB", 2, "totalEquity")]),
  plan("SOTP", "Two equity components", [], { components: [
    { id: "a", name: "Segment A", value: 400, basis: "equity", method: "P/E", rationale: "Explicit segment value", factIds: [componentEvidence], evidenceIds: [] },
    { id: "b", name: "Segment B", value: 300, basis: "equity", method: "EV/Sales", rationale: "Explicit segment value", factIds: [componentEvidence], evidenceIds: [] },
  ] }),
  plan("NAV", "Explicit assets and liabilities", [], { components: [
    { id: "assets", name: "Assets", value: 200, basis: "asset", method: "Adjusted book", rationale: "Explicit asset value", factIds: [componentEvidence], evidenceIds: [] },
    { id: "liabilities", name: "Liabilities", value: 120, basis: "liability", method: "Adjusted book", rationale: "Explicit liability value", factIds: [componentEvidence], evidenceIds: [] },
  ] }),
];
const specification: ValuationSpecification = {
  methodology: "FCFF DCF",
  method: "FCFF DCF",
  selectedMethod: "FCFF DCF",
  specId: "VALSPEC-FOCUS",
  modelId: model.modelId,
  architecture: "corporate",
  rationale: "FCFF is selected and independently cross-checked",
  variablesDrivingValuation: ["wacc", "terminalGrowth", "volume"],
  assumptions: plans[0].assumptions,
  discountRate: 0.1,
  discountRateRationale: "Focused deterministic rate",
  terminalAssumptions: { growth: 0.03, rationale: "Focused terminal growth" },
  terminalPolicy: terminal("fcff"),
  sensitivityVariables: ["wacc", "terminalGrowth", "volume"],
  methodPlans: plans,
  methodsConsidered: plans.map((entry) => ({ method: String(entry.method), verdict: "selected", reason: entry.rationale })),
};

let passed = 0;
let failed = 0;
const check = (name: string, assertion: () => void): void => {
  try {
    assertion();
    passed += 1;
    console.log(`  PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
};

check("forecast fixture is canonical and ready", () => {
  assert.equal(forecast.status, "ready");
  assert.equal(forecast.publicationBlocked, false);
  assert.deepEqual(forecast.incomeStatement.map((year) => year.values.revenue), [110, 132, 145.2]);
});

check("typed registry normalizes every required method", () => {
  assert.equal(VALUATION_METHODS.length, 10);
  assert.deepEqual(VALUATION_METHODS.map(normalizeValuationMethod), VALUATION_METHODS);
  assert.equal(normalizeValuationMethod("EV/Revenue"), "EV/Sales");
  assert.equal(normalizeValuationMethod("not-a-method"), null);
});

check("all required methods execute independently into a ready matrix", () => {
  const matrix = executeValuationMatrix({ specification, forecast: valuationForecast, factPack: pack, architecture: "corporate", requireEvidence: true });
  const ready = matrix.methods.filter((entry) => entry.status === "ready").map((entry) => entry.methodId);
  assert.equal(matrix.status, "ready", JSON.stringify(matrix.methods.filter((entry) => entry.status !== "ready").map((entry) => ({ method: entry.methodId, blockers: entry.blockers }))));
  assert.deepEqual([...new Set(ready)].sort(), [...VALUATION_METHODS].sort());
  assert.equal(matrix.primaryMethod, "FCFF DCF");
  assert.equal(matrix.methods.every((entry) => entry.suitability && entry.dataSufficiency && entry.provenance && entry.bridge && entry.diagnostics && entry.blockers && entry.publicationBlocked === false), true);
  assert.equal(matrix.crossCheck.disagreement?.methodCount, 10);
});

check("FCFF is derived from EBIT tax D&A capex and working capital, never net income", () => {
  const result = executeValuation(specification, valuationForecast, pack, { architecture: "corporate", requireEvidence: true });
  assert.equal(result.status, "ready", result.blockers?.join("; "));
  assert.deepEqual(result.paths?.fcff?.map((value) => Math.round(value * 1000) / 1000), [14.8, 18.32, 20.432]);
  assert.notDeepEqual(result.paths?.fcff, valuationForecast.incomeStatement.map((year) => year.values.netIncome));
  assert.equal(result.outputs?.pvExplicitFcff !== undefined, true);
  assert.equal(result.bridge?.netDebt, 20);
  assert.equal(result.bridge?.sharesOutstanding, 10);
});

check("missing net debt blocks rather than defaulting to zero", () => {
  const missingNetDebt: FactPack = { ...pack, balanceSheet: { ...pack.balanceSheet, facts: pack.balanceSheet.facts.filter((fact) => fact.metric !== "totalDebt" && fact.metric !== "cash" && fact.metric !== "netDebt") } };
  const matrix = executeValuationMatrix({ specification, forecast: valuationForecast, factPack: missingNetDebt, architecture: "corporate", requireEvidence: true });
  const result = matrix.methods.find((entry) => entry.methodId === "FCFF DCF");
  assert.equal(result?.status, "blocked");
  assert.equal(result?.fairValuePerShare, undefined);
  assert.equal(result?.blockers?.some((entry) => entry.includes("netDebtOrDebtAndCash") || entry.includes("net debt")), true);
});

check("missing evidence and unsupported or inapplicable methods fail before execution", () => {
  const noEvidence: ValuationSpecification = { ...specification, assumptions: [assumption("wacc", 0.1), { ...assumption("terminalGrowth", 0.03), factIds: ["missing-fact"], historicalEvidence: "[missing-fact]" }], methodPlans: undefined, evidenceIds: undefined };
  const missing = executeValuation(noEvidence, valuationForecast, pack, { architecture: "corporate", requireEvidence: true });
  assert.equal(missing.status, "blocked");
  assert.equal(missing.blockers?.some((entry) => entry.includes("evidence")), true);
  const unsupported = executeValuation({ ...specification, methodology: "Magic", method: "Magic", selectedMethod: "Magic" }, valuationForecast, pack);
  assert.equal(unsupported.status, "unsupported");
  const depository = buildValuationViabilityMatrix({ plans, forecast: valuationForecast, factPack: pack, architecture: "depository", selectedMethod: "FCFF DCF", requireEvidence: true });
  assert.equal(depository.find((entry) => entry.methodId === "FCFF DCF")?.status, "not_applicable");
});

check("terminal growth discipline and terminal value cap are enforced", () => {
  const cappedSpecification: ValuationSpecification = {
    ...specification,
    assumptions: [assumption("wacc", 0.1, "ebit"), assumption("terminalGrowth", 0.03)],
    terminalPolicy: { ...terminal("fcff"), maxValueShare: 0.5 },
    methodPlans: [],
  };
  const capped = executeValuation(cappedSpecification, valuationForecast, pack, { architecture: "corporate", requireEvidence: true });
  assert.equal(capped.status, "ready", capped.blockers?.join("; "));
  assert.equal((capped.outputs?.terminalValueShare ?? 1) <= 0.500001, true);
  assert.equal(capped.diagnostics?.some((entry) => entry.code === "TERMINAL_VALUE_CAP_APPLIED"), true);
  const invalidGrowth = executeValuation({ ...cappedSpecification, terminalPolicy: { ...terminal("fcff"), growth: 0.11 } }, valuationForecast, pack, { architecture: "corporate", requireEvidence: true });
  assert.equal(invalidGrowth.status, "blocked");
  assert.equal(invalidGrowth.diagnostics?.some((entry) => entry.code === "TERMINAL_SPREAD_INVALID"), true);
});

check("method-specific missing data blocks DDM residual-income roll-forward SOTP evidence and shares", () => {
  const ddmPlan = { ...plans[3], assumptions: plans[3].assumptions.filter((entry) => entry.variable !== "dps") };
  const ddm = executeValuationMatrix({ specification: { ...specification, methodology: "DDM", method: "DDM", selectedMethod: "DDM", assumptions: ddmPlan.assumptions, terminalPolicy: terminal("dividend"), methodPlans: [ddmPlan] }, forecast: { ...valuationForecast, cashFlow: valuationForecast.cashFlow.map((year) => ({ ...year, values: { ...year.values, dividendsPaid: undefined } })) }, factPack: pack, architecture: "corporate", requireEvidence: true }).methods.find((entry) => entry.methodId === "DDM");
  assert.equal(ddm?.status, "blocked", `DDM status=${ddm?.status}; missing=${JSON.stringify(ddm?.dataSufficiency.missingForecastLines)}`);
  assert.equal(ddm?.dataSufficiency.missingForecastLines.includes("forecastDpsOrDividendsPaid"), true);
  const residualForecast: ForecastResult = {
    ...forecast,
    balanceSheet: forecast.balanceSheet.map((year) => ({ ...year, values: { ...year.values, totalEquity: 999 } })),
    cashFlow: forecast.cashFlow.map((year) => ({ ...year, values: { ...year.values, dividendsPaid: 0, equityIssuance: 0 } })),
  };
  const residual = executeValuationMatrix({ specification: { ...specification, methodology: "Residual Income", method: "Residual Income", selectedMethod: "Residual Income", assumptions: plans[2].assumptions, terminalPolicy: terminal("residual_income"), methodPlans: [plans[2]] }, forecast: residualForecast, factPack: pack, architecture: "corporate", requireEvidence: true }).methods.find((entry) => entry.methodId === "Residual Income");
  assert.equal(residual?.status, "blocked", `Residual status=${residual?.status}; missing=${JSON.stringify(residual?.dataSufficiency.missingForecastLines)}; diagnostics=${JSON.stringify(residual?.diagnostics)}`);
  assert.equal(residual?.dataSufficiency.missingForecastLines.includes("bookValueRollForwardIdentity"), true);
  const unsupportedSotp = { ...plans[8], components: plans[8].components?.map((component) => ({ ...component, factIds: ["missing-fact"], evidenceIds: [] })) };
  const sotp = executeValuationMatrix({ specification: { ...specification, methodology: "SOTP", method: "SOTP", selectedMethod: "SOTP", assumptions: [], methodPlans: [unsupportedSotp] }, forecast: valuationForecast, factPack: pack, architecture: "corporate", requireEvidence: true }).methods.find((entry) => entry.methodId === "SOTP");
  assert.equal(sotp?.status, "blocked", `SOTP status=${sotp?.status}; missing=${JSON.stringify(sotp?.dataSufficiency.missingEvidence)}`);
  const missingShares: FactPack = {
    ...pack,
    market: { ...pack.market, facts: pack.market.facts.filter((entry) => entry.metric !== "sharesOutstanding") },
    shares: { ...pack.shares, facts: pack.shares.facts.filter((entry) => entry.metric !== "sharesOutstanding") },
  };
  const pe = executeValuationMatrix({ specification: { ...specification, methodology: "P/E", method: "P/E", selectedMethod: "P/E", assumptions: plans[4].assumptions, methodPlans: [plans[4]] }, forecast: valuationForecast, factPack: missingShares, architecture: "corporate", requireEvidence: true }).methods.find((entry) => entry.methodId === "P/E");
  assert.equal(pe?.status, "blocked", `P/E status=${pe?.status}; missing=${JSON.stringify(pe?.dataSufficiency.missingFacts)}`);
  assert.equal(pe?.dataSufficiency.missingFacts.includes("sharesOutstanding"), true);
});

check("blocked forecasts block valuation scenarios sensitivity and Monte Carlo", () => {
  const blocked: ForecastResult = { ...valuationForecast, status: "blocked", publicationStatus: "blocked", publicationBlocked: true, blockers: ["fixture blocker"] };
  const matrix = executeValuationMatrix({ specification, forecast: blocked, factPack: pack, architecture: "corporate" });
  const scenarios = [{ name: "bear", changedVariables: [], probability: 0.25, targetProvenance: "forecast" }, { name: "base", changedVariables: [], probability: 0.5, targetProvenance: "forecast" }, { name: "bull", changedVariables: [], probability: 0.25, targetProvenance: "forecast" }] as ScenarioSpecification[];
  const scenarioSet = executeScenarioSet(scenarios, model, blocked, pack, specification, { architecture: "corporate" });
  const sensitivity = runValuationSensitivity({ specification, forecast: blocked, factPack: pack, forecastSpec: model, architecture: "corporate" });
  const monteCarlo = runMonteCarlo({ specification, forecast: blocked, factPack: pack, forecastSpec: model, architecture: "corporate", seed: 7, sampleCount: 32, variables: [{ variable: "wacc", source: "valuation", distribution: { type: "uniform", min: 0.09, max: 0.11 } }] });
  assert.equal(matrix.status, "blocked");
  assert.equal(matrix.publicationBlocked, true);
  assert.equal(scenarioSet.validation.status, "blocked");
  assert.equal(scenarioSet.scenarios.every((scenario) => scenario.status === "blocked" && scenario.publicationBlocked), true);
  assert.equal(sensitivity.status, "blocked");
  assert.equal(monteCarlo.status, "blocked");
});

check("method-aware sensitivity reruns only relevant valuation and model paths", () => {
  const sensitivity = runValuationSensitivity({ specification, forecast: valuationForecast, factPack: pack, forecastSpec: model, architecture: "corporate", requireEvidence: true });
  assert.equal(sensitivity.status, "ready", JSON.stringify(sensitivity.blockers));
  assert.deepEqual([...sensitivity.runs.map((run) => run.variable)].sort(), ["terminalGrowth", "volume", "wacc"]);
  assert.equal(sensitivity.runs.find((run) => run.variable === "wacc")?.modelExecutions, 0);
  assert.equal(sensitivity.runs.find((run) => run.variable === "volume")?.modelExecutions, 2);
  assert.equal(sensitivity.rankedVariables.length, 3);
  assert.equal(toLegacySensitivityGrid(sensitivity).length, 9);
});

check("seeded bounded Monte Carlo is deterministic and reports ranges and drivers", () => {
  const variables = [
    { variable: "wacc", source: "valuation" as const, distribution: { type: "uniform" as const, min: 0.09, max: 0.11 } },
    { variable: "terminalGrowth", source: "valuation" as const, distribution: { type: "uniform" as const, min: 0.02, max: 0.04 } },
  ];
  const first = runMonteCarlo({ specification, forecast: valuationForecast, factPack: pack, forecastSpec: model, architecture: "corporate", requireEvidence: true, seed: 12345, sampleCount: 64, variables });
  const second = runMonteCarlo({ specification, forecast: valuationForecast, factPack: pack, forecastSpec: model, architecture: "corporate", requireEvidence: true, seed: 12345, sampleCount: 64, variables });
  assert.equal(first.status, "ready", first.blockers.join("; "));
  assert.deepEqual(first, second);
  assert.equal(first.acceptedSamples, 64);
  assert.equal(first.requestedSamples, 64);
  assert.equal(first.fairValue.p10 <= first.fairValue.p50 && first.fairValue.p50 <= first.fairValue.p90, true);
  assert.equal(first.downsideRange.high, first.fairValue.p25);
  assert.equal(first.centralRange.low, first.fairValue.p25);
  assert.equal(first.upsideRange.low, first.fairValue.p75);
  assert.equal(first.keyVarianceDrivers.length, 2);
  assert.equal(first.probabilityOfUpside >= 0 && first.probabilityOfUpside <= 1, true);
});

check("Monte Carlo rejects valuation-invalid bounded samples", () => {
  const result = runMonteCarlo({
    specification,
    forecast: valuationForecast,
    factPack: pack,
    forecastSpec: model,
    architecture: "corporate",
    requireEvidence: true,
    seed: 9,
    sampleCount: 64,
    variables: [
      { variable: "wacc", source: "valuation", distribution: { type: "uniform", min: 0.028, max: 0.034 } },
      { variable: "terminalGrowth", source: "valuation", distribution: { type: "uniform", min: 0.03, max: 0.034 } },
    ],
  });
  assert.equal(result.status, "ready", result.blockers.join("; "));
  assert.equal(result.rejectedSamples > 0, true, `accepted=${result.acceptedSamples}; rejected=${result.rejectedSamples}; attempted=${result.attemptedSamples}; first=${JSON.stringify(result.samples?.[0])}`);
  assert.equal(result.attemptedSamples > result.requestedSamples, true);
});

const scenarioPath = (delta: number) => model.driverPaths.volume.map((value) => value + delta);
const scenarios: ScenarioSpecification[] = [
  { name: "bear", probability: 0.25, changedVariables: [{ variable: "volume", baseValue: 0.1, scenarioValue: 0.08, path: scenarioPath(-0.02), rationale: "Lower volume" }], targetProvenance: "forecast" },
  { name: "base", probability: 0.5, changedVariables: [], targetProvenance: "forecast" },
  { name: "bull", probability: 0.25, changedVariables: [{ variable: "volume", baseValue: 0.1, scenarioValue: 0.12, path: scenarioPath(0.02), rationale: "Higher volume" }], targetProvenance: "forecast" },
];

check("canonical scenarios retain statements valuation bridge closure and base parity", () => {
  const validation = validateScenarioSet(scenarios, model);
  assert.equal(validation.valid, true, validation.blockers.join("; "));
  const execution = executeScenarioSet(scenarios, model, forecast, pack, specification, { architecture: "corporate", requireEvidence: true });
  assert.equal(execution.validation.valid, true, execution.validation.blockers.join("; "));
  assert.deepEqual(execution.scenarios.map((scenario) => scenario.name), ["bear", "base", "bull"]);
  assert.deepEqual(execution.scenarios.map((scenario) => scenario.targetPrice), execution.scenarios.map((scenario) => scenario.valuation?.fairValuePerShare));
  assert.equal(execution.scenarios.every((scenario) => scenario.forecast?.incomeStatement.length === 3 && scenario.forecast.balanceSheet.length === 3 && scenario.forecast.cashFlow.length === 3), true);
  assert.equal(execution.scenarios.every((scenario) => scenario.bridge && scenario.closure?.passed), true);
  assert.equal(execution.scenarios[0].targetPrice <= execution.scenarios[1].targetPrice! && execution.scenarios[1].targetPrice <= execution.scenarios[2].targetPrice!, true);
  assert.deepEqual(execution.forecasts.base.incomeStatement.map((year) => year.values), forecast.incomeStatement.map((year) => year.values));
});

check("scenario no-op unknown order base mismatch and non-monotonic paths are rejected", () => {
  const noOp = scenarios.map((scenario) => scenario.name === "bear" ? { ...scenario, changedVariables: [{ ...scenario.changedVariables[0], path: [...model.driverPaths.volume] }] } : scenario);
  assert.equal(validateScenarioSet(noOp, model).blockers.some((entry) => entry.includes("no-op")), true);
  const unknown = scenarios.map((scenario) => scenario.name === "bear" ? { ...scenario, changedVariables: [{ ...scenario.changedVariables[0], variable: "unknownVariable" }] } : scenario);
  assert.equal(validateScenarioSet(unknown, model).valid, false);
  const reordered = [scenarios[1], scenarios[0], scenarios[2]];
  assert.equal(validateScenarioSet(reordered, model).diagnostics.some((entry) => entry.code === "SCENARIO_ORDER_INVALID"), true);
  const baseMismatch = scenarios.map((scenario) => scenario.name === "base" ? { ...scenario, changedVariables: [{ variable: "volume", baseValue: 0.1, scenarioValue: 0.11, path: scenarioPath(0.01), rationale: "Wrong base" }] } : scenario);
  assert.equal(validateScenarioSet(baseMismatch, model).diagnostics.some((entry) => entry.code === "SCENARIO_BASE_PATH_MISMATCH"), true);
  const nonMonotonic = scenarios.map((scenario) => scenario.name === "bull" ? { ...scenario, changedVariables: [{ ...scenario.changedVariables[0], path: [0.12, 0.01, 0.12] }] } : scenario);
  assert.equal(validateScenarioSet(nonMonotonic, model).diagnostics.some((entry) => entry.code === "SCENARIO_MONOTONICITY_INVALID"), true);
  const invalidProbability = scenarios.map((scenario) => scenario.name === "bull" ? { ...scenario, probability: 0.5 } : scenario);
  assert.equal(validateScenarioSet(invalidProbability, model).diagnostics.some((entry) => entry.code === "SCENARIO_PROBABILITY_SUM_INVALID"), true);
});

const reversePlanBase: ReverseValuationPlan = {
  id: "REVPLAN-FOCUS",
  variable: "revenueCagr",
  why: "Volume growth is the revenue growth lever",
  unit: "decimal",
  range: { min: 0, max: 0.5 },
  economicLinkage: "Volume growth changes revenue and unlevered cash flow",
  forecastLinkage: "volume path drives revenue through F1",
  modelVariable: "volume",
  forecastLine: "revenue",
  method: "FCFF DCF",
  factIds: [factId("volume")],
  evidenceIds: [],
};

check("reverse plan validates only an actually linked model variable", () => {
  const valuation = executeValuation(specification, valuationForecast, pack, { architecture: "corporate", requireEvidence: true });
  const validated = validateReverseValuationPlan(reversePlanBase, { pack, understanding: {} as never, forecastSpec: model, valuation, architecture: "corporate" });
  assert.equal(validated.status, "viable", validated.blockers?.join("; "));
  const unavailable = validateReverseValuationPlan({ ...reversePlanBase, modelVariable: "arpu", forecastLine: "revenue" }, { pack, understanding: {} as never, forecastSpec: model, valuation, architecture: "corporate" });
  assert.equal(unavailable.status, "unavailable");
});

check("reverse solver converges and changes only the selected annual path", () => {
  const valuation = executeValuation(specification, valuationForecast, pack, { architecture: "corporate", requireEvidence: true });
  const plan = validateReverseValuationPlan(reversePlanBase, { pack, understanding: {} as never, forecastSpec: model, valuation, architecture: "corporate" });
  const adjusted = applyReverseVariable(model, plan, 0.12);
  assert.deepEqual(adjusted.driverPaths.volume, [0.12, 0.12, 0.12]);
  assert.deepEqual(adjusted.driverPaths.price, model.driverPaths.price);
  assert.deepEqual(adjusted.driverPaths.ebitMargin, model.driverPaths.ebitMargin);
  const result = solveReverseValuation({ plan, forecastSpec: model, factPack: pack, valuationSpec: specification, architecture: "corporate", requireEvidence: true }, 50);
  assert.equal(result.status, "ready", result.blockers.join("; "));
  assert.equal(result.convergence?.converged, true);
  assert.equal((result.convergence?.iterations ?? 0) > 0, true);
  assert.equal(Math.abs(result.convergence?.residual ?? Number.POSITIVE_INFINITY) <= 1e-6, true);
});

check("generic one-variable bisection records convergence", () => {
  const solution = solveOneVariable({ plan: reversePlanBase, target: 15, evaluate: (value) => value * 100, maxIterations: 80, tolerance: 1e-12, fairValueTolerance: 1e-9 });
  assert.equal(solution.status, "converged");
  assert.ok(solution.value !== undefined && Math.abs(solution.value - 0.15) < 1e-9);
  assert.equal(solution.convergence.converged, true);
  assert.equal(solution.convergence.evaluations >= solution.convergence.iterations, true);
});

async function pipelineChecks(): Promise<void> {
  const run = await runAiFirstResearch("BLOCK", {
    price: { currency: "USD", regularMarketPrice: { raw: 50 } },
    defaultKeyStatistics: { sharesOutstanding: { raw: 10 } },
    incomeStatementHistory: { incomeStatementHistory: [newer] },
    balanceSheetHistory: { balanceSheetHistory: [balance] },
    cashflowStatementHistory: { cashflowStatementHistory: [cash] },
    financialData: {},
    summaryDetail: {},
  }, {});
  check("pipeline reports blocked forecast across valuation scenarios sensitivity reverse and Monte Carlo", () => {
    assert.equal(run.report.forecast.status, "blocked");
    assert.equal(run.valuationMatrix?.status, "blocked");
    assert.equal(run.scenarioValidation?.status, "blocked");
    assert.equal(run.sensitivityAnalysis?.status, "blocked");
    assert.equal(run.reverseValuationResult?.status, "blocked");
    assert.equal(run.monteCarlo?.status, "blocked");
    assert.equal(run.report.catalysts.every((catalyst) => catalyst.id && catalyst.traceability && catalyst.financialImpactContract && catalyst.valuationImpactContract), true);
    assert.equal(run.report.risks.every((risk) => risk.id && risk.traceability && risk.financialImpactContract && risk.valuationImpactContract), true);
  });
}

pipelineChecks().then(() => {
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
