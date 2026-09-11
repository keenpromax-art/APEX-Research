/**
 * APEX RESEARCH — Labeling Invariants (TRACK 2)
 * ----------------------------------------------
 * Pure, testable invariants over model labels. Every violation is a BLOCKER:
 * a mislabeled model prices the wrong economics (deposits as inventory,
 * SaaS as hardware shipments) and no narrative disclosure can cure it.
 *
 * INV-01  Financial institutions value equity via residual income
 *         (valuationUse "vectors-only", statementShape "financial",
 *         zero FCFF projections). FCFF on a bank is a defect.
 * INV-02  Operating companies value via FCFF (valuationUse "fcff",
 *         statementShape "corporate", non-empty projections).
 * INV-03  Model tag matches the path (PB_RESIDUAL_INCOME ↔ financial,
 *         FCFF_DCF ↔ corporate).
 * INV-04  Sector lens matches the business (hardware ↔ units×ASP,
 *         software ↔ ARR×NRR — never crossed).
 * INV-05  Forecast shape matches valuation use (corporate↔fcff,
 *         financial↔vectors-only).
 */
import type { ResearchSeverity } from "./severity";

export interface LabelingFinding {
  invariant: "INV-01" | "INV-02" | "INV-03" | "INV-04" | "INV-05";
  pass: boolean;
  severity: ResearchSeverity;
  detail: string;
}

const block = (invariant: LabelingFinding["invariant"], detail: string): LabelingFinding => ({
  invariant, pass: false, severity: "blocker", detail,
});
const ok = (invariant: LabelingFinding["invariant"], detail: string): LabelingFinding => ({
  invariant, pass: true, severity: "info", detail,
});

/** INV-01/02/03 — valuation path labeling vs institution flag. */
export function checkValuationLabeling(input: {
  isFinancialInstitution: boolean;
  valuationUse?: "fcff" | "vectors-only" | string;
  statementShape?: "corporate" | "financial" | string;
  hasProjections?: boolean;
  modelTag?: string;
}): LabelingFinding[] {
  const out: LabelingFinding[] = [];
  const use = input.valuationUse ?? "";
  const shape = input.statementShape ?? "";
  const hasProj = Boolean(input.hasProjections);
  if (input.isFinancialInstitution) {
    out.push(
      use === "vectors-only"
        ? ok("INV-01", "Financial institution labeled vectors-only (residual-income prices equity).")
        : block("INV-01", `Financial institution labeled valuationUse "${use || "missing"}" — deposits are operating liabilities; residual-income/vectors-only is required, FCFF is forbidden.`)
    );
    out.push(
      !hasProj
        ? ok("INV-01", "Financial institution carries no FCFF projections (by construction).")
        : block("INV-01", "Financial institution carries FCFF projections — FCFF is invalid when deposits are operating inventory.")
    );
  } else {
    out.push(
      use === "fcff"
        ? ok("INV-02", "Operating company labeled fcff (FCFF DCF prices the enterprise).")
        : block("INV-02", `Operating company labeled valuationUse "${use || "missing"}" — FCFF DCF is required; vectors-only has no pricing engine.`)
    );
    out.push(
      hasProj
        ? ok("INV-02", "Operating company carries explicit FCFF projections.")
        : block("INV-02", "Operating company carries no FCFF projections — valuation has no engine.")
    );
  }
  if (input.modelTag) {
    const expectsRI = input.isFinancialInstitution;
    const isRI = /RESIDUAL|PB_/i.test(input.modelTag);
    const isFCFF = /FCFF|DCF/i.test(input.modelTag) && !isRI;
    const match = (expectsRI && isRI) || (!expectsRI && isFCFF) || (!isRI && !isFCFF);
    out.push(
      match
        ? ok("INV-03", `Model tag "${input.modelTag}" matches the ${expectsRI ? "financial" : "operating"} path.`)
        : block("INV-03", `Model tag "${input.modelTag}" contradicts the ${expectsRI ? "financial (expect PB_RESIDUAL_INCOME)" : "operating (expect FCFF_DCF)"} path.`)
    );
  }
  if (shape) {
    const expectsFinancial = input.isFinancialInstitution;
    const shapeOk = (expectsFinancial && shape === "financial") || (!expectsFinancial && shape === "corporate");
    out.push(
      shapeOk
        ? ok("INV-05", `Statement shape "${shape}" matches valuation use "${use || "n/a"}".`)
        : block("INV-05", `Statement shape "${shape}" contradicts ${expectsFinancial ? "financial (expect financial/vectors-only)" : "operating (expect corporate/fcff)"} labeling.`)
    );
  }
  return out;
}

/** INV-04 — sector lens labeling (never crossed). */
export function checkSectorLensLabeling(input: { sectorId: string; valuationLens?: string }): LabelingFinding[] {
  const lens = (input.valuationLens || "").toLowerCase();
  if (!lens) return [ok("INV-04", "No valuation lens asserted — nothing to cross-check.")];
  const sector = (input.sectorId || "").toLowerCase();
  if ((sector === "technology-hardware" || sector === "technology_hardware") && /arr|nrr|rule.of.40/i.test(lens)) {
    return [block("INV-04", `Hardware sector with SaaS lens "${input.valuationLens?.slice(0, 80)}" — units×ASP is required, ARR/NRR is a wrong-business-model label.`)];
  }
  if ((sector === "technology-software" || sector === "technology_software") && /units.*asp|shipments/i.test(lens)) {
    return [block("INV-04", `Software sector with hardware lens "${input.valuationLens?.slice(0, 80)}" — ARR×NRR is required, units/shipments is a wrong-business-model label.`)];
  }
  return [ok("INV-04", `Valuation lens matches ${sector || "unknown"} archetype.`)];
}

/** INV-05 standalone — forecast shape vs valuation use (no institution flag needed). */
export function checkForecastLabeling(input: {
  statementShape?: "corporate" | "financial" | string;
  valuationUse?: "fcff" | "vectors-only" | string;
}): LabelingFinding[] {
  const { statementShape, valuationUse } = input;
  if (!statementShape || !valuationUse) return [ok("INV-05", "Forecast shape/use unlabeled — nothing to cross-check.")];
  const match =
    (statementShape === "corporate" && valuationUse === "fcff") ||
    (statementShape === "financial" && valuationUse === "vectors-only");
  return [
    match
      ? ok("INV-05", `Forecast shape "${statementShape}" matches valuation use "${valuationUse}".`)
      : block("INV-05", `Forecast shape "${statementShape}" contradicts valuation use "${valuationUse}" (corporate↔fcff, financial↔vectors-only).`),
  ];
}
