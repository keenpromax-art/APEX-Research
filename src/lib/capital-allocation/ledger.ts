import { compareStableStrings, createStableId, stableHash } from "@/lib/research-ledger/stable";
import { deepFreeze } from "@/lib/research-ledger/immutable";
import {
  RAW_METRIC_ALIASES,
  buildHistoryMetricIndex,
  buildHistoryMetricPoints,
  historyFiscalYear,
  historyPeriodLabel,
  type HistoryMetricIndex,
} from "@/lib/history/facts";
import {
  CAPITAL_ALLOCATION_BUCKETS,
  CAPITAL_ALLOCATION_LEDGER_VERSION,
  type AcquisitionValueDiagnostic,
  type BuildCapitalAllocationLedgerInput,
  type BuybackValuationDiagnostic,
  type CapitalAllocationEntry,
  type CapitalAllocationEntryKind,
  type CapitalAllocationFlag,
  type CapitalAllocationLedger,
  type CapitalAllocationPeriod,
  type CapitalAllocationStatus,
  type CapitalAllocationTotals,
  type DividendConsistencyDiagnostic,
  type LeveragePolicyDiagnostic,
  type RoicReinvestmentDiagnostic,
} from "./types";

const LEDGER_DOMAIN = "capital-allocation/ledger/v1";
const DIVIDEND_STABILITY_TOLERANCE = 0.1;
const DEFAULT_REFERENCE_COST_OF_CAPITAL = 0.08;
const ACQUISITION_DISCIPLINE_MULTIPLE = 20;
const LEVERAGE_HISTORY_MINIMUM = 3;

function round6(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : 0;
}

function ratio(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator === 0) return null;
  return round6(numerator / denominator);
}

function sum(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  if (present.length === 0) return null;
  return round6(present.reduce((total, value) => total + value, 0));
}

function roicAt(index: HistoryMetricIndex, periodEnd: string): number | null {
  const metricPoints = buildHistoryMetricPoints(index);
  const entry = metricPoints.points("roic").find((point) => point.periodEnd === periodEnd);
  return entry?.reported ?? null;
}

function leverageAt(index: HistoryMetricIndex, periodEnd: string): number | null {
  const debt = index.measure(RAW_METRIC_ALIASES.totalDebt, periodEnd);
  const equity = index.measure(RAW_METRIC_ALIASES.totalEquity, periodEnd);
  if (debt === null || equity === null || equity === 0) return null;
  return round6(debt / equity);
}

interface EntrySeed {
  readonly kind: CapitalAllocationEntryKind;
  readonly label: string;
  readonly amount: number | null;
  readonly direction: CapitalAllocationEntry["direction"];
  readonly derived: boolean;
  readonly derivation: string;
  readonly aliases: readonly string[];
}

function buildEntry(input: {
  readonly seed: EntrySeed;
  readonly index: HistoryMetricIndex;
  readonly periodEnd: string;
  readonly period: string;
  readonly subjectId: string;
  readonly currency: string | null;
  readonly evidenceIds: readonly string[];
}): CapitalAllocationEntry | null {
  if (input.seed.amount === null) return null;
  const point = input.index.resolve(input.seed.aliases, input.periodEnd);
  const amount = round6(input.seed.amount);
  return {
    id: createStableId("CALENTRY", { subjectId: input.subjectId, kind: input.seed.kind, period: input.periodEnd, amount }, LEDGER_DOMAIN),
    kind: input.seed.kind,
    label: input.seed.label,
    period: input.period,
    periodEnd: input.periodEnd,
    amount,
    currency: input.currency,
    direction: input.seed.direction,
    bucket: CAPITAL_ALLOCATION_BUCKETS[input.seed.kind],
    derived: input.seed.derived,
    derivation: input.seed.derivation,
    evidenceIds: [...input.evidenceIds].sort(compareStableStrings),
    factIds: point?.factIds ?? [],
  };
}

interface PeriodTotals extends CapitalAllocationTotals {
  readonly payoutRatio: number | null;
}

