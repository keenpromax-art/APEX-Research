/**
 * APEX RESEARCH — Report Types (Phase 4 entry point)
 *
 * ReportBlueprints describe structure (TOC + sections + module selection).
 * They do not render PDF, compute financials, or invent page counts.
 */
export * from "./types";
export {
  REPORT_BLUEPRINTS,
  listReportBlueprints,
  getReportBlueprint,
  isReportTypeId,
} from "./registry";
export {
  INSTITUTIONAL_EQUITY_V1,
  institutionalConciseTocTitles,
  institutionalFullTocTitles,
  institutionalTocForDepth,
} from "./institutional-equity";
export {
  TEARSHEET_V1,
  VALUATION_DOSSIER_V1,
  EARNINGS_DEEP_DIVE_V1,
  FORENSIC_V1,
} from "./planned-blueprints";
export {
  INDUSTRY_V1,
  COMPETITIVE_V1,
  MANAGEMENT_V1,
  RISK_V1,
  SOTP_V1,
  BANK_V1,
  INSURANCE_V1,
  REIT_V1,
  SPECIAL_SITUATION_V1,
  PORTFOLIO_V1,
  ADVANCED_BLUEPRINTS,
} from "./advanced-blueprints";
export { resolveReportOutline } from "./resolve";
export {
  DEFAULT_REPORT_TYPE,
  DEFAULT_RESEARCH_DEPTH,
  selectableReportTypes,
  parseReportTypeParam,
  parseDepthParam,
  buildReportQuery,
  reportTypeTitle,
  type SelectableReportType,
} from "./selector";
