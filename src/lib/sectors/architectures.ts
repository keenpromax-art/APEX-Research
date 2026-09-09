/**
 * APEX RESEARCH — Statement Architecture Registry (Multi-Archetype Financial Statements)
 *
 * Maps the 22 sector profiles onto five statement architectures:
 *   A = Standard Corporate (AnnualFinancials / CorporateAnnualFinancials) — already hardened, do not touch.
 *   B = Depository Institution (BankAnnualFinancials) — bank + nbfc (NBFC shares the
 *       shape with deposit fields legitimately empty/undefined).
 *   C = Insurance (InsuranceAnnualFinancials) — underwriting + float, never bank fields.
 *   D = REIT (ReitAnnualFinancials) — equity REITs only; real-estate developers stay on A.
 *   E = Asset-light fee (AssetLightFeeAnnualFinancials) — asset management + ratings agency.
 *
 * Each entry carries an `implemented` flag. The report pipeline returns an explicit
 * UNSUPPORTED_SECTOR status for any sector whose architecture is not yet implemented
 * instead of silently forcing it through the generic Architecture A template.
 * Remove the gate per-sector (flip implemented → true) only after that architecture
 * passes extraction + ratios + drivers + PDF + QA verification against real tickers.
 */
import type { SectorId } from "./types";
import type { StatementArchitecture } from "@/types/report";

export interface ArchitectureInfo {
  arch: StatementArchitecture;
  /** Concrete statement type(s) produced for this sector. */
  statementTypes: string[];
  /** True once extraction + ratios + drivers + PDF + QA exist and are ticker-verified. */
  implemented: boolean;
  /** Human-readable coverage note for the UNSUPPORTED_SECTOR message. */
  label: string;
}

export const SECTOR_ARCHITECTURES: Record<SectorId, ArchitectureInfo> = {
  // Architecture A — standard corporate (hardened path, always on)
  "technology-hardware": { arch: "A", statementTypes: ["corporate"], implemented: true, label: "Standard corporate statements" },
  "technology-software": { arch: "A", statementTypes: ["corporate"], implemented: true, label: "Standard corporate statements" },
  "it-services": { arch: "A", statementTypes: ["corporate"], implemented: true, label: "Standard corporate statements" },
  pharma: { arch: "A", statementTypes: ["corporate"], implemented: true, label: "Standard corporate statements" },
  consumer: { arch: "A", statementTypes: ["corporate"], implemented: true, label: "Standard corporate statements" },
  "internet-retail": { arch: "A", statementTypes: ["corporate"], implemented: true, label: "Standard corporate statements" },
  "internet-platform": { arch: "A", statementTypes: ["corporate"], implemented: true, label: "Standard corporate statements" },
  auto: { arch: "A", statementTypes: ["corporate"], implemented: true, label: "Standard corporate statements" },
  "renewable-energy": { arch: "A", statementTypes: ["corporate"], implemented: true, label: "Standard corporate statements" },
  telecom: { arch: "A", statementTypes: ["corporate"], implemented: true, label: "Standard corporate statements" },
  industrial: { arch: "A", statementTypes: ["corporate"], implemented: true, label: "Standard corporate statements" },
  utilities: { arch: "A", statementTypes: ["corporate"], implemented: true, label: "Standard corporate statements" },
  agrochemical: { arch: "A", statementTypes: ["corporate"], implemented: true, label: "Standard corporate statements" },
  cement: { arch: "A", statementTypes: ["corporate"], implemented: true, label: "Standard corporate statements" },
  hospitality: { arch: "A", statementTypes: ["corporate"], implemented: true, label: "Standard corporate statements" },
  general: { arch: "A", statementTypes: ["corporate"], implemented: true, label: "Standard corporate statements" },
  // Architecture B — depository institutions
  bank: { arch: "B", statementTypes: ["bank"], implemented: true, label: "Bank-native statements (NII/PPOP/provisions/deposits/loans)" },
  nbfc: { arch: "B", statementTypes: ["nbfc"], implemented: true, label: "NBFC-native statements (loan-book/provisioning; no CASA)" },
  // Architecture C — insurance
  insurance: { arch: "C", statementTypes: ["insurance"], implemented: true, label: "Insurance-native statements (GWP/NEP/combined-ratio/float)" },
  // Architecture D — REIT (developers stay on A via REIT-vs-developer split at extraction)
  "real-estate": { arch: "D", statementTypes: ["reit", "corporate"], implemented: true, label: "REIT-native statements (NOI/FFO/AFFO/NAV); developers stay corporate" },
  // Architecture E — asset-light fee
  "asset-management": { arch: "E", statementTypes: ["asset-light"], implemented: true, label: "Fee-native statements (AUM/fee-rate/operating-margin)" },
  "ratings-agency": { arch: "E", statementTypes: ["asset-light"], implemented: true, label: "Fee-native statements (fee/subscription, asset-light)" },
};

/** Resolve the architecture info for a classified sector id (unknown → general/A). */
export function getArchitectureForSector(sectorId: string | undefined): ArchitectureInfo {
  const info = (sectorId ? SECTOR_ARCHITECTURES[sectorId as SectorId] : undefined) ?? SECTOR_ARCHITECTURES.general;
  return info;
}

/** True when the pipeline may generate a report for this sector (arch implemented). */
export function isSectorSupported(sectorId: string | undefined): boolean {
  return getArchitectureForSector(sectorId).implemented;
}

/** Stable machine-readable gate payload for the UNSUPPORTED_SECTOR response. */
export function unsupportedSectorPayload(sectorId: string | undefined): {
  status: "UNSUPPORTED_SECTOR";
  sectorId: string;
  architecture: StatementArchitecture;
  message: string;
} {
  const info = getArchitectureForSector(sectorId);
  const sid = sectorId || "general";
  return {
    status: "UNSUPPORTED_SECTOR",
    sectorId: sid,
    architecture: info.arch,
    message: `Financial statement modeling for sector '${sid}' (architecture ${info.arch} — ${info.label}) is not yet supported — coverage in progress. Standard corporate coverage is unaffected.`,
  };
}