function buildTotals(entries: readonly CapitalAllocationEntry[], payoutRatio: number | null): PeriodTotals {
  const byKind = (kind: CapitalAllocationEntryKind): number | null => {
    const matching = entries.filter((entry) => entry.kind === kind);
    if (matching.length === 0) return null;
    return round6(matching.reduce((total, entry) => total + entry.amount, 0));
  };
  const freeCashFlow = byKind("freeCashFlow");
  const totalCapex = byKind("totalCapex");
  const maintenanceCapex = byKind("maintenanceCapex");
  const growthCapex = byKind("growthCapex");
  const acquisitions = byKind("acquisitions");
  const assetDisposals = byKind("assetDisposals");
  const debtIssued = byKind("debtIssued");
  const debtRepaid = byKind("debtRepaid");
  const dividends = byKind("dividends");
  const buybacks = byKind("buybacks");
  const cashRetention = byKind("cashRetention");
  const netDebtFlow = debtIssued === null && debtRepaid === null ? null : round6((debtIssued ?? 0) - (debtRepaid ?? 0));
  const returned = sum([dividends, buybacks]);
  const reinvested = sum([maintenanceCapex ?? growthCapex ?? totalCapex, acquisitions]);
  const denominator = freeCashFlow !== null && freeCashFlow > 0 ? freeCashFlow : null;
  return {
    freeCashFlow,
    totalCapex,
    maintenanceCapex,
    growthCapex,
    acquisitions,
    assetDisposals,
    debtIssued,
    debtRepaid,
    netDebtFlow,
    dividends,
    buybacks,
    totalReturned: returned,
    cashRetention,
    reinvestmentRate: ratio(reinvested, denominator),
    distributionRate: ratio(returned, denominator),
    netInvestmentRate: ratio(reinvested, returned),
    payoutRatio,
  };
}

function roicDiagnostic(input: {
  readonly periods: readonly CapitalAllocationPeriod[];
  readonly index: HistoryMetricIndex;
  readonly wacc: number | null;
}): RoicReinvestmentDiagnostic {
  const latest = input.periods.length > 0 ? (input.periods[input.periods.length - 1] as CapitalAllocationPeriod) : null;
  const roic = latest ? roicAt(input.index, latest.periodEnd) : null;
  const reinvestmentRates = input.periods
    .map((entry) => entry.totals.reinvestmentRate)
    .filter((value): value is number => value !== null);
  const averageReinvestment = reinvestmentRates.length > 0
    ? round6(reinvestmentRates.reduce((total, value) => total + value, 0) / reinvestmentRates.length)
    : null;
  const wacc = input.wacc;
  if (roic === null || averageReinvestment === null) {
    return {
      status: roic === null ? "unavailable" : "insufficient",
      roic,
      weightedCostOfCapital: wacc,
      reinvestmentRate: averageReinvestment,
      spread: null,
      valueCreating: null,
      note: roic === null
        ? "return on invested capital is not measurable on the reported statements, so reinvestment quality is not judged"
        : "reinvestment out of free cash flow is not measurable, so the return spread is withheld rather than estimated",
    };
  }
  const reference = wacc ?? DEFAULT_REFERENCE_COST_OF_CAPITAL;
  const spread = round6(roic - reference);
  return {
    status: "ready",
    roic,
    weightedCostOfCapital: wacc,
    reinvestmentRate: averageReinvestment,
    spread,
    valueCreating: spread > 0,
    note: `ROIC of ${round6(roic * 100).toFixed(1)}% against a ${wacc === null ? `${round6(reference * 100).toFixed(1)}% default` : `${round6(reference * 100).toFixed(1)}%`} reference gives a ${spread > 0 ? "positive" : "negative"} ${round6(Math.abs(spread) * 100).toFixed(1)}pp spread at an average reinvestment rate of ${round6(averageReinvestment * 100).toFixed(1)}% of free cash flow`,
  };
}

