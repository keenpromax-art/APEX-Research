import type { Fact, FactPack } from "@/lib/ai-first/types";
import { compareStableStrings } from "@/lib/research-ledger/stable";

export const HISTORY_METRIC_KEYS = Object.freeze([
  "revenue",
  "ebit",
  "eps",
  "fcf",
  "roic",
  "roe",
  "roa",
  "grossMargin",
  "operatingMargin",
  "netMargin",
  "workingCapitalDays",
  "cashConversion",
  "capexIntensity",
  "leverage",
  "dilution",
  "payoutRatio",
  "buybackIntensity",
  "acquisitionIntensity",
] as const);

export type HistoryMetricKey = (typeof HISTORY_METRIC_KEYS)[number];

export type HistorySeriesBasis = "reported" | "restated" | "normalized";

export type HistoryMetricDirection = "higher-better" | "lower-better" | "neutral";

export const HISTORY_METRIC_UNITS: Readonly<Record<HistoryMetricKey, string>> = Object.freeze({
  revenue: "money",
  ebit: "money",
  eps: "per-share",
  fcf: "money",
  roic: "rate",
  roe: "rate",
  roa: "rate",
  grossMargin: "rate",
  operatingMargin: "rate",
  netMargin: "rate",
  workingCapitalDays: "days",
  cashConversion: "multiple",
  capexIntensity: "rate",
  leverage: "multiple",
  dilution: "rate",
  payoutRatio: "rate",
  buybackIntensity: "rate",
  acquisitionIntensity: "rate",
});

export const HISTORY_METRIC_DIRECTIONS: Readonly<Record<HistoryMetricKey, HistoryMetricDirection>> = Object.freeze({
  revenue: "higher-better",
  ebit: "higher-better",
  eps: "higher-better",
  fcf: "higher-better",
  roic: "higher-better",
  roe: "higher-better",
  roa: "higher-better",
  grossMargin: "higher-better",
  operatingMargin: "higher-better",
  netMargin: "higher-better",
  workingCapitalDays: "lower-better",
  cashConversion: "higher-better",
  capexIntensity: "lower-better",
  leverage: "lower-better",
  dilution: "lower-better",
  payoutRatio: "neutral",
  buybackIntensity: "neutral",
  acquisitionIntensity: "neutral",
});

export const HISTORY_METRIC_LABELS: Readonly<Record<HistoryMetricKey, string>> = Object.freeze({
  revenue: "Revenue",
  ebit: "EBIT",
  eps: "Diluted EPS",
  fcf: "Free cash flow",
  roic: "ROIC",
  roe: "ROE",
  roa: "ROA",
  grossMargin: "Gross margin",
  operatingMargin: "Operating margin",
  netMargin: "Net margin",
  workingCapitalDays: "Working capital days",
  cashConversion: "Cash conversion (CFO / net income)",
  capexIntensity: "Capex intensity",
  leverage: "Leverage (debt / equity)",
  dilution: "Share count dilution",
  payoutRatio: "Dividend payout",
  buybackIntensity: "Buyback intensity",
  acquisitionIntensity: "Acquisition intensity",
});

