import { compareStableStrings, createStableId, stableHash } from "@/lib/research-ledger/stable";
import { deepFreeze } from "@/lib/research-ledger/immutable";
import {
  RAW_METRIC_ALIASES,
  buildHistoryMetricIndex,
  historyFiscalYear,
  historyPeriodLabel,
  type HistoryMetricIndex,
} from "@/lib/history/facts";
import {
  EARNINGS_QUALITY_VERSION,
  ONE_OFF_LABELS,
  type AssessEarningsQualityInput,
  type EarningsQualityAssessment,
  type EarningsQualityFlag,
  type EarningsQualityOneOff,
  type EarningsQualityOneOffEvidence,
  type EarningsQualityPeriod,
  type EarningsQualityStatus,
  type EarningsQualityWorkingCapital,
  type OneOffKind,
  type OneOffSign,
} from "./types";

const ASSESSMENT_DOMAIN = "earnings-quality/assessment/v1";
const DEFAULT_HIGH_ACCRUAL_THRESHOLD = 0.1;
const DEFAULT_LOW_CASH_CONVERSION_THRESHOLD = 0.8;
const ACCRUAL_SHARE_THRESHOLD = 0.5;

function round6(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : 0;
}

function ratio(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null) return null;
  if (denominator === 0) return null;
  return round6(numerator / denominator);
}

function days(value: number | null, revenue: number | null): number | null {
  if (value === null || revenue === null || revenue === 0) return null;
  return round6((value / revenue) * 365);
}

function median(values: readonly number[]): number | null {
  const clean = values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (clean.length === 0) return null;
  const middle = clean.length >> 1;
  return round6(clean.length % 2 === 1 ? (clean[middle] as number) : ((clean[middle - 1] as number) + (clean[middle] as number)) / 2);
}

interface OneOffSpec {
  readonly kind: OneOffKind;
  readonly aliases: readonly string[];
  readonly defaultSign: OneOffSign;
  readonly signFromValue: (value: number) => OneOffSign;
}

const ONE_OFF_SPECS: readonly OneOffSpec[] = [
  { kind: "stockBasedCompensation", aliases: RAW_METRIC_ALIASES.stockBasedCompensation, defaultSign: "add-back", signFromValue: () => "add-back" },
  { kind: "impairment", aliases: RAW_METRIC_ALIASES.impairment, defaultSign: "add-back", signFromValue: () => "add-back" },
  { kind: "restructuring", aliases: RAW_METRIC_ALIASES.restructuring, defaultSign: "add-back", signFromValue: () => "add-back" },
  { kind: "acquisitionCost", aliases: RAW_METRIC_ALIASES.acquisitionSpend, defaultSign: "unknown", signFromValue: () => "unknown" },
  { kind: "assetSale", aliases: RAW_METRIC_ALIASES.assetSaleGain, defaultSign: "deduction", signFromValue: (value: number) => (value > 0 ? "deduction" : "add-back") },
  { kind: "tax", aliases: RAW_METRIC_ALIASES.incomeTaxExpense, defaultSign: "unknown", signFromValue: () => "unknown" },
  { kind: "workingCapital", aliases: RAW_METRIC_ALIASES.changesInWorkingCapital, defaultSign: "unknown", signFromValue: () => "unknown" },
  { kind: "otherOperating", aliases: RAW_METRIC_ALIASES.assetWriteOff, defaultSign: "add-back", signFromValue: () => "add-back" },
] as const;

function otherOperatingAssets(index: HistoryMetricIndex, periodEnd: string): number | null {
  const currentAssets = index.measure(RAW_METRIC_ALIASES.currentAssets, periodEnd);
  const cash = index.measure(RAW_METRIC_ALIASES.cash, periodEnd);
  const receivables = index.measure(RAW_METRIC_ALIASES.receivables, periodEnd);
  const inventory = index.measure(RAW_METRIC_ALIASES.inventory, periodEnd);
  if (currentAssets === null) return null;
  const parts = [cash, receivables, inventory].filter((value): value is number => value !== null);
  const known = parts.reduce((sum, value) => sum + value, 0);
  const residual = currentAssets - known;
  if (parts.length < 3) return null;
  return round6(residual);
}

