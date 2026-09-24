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
  /** Injectable in tests; defaults to wall-clock at compose time. */
  composedAt: string;
  /** Cover TOC rows (titles/order; page numbers stay presentation-only). */
  toc: ResolvedTocEntry[];
  /** Page-sections in render order. */
  sections: ComposedSection[];
  /** Phase 3 runner bundle for `moduleIds` (reference, not a copy). */
  modules: ModuleRunBundle;
  /** Unique module ids used by this composition (stable order). */
  moduleIds: ResearchModuleId[];
  /** Aggregated unknowns across modules (never invented into sections). */
  unknowns: string[];
  /**
   * Adaptive research identity (ResearchDNA). Present when the caller composed
   * with an identity; absent on the legacy/institutional path (golden-safe).
   * Referenced, never recomputed; the renderer stays presentation-only.
   */
  researchIdentity?: import("@/lib/research-identity").ResearchDNA | null;
}

export interface ComposeReportInput {
  /** Required ResearchCase + optional pipeline context (referenced as-is). */
  context: ModuleContext;
  /** Defaults to `institutional_equity_v1`. */
  reportTypeId?: ReportTypeId;
  /** Defaults to the blueprint default depth (`concise`). */
  depth?: ResearchDepth;
  /** ResearchReport for `"researchDebates"` gates (falls back to context). */
  researchReport?: unknown | null;
  /** True when debates exist on aiAnalysis / researchReport. */
  hasResearchDebates?: boolean;
  /** Secondary debates gate (case built with a research report). */
  researchCaseHasResearch?: boolean;
  /** Deterministic stamp for tests. */
  composedAt?: string;
  /**
   * Optional adaptive identity. When supplied, section depths are refined from
   * the identity section plan and identity-overview/signature sections are
   * appended (generic pages). Absent = legacy golden path, byte-identical.
   */
  researchIdentity?: import("@/lib/research-identity").ResearchDNA | null;
}
