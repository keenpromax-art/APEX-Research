import assert from "node:assert/strict";
import { buildFactPack, renderFactContext } from "../src/lib/ai-first/fact-pack";
import { validateModelSpec } from "../src/lib/ai-first/model-spec-validator";
import { executeForecast } from "../src/lib/ai-first/forecast-engine";
import { compileForecast } from "../src/lib/ai-first/forecast-compiler";
import { selectAccountingArchitecture } from "../src/lib/ai-first/accounting-architecture";
import { evalExpression, applyGrowthPath } from "../src/lib/ai-first/model-runtime";
import type { FactPack, ForecastSpecification } from "../src/lib/ai-first/types";

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
}, "FOCUS", { retrievalTimestamp: timestamp });

const factId = (metric: string): string => {
  const fact = [...pack.incomeStatement.facts, ...pack.balanceSheet.facts, ...pack.cashFlow.facts].find((candidate) => candidate.metric === metric && candidate.value !== undefined);
  assert.ok(fact?.factId);
  return fact.factId;
};

const evidence = (...metrics: string[]): string[] => metrics.map(factId);
const input = (name: string, label: string, baseValue: number, unit: string, statementLine: string): Record<string, unknown> => ({ id: `V-${name}`, name, label, baseValue, baseFactId: factId(statementLine), unit, kind: "input", statementLine });
const output = (name: string, label: string, unit: string, statementLine: string): Record<string, unknown> => ({ id: `V-${name}`, name, label, unit, kind: "computed", statementLine });
const formula = (id: string, expression: string, formulaOutput: string, variables: string[], metrics: string[]): Record<string, unknown> => ({ id, equation: `${formulaOutput} equation`, expression, output: formulaOutput, variables, explanation: "deterministic economic relationship", sourceFacts: evidence(...metrics), confidence: 0.9 });

const model: ForecastSpecification = {
  horizonYears: 3,
  horizonRationale: "Three annual periods for focused verification",
  variables: [
    input("volume", "Volume", 10, "count", "volume"),
    input("price", "Price", 10, "currency", "price"),
    input("grossMargin", "Gross margin", 0.4, "decimal", "grossMargin"),
    input("ebitMargin", "EBIT margin", 0.2, "decimal", "ebitMargin"),
    input("taxRate", "Tax rate", 0.2, "decimal", "taxRate"),
    input("netInterest", "Net interest", 1, "currency", "netInterest"),
    output("revenue", "Revenue", "currency", "totalRevenue"),
    output("grossProfit", "Gross profit", "currency", "grossProfit"),
    output("ebit", "EBIT", "currency", "ebit"),
    output("totalOpex", "Total operating expense", "currency", "totalOpex"),
    output("pbt", "Profit before tax", "currency", "pbt"),
    output("tax", "Tax", "currency", "tax"),
    output("netIncome", "Net income", "currency", "netIncome"),
  ] as ForecastSpecification["variables"],
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
};

