import { createSuite, check, report } from "../helpers/assert";
import { buildFactPack } from "../../src/lib/ai-first/fact-pack";
import { executeForecast } from "../../src/lib/ai-first/forecast-engine";
import { getAccountingArchitecture } from "../../src/lib/ai-first/accounting-architecture";
import { executeValuation, executeValuationMatrix } from "../../src/lib/ai-first/valuation-engine";
import { normalizeValuationMethod, VALUATION_METHODS } from "../../src/lib/ai-first/valuation-methods";
import { FIXED_TIMESTAMP, statementRow } from "../helpers/payloads";
import type { FactPack, ForecastResult, ForecastSpecification, ValuationMethodPlan, ValuationSpecification } from "../../src/lib/ai-first/types";

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
}, "VALFOCUS", { retrievalTimestamp: FIXED_TIMESTAMP });

function factId(metric: string): string {
  const fact = [...pack.market.facts, ...pack.shares.facts, ...pack.incomeStatement.facts, ...pack.balanceSheet.facts, ...pack.cashFlow.facts].find((c) => c.metric === metric && c.value !== undefined);
  if (!fact?.factId) throw new Error(`missing ${metric}`);
  return fact.factId;
}

const model = {
  horizonYears: 3,
  horizonRationale: "Focused three-year model",
  modelId: "MODEL-FOCUS",
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
const forecast: ForecastResult = { ...forecastOut.forecast, modelId: model.modelId, forecastId: "FCST-FOCUS" };
const valuationForecast: ForecastResult = {
  ...forecast,
  cashFlow: forecast.cashFlow.map((year, index) => ({ ...year, values: { ...year.values, fcfe: [4, 5, 6][index] } })),
};

function assumption(variableName: string, value: number, evidenceMetric = "totalRevenue"): Record<string, unknown> {
  return {
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
  };
}

const terminal = { growth: 0.03, maxValueShare: 0.9, terminalMetric: "fcff", rationale: "Explicit terminal policy", evidenceIds: [factId("totalRevenue")] };
const plans = [
  { method: "FCFF DCF", rationale: "Primary FCFF", variablesDrivingValuation: [], assumptions: [assumption("wacc", 0.1, "ebit"), assumption("terminalGrowth", 0.03)], discountRate: 0.1, terminalPolicy: terminal, sensitivityVariables: ["wacc", "terminalGrowth"] },
  { method: "P/E", rationale: "Earnings multiple", variablesDrivingValuation: [], assumptions: [assumption("targetPE", 18, "netIncome")] },
] as unknown as ValuationMethodPlan[];

const specification = {
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
  terminalPolicy: terminal,
  sensitivityVariables: ["wacc", "terminalGrowth", "volume"],
  methodPlans: plans,
  methodsConsidered: plans.map((e) => ({ method: String(e.method), verdict: "selected", reason: e.rationale })),
} as unknown as ValuationSpecification;

check(suite, "forecast fixture is ready", forecast.status === "ready" && forecast.publicationBlocked === false);
check(suite, "registry normalizes all methods", VALUATION_METHODS.length === 10 && normalizeValuationMethod("EV/Revenue") === "EV/Sales" && normalizeValuationMethod("not-a-method") === null);
check(suite, "fcff derives from ebit path", (() => {
  const result = executeValuation(specification, valuationForecast, pack, { architecture: "corporate", requireEvidence: true });
  return result.status === "ready" && Array.isArray(result.paths?.fcff) && result.bridge?.sharesOutstanding === 10;
})());
check(suite, "missing net debt blocks instead of zero", (() => {
  const missing: FactPack = { ...pack, balanceSheet: { ...pack.balanceSheet, facts: pack.balanceSheet.facts.filter((f) => f.metric !== "totalDebt" && f.metric !== "cash" && f.metric !== "netDebt") } };
  const matrix = executeValuationMatrix({ specification, forecast: valuationForecast, factPack: missing, architecture: "corporate", requireEvidence: true });
  const found = matrix.methods.find((e) => e.methodId === "FCFF DCF");
  return found?.status === "blocked" && found?.fairValuePerShare === undefined;
})());
check(suite, "unsupported method stays unsupported", executeValuation({ ...specification, methodology: "Magic", method: "Magic", selectedMethod: "Magic" } as unknown as ValuationSpecification, valuationForecast, pack).status === "unsupported");
check(suite, "blocked forecast blocks matrix", (() => {
  const blocked: ForecastResult = { ...valuationForecast, status: "blocked", publicationStatus: "blocked", publicationBlocked: true, blockers: ["fixture blocker"] };
  const matrix = executeValuationMatrix({ specification, forecast: blocked, factPack: pack, architecture: "corporate" });
  return matrix.status === "blocked" && matrix.publicationBlocked === true;
})());

report(suite, "valuation/valuation");
