import { createSuite, check, report } from "../helpers/assert";
import { buildFactPack } from "../../src/lib/ai-first/fact-pack";
import { executeForecast } from "../../src/lib/ai-first/forecast-engine";
import { getAccountingArchitecture } from "../../src/lib/ai-first/accounting-architecture";
import { executeValuation } from "../../src/lib/ai-first/valuation-engine";
import { executeScenarioSet, validateScenarioSet } from "../../src/lib/ai-first/scenarios-builder";
import { solveOneVariable, applyReverseVariable, solveReverseValuation } from "../../src/lib/ai-first/reverse-valuation";
import { validateReverseValuationPlan } from "../../src/lib/ai-first/reverse-planner";
import { runValuationSensitivity } from "../../src/lib/ai-first/sensitivity-engine";
import { runMonteCarlo } from "../../src/lib/ai-first/monte-carlo";
import { FIXED_TIMESTAMP, statementRow } from "../helpers/payloads";
import type { FactPack, ForecastResult, ForecastSpecification, ReverseValuationPlan, ScenarioSpecification, ValuationSpecification } from "../../src/lib/ai-first/types";

const suite = createSuite();

const older = statementRow("2023-12-31", { volume: 9, price: 9, totalRevenue: 81, grossProfit: 32, ebit: 16, pbt: 12, tax: 2, netIncome: 9, totalOpex: 16, grossMargin: 0.4, ebitMargin: 0.2, taxRate: 0.2, netInterest: 1 });
const newer = statementRow("2024-12-31", { volume: 10, price: 10, totalRevenue: 100, grossProfit: 40, ebit: 20, pbt: 15, tax: 3, netIncome: 12, totalOpex: 20, grossMargin: 0.4, ebitMargin: 0.2, taxRate: 0.2, netInterest: 1 });
const balance = statementRow("2024-12-31", { cash: 20, totalAssets: 200, totalLiabilities: 120, totalEquity: 80, totalDebt: 40, retainedEarnings: 50, propertyPlantAndEquipment: 60, accountsReceivable: 15, inventory: 10, accountsPayable: 12 });
const cash = statementRow("2024-12-31", { totalCashFromOperatingActivities: 15, totalCashFromInvestingActivities: -5, totalCashFromFinancingActivities: 0, capitalExpenditures: 5, depreciation: 2, dividends: 1 });

const pack: FactPack = buildFactPack({
  price: { currency: "USD", regularMarketPrice: { raw: 50 } },
  defaultKeyStatistics: { sharesOutstanding: { raw: 10 } },
  incomeStatementHistory: { incomeStatementHistory: [newer, older] },
  balanceSheetHistory: { balanceSheetHistory: [balance] },
  cashflowStatementHistory: { cashflowStatementHistory: [cash] },
}, "SCENFOCUS", { retrievalTimestamp: FIXED_TIMESTAMP });

function factId(metric: string): string {
  const fact = [...pack.market.facts, ...pack.shares.facts, ...pack.incomeStatement.facts, ...pack.balanceSheet.facts, ...pack.cashFlow.facts].find((c) => c.metric === metric && c.value !== undefined);
  if (!fact?.factId) throw new Error(`missing ${metric}`);
  return fact.factId;
}

