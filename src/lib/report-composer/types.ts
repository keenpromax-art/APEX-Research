/**
 * APEX RESEARCH — Report Composer (Phase 5)
 * -----------------------------------------
 * Bridges research → structure: a ComposedReport is the resolved blueprint
 * outline plus the Phase 3 module bundle, with per-section module data
 * references. The PDF renderer consumes this for structure (TOC + section
 * order) and remains presentation-only.
 *
 * PHASE 5 RULES (non-negotiable):
 *  - No financial computation, no LLM calls, no page-count caps.
 *  - Module data is REFERENCED from the runner bundle — never recomputed.
 *  - Missing sections/modules stay null with explicit unknowns.
 *  - Existing report output is unchanged: institutional outline still
 *    golden-matches the PDF; the renderer falls back to its legacy structure
 *    when a composed report is absent.
 */
import type { ModuleContext, ModuleRunBundle, ResearchModuleId, ResearchModuleOutputMap } from "@/lib/research-modules";
import type { ResearchDepth, ReportTypeId, ResolvedTocEntry } from "@/lib/report-types";

export const REPORT_COMPOSER_VERSION = "report-composer-v1";

/** PDF page-component names the institutional blueprint may reference. */
export type PdfComponentName =
  | "CoverPage"
  | "ResearchDebatesPage"
  | "FundamentalAnalysisPage"
  | "MoatAndPriceFairValuePage"
  | "MoatSourcesPage"
  | "BullsSayBearsSayPage"
  | "CreditAnalysisPage1"
  | "CreditAnalysisPage2"
  | "ManagementAndOwnershipPage1"
  | "ManagementAndOwnershipPage2"
  | "EventBasedPriceMovementPage"
  | "CorporateDisclosuresAndCatalystsPage"
  | "AnalystForecastsSummaryPage"
  | "IncomeStatementDetailedPage"
  | "BalanceSheetDetailedPage"
  | "CashFlowDetailedPage"
  | "ComparableCompanyAnalysisPage1"
  | "ComparableCompanyAnalysisPage2"
  | "ResearchMethodologyValuationPage1"
  | "ResearchMethodologyValuationPage2"
  | "CreditRatingApproachPage1"
  | "CreditRatingApproachPage2"
  | "InstitutionalDisclaimerPage"
  | "AnalystAIDisclosurePage"
  | "QualityAssuranceChecksumPage";

/** One outline section with module data slices feeding it (by reference). */
export interface ComposedSection {
  /** 1-based position in the composed outline. */
  index: number;
  id: string;
  title: string;
  modules: ResearchModuleId[];
  depth: ResearchDepth | null;
  includeWhen?: "always" | "researchDebates";
  pdfComponent?: PdfComponentName | string;
  /** Module outputs for `modules` — null when that module was unavailable. */
  moduleData: { [K in ResearchModuleId]?: ResearchModuleOutputMap[K] | null };
  /** Modules that produced no usable slice for this section. */
  unavailableModules: ResearchModuleId[];
}

export interface ComposedReport {
  version: string;
  caseId: string;
  blueprintId: ReportTypeId;
  depth: ResearchDepth;
  composedAt: string;
  toc: ResolvedTocEntry[];
  sections: ComposedSection[];
  modules: ModuleRunBundle;
  moduleIds: ResearchModuleId[];
  unknowns: string[];
  evidenceGraph?: import("@/lib/evidence-graph").EvidenceGraph | null;
  researchIdentity?: import("@/lib/research-identity").ResearchDNA | null;
  reportPlan?: import("@/lib/report-plan/types").ReportPlan | null;
  presentation?: import("@/lib/report-plan/presentation").PresentationViewModel | null;
  chartSpecs?: import("@/lib/report-charts/builder").ChartSpec[] | null;
  tableSpecs?: import("@/lib/report-charts/builder").TableSpec[] | null;
  companyIdentity?: import("@/lib/report-plan/identity-wiring").CompanyIdentity | null;
  originality?: import("@/lib/report-originality/collision").OriginalityReport | null;
}

export interface ComposeReportInput {
  context: ModuleContext;
  reportTypeId?: ReportTypeId;
  depth?: ResearchDepth;
  researchReport?: unknown | null;
  hasResearchDebates?: boolean;
  researchCaseHasResearch?: boolean;
  composedAt?: string;
  researchIdentity?: import("@/lib/research-identity").ResearchDNA | null;
  canonicalPackage?: import("@/lib/research-package/types").CanonicalResearchPackage | null;
  reportPlan?: import("@/lib/report-plan/types").ReportPlan | null;
  presentation?: import("@/lib/report-plan/presentation").PresentationViewModel | null;
  chartSpecs?: import("@/lib/report-charts/builder").ChartSpec[] | null;
  tableSpecs?: import("@/lib/report-charts/builder").TableSpec[] | null;
  companyIdentity?: import("@/lib/report-plan/identity-wiring").CompanyIdentity | null;
  originality?: import("@/lib/report-originality/collision").OriginalityReport | null;
  proposedChartIds?: string[];
  proposedTableIds?: string[];
  priorIdentities?: import("@/lib/research-identity").ResearchDNA[];
}
