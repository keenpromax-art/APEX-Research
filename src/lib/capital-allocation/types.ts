export const CAPITAL_ALLOCATION_LEDGER_VERSION = "capital-allocation-ledger-v1" as const;

export type CapitalAllocationStatus = "ready" | "insufficient" | "unavailable";
export type CapitalAllocationEntryKind =
  | "freeCashFlow"
  | "totalCapex"
  | "maintenanceCapex"
  | "growthCapex"
  | "acquisitions"
  | "assetDisposals"
  | "debtIssued"
  | "debtRepaid"
  | "dividends"
  | "buybacks"
  | "cashRetention"
  | "otherInvesting"
  | "otherFinancing";
export type CapitalAllocationBucket = "cashGeneration" | "reinvestment" | "financing" | "distribution" | "retention";
export type CapitalAllocationDirection = "inflow" | "outflow";
export type CapitalAllocationDiagnosticKey =
  | "roicVsReinvestment"
  | "acquisitionValue"
  | "buybackValuation"
  | "dividendConsistency"
  | "leveragePolicy";

export const CAPITAL_ALLOCATION_ENTRY_KINDS: readonly CapitalAllocationEntryKind[] = Object.freeze([
  "freeCashFlow",
  "totalCapex",
  "maintenanceCapex",
  "growthCapex",
  "acquisitions",
  "assetDisposals",
  "debtIssued",
  "debtRepaid",
  "dividends",
  "buybacks",
  "cashRetention",
  "otherInvesting",
  "otherFinancing",
] as const);

export const CAPITAL_ALLOCATION_DIAGNOSTIC_KEYS: readonly CapitalAllocationDiagnosticKey[] = Object.freeze([
  "roicVsReinvestment",
  "acquisitionValue",
  "buybackValuation",
  "dividendConsistency",
  "leveragePolicy",
] as const);

export const CAPITAL_ALLOCATION_BUCKETS: Readonly<Record<CapitalAllocationEntryKind, CapitalAllocationBucket>> = Object.freeze({
  freeCashFlow: "cashGeneration",
  totalCapex: "reinvestment",
  maintenanceCapex: "reinvestment",
  growthCapex: "reinvestment",
  acquisitions: "reinvestment",
  assetDisposals: "reinvestment",
  debtIssued: "financing",
  debtRepaid: "financing",
  dividends: "distribution",
  buybacks: "distribution",
  cashRetention: "retention",
  otherInvesting: "reinvestment",
  otherFinancing: "financing",
});

export interface CapitalAllocationEntry {
  readonly id: string;
  readonly kind: CapitalAllocationEntryKind;
  readonly label: string;
  readonly period: string;
  readonly periodEnd: string;
  readonly amount: number;
  readonly currency: string | null;
  readonly direction: CapitalAllocationDirection;
  readonly bucket: CapitalAllocationBucket;
  readonly derived: boolean;
  readonly derivation: string;
  readonly evidenceIds: readonly string[];
  readonly factIds: readonly string[];
}

export interface CapitalAllocationTotals {
  readonly freeCashFlow: number | null;
  readonly totalCapex: number | null;
  readonly maintenanceCapex: number | null;
  readonly growthCapex: number | null;
  readonly acquisitions: number | null;
  readonly assetDisposals: number | null;
  readonly debtIssued: number | null;
  readonly debtRepaid: number | null;
  readonly netDebtFlow: number | null;
  readonly dividends: number | null;
  readonly buybacks: number | null;
  readonly totalReturned: number | null;
  readonly cashRetention: number | null;
  readonly reinvestmentRate: number | null;
  readonly distributionRate: number | null;
  readonly netInvestmentRate: number | null;
}

export interface CapitalAllocationPeriod {
  readonly period: string;
  readonly periodEnd: string;
  readonly fiscalYear: number | null;
  readonly entries: readonly CapitalAllocationEntry[];
  readonly totals: CapitalAllocationTotals;
  readonly status: CapitalAllocationStatus;
  readonly notes: readonly string[];
}

