export interface Provenance {
  ticker: string;
  source: string;
  retrievedAt: string;
  period?: string | null;
  currency?: string | null;
  frequency?: string | null;
  originalField?: string | null;
  normalizedField?: string | null;
}

export interface Statement {
  frequency: string;
  periods: string[];
  lineItems: Record<string, Record<string, number | null>>;
  provenance: Provenance;
}

export interface FinancialData {
  ticker: string;
  retrievalTimestamp: string;
  company: Record<string, unknown> | null;
  market: Record<string, unknown> | null;
  price: Record<string, unknown> | null;
  historicalPrices: { date: string; close: number | null; volume: number | null }[];
  incomeStatement: Statement | null;
  balanceSheet: Statement | null;
  cashFlow: Statement | null;
  incomeStatementQuarterly: Statement | null;
  balanceSheetQuarterly: Statement | null;
  cashFlowQuarterly: Statement | null;
  valuation: Record<string, unknown> | null;
  ownership: Record<string, unknown> | null;
  dividends: { date: string; amount: number }[] | null;
  splits: { date: string; amount: number }[] | null;
  earnings: { recent: Record<string, unknown>[] } | null;
  analystData: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
}

export interface DataQuality {
  ticker: string;
  currency: string | null;
  statements: Record<string, { frequency: string; periods: string[]; lineItemCount: number }>;
  missingStatements: string[];
  missingFields: string[];
  historicalObservations: number;
  historicalDateRange: string | null;
  dataFreshness: string | null;
  dividendsAvailable: boolean;
  splitsAvailable: boolean;
  analystDataAvailable: boolean;
  notes: string[];
}

export interface Metric {
  key: string;
  label: string;
  value: number | null;
  unit: string;
  formula: string;
  inputs: string[];
  byPeriod?: Record<string, number | null> | null;
}

export interface DerivedMetrics {
  ticker: string;
  metrics: Map<string, Metric>;
}

export type Block =
  | { type: "heading"; level: number; content: string }
  | { type: "paragraph"; content: string; epistemic?: string | null }
  | { type: "metric"; label: string; value: number; unit: string; metricKey: string; change?: number | null }
  | { type: "table"; columns: string[]; rows: (string | number | null)[][] }
  | { type: "chart"; title: string; chartType: "line" | "bar"; ref?: string | null; data?: { label: string; value: number }[] | null }
  | { type: "callout"; variant: "info" | "warning" | "uncertainty" | "fact"; content: string }
  | { type: "list"; items: string[]; ordered: boolean }
  | { type: "formula"; expression: string; result?: number | null }
  | { type: "provenance"; items: { claim: string; value: number | null; source: string }[] };

export interface AnalysisDocument {
  title: string;
  summary: string;
  blocks: Block[];
}

export interface RawTickerData {
  ticker: string;
  retrievedAt: string;
  info: Record<string, unknown> | null;
  incomeStatement: { periods: string[]; lineItems: Record<string, Record<string, number | null>> } | null;
  quarterlyIncomeStatement: { periods: string[]; lineItems: Record<string, Record<string, number | null>> } | null;
  balanceSheet: { periods: string[]; lineItems: Record<string, Record<string, number | null>> } | null;
  quarterlyBalanceSheet: { periods: string[]; lineItems: Record<string, Record<string, number | null>> } | null;
  cashFlow: { periods: string[]; lineItems: Record<string, Record<string, number | null>> } | null;
  quarterlyCashFlow: { periods: string[]; lineItems: Record<string, Record<string, number | null>> } | null;
  priceHistory: { date: string; close: number | null; volume: number | null }[];
  dividends: { date: string; amount: number }[] | null;
  splits: { date: string; amount: number }[] | null;
  sharesOutstanding: { date: string; shares: number }[] | null;
  earningsDates: Record<string, unknown>[] | null;
  majorHolders: Record<string, unknown>[] | null;
  institutionalHolders: Record<string, unknown>[] | null;
}

export interface CompanyContext {
  ticker: string;
  retrievalTimestamp: string;
  company: Record<string, unknown> | null;
  market: Record<string, unknown> | null;
  price: Record<string, unknown> | null;
  financials: {
    incomeStatement: unknown;
    balanceSheet: unknown;
    cashFlow: unknown;
    quarterly: Record<string, unknown>;
  };
  historical: { observations: number; dateRange: string | null; price: { date: string; close: number | null }[] };
  derivedMetrics: Record<string, { label: string; value: number | null; unit: string; formula: string; inputs: string[]; byPeriod?: Record<string, number | null> }>;
  series: Record<string, { label: string; value: number }[]>;
  valuation: Record<string, unknown> | null;
  ownership: Record<string, unknown> | null;
  dividends: { date: string; amount: number }[] | null;
  splits: { date: string; amount: number }[] | null;
  earnings: { recent: Record<string, unknown>[] } | null;
  analystData: Record<string, unknown> | null;
  dataQuality: Record<string, unknown>;
}

export interface AnalysisContext {
  userRequest: string;
  companies: CompanyContext[];
  meta: { generatedAt: string; tickers: string[]; dataSource: string };
}
