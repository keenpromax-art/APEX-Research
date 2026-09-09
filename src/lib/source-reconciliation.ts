// ============================================================
// APEX RESEARCH — Primary-Source + Multi-Source Reconciliation Engine (P0 #2)
// ------------------------------------------------------------
// Filings / exchange / IR = PRIMARY (authoritative). Yahoo / aggregator = SECONDARY (cross-check).
// Reconcile revenue, EBIT, EBITDA, tax, debt, cash, shares, equity, CFO. Unresolved material diff = INVALID.
// Uses kernel magnitudeTolerance + MONEY_BRIDGE_TOL — no ad-hoc thresholds.
// ============================================================
import { magnitudeTolerance, MONEY_BRIDGE_TOL, PER_SHARE_TOL, RATIO_TOL, type ToleranceSpec } from "./financial-kernel";
import type { RawFact } from "./canonical-facts";

export type SourceTier = "PRIMARY" | "SECONDARY";
export interface TierFact {
  value: number | null;
  source: string;
  tier: SourceTier;
  fact: RawFact;
}

export interface ReconciliationResult {
  field: string;
  primary: TierFact | null;
  secondary: TierFact | null;
  status: "RECONCILED" | "MATERIAL_DIFF" | "MISSING_PRIMARY" | "MISSING_BOTH" | "SECONDARY_ONLY";
  tolerance: ToleranceSpec;
  gapAbs: number | null;
  gapRel: number | null;
  verdict: string;
  invalid: boolean;
}

const FIELD_TOL: Record<string, ToleranceSpec> = {
  revenue: MONEY_BRIDGE_TOL,
  ebitda: MONEY_BRIDGE_TOL,
  operatingIncome: MONEY_BRIDGE_TOL,
  netIncome: MONEY_BRIDGE_TOL,
  incomeTaxExpense: MONEY_BRIDGE_TOL,
  totalDebt: MONEY_BRIDGE_TOL,
  cash: MONEY_BRIDGE_TOL,
  sharesOutstanding: PER_SHARE_TOL,
  totalEquity: MONEY_BRIDGE_TOL,
  operatingCashFlow: MONEY_BRIDGE_TOL,
  default: MONEY_BRIDGE_TOL,
};

export function reconcileField(field: string, primary: TierFact | null, secondary: TierFact | null): ReconciliationResult {
  const tol = FIELD_TOL[field] ?? FIELD_TOL.default;
  if (!primary || primary.value === null) {
    if (!secondary || secondary.value === null) {
      return { field, primary, secondary, status: "MISSING_BOTH", tolerance: tol, gapAbs: null, gapRel: null, verdict: "Both tiers missing — INVALID for this field.", invalid: true };
    }
    return { field, primary, secondary, status: "MISSING_PRIMARY", tolerance: tol, gapAbs: null, gapRel: null, verdict: "PRIMARY missing — SECONDARY-only is not authoritative; gate must WARN/BLOCK unless filing backfills.", invalid: false };
  }
  if (!secondary || secondary.value === null) {
    return { field, primary, secondary, status: "SECONDARY_ONLY", tolerance: tol, gapAbs: null, gapRel: null, verdict: "PRIMARY present, no cross-check available — PASS with single-source limitation disclosed.", invalid: false };
  }
  const v = magnitudeTolerance(primary.value, secondary.value, tol);
  if (v.pass) {
    return { field, primary, secondary, status: "RECONCILED", tolerance: tol, gapAbs: v.gapAbs, gapRel: v.gapRel, verdict: `Reconciled: ${v.detail}`, invalid: false };
  }
  if (v.material) {
    return { field, primary, secondary, status: "MATERIAL_DIFF", tolerance: tol, gapAbs: v.gapAbs, gapRel: v.gapRel, verdict: `MATERIAL diff — INVALID: ${v.detail} — do not publish; investigate filing vs feed.`, invalid: true };
  }
  return { field, primary, secondary, status: "MATERIAL_DIFF", tolerance: tol, gapAbs: v.gapAbs, gapRel: v.gapRel, verdict: `Immaterial drift: ${v.detail} — WARN, still RECONCILED for publication.`, invalid: false };
}

export function reconcileAll(fields: Array<{ field: string; primary: TierFact | null; secondary: TierFact | null }>): ReconciliationResult[] {
  return fields.map((f) => reconcileField(f.field, f.primary, f.secondary));
}

export function hasInvalidReconciliation(results: ReconciliationResult[]): boolean {
  return results.some((r) => r.invalid);
}
