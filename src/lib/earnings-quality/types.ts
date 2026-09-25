export const EARNINGS_QUALITY_VERSION = "earnings-quality-v1" as const;

export type EarningsQualityStatus = "ready" | "insufficient" | "unavailable";
export type EarningsQualityFlagSeverity = "info" | "warning" | "material";
export type OneOffKind =
  | "stockBasedCompensation"
  | "impairment"
  | "restructuring"
  | "acquisitionCost"
  | "assetSale"
  | "tax"
  | "workingCapital"
  | "otherOperating";
export type OneOffBasis = "reported-fact" | "evidence" | "absent";
export type OneOffSign = "add-back" | "deduction" | "unknown";

export const ONE_OFF_KINDS: readonly OneOffKind[] = Object.freeze([
  "stockBasedCompensation",
  "impairment",
  "restructuring",
  "acquisitionCost",
  "assetSale",
  "tax",
  "workingCapital",
  "otherOperating",
] as const);

export const ONE_OFF_LABELS: Readonly<Record<OneOffKind, string>> = Object.freeze({
  stockBasedCompensation: "Stock-based compensation",
  impairment: "Impairment charges",
  restructuring: "Restructuring charges",
  acquisitionCost: "Acquisition-related costs",
  assetSale: "Asset disposal gains and losses",
  tax: "Tax items",
  workingCapital: "Working-capital swings",
  otherOperating: "Other operating one-offs",
});

export interface EarningsQualityOneOff {
  readonly id: string;
  readonly kind: OneOffKind;
  readonly label: string;
  readonly period: string;
  readonly periodEnd: string;
  readonly amount: number | null;
  readonly sign: OneOffSign;
  readonly basis: OneOffBasis;
  readonly source: string;
  readonly derivation: string | null;
  readonly factIds: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly note: string;
}

export interface EarningsQualityAccruals {
  readonly totalAccruals: number | null;
  readonly accrualRatio: number | null;
  readonly nonCashAccrualShare: number | null;
  readonly cashConversion: number | null;
  readonly freeCashFlowConversion: number | null;
  readonly derivation: string;
}

export interface EarningsQualityWorkingCapital {
  readonly receivables: number | null;
  readonly inventory: number | null;
  readonly payables: number | null;
  readonly otherOperatingAssets: number | null;
  readonly receivablesDays: number | null;
  readonly inventoryDays: number | null;
  readonly payablesDays: number | null;
  readonly changeInReceivables: number | null;
  readonly changeInInventory: number | null;
  readonly changeInPayables: number | null;
  readonly netWorkingCapitalDays: number | null;
}

export interface EarningsQualityPeriod {
  readonly period: string;
  readonly periodEnd: string;
  readonly fiscalYear: number | null;
  readonly reported: {
    readonly revenue: number | null;
    readonly netIncome: number | null;
    readonly operatingCashFlow: number | null;
    readonly freeCashFlow: number | null;
  };
  readonly accruals: EarningsQualityAccruals;
  readonly workingCapital: EarningsQualityWorkingCapital;
  readonly oneOffs: readonly EarningsQualityOneOff[];
  readonly cashEarnings: number | null;
  readonly normalizedEarnings: number | null;
  readonly normalization: {
    readonly identifiedKinds: readonly OneOffKind[];
    readonly unknownKinds: readonly OneOffKind[];
    readonly unresolvedKinds: readonly OneOffKind[];
    readonly totalAdjustment: number | null;
    readonly basis: "evidence-backed" | "reported-fact-only" | "none";
  };
  readonly status: EarningsQualityStatus;
  readonly factIds: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly notes: readonly string[];
}

export interface EarningsQualityFlag {
  readonly id: string;
  readonly kind: OneOffKind | "accrual" | "conversion" | "workingCapital" | "coverage";
  readonly severity: EarningsQualityFlagSeverity;
  readonly period: string | null;
  readonly message: string;
  readonly evidenceIds: readonly string[];
}

export interface EarningsQualitySummary {
  readonly periodsAssessed: number;
  readonly periodsWithCashFlow: number;
  readonly medianAccrualRatio: number | null;
  readonly medianCashConversion: number | null;
  readonly weakestCashConversionPeriod: string | null;
  readonly unexplainedAdjustmentCount: number;
  readonly unknownKinds: readonly OneOffKind[];
  readonly normalizedEarningsRange: { min: number | null; max: number | null };
}

export interface EarningsQualityAssessment {
  readonly version: typeof EARNINGS_QUALITY_VERSION;
  readonly subjectId: string;
  readonly status: EarningsQualityStatus;
  readonly reason: string;
  readonly generatedAt: string;
  readonly currency: string | null;
  readonly periods: readonly EarningsQualityPeriod[];
  readonly summary: EarningsQualitySummary;
  readonly flags: readonly EarningsQualityFlag[];
  readonly diagnostics: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly contentHash: string;
}

export interface EarningsQualityOneOffEvidence {
  readonly kind: OneOffKind;
  readonly period: string;
  readonly amount: number;
  readonly sign?: OneOffSign;
  readonly label?: string;
  readonly source: string;
  readonly evidenceIds?: readonly string[];
  readonly factIds?: readonly string[];
}

export interface AssessEarningsQualityInput {
  readonly factPack: import("@/lib/ai-first/types").FactPack | null;
  readonly subjectId?: string;
  readonly generatedAt?: string;
  readonly oneOffEvidence?: readonly EarningsQualityOneOffEvidence[] | null;
  readonly maintenanceCapex?: Readonly<Record<string, number>> | null;
  readonly evidenceIds?: readonly string[];
  readonly highAccrualRatioThreshold?: number;
  readonly lowCashConversionThreshold?: number;
}