function buildWorkingCapital(index: HistoryMetricIndex, periodEnd: string, priorPeriod: string | undefined, revenue: number | null): EarningsQualityWorkingCapital {
  const receivables = index.measure(RAW_METRIC_ALIASES.receivables, periodEnd);
  const inventory = index.measure(RAW_METRIC_ALIASES.inventory, periodEnd);
  const payables = index.measure(RAW_METRIC_ALIASES.payables, periodEnd);
  const changeInReceivables = priorPeriod ? index.measure(RAW_METRIC_ALIASES.changesInReceivables, priorPeriod) ?? difference(index, RAW_METRIC_ALIASES.receivables, priorPeriod, periodEnd) : null;
  const changeInInventory = priorPeriod ? index.measure(RAW_METRIC_ALIASES.changesInInventory, priorPeriod) ?? difference(index, RAW_METRIC_ALIASES.inventory, priorPeriod, periodEnd) : null;
  const changeInPayables = priorPeriod ? index.measure(RAW_METRIC_ALIASES.changesInPayables, priorPeriod) ?? difference(index, RAW_METRIC_ALIASES.payables, priorPeriod, periodEnd) : null;
  const netWorkingCapital = receivables === null || inventory === null || payables === null ? null : receivables + inventory - payables;
  return {
    receivables,
    inventory,
    payables,
    otherOperatingAssets: otherOperatingAssets(index, periodEnd),
    receivablesDays: days(receivables, revenue),
    inventoryDays: days(inventory, revenue),
    payablesDays: days(payables, revenue),
    changeInReceivables,
    changeInInventory,
    changeInPayables,
    netWorkingCapitalDays: days(netWorkingCapital, revenue),
  };
}

function difference(index: HistoryMetricIndex, aliases: readonly string[], from: string, to: string): number | null {
  const before = index.measure(aliases, from);
  const after = index.measure(aliases, to);
  if (before === null || after === null) return null;
  return round6(after - before);
}

function buildOneOffs(input: {
  index: HistoryMetricIndex;
  periodEnd: string;
  subjectId: string;
  evidence: readonly EarningsQualityOneOffEvidence[];
}): { oneOffs: EarningsQualityOneOff[]; unidentified: OneOffKind[] } {
  const out: EarningsQualityOneOff[] = [];
  const unidentified: OneOffKind[] = [];
  const period = historyPeriodLabel(input.periodEnd);
  for (const spec of ONE_OFF_SPECS) {
    const backed = input.evidence
      .filter((entry) => entry.kind === spec.kind && (entry.period === input.periodEnd || entry.period === period))
      .sort((left, right) => left.source.localeCompare(right.source) || left.label?.localeCompare(right.label ?? "") || 0);
    const point = input.index.resolve(spec.aliases, input.periodEnd);
    const factAmount = point?.reported ?? null;
    if (backed.length > 0) {
      for (const entry of backed) {
        const attachedEvidenceIds = [...(entry.evidenceIds ?? [])].sort(compareStableStrings);
        out.push({
          id: createStableId("EQONEOFF", { subjectId: input.subjectId, kind: spec.kind, period: input.periodEnd, amount: entry.amount, source: entry.source }, ASSESSMENT_DOMAIN),
          kind: spec.kind,
          label: entry.label ?? ONE_OFF_LABELS[spec.kind],
          period,
          periodEnd: input.periodEnd,
          amount: round6(entry.amount),
          sign: entry.sign ?? spec.defaultSign,
          basis: attachedEvidenceIds.length > 0 ? "evidence" : "reported-fact",
          source: entry.source,
          derivation: null,
          factIds: [...(entry.factIds ?? []), ...(point?.factIds ?? [])].sort(compareStableStrings),
          evidenceIds: attachedEvidenceIds,
          note: attachedEvidenceIds.length > 0
            ? `evidence-backed ${ONE_OFF_LABELS[spec.kind].toLowerCase()} adjustment cited to ${attachedEvidenceIds.join(", ")}`
            : `adjustment supplied without an evidence identifier; it is carried as a measured fact rather than an evidenced one-off`,
        });
      }
      continue;
    }
    if (factAmount !== null) {
      out.push({
        id: createStableId("EQONEOFF", { subjectId: input.subjectId, kind: spec.kind, period: input.periodEnd, amount: factAmount }, ASSESSMENT_DOMAIN),
        kind: spec.kind,
        label: ONE_OFF_LABELS[spec.kind],
        period,
        periodEnd: input.periodEnd,
        amount: round6(factAmount),
        sign: spec.signFromValue(factAmount),
        basis: "reported-fact",
        source: point?.source ?? "unavailable",
        derivation: null,
        factIds: point?.factIds ?? [],
        evidenceIds: Object.freeze([]) as readonly string[],
        note: `taken directly from the reported ${spec.aliases[0]} fact; no evidence-backed adjustment is layered on top`,
      });
      continue;
    }
    unidentified.push(spec.kind);
    out.push({
      id: createStableId("EQONEOFF", { subjectId: input.subjectId, kind: spec.kind, period: input.periodEnd, amount: null }, ASSESSMENT_DOMAIN),
      kind: spec.kind,
      label: ONE_OFF_LABELS[spec.kind],
      period,
      periodEnd: input.periodEnd,
      amount: null,
      sign: "unknown",
      basis: "absent",
      source: "unavailable",
      derivation: null,
      factIds: Object.freeze([]) as readonly string[],
      evidenceIds: Object.freeze([]) as readonly string[],
      note: `no reported fact and no evidence for ${ONE_OFF_LABELS[spec.kind].toLowerCase()}; the adjustment stays unknown rather than being estimated`,
    });
  }
  return { oneOffs: out, unidentified };
}

