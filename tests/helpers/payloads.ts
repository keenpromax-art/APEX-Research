export const FIXED_TIMESTAMP = "2026-09-25T12:00:00.000Z";

export function raw(value: number): { raw: number; fmt: string } {
  return { raw: value, fmt: String(value) };
}

export function statementRow(period: string, values: Record<string, number>): Record<string, unknown> {
  return {
    endDate: { raw: period, fmt: period },
    maxAge: 1,
    ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, raw(value)])),
  };
}

export function bankPayload(): Record<string, unknown> {
  return {
    assetProfile: {
      longBusinessSummary: "State Bank of India is a commercial bank taking deposits and making advances across retail and corporate banking.",
      sector: "Financial Services",
      industry: "Banks - Regional",
      country: "India",
    },
    price: {
      longName: "State Bank of India",
      shortName: "SBIN",
      currency: "INR",
      regularMarketPrice: raw(820),
      marketCap: raw(7320000000000),
    },
    summaryDetail: { beta: raw(1.1) },
    financialData: { recommendationKey: "buy" },
    defaultKeyStatistics: { sharesOutstanding: raw(8920000000), bookValue: raw(415) },
    incomeStatementHistory: {
      incomeStatementHistory: [
        statementRow("2024-03-31", { totalRevenue: 4763000000000, netIncome: 610000000000, interestIncome: 6200000000000, interestExpense: 4400000000000 }),
        statementRow("2023-03-31", { totalRevenue: 4200000000000, netIncome: 500000000000 }),
      ],
    },
    balanceSheetHistory: {
      balanceSheetHistory: [
        statementRow("2024-03-31", { totalAssets: 61000000000000, totalLiabilities: 55600000000000, totalEquity: 5400000000000, totalDebt: 900000000000, cash: 3000000000000 }),
      ],
    },
    cashflowStatementHistory: {
      cashflowStatementHistory: [statementRow("2024-03-31", { totalCashFromOperatingActivities: 800000000000, capitalExpenditures: 120000000000 })],
    },
  };
}

export function corporatePayload(): Record<string, unknown> {
  return {
    assetProfile: {
      longBusinessSummary: "Infosys Limited is a global information technology services company delivering digital transformation through volume times price consulting engagements.",
      sector: "Technology",
      industry: "Information Technology Services",
      country: "India",
    },
    price: {
      longName: "Infosys Limited",
      shortName: "INFY",
      currency: "INR",
      regularMarketPrice: raw(1850),
      marketCap: raw(7650000000000),
    },
    summaryDetail: { beta: raw(0.9) },
    financialData: { recommendationKey: "buy" },
    defaultKeyStatistics: { sharesOutstanding: raw(4130000000), bookValue: raw(210) },
    incomeStatementHistory: {
      incomeStatementHistory: [
        statementRow("2024-03-31", { totalRevenue: 1538000000000, grossProfit: 460000000000, ebit: 320000000000, netIncome: 240000000000, tax: 80000000000 }),
        statementRow("2023-03-31", { totalRevenue: 1468000000000, netIncome: 240000000000 }),
      ],
    },
    balanceSheetHistory: {
      balanceSheetHistory: [
        statementRow("2024-03-31", { totalAssets: 1200000000000, totalLiabilities: 350000000000, totalEquity: 850000000000, totalDebt: 100000000000, cash: 300000000000 }),
      ],
    },
    cashflowStatementHistory: {
      cashflowStatementHistory: [statementRow("2024-03-31", { totalCashFromOperatingActivities: 280000000000, capitalExpenditures: 40000000000 })],
    },
  };
}

export function reitPayload(): Record<string, unknown> {
  return {
    assetProfile: {
      longBusinessSummary: "Embassy Office Parks REIT owns rental income producing office properties with occupancy and lease expiry economics.",
      sector: "Real Estate",
      industry: "REIT - Office",
      country: "India",
    },
    price: {
      longName: "Embassy Office Parks REIT",
      shortName: "EMBASSY",
      currency: "INR",
      regularMarketPrice: raw(380),
      marketCap: raw(360000000000),
    },
    summaryDetail: { beta: raw(0.6) },
    financialData: {},
    defaultKeyStatistics: { sharesOutstanding: raw(948000000) },
    incomeStatementHistory: {
      incomeStatementHistory: [
        statementRow("2024-03-31", { totalRevenue: 38000000000, netIncome: 9000000000, rentalIncome: 32000000000 }),
      ],
    },
    balanceSheetHistory: {
      balanceSheetHistory: [
        statementRow("2024-03-31", { totalAssets: 550000000000, totalLiabilities: 250000000000, totalEquity: 300000000000, totalDebt: 180000000000, cash: 15000000000 }),
      ],
    },
    cashflowStatementHistory: {
      cashflowStatementHistory: [statementRow("2024-03-31", { totalCashFromOperatingActivities: 25000000000, capitalExpenditures: 8000000000 })],
    },
  };
}