const model = {
  horizonYears: 3,
  horizonRationale: "Scenario focus",
  modelId: "MODEL-SCEN",
  variables: [
    { id: "V-volume", name: "volume", label: "Volume", baseValue: 10, baseFactId: factId("volume"), unit: "count", kind: "input", statementLine: "volume" },
    { id: "V-price", name: "price", label: "Price", baseValue: 10, baseFactId: factId("price"), unit: "currency", kind: "input", statementLine: "price" },
    { id: "V-grossMargin", name: "grossMargin", label: "Gross margin", baseValue: 0.4, baseFactId: factId("grossMargin"), unit: "decimal", kind: "input", statementLine: "grossMargin" },
    { id: "V-ebitMargin", name: "ebitMargin", label: "EBIT margin", baseValue: 0.2, baseFactId: factId("ebitMargin"), unit: "decimal", kind: "input", statementLine: "ebitMargin" },
    { id: "V-taxRate", name: "taxRate", label: "Tax rate", baseValue: 0.2, baseFactId: factId("taxRate"), unit: "decimal", kind: "input", statementLine: "taxRate" },
    { id: "V-netInterest", name: "netInterest", label: "Net interest", baseValue: 1, baseFactId: factId("netInterest"), unit: "currency", kind: "input", statementLine: "netInterest" },
    { id: "V-revenue", name: "revenue", label: "Revenue", baseValue: 100, unit: "currency", kind: "computed", statementLine: "totalRevenue" },
    { id: "V-grossProfit", name: "grossProfit", label: "Gross profit", baseValue: 40, unit: "currency", kind: "computed", statementLine: "grossProfit" },
    { id: "V-ebit", name: "ebit", label: "EBIT", baseValue: 20, unit: "currency", kind: "computed", statementLine: "ebit" },
    { id: "V-totalOpex", name: "totalOpex", label: "Opex", baseValue: 20, unit: "currency", kind: "computed", statementLine: "totalOpex" },
    { id: "V-pbt", name: "pbt", label: "PBT", baseValue: 15, unit: "currency", kind: "computed", statementLine: "pbt" },
    { id: "V-tax", name: "tax", label: "Tax", baseValue: 3, unit: "currency", kind: "computed", statementLine: "tax" },
    { id: "V-netIncome", name: "netIncome", label: "Net income", baseValue: 12, unit: "currency", kind: "computed", statementLine: "netIncome" },
  ],
  formulas: [
    { id: "F1", equation: "revenue equation", expression: "volume * price", output: "revenue", variables: ["volume", "price"], explanation: "Deterministic relationship", sourceFacts: [factId("volume"), factId("price")], confidence: 0.9 },
    { id: "F2", equation: "gross profit equation", expression: "revenue * grossMargin", output: "grossProfit", variables: ["revenue", "grossMargin"], explanation: "Deterministic relationship", sourceFacts: [factId("totalRevenue"), factId("grossMargin")], confidence: 0.9 },
    { id: "F3", equation: "ebit equation", expression: "revenue * ebitMargin", output: "ebit", variables: ["revenue", "ebitMargin"], explanation: "Deterministic relationship", sourceFacts: [factId("totalRevenue"), factId("ebitMargin")], confidence: 0.9 },
    { id: "F4", equation: "opex equation", expression: "grossProfit - ebit", output: "totalOpex", variables: ["grossProfit", "ebit"], explanation: "Deterministic relationship", sourceFacts: [factId("grossProfit"), factId("ebit")], confidence: 0.9 },
    { id: "F5", equation: "pbt equation", expression: "ebit - netInterest", output: "pbt", variables: ["ebit", "netInterest"], explanation: "Deterministic relationship", sourceFacts: [factId("ebit"), factId("netInterest")], confidence: 0.9 },
    { id: "F6", equation: "tax equation", expression: "pbt * taxRate", output: "tax", variables: ["pbt", "taxRate"], explanation: "Deterministic relationship", sourceFacts: [factId("pbt"), factId("taxRate")], confidence: 0.9 },
    { id: "F7", equation: "net income equation", expression: "pbt - tax", output: "netIncome", variables: ["pbt", "tax"], explanation: "Deterministic relationship", sourceFacts: [factId("netIncome"), factId("tax")], confidence: 0.9 },
  ],
  assumptions: [],
  driverPaths: { volume: [0.1, 0.2, 0.1], price: [0, 0, 0], grossMargin: [0, 0, 0], ebitMargin: [0, 0, 0], taxRate: [0, 0, 0], netInterest: [0, 0, 0] },
  architecture: "corporate",
} as unknown as ForecastSpecification;

const forecastOut = executeForecast({ model, factPack: pack, architecture: getAccountingArchitecture("corporate") });
const forecast: ForecastResult = { ...forecastOut.forecast, modelId: model.modelId, forecastId: "FCST-SCEN" };
const valuationForecast: ForecastResult = {
  ...forecast,
  cashFlow: forecast.cashFlow.map((year, index) => ({ ...year, values: { ...year.values, fcfe: [4, 5, 6][index] } })),
};

const terminal = { growth: 0.03, maxValueShare: 0.9, terminalMetric: "fcff", rationale: "Explicit terminal policy", evidenceIds: [factId("totalRevenue")] };
const specification = {
  methodology: "FCFF DCF",
  method: "FCFF DCF",
  selectedMethod: "FCFF DCF",
  specId: "VALSPEC-SCEN",
  modelId: model.modelId,
  architecture: "corporate",
  rationale: "Scenario focus",
  variablesDrivingValuation: ["wacc", "terminalGrowth", "volume"],
  assumptions: [
    { id: "A-wacc", assumption: "wacc assumption", variable: "wacc", value: 0.1, unit: "decimal", period: "Y1-Y3", rationale: "Deterministic", historicalEvidence: `[${factId("ebit")}]`, factIds: [factId("ebit")], confidence: 0.9 },
    { id: "A-terminalGrowth", assumption: "terminal assumption", variable: "terminalGrowth", value: 0.03, unit: "decimal", period: "terminal", rationale: "Deterministic", historicalEvidence: `[${factId("totalRevenue")}]`, factIds: [factId("totalRevenue")], confidence: 0.9 },
  ],
  discountRate: 0.1,
  discountRateRationale: "Deterministic rate",
  terminalAssumptions: { growth: 0.03, rationale: "Terminal growth" },
  terminalPolicy: terminal,
  sensitivityVariables: ["wacc", "terminalGrowth", "volume"],
  methodPlans: [
    { method: "FCFF DCF", rationale: "Primary", variablesDrivingValuation: [], assumptions: [{ id: "A-wacc", assumption: "w", variable: "wacc", value: 0.1, unit: "decimal", period: "Y1-Y3", rationale: "d", historicalEvidence: `[${factId("ebit")}]`, factIds: [factId("ebit")], confidence: 0.9 }, { id: "A-g", assumption: "g", variable: "terminalGrowth", value: 0.03, unit: "decimal", period: "terminal", rationale: "d", historicalEvidence: `[${factId("totalRevenue")}]`, factIds: [factId("totalRevenue")], confidence: 0.9 }], discountRate: 0.1, terminalPolicy: terminal, sensitivityVariables: ["wacc", "terminalGrowth"] },
  ],
  methodsConsidered: [{ method: "FCFF DCF", verdict: "selected", reason: "Primary" }],
} as unknown as ValuationSpecification;