function acquisitionDiagnostic(input: {
  readonly periods: readonly CapitalAllocationPeriod[];
  readonly acquiredEarnings: Readonly<Record<string, number>> | null;
}): AcquisitionValueDiagnostic {
  const spend = sum(input.periods.map((entry) => entry.totals.acquisitions));
  const periodsWithAcquisitions = input.periods.filter((entry) => (entry.totals.acquisitions ?? 0) > 0).length;
  const earnings = input.acquiredEarnings ? sum(Object.values(input.acquiredEarnings)) : null;
  if (spend === null || spend === 0) {
    return {
      status: periodsWithAcquisitions === 0 ? "unavailable" : "insufficient",
      totalConsideration: spend,
      periodsWithAcquisitions,
      acquiredEarnings: null,
      impliedPriceEarnings: null,
      valueCreating: null,
      note: periodsWithAcquisitions === 0
        ? "no acquisition spend is on record, so acquisition value creation is not applicable"
        : "acquisition spend is on record with no acquired-earnings evidence, so the implied price paid is withheld",
    };
  }
  if (earnings === null || earnings === 0) {
    return {
      status: "insufficient",
      totalConsideration: spend,
      periodsWithAcquisitions,
      acquiredEarnings: null,
      impliedPriceEarnings: null,
      valueCreating: null,
      note: `acquisition spend of ${spend} is on record with no acquired-earnings evidence; the implied price paid is withheld rather than estimated`,
    };
  }
  const implied = round6(spend / Math.abs(earnings));
  return {
    status: "ready",
    totalConsideration: spend,
    periodsWithAcquisitions,
    acquiredEarnings: round6(earnings),
    impliedPriceEarnings: implied,
    valueCreating: implied < ACQUISITION_DISCIPLINE_MULTIPLE,
    note: `implied price paid of ${implied}x acquired earnings across ${periodsWithAcquisitions} acquisition period(s); ${implied < ACQUISITION_DISCIPLINE_MULTIPLE ? "below" : "at or above"} a ${ACQUISITION_DISCIPLINE_MULTIPLE}x discipline threshold`,
  };
}

function buybackDiagnostic(input: {
  readonly periods: readonly CapitalAllocationPeriod[];
  readonly currentFairValuePerShare: number | null;
  readonly referencePrice: number | null;
}): BuybackValuationDiagnostic {
  const spent = sum(input.periods.map((entry) => entry.totals.buybacks));
  const periodsWithBuybacks = input.periods.filter((entry) => (entry.totals.buybacks ?? 0) > 0).length;
  if (spent === null || spent === 0) {
    return {
      status: periodsWithBuybacks === 0 ? "unavailable" : "insufficient",
      totalCashSpent: spent,
      periodsWithBuybacks,
      averageFairValue: null,
      referencePrice: null,
      buybackBelowFairValue: null,
      note: periodsWithBuybacks === 0
        ? "no buyback spend is on record, so buyback valuation discipline is not applicable"
        : "buyback spend is on record but the average repurchase price is not observable, so value creation is not judged",
    };
  }
  const reference = input.currentFairValuePerShare ?? input.referencePrice;
  if (reference === null || reference <= 0) {
    return {
      status: "insufficient",
      totalCashSpent: spent,
      periodsWithBuybacks,
      averageFairValue: null,
      referencePrice: input.referencePrice,
      buybackBelowFairValue: null,
      note: `buyback spend of ${spent} is on record with no per-share repurchase price; value creation is left unjudged rather than assumed favourable`,
    };
  }
  return {
    status: "ready",
    totalCashSpent: spent,
    periodsWithBuybacks,
    averageFairValue: round6(reference),
    referencePrice: input.referencePrice,
    buybackBelowFairValue: reference > 0,
    note: `repurchases are benchmarked against a ${round6(reference)} per-share reference; a repurchase below intrinsic value is accretive only while that reference holds`,
  };
}

function dividendDiagnostic(input: {
  readonly periods: readonly CapitalAllocationPeriod[];
  readonly payoutHistory: readonly { period: string; payoutRatio: number | null }[];
}): DividendConsistencyDiagnostic {
  const observed = input.periods.length;
  const withDividends = input.periods.filter((entry) => (entry.totals.dividends ?? 0) > 0).length;
  const coverage = ratio(withDividends, observed);
  if (observed === 0) {
    return {
      status: "unavailable",
      periodsObserved: 0,
      periodsWithDividends: 0,
      coverage: null,
      payoutHistory: input.payoutHistory,
      consistent: null,
      note: "no period is on record, so dividend consistency cannot be assessed",
    };
  }
  if (withDividends === 0) {
    return {
      status: "ready",
      periodsObserved: observed,
      periodsWithDividends: 0,
      coverage: 0,
      payoutHistory: input.payoutHistory,
      consistent: true,
      note: `no dividend is paid in any of the ${observed} observed period(s); the policy is consistent but retention-only`,
    };
  }
  const defined = input.payoutHistory.map((entry) => entry.payoutRatio).filter((value): value is number => value !== null);
  const consistent = defined.length > 1 ? defined.every((value) => Math.abs(value - (defined[0] as number)) <= DIVIDEND_STABILITY_TOLERANCE) : null;
  return {
    status: "ready",
    periodsObserved: observed,
    periodsWithDividends: withDividends,
    coverage,
    payoutHistory: input.payoutHistory,
    consistent,
    note: `dividends are paid in ${withDividends} of ${observed} period(s)${consistent === null ? " with too few measurable payout ratios to judge stability" : consistent ? " and the payout ratio is stable within 10pp" : " and the payout ratio has moved by more than 10pp"}`,
  };
}

