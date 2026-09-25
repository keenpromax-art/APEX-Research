import type { HistoryMetricKey, HistorySeriesBasis } from "./facts";

export const NORMALIZED_HISTORY_VERSION = "normalized-history-v1" as const;

export const HISTORY_WINDOW_KEYS = Object.freeze(["5Y", "10Y"] as const);
export type HistoryWindowKey = (typeof HISTORY_WINDOW_KEYS)[number];

export const HISTORY_WINDOW_YEARS: Readonly<Record<HistoryWindowKey, number>> = Object.freeze({ "5Y": 5, "10Y": 10 });

export type HistoryStatus = "ready" | "insufficient" | "unavailable";
export type HistoryTrendDirection = "improving" | "deteriorating" | "stable" | "unknown";
export type HistoryReversibility = "reversible" | "irreversible" | "unknown";

export interface HistorySeriesPoint {
  readonly period: string;
  readonly periodEnd: string;
  readonly fiscalYear: number | null;
  readonly value: number | null;
  readonly unit: string;
  readonly restated: boolean;
  readonly derived: boolean;
  readonly factIds: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly source: string;
  readonly note: string | null;
}

export interface HistoryTrend {
  readonly metric: HistoryMetricKey;
  readonly label: string;
  readonly window: HistoryWindowKey;
  readonly basis: HistorySeriesBasis;
  readonly unit: string;
  readonly direction: "higher-better" | "lower-better" | "neutral";
  readonly points: readonly HistorySeriesPoint[];
  readonly first: number | null;
  readonly last: number | null;
  readonly change: number | null;
  readonly changePct: number | null;
  readonly cagr: number | null;
  readonly average: number | null;
  readonly volatility: number | null;
  readonly trendDirection: HistoryTrendDirection;
  readonly coverage: {
    readonly periods: number;
    readonly required: number;
    readonly expected: number;
    readonly complete: boolean;
  };
  readonly status: HistoryStatus;
  readonly notes: readonly string[];
}

export interface HistoryRestatementChain {
  readonly id: string;
  readonly metric: string;
  readonly period: string;
  readonly periodEnd: string;
  readonly priorFactId: string;
  readonly restatedFactId: string;
  readonly priorValue: number;
  readonly restatedValue: number;
  readonly delta: number;
  readonly deltaPct: number | null;
  readonly direction: "upward" | "downward" | "unchanged";
  readonly reason: string;
  readonly origin: "fact-restatement-flag" | "evidence-registry-restatement" | "source-conflict";
  readonly reversibility: HistoryReversibility;
  readonly reversibilityBasis: string;
  readonly impactedMetrics: readonly HistoryMetricKey[];
  readonly evidenceIds: readonly string[];
}

export type CorporateActionKind = "split" | "dividend" | "symbolChange" | "spinOff" | "rightsIssue" | "merger" | "delisting" | "buyback" | "unknown";

export interface HistoryCorporateAction {
  readonly id: string;
  readonly kind: CorporateActionKind;
  readonly effectiveDate: string;
  readonly description: string;
  readonly factor: number | null;
  readonly amount: number | null;
  readonly adjustedMetrics: readonly HistoryMetricKey[];
  readonly adjustmentApplied: boolean;
  readonly note: string;
  readonly factIds: readonly string[];
  readonly evidenceIds: readonly string[];
}

export interface HistoryTrendBreak {
  readonly id: string;
  readonly metric: HistoryMetricKey;
  readonly label: string;
  readonly window: HistoryWindowKey;
  readonly basis: HistorySeriesBasis;
  readonly breakPeriod: string;
  readonly breakPeriodEnd: string;
  readonly method: "mean-shift";
  readonly priorMean: number;
  readonly postMean: number;
  readonly delta: number;
  readonly deltaPct: number | null;
  readonly separation: number;
  readonly severity: "major" | "moderate" | "minor";
  readonly cause: string | null;
  readonly causeEvidenceIds: readonly string[];
  readonly causeConfidence: number;
  readonly reversible: boolean | null;
  readonly reversibility: HistoryReversibility;
  readonly reversibilityBasis: string;
  readonly valuationResponse: HistoryValuationResponse | null;
  readonly evidenceIds: readonly string[];
  readonly status: "evidenced" | "unattributed";
}

export interface HistoryValuationResponse {
  readonly horizonMonths: number;
  readonly observed: boolean;
  readonly fromDate: string;
  readonly toDate: string;
  readonly priceReturnPct: number | null;
  readonly note: string;
}

export interface HistoryCoverage {
  readonly metricsTracked: number;
  readonly metricsReady: number;
  readonly periodsAvailable: number;
  readonly earliestPeriodEnd: string | null;
  readonly latestPeriodEnd: string | null;
  readonly completeness: number;
  readonly missingMetrics: readonly HistoryMetricKey[];
}

export interface NormalizedHistoryResult {
  readonly version: typeof NORMALIZED_HISTORY_VERSION;
  readonly subjectId: string;
  readonly status: HistoryStatus;
  readonly generatedAt: string;
  readonly currency: string | null;
  readonly windows: Readonly<Record<HistoryWindowKey, readonly HistoryTrend[]>>;
  readonly restatementChains: readonly HistoryRestatementChain[];
  readonly corporateActions: readonly HistoryCorporateAction[];
  readonly trendBreaks: readonly HistoryTrendBreak[];
  readonly coverage: HistoryCoverage;
  readonly materialClaims: {
    readonly id: string;
    readonly claim: string;
    readonly dependsOn: readonly HistoryMetricKey[];
    readonly supportedBy: readonly string[];
  }[];
  readonly diagnostics: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly contentHash: string;
}

export interface BuildNormalizedHistoryInput {
  readonly factPack: import("@/lib/ai-first/types").FactPack | null;
  readonly subjectId?: string;
  readonly generatedAt?: string;
  readonly windows?: readonly HistoryWindowKey[];
  readonly minimumPeriods?: Partial<Record<HistoryWindowKey, number>>;
  readonly evidenceRegistry?: import("@/lib/research-retrieval/types").CanonicalEvidenceRegistry | null;
  readonly benchmarkPriceHistory?: Readonly<Record<string, number>> | null;
  readonly earningsNormalization?: Readonly<Record<string, Readonly<Record<string, number>>>> | null;
}
