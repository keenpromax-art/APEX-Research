import { createSuite, check, report } from "../helpers/assert";
import { buildFactPack, renderFactContext } from "../../src/lib/ai-first/fact-pack";
import { compileForecast } from "../../src/lib/ai-first/forecast-compiler";
import { executeForecast } from "../../src/lib/ai-first/forecast-engine";
import { validateModelSpec } from "../../src/lib/ai-first/model-spec-validator";
import { FIXED_TIMESTAMP, statementRow } from "../helpers/payloads";
import type { FactPack, ForecastSpecification } from "../../src/lib/ai-first/types";

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
}, "FOCUS", { retrievalTimestamp: FIXED_TIMESTAMP });

function factId(metric: string): string {
  const fact = [...pack.incomeStatement.facts, ...pack.balanceSheet.facts, ...pack.cashFlow.facts].find((c) => c.metric === metric && c.value !== undefined);
  if (!fact?.factId) throw new Error(`missing fact ${metric}`);
  return fact.factId;
}

const model = {
  horizonYears: 3,
  horizonRationale: "Canonical three-year model",
  variables: [
    { id: "V-volume", name: "volume", label: "Volume", baseValue: 10, baseFactId: factId("volume"), unit: "count", kind: "input", statementLine: "volume" },
    { id: "V-price", name: "price", label: "Price", baseValue: 10, baseFactId: factId("price"), unit: "currency", kind: "input", statementLine: "price" },
    { id: "V-grossMargin", name: "grossMargin", label: "Gross margin", baseValue: 0.4, baseFactId: factId("grossMargin"), unit: "decimal", kind: "input", statementLine: "grossMargin" },
    { id: "V-ebitMargin", name: "ebitMargin", label: "EBIT margin", baseValue: 0.2, baseFactId: factId("ebitMargin"), unit: "decimal", kind: "input", statementLine: "ebitMargin" },
    { id: "V-taxRate", name: "taxRate", label: "Tax rate", baseValue: 0.2, baseFactId: factId("taxRate"), unit: "decimal", kind: "input", statementLine: "taxRate" },
    { id: "V-netInterest", name: "netInterest", label: "Net interest", baseValue: 1, baseFactId: factId("netInterest"), unit: "currency", kind: "input", statementLine: "netInterest" },
    { id: "V-revenue", name: "revenue", label: "Revenue", unit: "currency", kind: "computed", statementLine: "totalRevenue" },
    { id: "V-grossProfit", name: "grossProfit", label: "Gross profit", unit: "currency", kind: "computed", statementLine: "grossProfit" },
    { id: "V-ebit", name: "ebit", label: "EBIT", unit: "currency", kind: "computed", statementLine: "ebit" },
    { id: "V-totalOpex", name: "totalOpex", label: "Opex", unit: "currency", kind: "computed", statementLine: "totalOpex" },
    { id: "V-pbt", name: "pbt", label: "PBT", unit: "currency", kind: "computed", statementLine: "pbt" },
    { id: "V-tax", name: "tax", label: "Tax", unit: "currency", kind: "computed", statementLine: "tax" },
    { id: "V-netIncome", name: "netIncome", label: "Net income", unit: "currency", kind: "computed", statementLine: "netIncome" },
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
} as unknown as ForecastSpecification;

check(suite, "fact context carries canonical and legacy ids", (() => {
  const ctx = renderFactContext(pack, ["incomeStatement"]);
  return /\[FACT-[a-z0-9-]+\]/.test(ctx) && ctx.includes("[F-totalRevenue]");
})());

check(suite, "compiled base period is latest", compileForecast({ model, factPack: pack }).basePeriod === "2024-12-31");

check(suite, "paths compound cumulatively", (() => {
  const compiled = compileForecast({ model, factPack: pack });
  return compiled.years[0].incomeStatement.values.revenue === 110
    && compiled.years[1].incomeStatement.values.revenue === 132
    && compiled.years[2].incomeStatement.values.revenue === 145.2;
})());

check(suite, "deep chain evaluates topologically", (() => {
  const out = executeForecast({ model, factPack: pack });
  return out.forecast.incomeStatement[2].values.revenue === 145.2 && out.forecast.incomeStatement[2].values.netIncome === 22.432;
})());

check(suite, "valid model passes spec validation", validateModelSpec(model, pack).valid === true);

check(suite, "cycle blocks validation", (() => {
  const cycle = { ...model, formulas: [{ ...model.formulas[0], id: "C1" }, { ...model.formulas[0], id: "C2", output: "volume", variables: ["revenue"] }] };
  return validateModelSpec(cycle as ForecastSpecification, pack).issues.some((e) => e.code === "DEPENDENCY_CYCLE");
})());

check(suite, "invalid model blocks execution", (() => {
  const invalid = { ...model, formulas: [{ ...model.formulas[0], expression: "unknown * 2", variables: ["unknown"] }] };
  const out = executeForecast({ model: invalid as ForecastSpecification, factPack: pack });
  return out.status === "blocked" && out.forecast.publicationBlocked === true;
})());

check(suite, "statements close without plugs", (() => {
  const out = executeForecast({ model, factPack: pack });
  return out.forecast.status === "ready" && out.plugs.length === 0 && out.forecast.cashFlow[0].values.cashClose === 30;
})());

report(suite, "model/forecast");
