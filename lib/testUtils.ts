import type { RawTickerData } from "./types";

function statement(rows: Record<string, number[]>, periods: string[]) {
  const lineItems: Record<string, Record<string, number | null>> = {};
  for (const [item, values] of Object.entries(rows)) {
    lineItems[item] = {};
    periods.forEach((period, i) => {
      lineItems[item][period] = values[i] ?? null;
    });
  }
  return { periods, lineItems };
}

export function makeRawData(overrides: Partial<{
  withIncome: boolean;
  withBalance: boolean;
  withCashflow: boolean;
  withHistory: boolean;
}> = {}): RawTickerData {
  const { withIncome = true, withBalance = true, withCashflow = true, withHistory = true } = overrides;
  const periods = ["2025-03-31", "2024-03-31"];
  const closes = Array.from({ length: 600 }, (_, i) => 100 * 1.001 ** i);
  return {
    ticker: "TEST",
    retrievedAt: "2026-09-28T00:00:00+00:00",
    info: {
      shortName: "Test Co",
      longName: "Test Company Ltd",
      sector: "Technology",
      industry: "Software",
      currency: "USD",
      regularMarketPrice: 150,
      regularMarketChange: 2,
      regularMarketChangePercent: 0.0135,
      marketCap: 7500,
      sharesOutstanding: 50,
      trailingPE: 10,
      priceToBook: 3,
      dividendYield: 0.02,
    },
    incomeStatement: withIncome
      ? statement(
          {
            "Total Revenue": [1000, 900],
            "Cost Of Revenue": [600, 550],
            "Gross Profit": [400, 350],
            "Operating Income": [200, 180],
            EBITDA: [250, 220],
            "Net Income": [150, 130],
            "Diluted EPS": [3, 2.6],
            "Diluted Average Shares": [50, 50],
          },
          periods
        )
      : null,
    quarterlyIncomeStatement: null,
    balanceSheet: withBalance
      ? statement(
          {
            "Total Assets": [2000, 1900],
            "Total Debt": [500, 480],
            "Stockholders Equity": [1000, 950],
            "Cash And Cash Equivalents": [200, 180],
            "Total Current Assets": [800, 750],
            "Total Current Liabilities": [400, 380],
            Inventory: [100, 90],
            "Common Stock Shares Outstanding": [50, 50],
          },
          periods
        )
      : null,
    quarterlyBalanceSheet: null,
    cashFlow: withCashflow
      ? statement(
          {
            "Operating Cash Flow": [300, 280],
            "Capital Expenditure": [-100, -90],
            "Free Cash Flow": [200, 190],
            "Change In Working Capital": [10, 5],
          },
          periods
        )
      : null,
    quarterlyCashFlow: null,
    priceHistory: withHistory
      ? closes.map((close, i) => ({
          date: new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10),
          close,
          volume: 1000,
        }))
      : [],
    dividends: [
      { date: "2025-06-01", amount: 1 },
      { date: "2025-09-01", amount: 1.1 },
    ],
    splits: null,
    sharesOutstanding: [{ date: "2025-01-01", shares: 50 }],
    earningsDates: null,
    majorHolders: null,
    institutionalHolders: null,
  };
}
