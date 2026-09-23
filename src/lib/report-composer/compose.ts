/**
 * composeReport — pure, deterministic research → ComposedReport.
 * Resolves the blueprint outline, runs only the modules that outline needs,
 * and wires section → module data by reference. Never computes financials.
 */
import {
  getModuleData,
  runResearchModules,
  type ModuleContext,
} from "@/lib/research-modules";
import { getReportBlueprint, resolveReportOutline } from "@/lib/report-types";
import type { ReportData } from "@/types/report";
import {
  REPORT_COMPOSER_VERSION,
  type ComposeReportInput,
  type ComposedReport,
  type ComposedSection,
} from "./types";

export function composeReport(input: ComposeReportInput): ComposedReport {
  if (!input?.context?.researchCase) {
    throw new Error("composeReport: researchCase is required");
  }

  const reportTypeId = input.reportTypeId ?? "institutional_equity_v1";
  const blueprint = getReportBlueprint(reportTypeId);
  if (!blueprint) {
    throw new Error(`composeReport: unknown report type: ${reportTypeId}`);
  }

  const outline = resolveReportOutline(blueprint, {
    depth: input.depth,
    researchReport:
      input.researchReport !== undefined
        ? input.researchReport
        : input.context.researchReport,
    hasResearchDebates: input.hasResearchDebates,
    researchCaseHasResearch: input.researchCaseHasResearch,
  });

  const modules = runResearchModules(input.context, outline.moduleIds);

  const sections: ComposedSection[] = outline.sections.map((s) => {
    const moduleData: ComposedSection["moduleData"] = {};
    const unavailableModules: ComposedSection["unavailableModules"] = [];
    for (const id of s.modules) {
      const slice = getModuleData(modules, id);
      // Indexing a mapped type by a union key needs a widened write.
      (moduleData as Record<string, unknown>)[id] = slice;
      if (slice == null) unavailableModules.push(id);
    }
    return {
      index: s.index,
      id: s.id,
      title: s.title,
      modules: [...s.modules],
      depth: s.depth,
      includeWhen: s.includeWhen,
      pdfComponent: s.pdfComponent,
      moduleData,
      unavailableModules,
    };
  });

  return {
    version: REPORT_COMPOSER_VERSION,
    caseId: modules.caseId,
    blueprintId: outline.blueprintId,
    depth: outline.depth,
    composedAt: input.composedAt ?? new Date().toISOString(),
    toc: outline.toc,
    sections,
    modules,
    moduleIds: outline.moduleIds,
    unknowns: [...modules.unknowns],
  };
}

/**
 * Build a ModuleContext from assembled ReportData (Phase 5 wire).
 * Returns null when ResearchCase is absent — caller keeps the legacy PDF path.
 */
export function moduleContextFromReportData(
  report: ReportData
): ModuleContext | null {
  if (!report?.researchCase) return null;
  return {
    researchCase: report.researchCase,
    masterReportFacts: report.masterReportFacts ?? null,
    ratiosByYear: report.ratiosByYear ?? null,
    dupontByYear: report.dupontByYear ?? null,
    dataConfidence: report.dataConfidence ?? null,
    valuationAudit: report.valuationAudit ?? null,
    baselineReconciliation: report.baselineReconciliation ?? null,
    supervision: report.supervision ?? null,
    selectedModel: report.selectedModel ?? null,
    valuationLens: report.valuationLens ?? null,
    calibration: report.calibration ?? null,
    aiAnalysis: report.aiAnalysis ?? null,
    researchReport: report.researchReport ?? null,
    eventPriceMovements: report.eventPriceMovements ?? null,
    shareholding: report.shareholding ?? null,
    news: report.news ?? null,
    qaReport: report.qaReport ?? null,
  };
}

/**
 * Compose from a fully assembled ReportData bundle.
 * Returns null when no ResearchCase — never throws for missing optional fields.
 */
export function composeReportFromData(
  report: ReportData,
  options: Omit<ComposeReportInput, "context"> = {}
): ComposedReport | null {
  const context = moduleContextFromReportData(report);
  if (!context) return null;

  const hasResearchDebates =
    options.hasResearchDebates ??
    Boolean(
      report.aiAnalysis?.researchDebates?.length ||
        report.researchReport?.debates?.length
    );

  return composeReport({
    ...options,
    context,
    researchReport:
      options.researchReport !== undefined
        ? options.researchReport
        : report.researchReport ?? null,
    hasResearchDebates,
  });
}