function leverageDiagnostic(input: {
  readonly periods: readonly CapitalAllocationPeriod[];
  readonly index: HistoryMetricIndex;
}): LeveragePolicyDiagnostic {
  const leverageHistory = input.periods.map((entry) => {
    const debt = input.index.measure(RAW_METRIC_ALIASES.totalDebt, entry.periodEnd);
    const cash = input.index.measure(RAW_METRIC_ALIASES.cash, entry.periodEnd);
    return {
      period: entry.period,
      debtToEquity: leverageAt(input.index, entry.periodEnd),
      netDebt: debt === null || cash === null ? null : round6(debt - cash),
    };
  });
  const values = leverageHistory.map((entry) => entry.debtToEquity).filter((value): value is number => value !== null);
  if (values.length === 0) {
    return {
      status: "unavailable",
      leverageHistory,
      firstLeverage: null,
      lastLeverage: null,
      direction: "unknown",
      note: "debt-to-equity is not measurable on the reported statements, so leverage policy cannot be characterized",
    };
  }
  const first = values[0] as number;
  const last = values[values.length - 1] as number;
  const direction = last > first * 1.1 ? "increasing" : last < first * 0.9 ? "decreasing" : "stable";
  return {
    status: values.length >= LEVERAGE_HISTORY_MINIMUM ? "ready" : "insufficient",
    leverageHistory,
    firstLeverage: first,
    lastLeverage: last,
    direction,
    note: `debt-to-equity moved from ${round6(first)} to ${round6(last)} across ${values.length} measurable period(s), which reads as ${direction} leverage`,
  };
}