const pathFor = (delta: number): number[] => model.driverPaths.volume.map((v) => v + delta);
const scenarios: ScenarioSpecification[] = [
  { name: "bear", probability: 0.25, changedVariables: [{ variable: "volume", baseValue: 0.1, scenarioValue: 0.08, path: pathFor(-0.02), rationale: "Lower volume" }], targetProvenance: "forecast" },
  { name: "base", probability: 0.5, changedVariables: [], targetProvenance: "forecast" },
  { name: "bull", probability: 0.25, changedVariables: [{ variable: "volume", baseValue: 0.1, scenarioValue: 0.12, path: pathFor(0.02), rationale: "Higher volume" }], targetProvenance: "forecast" },
];

check(suite, "scenario set validates", validateScenarioSet(scenarios, model).valid === true);
check(suite, "scenarios execute with bridge closure", (() => {
  const executed = executeScenarioSet(scenarios, model, forecast, pack, specification, { architecture: "corporate", requireEvidence: true });
  return executed.validation.valid === true
    && executed.scenarios.every((s) => s.bridge && s.closure?.passed)
    && executed.scenarios[0].targetPrice! <= executed.scenarios[1].targetPrice!
    && executed.scenarios[1].targetPrice! <= executed.scenarios[2].targetPrice!;
})());
check(suite, "unknown scenario variable rejected", (() => {
  const bad = scenarios.map((s) => s.name === "bear" ? { ...s, changedVariables: [{ ...s.changedVariables[0], variable: "unknownVariable" }] } : s);
  return validateScenarioSet(bad as ScenarioSpecification[], model).valid === false;
})());
check(suite, "sensitivity reruns only relevant paths", (() => {
  const sensitivity = runValuationSensitivity({ specification, forecast: valuationForecast, factPack: pack, forecastSpec: model, architecture: "corporate", requireEvidence: true });
  return sensitivity.status === "ready" && sensitivity.runs.find((r) => r.variable === "wacc")?.modelExecutions === 0;
})());
check(suite, "seeded monte carlo is deterministic", (() => {
  const variables = [{ variable: "wacc", source: "valuation" as const, distribution: { type: "uniform" as const, min: 0.09, max: 0.11 } }];
  const first = runMonteCarlo({ specification, forecast: valuationForecast, factPack: pack, forecastSpec: model, architecture: "corporate", requireEvidence: true, seed: 12345, sampleCount: 32, variables });
  const second = runMonteCarlo({ specification, forecast: valuationForecast, factPack: pack, forecastSpec: model, architecture: "corporate", requireEvidence: true, seed: 12345, sampleCount: 32, variables });
  return first.status === "ready" && JSON.stringify(first) === JSON.stringify(second);
})());

const reversePlan: ReverseValuationPlan = {
  id: "REVPLAN-FOCUS",
  variable: "revenueCagr",
  why: "Volume growth lever",
  unit: "decimal",
  range: { min: 0, max: 0.5 },
  economicLinkage: "Volume growth changes revenue",
  forecastLinkage: "volume path drives revenue through F1",
  modelVariable: "volume",
  forecastLine: "revenue",
  method: "FCFF DCF",
  factIds: [factId("volume")],
  evidenceIds: [],
};

check(suite, "reverse plan validates linked variable", (() => {
  const valuation = executeValuation(specification, valuationForecast, pack, { architecture: "corporate", requireEvidence: true });
  const validated = validateReverseValuationPlan(reversePlan, { pack, understanding: {} as never, forecastSpec: model, valuation, architecture: "corporate" });
  return validated.status === "viable";
})());
check(suite, "reverse solver converges", (() => {
  const result = solveReverseValuation({ plan: reversePlan, forecastSpec: model, factPack: pack, valuationSpec: specification, architecture: "corporate", requireEvidence: true }, 50);
  return result.status === "ready" && result.convergence?.converged === true;
})());
check(suite, "bisection records convergence", solveOneVariable({ plan: reversePlan, target: 15, evaluate: (v) => v * 100, maxIterations: 80, tolerance: 1e-12, fairValueTolerance: 1e-9 }).status === "converged");
check(suite, "reverse path edit is isolated", (() => {
  const adjusted = applyReverseVariable(model, reversePlan, 0.12);
  return JSON.stringify(adjusted.driverPaths.volume) === JSON.stringify([0.12, 0.12, 0.12]) && JSON.stringify(adjusted.driverPaths.price) === JSON.stringify(model.driverPaths.price);
})());

report(suite, "valuation/scenarios-reverse");
