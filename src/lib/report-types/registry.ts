/**
 * Report blueprint registry (Phase 4 + Phase 8).
 */
import type { ReportBlueprint, ReportTypeId } from "./types";
import { REPORT_BLUEPRINTS_VERSION } from "./types";
import { INSTITUTIONAL_EQUITY_V1 } from "./institutional-equity";
import {
  TEARSHEET_V1,
  VALUATION_DOSSIER_V1,
  EARNINGS_DEEP_DIVE_V1,
  FORENSIC_V1,
} from "./planned-blueprints";
import { ADVANCED_BLUEPRINTS } from "./advanced-blueprints";

export const REPORT_BLUEPRINTS: readonly ReportBlueprint[] = [
  INSTITUTIONAL_EQUITY_V1,
  TEARSHEET_V1,
  VALUATION_DOSSIER_V1,
  EARNINGS_DEEP_DIVE_V1,
  FORENSIC_V1,
  ...ADVANCED_BLUEPRINTS,
] as const;

const BY_ID = new Map<ReportTypeId, ReportBlueprint>(
  REPORT_BLUEPRINTS.map((b) => [b.id, b])
);

export function listReportBlueprints(): ReportBlueprint[] {
  return REPORT_BLUEPRINTS.map((b) => ({ ...b }));
}

export function getReportBlueprint(id: ReportTypeId): ReportBlueprint | null {
  return BY_ID.get(id) ?? null;
}

export function isReportTypeId(id: string): id is ReportTypeId {
  return BY_ID.has(id as ReportTypeId);
}

export { REPORT_BLUEPRINTS_VERSION };
