/**
 * APEX RESEARCH — Report Blueprints (Phase 4)
 * -------------------------------------------
 * A ReportBlueprint is the report-type plan: which research modules to run,
 * which TOC rows the cover prints, and which page-sections compose the document
 * (in render order). Blueprints do not render and do not compute financials.
 *
 * PHASE 4 RULES (non-negotiable):
 *  - `institutional_equity_v1` must match today's PDF TOC titles/order and
 *    page-component render order (concise + full).
 *  - No hardcoded max page counts / page caps — length emerges later from
 *    modules × complexity × evidence (composer phase).
 *  - Section titles are report-type copy, never company-specific conclusions.
 *  - Section → module wiring only references the Phase 3 catalog.
 *  - PDF remains the presentation layer; blueprints describe structure only.
 */
import type { ResearchModuleId } from "@/lib/research-modules";

export const REPORT_BLUEPRINTS_VERSION = "report-blueprints-v1";

export type ReportTypeId =
  | "institutional_equity_v1"
  | "tearsheet_v1"
  | "valuation_dossier_v1"
  | "earnings_deep_dive_v1"
  | "forensic_v1"
  | "industry_v1"
  | "competitive_v1"
  | "management_v1"
  | "risk_v1"
  | "sotp_v1"
  | "bank_v1"
  | "insurance_v1"
  | "reit_v1"
  | "special_situation_v1"
  | "portfolio_v1";

/** Research depth — mirrors the PDF `concise` flag (default concise). */
export type ResearchDepth = "concise" | "full";

export type BlueprintStatus = "stable" | "planned";

/**
 * Cover "Report Contents" row. Page numbers are presentation (PDF) and are
 * intentionally NOT part of the blueprint.
 */
export interface TocEntryBlueprint {
  title: string;
  /** Which depths print this row on the cover. */
  depth: "both" | ResearchDepth;
}

/**
 * One composable page-section in document render order.
 */
export interface SectionBlueprint {
  id: string;
  title: string;
  /** Research modules that feed this section (Phase 3 ids). */
  modules: ResearchModuleId[];
  /** `null` = both depths; otherwise only at that depth. */
  depth: ResearchDepth | null;
  /**
   * Conditional inclusion. `"researchDebates"` mirrors ResearchDebatesPage:
   * include only when debates exist or a research report is present.
   */
  includeWhen?: "always" | "researchDebates";
  /**
   * PDF page-component name (presentation mapping for golden tests / Phase 5
   * composer). Not used for rendering inside this module.
   */
  pdfComponent?: string;
}

export interface ReportBlueprint {
  id: ReportTypeId;
  title: string;
  description: string;
  version: string;
  /** Modules required to compose this report type. */
  requiredModules: ResearchModuleId[];
  /** Cover TOC rows in print order. */
  toc: TocEntryBlueprint[];
  /** Page-sections in render order. */
  sections: SectionBlueprint[];
  /** PDF default is concise. */
  defaultDepth: ResearchDepth;
  status: BlueprintStatus;
}

export interface ResolvedSection extends SectionBlueprint {
  /** 1-based position in the resolved outline. */
  index: number;
}

export interface ResolveSectionsInput {
  /** Defaults to `blueprint.defaultDepth`. */
  depth?: ResearchDepth;
  /**
   * ResearchReport presence (or debates) for `"researchDebates"` gates —
   * same rule as `ResearchDebatesPage` (`!debates.length && !researchReport → omit`).
   */
  researchReport?: unknown | null;
  /** Explicit debates flag when the caller already knows debates exist. */
  hasResearchDebates?: boolean;
  /**
   * Optional ResearchCase — when present, domain availability implies a prior
   * research report (used as a secondary debates gate).
   */
  researchCaseHasResearch?: boolean;
}

export interface ResolvedTocEntry extends TocEntryBlueprint {
  index: number;
}

export interface ResolvedReportOutline {
  blueprintId: ReportTypeId;
  depth: ResearchDepth;
  toc: ResolvedTocEntry[];
  sections: ResolvedSection[];
  /** Unique module ids required by this outline (stable order). */
  moduleIds: ResearchModuleId[];
}