export const RAW_METRIC_ALIASES = Object.freeze({
  revenue: ["totalRevenue", "operatingRevenue", "totalRevenues", "revenue", "netRevenue"],
  grossProfit: ["grossProfit"],
  operatingIncome: ["operatingIncome", "ebit", "operatingIncomeLoss", "ebita"],
  netIncome: ["netIncome", "netIncomeCommonStockholders", "netIncomeContinuousOperations", "profit"],
  eps: ["dilutedEPS", "dilutedAverageEPS", "epsDiluted", "basicEPS", "basicAverageEPS", "eps"],
  totalAssets: ["totalAssets"],
  totalEquity: ["totalEquity", "StockholdersEquity", "stockholdersEquity", "totalStockholderEquity", "commonStockEquity"],
  totalDebt: ["totalDebt", "totalDebtAndCapitalLeaseObligation", "longTermDebtAndCapitalLeaseObligation"],
  cash: ["cash", "cashAndCashEquivalents", "cashCashEquivalentsAndShortTermInvestments", "cashAndShortTermInvestments"],
  currentAssets: ["totalCurrentAssets"],
  currentLiabilities: ["totalCurrentLiabilities"],
  receivables: ["accountsReceivable", "receivables", "accountsReceivableNetCurrent", "netReceivables"],
  inventory: ["inventory", "netInventory", "inventoryGross"],
  payables: ["accountsPayable", "payables", "accountsPayableCurrent", "tradePayables"],
  operatingCashFlow: ["totalCashFromOperatingActivities", "operatingCashFlow", "cashFlowFromContinuingOperatingActivities"],
  capex: ["capitalExpenditures", "capitalExpenditureReported", "purchaseOfPPE"],
  freeCashFlow: ["freeCashFlow"],
  depreciation: ["depreciation", "depreciationAndAmortization", "reconciledDepreciation", "depreciationAmortizationDepletion"],
  stockBasedCompensation: ["stockBasedCompensation", "shareBasedCompensation", "stockBasedCompensationArrangementByShareBasedPaymentAwardEquityInstrumentsOtherThanOptionsGrantsInPeriodTotal"],
  impairment: ["impairmentOfCapitalAssets", "assetImpairment", "impairmentOfLongLivedAssetsHeldForUse", "impairmentOfLongLivedAssetsToBeDisposedOf"],
  restructuring: ["restructuringAndMergernAcquisition", "restructuringCharges", "restructuringSettlementAndImpairmentProvisions"],
  acquisitionSpend: ["acquisitionOfBusiness", "acquisitionsNetOfCashAcquired", "businessAcquisitions", "purchaseOfBusinesses"],
  assetSaleProceeds: ["saleOfBusiness", "proceedsFromSaleOfBusiness", "saleOfInvestment", "proceedsFromDivestitureOfSubsidiaries"],
  assetSaleGain: ["gainOnSaleOfPPE", "gainOnSaleOfBusiness", "gainOnSaleOfSecurity", "otherSpecialCharges"],
  assetWriteOff: ["writeOff", "otherNoncashIncomeExpense", "assetImpairmentCharge"],
  interestExpense: ["interestExpense", "interestExpenseNonOperating", "interestExpenseDebt", "netNonOperatingInterestIncomeExpense"],
  incomeTaxExpense: ["incomeTaxExpense", "taxProvision"],
  pretaxIncome: ["pretaxIncome", "incomeBeforeTax", "incomeBeforeTaxMinorityInterest", "pretaxIncomeContinuousOperations"],
  dividendsPaid: ["dividendsPaid", "cashDividendsPaid", "commonStockDividendPaid", "cashDividendsPaidToGeneralAndAdministrativeExpense"],
  buybacks: ["repurchaseOfCapitalStock", "repurchaseOfStock", "treasuryStockValueAcquired", "commonStockRepurchased", "paymentsForRepurchaseOfCommonStock"],
  debtRepaid: ["repaymentOfDebt", "repaymentsOfDebt", "cashPaidForDebtRepayment", "longTermDebtRepayments"],
  debtIssued: ["issuanceOfDebt", "proceedsFromIssuanceOfDebt", "shortTermDebtIssuance", "longTermDebtIssuance"],
  dilutedShares: ["dilutedAverageShares", "averageDilutedSharesOutstanding", "basicAverageShares", "averageSharesOutstanding"],
  workingCapital: ["workingCapital", "netWorkingCapital", "workingCapitalOfCapital"],
  changesInReceivables: ["changeInReceivables", "changesInAccountReceivables", "increaseDecreaseInReceivables"],
  changesInInventory: ["changeInInventory", "changesInInventories", "increaseDecreaseInInventories"],
  changesInPayables: ["changeInPayables", "changesInAccountPayable", "increaseDecreaseInPayables"],
  changesInWorkingCapital: ["changeInWorkingCapital", "changesInWorkingCapital", "increaseDecreaseInWorkingCapital"],
}) as Readonly<Record<string, readonly string[]>>;

