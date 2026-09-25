import type { ResearchModuleId } from "@/lib/research-modules";
import type { ReportTypeId, ResearchDepth } from "@/lib/report-types";

export const REPORT_PLAN_VERSION = "report-plan-v1";
export const REPORT_BLUEPRINT_ROLE = "template";
export const REPORT_PLAN_HASH_DOMAIN = "report-plan/v1";

export type ReportPlanCompatibilityStatus = "supported" | "limited" | "unsupported";
export type ReportPlanSectionStatus = "ready" | "partial" | "unavailable";

export interface ReportPlanSection {
  id: string;
  title: string;
  order: number;
  depth: number;
  priority: number;
  include: boolean;
  mandatory: boolean;
  modules: ResearchModuleId[];
  sourceQuestions: string[];
  requiredEvidence: string[];
  chartIds: string[];
  tableIds: string[];
  rationale: string;
  coverage: ReportPlanSectionStatus;
}

export interface ReportPlanCoverage {
  totalSections: number;
  includedSections: number;
  availableEvidence: number;
  missingEvidence: string[];
  coverageScore: number;
}

export interface ReportPlanCompatibility {
  status: ReportPlanCompatibilityStatus;
  capability: string;
  reasons: string[];
}

export interface ReportPlan {
  version: typeof REPORT_PLAN_VERSION;
  planId: string;
  ticker: string;
  caseId: string | null;
  packageId: string | null;
  blueprintIdAsTemplate: ReportTypeId;
  depth: ResearchDepth;
  generatedAt: string;
  sections: ReportPlanSection[];
  moduleIds: ResearchModuleId[];
  chartRequirements: string[];
  tableRequirements: string[];
  requiredEvidence: string[];
  coverage: ReportPlanCoverage;
  unresolvedBlockers: string[];
  compatibility: ReportPlanCompatibility;
  planHash: string;
}

export interface CompileReportPlanInput {
  ticker: string;
  caseId?: string | null;
  packageId?: string | null;
  blueprintId?: ReportTypeId;
  depth?: ResearchDepth;
  generatedAt: string;
  blueprintSections?: Array<{ id: string; title: string; modules: ResearchModuleId[] }>;
  blueprintModuleIds?: ResearchModuleId[];
  identitySections?: Array<{ sectionId: string; title: string; order: number; depth: number; priority: number; include: boolean; mandatory: boolean; chartIds: string[]; tableIds: string[]; rationale: string }>;
  identityChartIds?: string[];
  identityTableIds?: string[];
  researchQuestions?: Array<{ question: string; requiredFor: string }>;
  requiredEvidence?: string[];
  missingEvidence?: string[];
  qualityBlockers?: string[];
  qualityWarnings?: string[];
  compatibility?: ReportPlanCompatibility;
  coverageScore?: number;
}