function signedAdjustment(oneOff: EarningsQualityOneOff): number | null {
  if (oneOff.amount === null || oneOff.sign === "unknown") return null;
  const magnitude = Math.abs(oneOff.amount);
  return oneOff.sign === "add-back" ? magnitude : -magnitude;
}

export function assessEarningsQuality(input: AssessEarningsQualityInput): EarningsQualityAssessment {
  const index = buildHistoryMetricIndex(input.factPack);
  const subjectId = (input.subjectId ?? input.factPack?.ticker ?? "UNKNOWN").trim().toUpperCase() || "UNKNOWN";
  const generatedAt = input.generatedAt ?? input.factPack?.retrievalTimestamp ?? "unknown";
  const evidence = input.oneOffEvidence ?? [];
  const periods = index.periods;
  const builtPeriods: EarningsQualityPeriod[] = [];
  const flags: EarningsQualityFlag[] = [];
  const diagnostics: string[] = [];
  const highAccrual = input.highAccrualRatioThreshold ?? DEFAULT_HIGH_ACCRUAL_THRESHOLD;
  const lowConversion = input.lowCashConversionThreshold ?? DEFAULT_LOW_CASH_CONVERSION_THRESHOLD;
  for (let position = 0; position < periods.length; position += 1) {
    const periodEnd = periods[position] as string;
    const priorPeriod = position > 0 ? (periods[position - 1] as string) : undefined;
    const revenue = index.measure(RAW_METRIC_ALIASES.revenue, periodEnd);
    const netIncome = index.measure(RAW_METRIC_ALIASES.netIncome, periodEnd);
    const operatingCashFlow = index.measure(RAW_METRIC_ALIASES.operatingCashFlow, periodEnd);
    const capex = index.measure(RAW_METRIC_ALIASES.capex, periodEnd);
    const reportedFcf = index.measure(RAW_METRIC_ALIASES.freeCashFlow, periodEnd);
    const maintenance = input.maintenanceCapex?.[periodEnd] ?? null;
    const freeCashFlow = reportedFcf !== null
      ? reportedFcf
      : operatingCashFlow !== null && capex !== null
        ? round6(operatingCashFlow - Math.abs(capex))
        : operatingCashFlow !== null && maintenance !== null
          ? round6(operatingCashFlow - Math.abs(maintenance))
          : null;
    const totalAccruals = netIncome !== null && operatingCashFlow !== null ? round6(netIncome - operatingCashFlow) : null;
    const accrualRatio = ratio(totalAccruals, netIncome);
    const nonCashAccrualShare = accrualRatio === null ? null : round6(Math.abs(accrualRatio));
    const workingCapital = buildWorkingCapital(index, periodEnd, priorPeriod, revenue);
    const { oneOffs, unidentified } = buildOneOffs({ index, periodEnd, subjectId, evidence });
    const identifiedKinds = oneOffs.filter((entry) => entry.basis !== "absent" && entry.sign !== "unknown").map((entry) => entry.kind);
    const resolvable = oneOffs.map(signedAdjustment);
    const adjustmentTotal = resolvable.some((value) => value === null)
      ? round6(resolvable.reduce<number>((sum, value) => sum + (value ?? 0), 0))
      : round6(resolvable.reduce<number>((sum, value) => sum + (value as number), 0));
    const unresolvedKinds = oneOffs.filter((entry, position) => resolvable[position] === null).map((entry) => entry.kind);
    const measuredUnknownSign = oneOffs.filter((entry) => entry.amount !== null && entry.sign === "unknown").map((entry) => entry.kind);
    const normalizedEarnings = netIncome === null ? null : round6(netIncome + adjustmentTotal);
    const basis = oneOffs.some((entry) => entry.basis === "evidence")
      ? "evidence-backed"
      : oneOffs.some((entry) => entry.basis === "reported-fact" && entry.sign !== "unknown")
        ? "reported-fact-only"
        : "none";
    const status: EarningsQualityStatus = netIncome === null
      ? "unavailable"
      : operatingCashFlow === null
        ? "insufficient"
        : "ready";
    const notes: string[] = [];
    if (status !== "ready") notes.push(status === "unavailable" ? "net income is not on record for this period" : "operating cash flow is not on record, so cash conversion and accruals stay unknown");
    if (unidentified.length > 0) notes.push(`unknown one-off kinds (no fact, no evidence, never imputed): ${unidentified.join(", ")}`);
    if (measuredUnknownSign.length > 0) notes.push(`measured but direction-ambiguous, therefore excluded from normalized earnings: ${measuredUnknownSign.join(", ")}`);
    const factIds = [
      ...(index.resolve(RAW_METRIC_ALIASES.revenue, periodEnd)?.factIds ?? []),
      ...(index.resolve(RAW_METRIC_ALIASES.netIncome, periodEnd)?.factIds ?? []),
      ...(index.resolve(RAW_METRIC_ALIASES.operatingCashFlow, periodEnd)?.factIds ?? []),
      ...(index.resolve(RAW_METRIC_ALIASES.capex, periodEnd)?.factIds ?? []),
    ];
    const evidenceIds = [...new Set(oneOffs.flatMap((entry) => entry.evidenceIds))].sort(compareStableStrings);
    builtPeriods.push({
      period: historyPeriodLabel(periodEnd),
      periodEnd,
      fiscalYear: historyFiscalYear(periodEnd),
      reported: { revenue, netIncome, operatingCashFlow, freeCashFlow },
      accruals: {
        totalAccruals,
        accrualRatio,
        nonCashAccrualShare,
        cashConversion: ratio(operatingCashFlow, netIncome),
        freeCashFlowConversion: ratio(freeCashFlow, netIncome),
        derivation: "accruals = net income - operating cash flow; accrual ratio = accruals / net income; conversion = cash measure / net income",
      },
      workingCapital,
      oneOffs,
      cashEarnings: operatingCashFlow,
      normalizedEarnings,
      normalization: {
        identifiedKinds,
        unknownKinds: unidentified,
        unresolvedKinds,
        totalAdjustment: netIncome === null ? null : adjustmentTotal,
        basis,
      },
      status,
      factIds: [...new Set(factIds)].sort(compareStableStrings),
      evidenceIds,
      notes,
    });
    if (accrualRatio !== null && accrualRatio > highAccrual) {
      flags.push({
        id: createStableId("EQFLAG", { subjectId, periodEnd, kind: "accrual" }, ASSESSMENT_DOMAIN),
        kind: "accrual",
        severity: Math.abs(accrualRatio) >= ACCRUAL_SHARE_THRESHOLD ? "material" : "warning",
        period: historyPeriodLabel(periodEnd),
        message: `accrual ratio ${round6(accrualRatio * 100).toFixed(1)}% of net income exceeds the ${round6(highAccrual * 100).toFixed(1)}% screen; reported earnings are not fully backed by operating cash in this period`,
        evidenceIds,
      });
    }
    const conversion = ratio(operatingCashFlow, netIncome);
    if (conversion !== null && netIncome !== null && netIncome > 0 && conversion < lowConversion) {
      flags.push({
        id: createStableId("EQFLAG", { subjectId, periodEnd, kind: "conversion" }, ASSESSMENT_DOMAIN),
        kind: "conversion",
        severity: conversion < 0.5 ? "material" : "warning",
        period: historyPeriodLabel(periodEnd),
        message: `cash conversion ${round6(conversion * 100).toFixed(1)}% of net income is below the ${round6(lowConversion * 100).toFixed(1)}% screen`,
        evidenceIds,
      });
    }
    if (unidentified.length > 0) {
      flags.push({
        id: createStableId("EQFLAG", { subjectId, periodEnd, kind: "coverage" }, ASSESSMENT_DOMAIN),
        kind: "coverage",
        severity: "warning",
        period: historyPeriodLabel(periodEnd),
        message: `no reported fact and no evidence for ${unidentified.join(", ")}; these adjustments remain unknown and are not imputed`,
        evidenceIds: Object.freeze([]) as readonly string[],
      });
    }
  }
  const readyPeriods = builtPeriods.filter((entry) => entry.status === "ready");
  const unknownKinds = [...new Set(builtPeriods.flatMap((entry) => [...entry.normalization.unknownKinds]))].sort(compareStableStrings);
  const accrualRatios = readyPeriods.map((entry) => entry.accruals.accrualRatio).filter((value): value is number => value !== null);
  const conversions = readyPeriods.map((entry) => entry.accruals.cashConversion).filter((value): value is number => value !== null);
  const weakest = readyPeriods
    .filter((entry) => entry.accruals.cashConversion !== null && entry.reported.netIncome !== null && entry.reported.netIncome > 0)
    .sort((left, right) => (left.accruals.cashConversion as number) - (right.accruals.cashConversion as number))[0];
  const normalizedValues = builtPeriods.map((entry) => entry.normalizedEarnings).filter((value): value is number => value !== null);
  const status: EarningsQualityStatus = builtPeriods.length === 0
    ? "unavailable"
    : readyPeriods.length === 0
      ? "insufficient"
      : "ready";
  const reason = status === "unavailable"
    ? "no statement period is on record, so earnings quality cannot be assessed"
    : status === "insufficient"
      ? `${builtPeriods.length} period(s) lack both net income and operating cash flow, so conversion and accrual quality stay undetermined`
      : `${readyPeriods.length} of ${builtPeriods.length} period(s) carry both net income and operating cash flow; ${unknownKinds.length} one-off kind(s) remain unknown`;
  if (status !== "ready") diagnostics.push(`EARNINGS_QUALITY_${status.toUpperCase()}`);
  if (unknownKinds.length > 0) diagnostics.push(`EARNINGS_QUALITY_UNKNOWN_KINDS:${unknownKinds.join(",")}`);
  const content = {
    version: EARNINGS_QUALITY_VERSION,
    subjectId,
    status,
    reason,
    generatedAt,
    currency: index.currency,
    periods: builtPeriods,
    summary: {
      periodsAssessed: builtPeriods.length,
      periodsWithCashFlow: readyPeriods.length,
      medianAccrualRatio: median(accrualRatios),
      medianCashConversion: median(conversions),
      weakestCashConversionPeriod: weakest?.period ?? null,
      unexplainedAdjustmentCount: builtPeriods.reduce((sum, entry) => sum + entry.oneOffs.filter((oneOff) => oneOff.basis === "absent").length, 0),
      unknownKinds,
      normalizedEarningsRange: {
        min: normalizedValues.length > 0 ? round6(Math.min(...normalizedValues)) : null,
        max: normalizedValues.length > 0 ? round6(Math.max(...normalizedValues)) : null,
      },
    },
    flags: flags.sort((left, right) => left.id.localeCompare(right.id)),
    diagnostics: [...new Set(diagnostics)].sort(compareStableStrings),
    evidenceIds: [...new Set([...builtPeriods.flatMap((entry) => entry.evidenceIds), ...(input.evidenceIds ?? [])])].sort(compareStableStrings),
  } satisfies Omit<EarningsQualityAssessment, "contentHash">;
  return deepFreeze({ ...content, contentHash: stableHash(content, ASSESSMENT_DOMAIN) }) as EarningsQualityAssessment;
}

export const evaluateEarningsQuality = assessEarningsQuality;
export const buildEarningsQualityAssessment = assessEarningsQuality;