export const HISTORY_METRIC_RAW_ALIASES: Readonly<Record<HistoryMetricKey, readonly string[]>> = Object.freeze({
  revenue: RAW_METRIC_ALIASES.revenue,
  ebit: RAW_METRIC_ALIASES.operatingIncome,
  eps: RAW_METRIC_ALIASES.eps,
  fcf: RAW_METRIC_ALIASES.freeCashFlow,
  roic: Object.freeze([...RAW_METRIC_ALIASES.operatingIncome, ...RAW_METRIC_ALIASES.totalEquity, ...RAW_METRIC_ALIASES.totalDebt, ...RAW_METRIC_ALIASES.cash, ...RAW_METRIC_ALIASES.incomeTaxExpense, ...RAW_METRIC_ALIASES.pretaxIncome]),
  roe: Object.freeze([...RAW_METRIC_ALIASES.netIncome, ...RAW_METRIC_ALIASES.totalEquity]),
  roa: Object.freeze([...RAW_METRIC_ALIASES.netIncome, ...RAW_METRIC_ALIASES.totalAssets]),
  grossMargin: Object.freeze([...RAW_METRIC_ALIASES.grossProfit, ...RAW_METRIC_ALIASES.revenue]),
  operatingMargin: Object.freeze([...RAW_METRIC_ALIASES.operatingIncome, ...RAW_METRIC_ALIASES.revenue]),
  netMargin: Object.freeze([...RAW_METRIC_ALIASES.netIncome, ...RAW_METRIC_ALIASES.revenue]),
  workingCapitalDays: Object.freeze([...RAW_METRIC_ALIASES.receivables, ...RAW_METRIC_ALIASES.inventory, ...RAW_METRIC_ALIASES.payables, ...RAW_METRIC_ALIASES.currentAssets, ...RAW_METRIC_ALIASES.currentLiabilities, ...RAW_METRIC_ALIASES.revenue]),
  cashConversion: Object.freeze([...RAW_METRIC_ALIASES.operatingCashFlow, ...RAW_METRIC_ALIASES.netIncome]),
  capexIntensity: Object.freeze([...RAW_METRIC_ALIASES.capex, ...RAW_METRIC_ALIASES.revenue]),
  leverage: Object.freeze([...RAW_METRIC_ALIASES.totalDebt, ...RAW_METRIC_ALIASES.totalEquity]),
  dilution: RAW_METRIC_ALIASES.dilutedShares,
  payoutRatio: Object.freeze([...RAW_METRIC_ALIASES.dividendsPaid, ...RAW_METRIC_ALIASES.netIncome]),
  buybackIntensity: Object.freeze([...RAW_METRIC_ALIASES.buybacks, ...RAW_METRIC_ALIASES.operatingCashFlow]),
  acquisitionIntensity: Object.freeze([...RAW_METRIC_ALIASES.acquisitionSpend, ...RAW_METRIC_ALIASES.totalAssets]),
});

export interface HistoryObservation {
  readonly rawMetric: string;
  readonly period: string;
  readonly periodEnd: string;
  readonly value: number;
  readonly restated: boolean;
  readonly estimated: boolean;
  readonly factId: string;
  readonly factIds: readonly string[];
  readonly source: string;
  readonly sourceIds: readonly string[];
  readonly authority: string;
}

export interface HistoryRawPoint {
  readonly metric: string;
  readonly period: string;
  readonly periodEnd: string;
  readonly reported: number | null;
  readonly restated: number | null;
  readonly factIds: readonly string[];
  readonly restatedFactIds: readonly string[];
  readonly sourceIds: readonly string[];
  readonly source: string;
  readonly conflict: boolean;
}

export interface HistoryMetricIndex {
  readonly ticker: string;
  readonly currency: string | null;
  readonly periods: readonly string[];
  readonly rawMetrics: readonly string[];
  readonly observations: readonly HistoryObservation[];
  readonly diagnostics: readonly string[];
  point(rawMetric: string, periodEnd: string): HistoryRawPoint | null;
  value(rawMetric: string, periodEnd: string): number | null;
  series(rawMetric: string): readonly HistoryRawPoint[];
  resolve(aliases: readonly string[], periodEnd: string): HistoryRawPoint | null;
  measure(aliases: readonly string[], periodEnd: string): number | null;
}

const AUTHORITY_RANK: Readonly<Record<string, number>> = Object.freeze({
  primary: 0,
  secondary: 1,
  tertiary: 2,
  model_derived: 3,
  unknown: 4,
});

function round6(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(6));
}

export function historyPeriodEnd(period: string | undefined): string {
  if (typeof period !== "string") return "";
  const trimmed = period.trim();
  if (!trimmed || trimmed.toLowerCase() === "unknown") return "";
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const compact = trimmed.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const parsed = Date.parse(trimmed);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  return "";
}

export function historyPeriodLabel(periodEnd: string): string {
  const year = periodEnd.slice(0, 4);
  return year && /^\d{4}$/.test(year) ? `FY${year}` : periodEnd || "unknown";
}

export function historyFiscalYear(periodEnd: string): number | null {
  const year = Number.parseInt(periodEnd.slice(0, 4), 10);
  return Number.isFinite(year) ? year : null;
}

