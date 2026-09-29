import type { AnalysisContext, CompanyContext, DataQuality, DerivedMetrics, FinancialData } from "./types";

const PRICE_SERIES_POINTS = 520;

const KEY_FIELDS: [string, string][] = [
  ["incomeStatement", "revenue"],
  ["incomeStatement", "net_income"],
  ["incomeStatement", "diluted_eps"],
  ["balanceSheet", "total_debt"],
  ["balanceSheet", "stockholders_equity"],
  ["cashFlow", "operating_cash_flow"],
];

export function buildContext(
  financials: FinancialData[],
  derived: DerivedMetrics[],
  userRequest: string
): AnalysisContext {
  return {
    userRequest,
    companies: financials.map((data, i) => companyContext(data, derived[i])),
    meta: {
      generatedAt: new Date().toISOString(),
      tickers: financials.map((d) => d.ticker),
      dataSource: "yfinance",
    },
  };
}

function companyContext(data: FinancialData, metrics: DerivedMetrics): CompanyContext {
  const sample = data.historicalPrices.slice(-PRICE_SERIES_POINTS);
  const series: Record<string, { label: string; value: number }[]> = {};
  if (data.historicalPrices.length > 0) {
    series["price"] = sample
      .filter((r) => r.close !== null)
      .map((r) => ({ label: r.date, value: r.close as number }));
  }
  for (const [key, metric] of metrics.metrics) {
    if (!metric.byPeriod) continue;
    const points = Object.entries(metric.byPeriod)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .filter((entry): entry is [string, number] => entry[1] !== null)
      .map(([period, value]) => ({ label: period.slice(0,4) || period, value }));
    if (points.length > 0) series[key] = points;
  }

  return {
    ticker: data.ticker,
    retrievalTimestamp: data.retrievalTimestamp,
    company: data.company,
    market: data.market,
    price: data.price,
    financials: {
      incomeStatement: data.incomeStatement,
      balanceSheet: data.balanceSheet,
      cashFlow: data.cashFlow,
      quarterly: {
        incomeStatement: data.incomeStatementQuarterly,
        balanceSheet: data.balanceSheetQuarterly,
        cashFlow: data.cashFlowQuarterly,
      },
    },
    historical: {
      observations: data.historicalPrices.length,
      dateRange:
        data.historicalPrices.length > 0
          ? `${data.historicalPrices[0].date} to ${data.historicalPrices[data.historicalPrices.length - 1].date}`
          : null,
      price: sample.map((r) => ({ date: r.date, close: r.close })),
    },
    derivedMetrics: Object.fromEntries(
      [...metrics.metrics.entries()].map(([key, m]) => [
        key,
        { label: m.label, value: m.value, unit: m.unit, formula: m.formula, inputs: m.inputs, ...(m.byPeriod ? { byPeriod: m.byPeriod } : {}) },
      ])
    ),
    series,
    valuation: data.valuation,
    ownership: data.ownership,
    dividends: data.dividends,
    splits: data.splits,
    earnings: data.earnings,
    analystData: data.analystData,
    dataQuality: dataQuality(data) as unknown as Record<string, unknown>,
  };
}

function statementSummary(statement: FinancialData["incomeStatement"]): { frequency: string; periods: string[]; lineItemCount: number } {
  return {
    frequency: statement?.frequency ?? "annual",
    periods: statement?.periods ?? [],
    lineItemCount: statement ? Object.keys(statement.lineItems).length : 0,
  };
}

function dataQuality(data: FinancialData): DataQuality {
  const quality: DataQuality = {
    ticker: data.ticker,
    currency: (data.market?.currency as string) ?? null,
    statements: {
      incomeStatement: statementSummary(data.incomeStatement),
      balanceSheet: statementSummary(data.balanceSheet),
      cashFlow: statementSummary(data.cashFlow),
    },
    missingStatements: [],
    missingFields: [],
    historicalObservations: data.historicalPrices.length,
    historicalDateRange:
      data.historicalPrices.length > 0
        ? `${data.historicalPrices[0].date} to ${data.historicalPrices[data.historicalPrices.length - 1].date}`
        : null,
    dataFreshness: data.retrievalTimestamp,
    dividendsAvailable: data.dividends !== null,
    splitsAvailable: data.splits !== null,
    analystDataAvailable: data.analystData !== null,
    notes: [],
  };

  for (const name of ["incomeStatement", "balanceSheet", "cashFlow"] as const) {
    if (!data[name]) {
      quality.missingStatements.push(name);
      quality.notes.push(`${name.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())} unavailable.`);
    } else if (data[name]!.periods.length < 3) {
      quality.notes.push(`Only ${data[name]!.periods.length} annual periods available in ${name.replace(/([A-Z])/g, " $1").toLowerCase()}.`);
    }
  }

  for (const [statementName, canonical] of KEY_FIELDS) {
    const statement = data[statementName as "incomeStatement" | "balanceSheet" | "cashFlow"];
    if (!statement) continue;
    const found = Object.keys(statement.lineItems).some((item) => {
      const normalized = item.toLowerCase().replace(/[^a-z0-9]/g, "");
      return normalized === canonical.replace(/_/g, "") || normalized.includes(canonical.replace(/_/g, ""));
    });
    if (!found) quality.missingFields.push(`${statementName}.${canonical}`);
  }

  if (data.historicalPrices.length === 0) quality.notes.push("Price history unavailable.");
  if (!data.analystData) quality.notes.push("Analyst data not provided by yfinance for this ticker.");
  if (!data.dividends) quality.notes.push("Dividend data unavailable.");

  return quality;
}