let passed = 0;
let failed = 0;
function check(name: string, assertion: () => void): void {
  try {
    assertion();
    passed += 1;
    console.log(`  PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

check("canonical prompt includes factId and legacy compatibility reference", () => {
  const context = renderFactContext(pack, ["incomeStatement"]);
  assert.match(context, /\[FACT-[a-z0-9-]+\]/);
  assert.match(context, /\[F-totalRevenue\]/);
});

check("latest-period base selection is independent of reversed fact order", () => {
  const compiled = compileForecast({ model, factPack: pack });
  assert.equal(compiled.basePeriod, "2024-12-31");
  assert.equal(compiled.baseValues.revenue, 100);
  assert.deepEqual(compiled.years.map((year) => year.period), ["FY2025", "FY2026", "FY2027"]);
});

check("annual paths compound cumulatively through Y2 and Y3", () => {
  const compiled = compileForecast({ model, factPack: pack });
  assert.equal(compiled.years[0].incomeStatement.values.revenue, 110);
  assert.equal(compiled.years[1].incomeStatement.values.revenue, 132);
  assert.equal(compiled.years[2].incomeStatement.values.revenue, 145.2);
  assert.deepEqual(applyGrowthPath(100, [0.1, 0.2, 0.1]).map((value) => Math.round(value * 100) / 100), [110, 132, 145.2]);
});

check("deep formula chains evaluate topologically", () => {
  const out = executeForecast({ model, factPack: pack });
  assert.equal(out.formulasEvaluated.F7, out.forecast.incomeStatement[2].values.netIncome);
  assert.equal(out.forecast.incomeStatement[2].values.revenue, 145.2);
  assert.equal(out.forecast.incomeStatement[2].values.netIncome, 22.432);
});

check("safe expression evaluator rejects arbitrary code", () => {
  assert.equal(evalExpression("revenue * margin", { revenue: 10, margin: 0.2 }).ok, true);
  assert.equal(evalExpression("process.exit(1)", { revenue: 10 }).ok, false);
});

check("cycles, duplicate outputs, unknown variables, and disconnected outputs block validation", () => {
  const cycle: ForecastSpecification = {
    ...model,
    formulas: [
      { ...model.formulas[0], id: "C1", output: "revenue", variables: ["volume"] },
      { ...model.formulas[0], id: "C2", output: "volume", variables: ["revenue"] },
    ],
  };
  const cycleResult = validateModelSpec(cycle, pack);
  assert.equal(cycleResult.valid, false);
  assert.equal(cycleResult.issues.some((entry) => entry.code === "DEPENDENCY_CYCLE"), true);
  const duplicate = { ...model, formulas: [model.formulas[0], { ...model.formulas[1], id: "F8", output: "revenue", variables: ["revenue", "grossMargin"] }] };
  assert.equal(validateModelSpec(duplicate, pack).issues.some((entry) => entry.code === "DUPLICATE_OUTPUT"), true);
  const unknown = { ...model, formulas: [{ ...model.formulas[0], expression: "revenue * missing", variables: ["revenue", "missing"] }] };
  assert.equal(validateModelSpec(unknown, pack).issues.some((entry) => entry.code === "UNKNOWN_FORMULA_VARIABLE"), true);
  const disconnected = { ...model, variables: [...model.variables, output("orphan", "Orphan", "currency", "orphan")], formulas: [...model.formulas, formula("F9", "revenue * 1", "orphan", ["revenue"], ["totalRevenue"])] };
  assert.equal(validateModelSpec(disconnected, pack).issues.some((entry) => entry.code === "DISCONNECTED_OUTPUT"), true);
});

check("invalid base values, units, evidence, and driver horizons are rejected", () => {
  const invalid = { ...model, variables: model.variables.map((variable) => variable.name === "volume" ? { ...variable, baseValue: 999, unit: "not-a-unit" } : variable), formulas: model.formulas.map((formulaItem) => ({ ...formulaItem, sourceFacts: [] })), driverPaths: { ...model.driverPaths, volume: [0.1] } };
  const result = validateModelSpec(invalid, pack);
  assert.equal(result.valid, false);
  assert.equal(result.issues.some((entry) => entry.code === "BASE_VALUE_MISMATCH"), true);
  assert.equal(result.issues.some((entry) => entry.code === "INVALID_UNIT"), true);
  assert.equal(result.issues.some((entry) => entry.code === "MISSING_EVIDENCE_ID"), true);
  assert.equal(result.issues.some((entry) => entry.code === "HORIZON_LENGTH_MISMATCH"), true);
});

check("integrated statements are distinct and cash and balance sheet close", () => {
  const out = executeForecast({ model, factPack: pack });
  assert.notEqual(out.forecast.incomeStatement[0], out.forecast.balanceSheet[0]);
  assert.notEqual(out.forecast.incomeStatement[0].values, out.forecast.balanceSheet[0].values);
  assert.equal(out.forecast.cashFlow[0].values.cashOpen, 20);
  assert.equal(out.forecast.cashFlow[0].values.cashClose, 30);
  assert.equal(out.forecast.balanceSheet[0].values.totalAssets, 200);
  assert.equal(out.forecast.identityChecks.length > 0, true);
  assert.equal(out.forecast.identityChecks.filter((checkItem) => checkItem.critical && !checkItem.pass).length, 0);
  assert.equal(out.forecast.status, "ready");
  assert.equal(out.plugs.length, 0);
});

check("architecture selection uses economic evidence", () => {
  assert.equal(selectAccountingArchitecture({ understanding: { whatItDoes: "takes deposits and makes loans", howItMakesMoney: "net interest income" } }).id, "depository");
  assert.equal(selectAccountingArchitecture({ understanding: { whatItDoes: "underwrites insurance policies", howItMakesMoney: "premiums and claims" } }).id, "insurance");
  assert.equal(selectAccountingArchitecture({ understanding: { whatItDoes: "real estate investment trust", howItMakesMoney: "rental income and occupancy" } }).id, "reit");
  assert.equal(selectAccountingArchitecture({ understanding: { whatItDoes: "asset management company", howItMakesMoney: "management fees on AUM" } }).id, "fee_based");
  assert.equal(selectAccountingArchitecture({ understanding: { whatItDoes: "manufactures products", howItMakesMoney: "volume times price" } }).id, "corporate");
  assert.equal(selectAccountingArchitecture({ understanding: { whatItDoes: "diversified conglomerate", businessSegments: [{ name: "a" }, { name: "b" }] } }).id, "conglomerate");
});

check("blocked execution never evaluates an invalid model", () => {
  const invalid: ForecastSpecification = { ...model, formulas: [{ ...model.formulas[0], expression: "unknown * 2", variables: ["unknown"] }] };
  const out = executeForecast({ model: invalid, factPack: pack });
  assert.equal(out.status, "blocked");
  assert.equal(out.forecast.publicationBlocked, true);
  assert.equal(out.formulasEvaluated.F1, null);
  assert.equal(out.forecast.identityChecks.length > 0, true);
});

console.log(`RESULT: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
