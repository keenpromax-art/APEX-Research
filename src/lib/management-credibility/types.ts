export const MANAGEMENT_CREDIBILITY_VERSION = "management-credibility-v1" as const;

export type ManagementCredibilityStatus = "VERIFIED" | "UNVERIFIED";
export type ManagementPromiseStatus = "pending" | "met" | "missed" | "withdrawn" | "unverified" | "superseded";
export type ManagementOutcomeStatus = "measured" | "unmeasured";
export type ManagementPromiseSourceType = "earnings_call" | "investor_presentation" | "exchange_filing" | "annual_report" | "press_release" | "other";
export type ManagementPromiseDirection = "higher-better" | "lower-better" | "two-sided";
export type ManagementBias = "over-optimistic" | "over-cautious" | "balanced" | "unknown";
export type CredibilityBand = "strong" | "credible" | "mixed" | "weak" | "unverified";

export const MAXIMUM_CREDIBILITY_SCORE = 0.95;

export interface ManagementPromise {
  readonly id: string;
  readonly metric: string;
  readonly metricKind: "revenue" | "ebit" | "margin" | "eps" | "capex" | "dividend" | "roic" | "custom";
  readonly unit: string;
  readonly period: string;
  readonly target: number;
  readonly low?: number;
  readonly high?: number;
  readonly direction: ManagementPromiseDirection;
  readonly issuedAt: string;
  readonly source: string;
  readonly sourceType: ManagementPromiseSourceType;
  readonly text: string;
  readonly status: ManagementPromiseStatus;
  readonly supersedesId?: string | null;
  readonly evidenceIds: readonly string[];
}

export interface ManagementPromiseInput {
  readonly id?: string;
  readonly metric: string;
  readonly metricKind?: ManagementPromise["metricKind"];
  readonly unit?: string;
  readonly period: string;
  readonly target: number;
  readonly low?: number;
  readonly high?: number;
  readonly direction?: ManagementPromiseDirection;
  readonly issuedAt: string;
  readonly source: string;
  readonly sourceType?: ManagementPromiseSourceType;
  readonly text?: string;
  readonly status?: ManagementPromiseStatus;
  readonly supersedesId?: string | null;
  readonly evidenceIds?: readonly string[];
}

export interface ManagementActual {
  readonly promiseId: string;
  readonly period: string;
  readonly actual: number;
  readonly source: string;
  readonly factIds?: readonly string[];
  readonly evidenceIds?: readonly string[];
}

export interface ManagementCredibilityEntry {
  readonly promise: ManagementPromise;
  readonly outcome: {
    readonly status: ManagementOutcomeStatus;
    readonly actual: number | null;
    readonly variance: number | null;
    readonly variancePct: number | null;
    readonly withinRange: boolean | null;
    readonly source: string | null;
    readonly factIds: readonly string[];
    readonly evidenceIds: readonly string[];
  };
  readonly hit: boolean | null;
  readonly score: number | null;
  readonly band: CredibilityBand;
  readonly confidence: number;
  readonly note: string;
}

export interface ManagementCredibilityLedger {
  readonly version: typeof MANAGEMENT_CREDIBILITY_VERSION;
  readonly subjectId: string;
  readonly status: ManagementCredibilityStatus;
  readonly reason: string;
  readonly generatedAt: string;
  readonly observations: readonly ManagementCredibilityEntry[];
  readonly score: number | null;
  readonly confidence: number;
  readonly band: CredibilityBand;
  readonly bias: ManagementBias;
  readonly hitRate: number | null;
  readonly counts: {
    readonly promises: number;
    readonly resolved: number;
    readonly met: number;
    readonly missed: number;
    readonly withdrawn: number;
    readonly unverified: number;
  };
  readonly streak: {
    readonly current: number | null;
    readonly direction: "improving" | "declining" | "stable" | "unknown";
  };
  readonly diagnostics: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly contentHash: string;
}

export interface BuildManagementCredibilityLedgerInput {
  readonly subjectId: string;
  readonly promises?: readonly ManagementPromiseInput[] | null;
  readonly actuals?: readonly ManagementActual[] | null;
  readonly generatedAt?: string;
  readonly minimumSampleForScore?: number;
  readonly evidenceIds?: readonly string[];
}
