/**
 * APEX RESEARCH — Report Type / Depth Selector helpers (Phase 9 UI)
 * ------------------------------------------------------------------
 * Pure, client-safe helpers shared by the home page, the report page, and
 * ReportClient. Selectable types are blueprints with `status: "stable"` —
 * planned skeletons never appear in the UI. Parsers are fail-closed:
 * unknown/absent query values fall back to the institutional default with
 * concise depth (never invented, never partial).
 */
import {
  getReportBlueprint,
  isReportTypeId,
  listReportBlueprints,
} from "./registry";
import type { ReportTypeId, ResearchDepth } from "./types";

export const DEFAULT_REPORT_TYPE: ReportTypeId = "institutional_equity_v1";
export const DEFAULT_RESEARCH_DEPTH: ResearchDepth = "concise";

export interface SelectableReportType {
  id: ReportTypeId;
  title: string;
  description: string;
  defaultDepth: ResearchDepth;
}

/** Stable blueprints in registry order — the only types the UI may offer. */
export function selectableReportTypes(): SelectableReportType[] {
  return listReportBlueprints()
    .filter((b) => b.status === "stable")
    .map((b) => ({
      id: b.id,
      title: b.title,
      description: b.description,
      defaultDepth: b.defaultDepth,
    }));
}

/** Validate a `?type=` query value; unknown/planned ids fall back to the institutional default. */
export function parseReportTypeParam(value: unknown): ReportTypeId {
  if (typeof value !== "string" || !isReportTypeId(value)) return DEFAULT_REPORT_TYPE;
  return getReportBlueprint(value)?.status === "stable" ? value : DEFAULT_REPORT_TYPE;
}

/** Validate a `?depth=` query value; anything but "full" is concise. */
export function parseDepthParam(value: unknown): ResearchDepth {
  return value === "full" ? "full" : DEFAULT_RESEARCH_DEPTH;
}

/** Query string (`?type=…&depth=…`) for report navigation. Always explicit. */
export function buildReportQuery(
  reportTypeId: ReportTypeId = DEFAULT_REPORT_TYPE,
  depth: ResearchDepth = DEFAULT_RESEARCH_DEPTH
): string {
  return `?type=${encodeURIComponent(reportTypeId)}&depth=${encodeURIComponent(depth)}`;
}

/** Blueprint title for display; safe fallback when the id is unknown. */
export function reportTypeTitle(reportTypeId: ReportTypeId): string {
  return getReportBlueprint(reportTypeId)?.title ?? "Institutional Equity Research";
}