export interface RoicReinvestmentDiagnostic {
  readonly status: "ready" | "insufficient" | "unavailable";
  readonly roic: number | null;
  readonly weightedCostOfCapital: number | null;
  readonly reinvestmentRate: number | null;
  readonly spread: number | null;
  readonly valueCreating: boolean | null;
  readonly note: string;
}

export interface AcquisitionValueDiagnostic {
  readonly status: "ready" | "insufficient" | "unavailable";
  readonly totalConsideration: number | null;
  readonly periodsWithAcquisitions: number;
  readonly acquiredEarnings: number | null;
  readonly impliedPriceEarnings: number | null;
  readonly valueCreating: boolean | null;
  readonly note: string;
}

export interface BuybackValuationDiagnostic {
  readonly status: "ready" | "insufficient" | "unavailable";
  readonly totalCashSpent: number | null;
  readonly periodsWithBuybacks: number;
  readonly averageFairValue: number | null;
  readonly referencePrice: number | null;
  readonly buybackBelowFairValue: boolean | null;
  readonly note: string;
}

export interface DividendConsistencyDiagnostic {
  readonly status: "ready" | "insufficient" | "unavailable";
  readonly periodsObserved: number;
  readonly periodsWithDividends: number;
  readonly coverage: number | null;
  readonly payoutHistory: readonly { period: string; payoutRatio: number | null }[];
  readonly consistent: boolean | null;
  readonly note: string;
}

export interface LeveragePolicyDiagnostic {
  readonly status: "ready" | "insufficient" | "unavailable";
  readonly leverageHistory: readonly { period: string; debtToEquity: number | null; netDebt: number | null }[];
  readonly firstLeverage: number | null;
  readonly lastLeverage: number | null;
  readonly direction: "increasing" | "decreasing" | "stable" | "unknown";
  readonly note: string;
}

export interface CapitalAllocationDiagnostics {
  readonly roicVsReinvestment: RoicReinvestmentDiagnostic;
  readonly acquisitionValue: AcquisitionValueDiagnostic;
  readonly buybackValuation: BuybackValuationDiagnostic;
  readonly dividendConsistency: DividendConsistencyDiagnostic;
  readonly leveragePolicy: LeveragePolicyDiagnostic;
}

export interface CapitalAllocationFlag {
  readonly id: string;
  readonly key: CapitalAllocationDiagnosticKey | "capexSplit" | "retention";
  readonly severity: "info" | "warning" | "material";
  readonly period: string | null;
  readonly message: string;
  readonly evidenceIds: readonly string[];
}

export interface CapitalAllocationLedger {
  readonly version: typeof CAPITAL_ALLOCATION_LEDGER_VERSION;
  readonly subjectId: string;
  readonly status: CapitalAllocationStatus;
  readonly reason: string;
  readonly generatedAt: string;
  readonly currency: string | null;
  readonly periods: readonly CapitalAllocationPeriod[];
  readonly diagnostics: CapitalAllocationDiagnostics;
  readonly flags: readonly CapitalAllocationFlag[];
  readonly evidenceIds: readonly string[];
  readonly diagnosticsLog: readonly string[];
  readonly contentHash: string;
}

export interface BuildCapitalAllocationLedgerInput {
  readonly factPack: import("@/lib/ai-first/types").FactPack | null;
  readonly subjectId?: string;
  readonly generatedAt?: string;
  readonly maintenanceCapex?: Readonly<Record<string, number>> | null;
  readonly maintenanceCapexEvidenceIds?: Readonly<Record<string, readonly string[]>> | null;
  readonly weightedCostOfCapital?: number | null;
  readonly referencePrice?: number | null;
  readonly acquiredEarnings?: Readonly<Record<string, number>> | null;
  readonly currentFairValuePerShare?: number | null;
  readonly evidenceIds?: readonly string[];
}