export function listHistoryFacts(pack: FactPack | null | undefined): Fact[] {
  if (!pack) return [];
  const sections: Array<{ name: string; facts: Fact[] }> = [
    { name: "company", facts: pack.company?.facts ?? [] },
    { name: "market", facts: pack.market?.facts ?? [] },
    { name: "incomeStatement", facts: pack.incomeStatement?.facts ?? [] },
    { name: "balanceSheet", facts: pack.balanceSheet?.facts ?? [] },
    { name: "cashFlow", facts: pack.cashFlow?.facts ?? [] },
    { name: "shares", facts: pack.shares?.facts ?? [] },
    { name: "earnings", facts: pack.earnings?.facts ?? [] },
    { name: "estimates", facts: pack.estimates?.facts ?? [] },
    { name: "corporateActions", facts: pack.corporateActions?.facts ?? [] },
    { name: "priceHistory", facts: pack.priceHistory?.facts ?? [] },
    { name: "holders", facts: pack.holders?.facts ?? [] },
    { name: "fundamentalsTimeseries", facts: pack.fundamentalsTimeseries?.facts ?? [] },
  ];
  const seen = new Set<string>();
  const out: Fact[] = [];
  for (const section of sections) {
    for (const fact of section.facts) {
      if (fact.value === undefined || !Number.isFinite(fact.value)) continue;
      const key = fact.factId ?? `${section.name}|${fact.metric}|${fact.period}|${fact.sourceId ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(fact);
    }
  }
  return out;
}

function observationOf(fact: Fact): HistoryObservation | null {
  if (fact.value === undefined || !Number.isFinite(fact.value)) return null;
  const periodEnd = historyPeriodEnd(fact.reportingPeriod ?? fact.fiscalPeriod ?? fact.period);
  if (!periodEnd) return null;
  const authority = fact.sourceMetadata?.authority ?? (fact.source === "derived" ? "model_derived" : "unknown");
  return {
    rawMetric: fact.metric,
    period: fact.reportingPeriod ?? fact.fiscalPeriod ?? fact.period,
    periodEnd,
    value: fact.value,
    restated: fact.restated === true,
    estimated: fact.estimated === true,
    factId: fact.factId ?? "",
    factIds: fact.factId ? [fact.factId] : [],
    source: String(fact.sourceMetadata?.provider ?? fact.source ?? "unknown"),
    sourceIds: fact.sourceId ? [fact.sourceId] : [],
    authority,
  };
}

function selectionRank(observation: HistoryObservation): string {
  const rank = AUTHORITY_RANK[observation.authority] ?? 4;
  return `${rank}|${observation.sourceIds.join(",")}|${observation.factId}`;
}

function pickObservations(observations: readonly HistoryObservation[]): {
  reported: HistoryObservation | null;
  restated: HistoryObservation | null;
  conflict: boolean;
} {
  const originals = observations.filter((entry) => !entry.restated);
  const restatements = observations.filter((entry) => entry.restated);
  const rank = (left: HistoryObservation, right: HistoryObservation): number => compareStableStrings(selectionRank(left), selectionRank(right));
  const reported = [...originals].sort(rank)[0] ?? null;
  const restated = [...restatements].sort(rank)[0] ?? null;
  const distinct = new Set(observations.map((entry) => entry.value));
  return { reported, restated, conflict: distinct.size > 1 };
}

export function buildHistoryMetricIndex(pack: FactPack | null | undefined): HistoryMetricIndex {
  const facts = listHistoryFacts(pack);
  const observations: HistoryObservation[] = [];
  const diagnostics: string[] = [];
  for (const fact of facts) {
    const observation = observationOf(fact);
    if (observation) observations.push(observation);
  }
  observations.sort((left, right) =>
    compareStableStrings(left.rawMetric, right.rawMetric)
    || compareStableStrings(left.periodEnd, right.periodEnd)
    || compareStableStrings(selectionRank(left), selectionRank(right)));
  const grouped = new Map<string, HistoryObservation[]>();
  for (const observation of observations) {
    const key = `${observation.rawMetric}|${observation.periodEnd}`;
    const group = grouped.get(key) ?? [];
    group.push(observation);
    grouped.set(key, group);
  }
  const resolved = new Map<string, HistoryRawPoint>();
  for (const [key, group] of grouped) {
    const selected = pickObservations(group);
    const leading = group[0];
    if (!leading) continue;
    if (selected.conflict) diagnostics.push(`HISTORY_SOURCE_CONFLICT:${key}`);
    const reportedValue = selected.reported?.value ?? selected.restated?.value ?? null;
    const restatedValue = selected.restated ? selected.restated.value : null;
    resolved.set(key, {
      metric: leading.rawMetric,
      period: leading.period,
      periodEnd: leading.periodEnd,
      reported: reportedValue,
      restated: restatedValue !== null && restatedValue !== reportedValue ? restatedValue : restatedValue,
      factIds: [...new Set(group.flatMap((entry) => entry.factIds))].sort(compareStableStrings),
      restatedFactIds: [...new Set(group.filter((entry) => entry.restated).flatMap((entry) => entry.factIds))].sort(compareStableStrings),
      sourceIds: [...new Set(group.flatMap((entry) => entry.sourceIds))].sort(compareStableStrings),
      source: leading.source,
      conflict: selected.conflict,
    });
  }
  const periods = [...new Set(observations.map((entry) => entry.periodEnd))].sort(compareStableStrings);
  const rawMetrics = [...new Set(observations.map((entry) => entry.rawMetric))].sort(compareStableStrings);
  const byMetric = new Map<string, HistoryRawPoint[]>();
  for (const rawMetric of rawMetrics) {
    byMetric.set(rawMetric, [...resolved.values()].filter((entry) => entry.metric === rawMetric).sort((left, right) => compareStableStrings(left.periodEnd, right.periodEnd)));
  }
  const currencyFact = pack?.incomeStatement?.facts.find((fact) => fact.currency) ?? pack?.market?.facts.find((fact) => fact.currency);
  const index: HistoryMetricIndex = {
    ticker: pack?.ticker ?? "",
    currency: currencyFact?.currency?.toUpperCase() ?? null,
    periods,
    rawMetrics,
    observations,
    diagnostics: [...new Set(diagnostics)].sort(compareStableStrings),
    point(rawMetric: string, periodEnd: string): HistoryRawPoint | null {
      return resolved.get(`${rawMetric}|${periodEnd}`) ?? null;
    },
    value(rawMetric: string, periodEnd: string): number | null {
      const point = resolved.get(`${rawMetric}|${periodEnd}`);
      return point?.reported ?? null;
    },
    series(rawMetric: string): readonly HistoryRawPoint[] {
      return byMetric.get(rawMetric) ?? [];
    },
    resolve(aliases: readonly string[], periodEnd: string): HistoryRawPoint | null {
      for (const alias of aliases) {
        const point = resolved.get(`${alias}|${periodEnd}`);
        if (point) return point;
      }
      return null;
    },
    measure(aliases: readonly string[], periodEnd: string): number | null {
      const point = index.resolve(aliases, periodEnd);
      return point?.reported ?? null;
    },
  };
  return index;
}

export interface HistoryMetricPoint {
  readonly metric: HistoryMetricKey;
  readonly period: string;
  readonly periodEnd: string;
  readonly fiscalYear: number | null;
  readonly reported: number | null;
  readonly restated: number | null;
  readonly factIds: readonly string[];
  readonly restatedFactIds: readonly string[];
  readonly sourceIds: readonly string[];
  readonly source: string;
  readonly derived: boolean;
  readonly derivation: string | null;
  readonly conflict: boolean;
}

interface RawSelection {
  readonly value: number | null;
  readonly restated: number | null;
  readonly factIds: readonly string[];
  readonly restatedFactIds: readonly string[];
  readonly sourceIds: readonly string[];
  readonly source: string;
  readonly conflict: boolean;
}

const EMPTY_SELECTION: RawSelection = Object.freeze({
  value: null,
  restated: null,
  factIds: Object.freeze([]) as readonly string[],
  restatedFactIds: Object.freeze([]) as readonly string[],
  sourceIds: Object.freeze([]) as readonly string[],
  source: "unavailable",
  conflict: false,
});

function combine(selections: readonly (RawSelection | null)[]): RawSelection {
  const present = selections.filter((entry): entry is RawSelection => entry !== null);
  if (present.length === 0) return EMPTY_SELECTION;
  const hasValue = present.some((entry) => entry.value !== null);
  if (!hasValue) return EMPTY_SELECTION;
  return {
    value: null,
    restated: null,
    factIds: [...new Set(present.flatMap((entry) => entry.factIds))].sort(compareStableStrings),
    restatedFactIds: [...new Set(present.flatMap((entry) => entry.restatedFactIds))].sort(compareStableStrings),
    sourceIds: [...new Set(present.flatMap((entry) => entry.sourceIds))].sort(compareStableStrings),
    source: present.find((entry) => entry.source !== "unavailable")?.source ?? "unavailable",
    conflict: present.some((entry) => entry.conflict),
  };
}

function select(index: HistoryMetricIndex, aliases: readonly string[], periodEnd: string): RawSelection {
  const point = index.resolve(aliases, periodEnd);
  if (!point) return EMPTY_SELECTION;
  return {
    value: point.reported,
    restated: point.restated,
    factIds: point.factIds,
    restatedFactIds: point.restatedFactIds,
    sourceIds: point.sourceIds,
    source: point.source,
    conflict: point.conflict,
  };
}

function ratio(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || !Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator === 0) return null;
  return round6(numerator / denominator);
}

function point(
  metric: HistoryMetricKey,
  periodEnd: string,
  value: number | null,
  restated: number | null,
  selection: RawSelection,
  derived: boolean,
  derivation: string | null,
): HistoryMetricPoint | null {
  if (value === null && restated === null) return null;
  return {
    metric,
    period: historyPeriodLabel(periodEnd),
    periodEnd,
    fiscalYear: historyFiscalYear(periodEnd),
    reported: value,
    restated,
    factIds: selection.factIds,
    restatedFactIds: selection.restatedFactIds,
    sourceIds: selection.sourceIds,
    source: selection.source,
    derived,
    derivation,
    conflict: selection.conflict,
  };
}

function buildMetricPoints(index: HistoryMetricIndex, metric: HistoryMetricKey): HistoryMetricPoint[] {
  const periods = index.periods;
  const prior = new Map<string, string>();
  for (let position = 0; position < periods.length; position += 1) {
    const current = periods[position];
    const previous = position > 0 ? periods[position - 1] : undefined;
    if (current && previous) prior.set(current, previous);
  }
  const out: HistoryMetricPoint[] = [];
  for (const periodEnd of periods) {
    const previousPeriod = prior.get(periodEnd) ?? "";
    const previousLookup = (aliases: readonly string[]): RawSelection => (previousPeriod ? select(index, aliases, previousPeriod) : EMPTY_SELECTION);
    const value = (aliases: readonly string[]): RawSelection => select(index, aliases, periodEnd);
    const derived = (result: { value: number | null; restatedValue: number | null; selection: RawSelection }, derivation: string): HistoryMetricPoint | null => {
      if (result.value === null && result.restatedValue === null) return null;
      return point(metric, periodEnd, roundOrNull(result.value), roundOrNull(result.restatedValue), result.selection, true, derivation);
    };
    const direct = (aliases: readonly string[]): { value: number | null; restatedValue: number | null; selection: RawSelection } => {
      const selection = value(aliases);
      return { value: selection.value, restatedValue: selection.restated, selection };
    };
    let built: HistoryMetricPoint | null = null;
    switch (metric) {
      case "revenue": {
        const result = direct(RAW_METRIC_ALIASES.revenue);
        built = point(metric, periodEnd, result.value, result.restatedValue, result.selection, false, null);
        break;
      }
      case "ebit": {
        const result = direct(RAW_METRIC_ALIASES.operatingIncome);
        built = point(metric, periodEnd, result.value, result.restatedValue, result.selection, false, null);
        break;
      }
      case "eps": {
        const result = direct(RAW_METRIC_ALIASES.eps);
        built = point(metric, periodEnd, result.value, result.restatedValue, result.selection, false, null);
        break;
      }
      case "fcf": {
        const free = direct(RAW_METRIC_ALIASES.freeCashFlow);
        if (free.value !== null || free.restatedValue !== null) {
          built = point(metric, periodEnd, free.value, free.restatedValue, free.selection, false, null);
          break;
        }
        const operating = value(RAW_METRIC_ALIASES.operatingCashFlow);
        const capex = value(RAW_METRIC_ALIASES.capex);
        const operatingRestated = operating.restated;
        const capexRestated = capex.restated;
        if (operating.value === null || capex.value === null) {
          built = null;
          break;
        }
        built = derived({
          value: operating.value - Math.abs(capex.value),
          restatedValue: operatingRestated !== null && capexRestated !== null ? operatingRestated - Math.abs(capexRestated) : null,
          selection: combine([operating, capex]),
        }, "free cash flow = operating cash flow less absolute capital expenditure");
        break;
      }
      case "grossMargin": {
        const revenue = value(RAW_METRIC_ALIASES.revenue);
        const gross = value(RAW_METRIC_ALIASES.grossProfit);
        built = derived({
          value: ratio(gross.value, revenue.value),
          restatedValue: ratio(gross.restated, revenue.restated),
          selection: combine([revenue, gross]),
        }, "gross margin = gross profit / revenue");
        break;
      }
      case "operatingMargin": {
        const revenue = value(RAW_METRIC_ALIASES.revenue);
        const operating = value(RAW_METRIC_ALIASES.operatingIncome);
        built = derived({
          value: ratio(operating.value, revenue.value),
          restatedValue: ratio(operating.restated, revenue.restated),
          selection: combine([revenue, operating]),
        }, "operating margin = operating income / revenue");
        break;
      }
      case "netMargin": {
        const revenue = value(RAW_METRIC_ALIASES.revenue);
        const net = value(RAW_METRIC_ALIASES.netIncome);
        built = derived({
          value: ratio(net.value, revenue.value),
          restatedValue: ratio(net.restated, revenue.restated),
          selection: combine([revenue, net]),
        }, "net margin = net income / revenue");
        break;
      }
      case "roe": {
        const net = value(RAW_METRIC_ALIASES.netIncome);
        const equity = value(RAW_METRIC_ALIASES.totalEquity);
        built = derived({
          value: ratio(net.value, equity.value),
          restatedValue: ratio(net.restated, equity.restated),
          selection: combine([net, equity]),
        }, "ROE = net income / period-end total equity");
        break;
      }
      case "roa": {
        const net = value(RAW_METRIC_ALIASES.netIncome);
        const assets = value(RAW_METRIC_ALIASES.totalAssets);
        built = derived({
          value: ratio(net.value, assets.value),
          restatedValue: ratio(net.restated, assets.restated),
          selection: combine([net, assets]),
        }, "ROA = net income / period-end total assets");
        break;
      }
      case "roic": {
        const operating = value(RAW_METRIC_ALIASES.operatingIncome);
        const tax = value(RAW_METRIC_ALIASES.incomeTaxExpense);
        const pretax = value(RAW_METRIC_ALIASES.pretaxIncome);
        const debt = value(RAW_METRIC_ALIASES.totalDebt);
        const cash = value(RAW_METRIC_ALIASES.cash);
        const equity = value(RAW_METRIC_ALIASES.totalEquity);
        const effectiveTax = ratio(tax.value, pretax.value);
        const nopat = operating.value === null || effectiveTax === null ? null : operating.value * (1 - effectiveTax);
        const invested = equity.value === null ? null : equity.value + (debt.value ?? 0) - (cash.value ?? 0);
        const restatedNopat = operating.restated === null || ratio(tax.restated, pretax.restated) === null ? null : operating.restated * (1 - (ratio(tax.restated, pretax.restated) as number));
        const restatedInvested = equity.restated === null ? null : equity.restated + (debt.restated ?? 0) - (cash.restated ?? 0);
        built = derived({
          value: ratio(nopat, invested),
          restatedValue: ratio(restatedNopat, restatedInvested),
          selection: combine([operating, tax, pretax, debt, cash, equity]),
        }, "ROIC = NOPAT / (total equity + total debt - cash), NOPAT taxed at the reported effective rate");
        break;
      }
      case "workingCapitalDays": {
        const revenue = value(RAW_METRIC_ALIASES.revenue);
        const receivables = value(RAW_METRIC_ALIASES.receivables);
        const inventory = value(RAW_METRIC_ALIASES.inventory);
        const payables = value(RAW_METRIC_ALIASES.payables);
        const currentAssets = value(RAW_METRIC_ALIASES.currentAssets);
        const currentLiabilities = value(RAW_METRIC_ALIASES.currentLiabilities);
        const reported = receivables.value === null || inventory.value === null || payables.value === null || revenue.value === null || revenue.value === 0
          ? null
          : round6(((receivables.value + inventory.value - payables.value) / revenue.value) * 365);
        const restated = receivables.restated === null || inventory.restated === null || payables.restated === null || revenue.restated === null || revenue.restated === 0
          ? null
          : round6(((receivables.restated + inventory.restated - payables.restated) / revenue.restated) * 365);
        const fallback = currentAssets.value === null || currentLiabilities.value === null || revenue.value === null || revenue.value === 0
          ? null
          : round6(((currentAssets.value - currentLiabilities.value) / revenue.value) * 365);
        const fallbackRestated = currentAssets.restated === null || currentLiabilities.restated === null || revenue.restated === null || revenue.restated === 0
          ? null
          : round6(((currentAssets.restated - currentLiabilities.restated) / revenue.restated) * 365);
        built = derived({
          value: reported ?? fallback,
          restatedValue: restated ?? fallbackRestated,
          selection: combine([reported === null ? combine([currentAssets, currentLiabilities]) : combine([receivables, inventory, payables]), revenue]),
        }, "working capital days = (receivables + inventory - payables) / revenue x 365, falling back to (current assets - current liabilities) / revenue x 365");
        break;
      }
      case "cashConversion": {
        const operating = value(RAW_METRIC_ALIASES.operatingCashFlow);
        const net = value(RAW_METRIC_ALIASES.netIncome);
        built = derived({
          value: ratio(operating.value, net.value),
          restatedValue: ratio(operating.restated, net.restated),
          selection: combine([operating, net]),
        }, "cash conversion = operating cash flow / net income");
        break;
      }
      case "capexIntensity": {
        const revenue = value(RAW_METRIC_ALIASES.revenue);
        const capex = value(RAW_METRIC_ALIASES.capex);
        built = derived({
          value: capex.value === null || revenue.value === null || revenue.value === 0 ? null : round6(Math.abs(capex.value) / revenue.value),
          restatedValue: capex.restated === null || revenue.restated === null || revenue.restated === 0 ? null : round6(Math.abs(capex.restated) / revenue.restated),
          selection: combine([capex, revenue]),
        }, "capex intensity = absolute capital expenditure / revenue");
        break;
      }
      case "leverage": {
        const debt = value(RAW_METRIC_ALIASES.totalDebt);
        const equity = value(RAW_METRIC_ALIASES.totalEquity);
        built = derived({
          value: ratio(debt.value, equity.value),
          restatedValue: ratio(debt.restated, equity.restated),
          selection: combine([debt, equity]),
        }, "leverage = total debt / total equity");
        break;
      }
      case "dilution": {
        const shares = value(RAW_METRIC_ALIASES.dilutedShares);
        const priorShares = previousPeriod ? previousLookup(RAW_METRIC_ALIASES.dilutedShares) : EMPTY_SELECTION;
        if (shares.value === null || priorShares.value === null || priorShares.value === 0) {
          built = null;
          break;
        }
        const restatedDilution = shares.restated === null || priorShares.restated === null || priorShares.restated === 0
          ? null
          : round6(shares.restated / priorShares.restated - 1);
        built = derived({
          value: round6(shares.value / priorShares.value - 1),
          restatedValue: restatedDilution,
          selection: combine([shares, priorShares]),
        }, "dilution = current period weighted average shares / prior period weighted average shares - 1");
        break;
      }
      case "payoutRatio": {
        const net = value(RAW_METRIC_ALIASES.netIncome);
        const dividends = value(RAW_METRIC_ALIASES.dividendsPaid);
        built = derived({
          value: net.value === null || net.value === 0 || dividends.value === null ? null : round6(Math.abs(dividends.value) / net.value),
          restatedValue: net.restated === null || net.restated === 0 || dividends.restated === null ? null : round6(Math.abs(dividends.restated) / net.restated),
          selection: combine([dividends, net]),
        }, "payout ratio = absolute dividends paid / net income");
        break;
      }
      case "buybackIntensity": {
        const buybacks = value(RAW_METRIC_ALIASES.buybacks);
        const operating = value(RAW_METRIC_ALIASES.operatingCashFlow);
        const denominator = operating.value !== null && operating.value !== 0 ? operating.value : null;
        built = derived({
          value: buybacks.value === null || denominator === null ? null : round6(Math.abs(buybacks.value) / Math.abs(denominator)),
          restatedValue: buybacks.restated === null || denominator === null ? null : round6(Math.abs(buybacks.restated) / Math.abs(denominator)),
          selection: combine([buybacks, operating]),
        }, "buyback intensity = absolute share repurchases / operating cash flow");
        break;
      }
      case "acquisitionIntensity": {
        const acquisitions = value(RAW_METRIC_ALIASES.acquisitionSpend);
        const assets = value(RAW_METRIC_ALIASES.totalAssets);
        built = derived({
          value: acquisitions.value === null || assets.value === null || assets.value === 0 ? null : round6(Math.abs(acquisitions.value) / assets.value),
          restatedValue: acquisitions.restated === null || assets.restated === null || assets.restated === 0 ? null : round6(Math.abs(acquisitions.restated) / assets.restated),
          selection: combine([acquisitions, assets]),
        }, "acquisition intensity = absolute acquisition spend / period-end total assets");
        break;
      }
      default: {
        built = null;
      }
    }
    if (built) out.push(built);
  }
  return out;
}

function roundOrNull(value: number | null): number | null {
  return value === null || !Number.isFinite(value) ? null : round6(value);
}

export interface HistoryMetricPointIndex {
  readonly metrics: Readonly<Record<HistoryMetricKey, readonly HistoryMetricPoint[]>>;
  readonly diagnostics: readonly string[];
  points(metric: HistoryMetricKey): readonly HistoryMetricPoint[];
}

export function buildHistoryMetricPoints(index: HistoryMetricIndex): HistoryMetricPointIndex {
  const metrics = {} as Record<HistoryMetricKey, readonly HistoryMetricPoint[]>;
  const diagnostics: string[] = [...index.diagnostics];
  for (const metric of HISTORY_METRIC_KEYS) {
    const points = buildMetricPoints(index, metric);
    metrics[metric] = Object.freeze(points);
    for (const entry of points) {
      if (entry.conflict) diagnostics.push(`HISTORY_METRIC_SOURCE_CONFLICT:${metric}|${entry.periodEnd}`);
      if (entry.restated !== null && entry.reported !== null && entry.restated !== entry.reported) {
        diagnostics.push(`HISTORY_RESTATEMENT:${metric}|${entry.periodEnd}`);
      }
    }
  }
  return {
    metrics,
    diagnostics: [...new Set(diagnostics)].sort(compareStableStrings),
    points(metric: HistoryMetricKey): readonly HistoryMetricPoint[] {
      return metrics[metric] ?? [];
    },
  };
}