export function buildCapitalAllocationLedger(input: BuildCapitalAllocationLedgerInput): CapitalAllocationLedger {
  const index = buildHistoryMetricIndex(input.factPack);
  const subjectId = (input.subjectId ?? input.factPack?.ticker ?? "UNKNOWN").trim().toUpperCase() || "UNKNOWN";
  const generatedAt = input.generatedAt ?? input.factPack?.retrievalTimestamp ?? "unknown";
  const periods: CapitalAllocationPeriod[] = [];
  const flags: CapitalAllocationFlag[] = [];
  const log: string[] = [];
  for (const periodEnd of index.periods) {
    const period = historyPeriodLabel(periodEnd);
    const operating = index.measure(RAW_METRIC_ALIASES.operatingCashFlow, periodEnd);
    const capex = index.measure(RAW_METRIC_ALIASES.capex, periodEnd);
    const reportedFcf = index.measure(RAW_METRIC_ALIASES.freeCashFlow, periodEnd);
    const freeCashFlow = reportedFcf !== null
      ? reportedFcf
      : operating !== null && capex !== null
        ? round6(operating - Math.abs(capex))
        : operating;
    const acquisitions = index.measure(RAW_METRIC_ALIASES.acquisitionSpend, periodEnd);
    const disposals = index.measure(RAW_METRIC_ALIASES.assetSaleProceeds, periodEnd);
    const debtIssued = index.measure(RAW_METRIC_ALIASES.debtIssued, periodEnd);
    const debtRepaid = index.measure(RAW_METRIC_ALIASES.debtRepaid, periodEnd);
    const dividends = index.measure(RAW_METRIC_ALIASES.dividendsPaid, periodEnd);
    const buybacks = index.measure(RAW_METRIC_ALIASES.buybacks, periodEnd);
    const maintenanceShare = input.maintenanceCapex?.[periodEnd] ?? null;
    const maintenance = capex !== null && maintenanceShare !== null ? round6(Math.abs(capex) * maintenanceShare) : null;
    const growth = capex !== null && maintenanceShare !== null ? round6(Math.abs(capex) - Math.abs(maintenance as number)) : null;
    const capexEvidenceIds = input.maintenanceCapexEvidenceIds?.[periodEnd] ?? input.evidenceIds ?? [];
    const netIncome = index.measure(RAW_METRIC_ALIASES.netIncome, periodEnd);
    const seeds: EntrySeed[] = [
      { kind: "freeCashFlow", label: "Free cash flow", amount: freeCashFlow, direction: "inflow", derived: reportedFcf === null, derivation: reportedFcf === null ? "operating cash flow less absolute capital expenditure" : "reported free cash flow fact", aliases: RAW_METRIC_ALIASES.freeCashFlow },
      { kind: "totalCapex", label: "Total capital expenditure", amount: capex === null ? null : Math.abs(capex), direction: "outflow", derived: false, derivation: "absolute reported capital expenditure", aliases: RAW_METRIC_ALIASES.capex },
      { kind: "maintenanceCapex", label: "Maintenance capital expenditure", amount: maintenance, direction: "outflow", derived: true, derivation: "total capital expenditure multiplied by the evidence-backed maintenance share", aliases: RAW_METRIC_ALIASES.capex },
      { kind: "growthCapex", label: "Growth capital expenditure", amount: growth, direction: "outflow", derived: true, derivation: "total capital expenditure less the evidence-backed maintenance portion", aliases: RAW_METRIC_ALIASES.capex },
      { kind: "acquisitions", label: "Acquisitions", amount: acquisitions === null ? null : Math.abs(acquisitions), direction: "outflow", derived: false, derivation: "absolute reported acquisition spend", aliases: RAW_METRIC_ALIASES.acquisitionSpend },
      { kind: "assetDisposals", label: "Asset disposal proceeds", amount: disposals === null ? null : Math.abs(disposals), direction: "inflow", derived: false, derivation: "absolute reported disposal proceeds", aliases: RAW_METRIC_ALIASES.assetSaleProceeds },
      { kind: "debtIssued", label: "Debt issued", amount: debtIssued === null ? null : Math.abs(debtIssued), direction: "inflow", derived: false, derivation: "absolute reported debt issuance", aliases: RAW_METRIC_ALIASES.debtIssued },
      { kind: "debtRepaid", label: "Debt repaid", amount: debtRepaid === null ? null : Math.abs(debtRepaid), direction: "outflow", derived: false, derivation: "absolute reported debt repayment", aliases: RAW_METRIC_ALIASES.debtRepaid },
      { kind: "dividends", label: "Dividends paid", amount: dividends === null ? null : Math.abs(dividends), direction: "outflow", derived: false, derivation: "absolute reported dividends paid", aliases: RAW_METRIC_ALIASES.dividendsPaid },
      { kind: "buybacks", label: "Share repurchases", amount: buybacks === null ? null : Math.abs(buybacks), direction: "outflow", derived: false, derivation: "absolute reported share repurchases", aliases: RAW_METRIC_ALIASES.buybacks },
    ];
    const entries = seeds
      .map((seed) => buildEntry({
        seed,
        index,
        periodEnd,
        period,
        subjectId,
        currency: index.currency,
        evidenceIds: seed.kind === "maintenanceCapex" || seed.kind === "growthCapex" ? capexEvidenceIds : (input.evidenceIds ?? []),
      }))
      .filter((entry): entry is CapitalAllocationEntry => entry !== null);
    const deployed = entries
      .filter((entry) => entry.bucket === "reinvestment" || entry.bucket === "distribution" || entry.bucket === "financing")
      .reduce((total, entry) => total + entry.amount, 0);
    const retention = entries.length > 0 && freeCashFlow !== null ? round6(Math.max(0, freeCashFlow - deployed)) : null;
    const retentionEntry = buildEntry({
      seed: {
        kind: "cashRetention",
        label: "Cash retained",
        amount: retention,
        direction: "inflow",
        derived: true,
        derivation: "free cash flow less reinvestment, financing and distributions deployed in the period",
        aliases: [],
      },
      index,
      periodEnd,
      period,
      subjectId,
      currency: index.currency,
      evidenceIds: input.evidenceIds ?? [],
    });
    if (retentionEntry) entries.push(retentionEntry);
    const payoutRatio = ratio(dividends === null ? null : Math.abs(dividends), netIncome);
    const totals = buildTotals(entries, payoutRatio);
    const notes: string[] = [];
    if (capex !== null && maintenanceShare === null) notes.push("capital expenditure is reported in total only; the maintenance and growth split is withheld");
    if (freeCashFlow === null) notes.push("free cash flow is not measurable in this period");
    if (acquisitions === null) notes.push("no acquisition line is on record in this period");
    if (dividends === null) notes.push("no dividend line is on record in this period");
    if (buybacks === null) notes.push("no share repurchase line is on record in this period");
    const status: CapitalAllocationStatus = totals.freeCashFlow === null ? "unavailable" : entries.length >= 3 ? "ready" : "insufficient";
    periods.push({
      period,
      periodEnd,
      fiscalYear: historyFiscalYear(periodEnd),
      entries: Object.freeze(entries),
      totals: Object.freeze(totals),
      status,
      notes: Object.freeze(notes),
    });
    if (capex !== null && maintenanceShare === null) {
      flags.push({
        id: createStableId("CALFLAG", { subjectId, periodEnd, key: "capexSplit" }, LEDGER_DOMAIN),
        key: "capexSplit",
        severity: "warning",
        period,
        message: "capital expenditure is reported in total only; the maintenance and growth split is withheld rather than assumed",
        evidenceIds: [...(input.evidenceIds ?? [])],
      });
    }
  }
  const payoutHistory = periods.map((entry) => ({ period: entry.period, payoutRatio: (entry.totals as PeriodTotals).payoutRatio }));
  const readyPeriods = periods.filter((entry) => entry.status === "ready");
  const diagnostics = {
    roicVsReinvestment: roicDiagnostic({ periods: readyPeriods, index, wacc: input.weightedCostOfCapital ?? null }),
    acquisitionValue: acquisitionDiagnostic({ periods: readyPeriods, acquiredEarnings: input.acquiredEarnings ?? null }),
    buybackValuation: buybackDiagnostic({
      periods: readyPeriods,
      currentFairValuePerShare: input.currentFairValuePerShare ?? null,
      referencePrice: input.referencePrice ?? null,
    }),
    dividendConsistency: dividendDiagnostic({ periods: readyPeriods, payoutHistory }),
    leveragePolicy: leverageDiagnostic({ periods, index }),
  } satisfies CapitalAllocationLedger["diagnostics"];
  const status: CapitalAllocationStatus = periods.length === 0
    ? "unavailable"
    : readyPeriods.length === 0
      ? "insufficient"
      : "ready";
  const reason = status === "unavailable"
    ? "no statement period is on record, so the capital-allocation ledger is unavailable"
    : status === "insufficient"
      ? `${periods.length} period(s) are on record but none carries a measurable cash-generation line`
      : `${readyPeriods.length} of ${periods.length} period(s) carry a measurable capital-allocation ledger`;
  if (status !== "ready") log.push(`CAPITAL_ALLOCATION_${status.toUpperCase()}`);
  if (diagnostics.acquisitionValue.status !== "ready") log.push("ACQUISITION_VALUE_UNJUDGED");
  if (diagnostics.buybackValuation.status !== "ready") log.push("BUYBACK_VALUATION_UNJUDGED");
  if (diagnostics.dividendConsistency.status !== "ready") log.push("DIVIDEND_CONSISTENCY_UNJUDGED");
  if (diagnostics.leveragePolicy.status !== "ready") log.push("LEVERAGE_POLICY_UNJUDGED");
  if (diagnostics.roicVsReinvestment.status !== "ready") log.push("ROIC_REINVESTMENT_UNJUDGED");
  const content = {
    version: CAPITAL_ALLOCATION_LEDGER_VERSION,
    subjectId,
    status,
    reason,
    generatedAt,
    currency: index.currency,
    periods: Object.freeze(periods),
    diagnostics,
    flags: Object.freeze(flags.sort((left, right) => left.id.localeCompare(right.id))),
    evidenceIds: [...new Set([...(input.evidenceIds ?? []), ...periods.flatMap((entry) => entry.entries.flatMap((item) => item.evidenceIds))])].sort(compareStableStrings),
    diagnosticsLog: Object.freeze([...new Set(log)].sort(compareStableStrings)),
  } satisfies Omit<CapitalAllocationLedger, "contentHash">;
  return deepFreeze({ ...content, contentHash: stableHash(content, LEDGER_DOMAIN) }) as CapitalAllocationLedger;
}

export const buildCapitalAllocation = buildCapitalAllocationLedger;
export const capitalAllocationLedger = buildCapitalAllocationLedger;
