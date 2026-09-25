import {
  getModuleData,
  runResearchModules,
  type ModuleContext,
} from "@/lib/research-modules";
import { getReportBlueprint, resolveReportOutline } from "@/lib/report-types";
import type { ReportData } from "@/types/report";
import { compileReportPlan } from "@/lib/report-plan/compiler";
import { companyIdentityFromPackage } from "@/lib/report-plan/identity-wiring";
import { buildPresentationViewModel } from "@/lib/report-plan/presentation";
import { buildChartSpecs, buildTableSpecs } from "@/lib/report-charts/builder";
import { validateChartProposals, validateTableProposals } from "@/lib/report-charts/proposal";
import { computeReportFingerprints } from "@/lib/report-originality/fingerprints";
import { detectOriginalityCollision } from "@/lib/report-originality/collision";
import type { ChartSpec, TableSpec } from "@/lib/report-charts/builder";
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
  const identity = input.researchIdentity ?? null;
  const identityDepthBySection = new Map(
    (identity?.sections.sections ?? []).map((p) => [p.sectionId, p.depth] as const)
  );
  const sections: ComposedSection[] = outline.sections.map((s) => {
    const moduleData: ComposedSection["moduleData"] = {};
    const unavailableModules: ComposedSection["unavailableModules"] = [];
    for (const id of s.modules) {
      const slice = getModuleData(modules, id);
      (moduleData as Record<string, unknown>)[id] = slice;
      if (slice == null) unavailableModules.push(id);
    }
    const identityDepth = identityDepthBySection.get(s.id);
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
      ...(identityDepth !== undefined ? { identityDepth } : {}),
    } as ComposedSection;
  });
  if (identity) {
    const thesisSlice = getModuleData(modules, "thesis");
    const valuationSlice = getModuleData(modules, "valuation");
    let nextIndex = sections.length + 1;
    const overview = identity.sections.sections.find((p) => p.sectionId === "identity-overview");
    if (overview?.include) {
      const moduleData: ComposedSection["moduleData"] = {};
      (moduleData as Record<string, unknown>).thesis = thesisSlice;
      sections.push({
        index: nextIndex++,
        id: "identity-overview",
        title: overview.title,
        modules: ["thesis"],
        depth: outline.depth,
        moduleData,
        unavailableModules: thesisSlice == null ? ["thesis"] : [],
      });
    }
    const signature = identity.sections.sections.find((p) => p.sectionId === "signature-analysis");
    if (signature?.include) {
      const moduleData: ComposedSection["moduleData"] = {};
      (moduleData as Record<string, unknown>).valuation = valuationSlice;
      sections.push({
        index: nextIndex++,
        id: "signature-analysis",
        title: signature.title,
        modules: ["valuation"],
        depth: "full",
        moduleData,
        unavailableModules: valuationSlice == null ? ["valuation"] : [],
      });
    }
  }
  const composedAt = input.composedAt ?? new Date().toISOString();
  const base: ComposedReport = {
    version: REPORT_COMPOSER_VERSION,
    caseId: modules.caseId,
    blueprintId: outline.blueprintId,
    depth: outline.depth,
    composedAt,
    toc: outline.toc,
    sections,
    modules,
    moduleIds: outline.moduleIds,
    unknowns: [...modules.unknowns],
    ...(identity ? { researchIdentity: identity } : {}),
  };
  return attachCanonicalArtifacts(base, input, composedAt);
}

function attachCanonicalArtifacts(base: ComposedReport, input: ComposeReportInput, composedAt: string): ComposedReport {
  let reportPlan = input.reportPlan ?? null;
  let companyIdentity = input.companyIdentity ?? null;
  let chartSpecs: ChartSpec[] | null = input.chartSpecs ?? null;
  let tableSpecs: TableSpec[] | null = input.tableSpecs ?? null;
  let presentation = input.presentation ?? null;
  let originality = input.originality ?? null;
  const canonicalPackage = input.canonicalPackage ?? null;
  if (!reportPlan && canonicalPackage) {
    try {
      reportPlan = compileReportPlan({
        packageValue: canonicalPackage,
        blueprintId: base.blueprintId,
        depth: base.depth,
        identity: input.researchIdentity ?? null,
        researchPlan: canonicalPackage.researchPlan ?? null,
        generatedAt: composedAt,
      });
    } catch {
      reportPlan = null;
    }
  }
  if (!companyIdentity && canonicalPackage) {
    try {
      companyIdentity = companyIdentityFromPackage(canonicalPackage, composedAt);
    } catch {
      companyIdentity = null;
    }
  }
  if ((!chartSpecs || !tableSpecs) && canonicalPackage && reportPlan) {
    try {
      const chartValidation = validateChartProposals(input.proposedChartIds ?? []);
      const tableValidation = validateTableProposals(input.proposedTableIds ?? []);
      if (!chartSpecs) {
        const built = buildChartSpecs({ packageValue: canonicalPackage, plan: reportPlan, proposedChartIds: chartValidation.accepted });
        chartSpecs = [...built.specs, ...built.omitted];
      }
      if (!tableSpecs) {
        const built = buildTableSpecs({ packageValue: canonicalPackage, plan: reportPlan, proposedTableIds: tableValidation.accepted });
        tableSpecs = [...built.specs, ...built.omitted];
      }
    } catch {
      chartSpecs = chartSpecs ?? null;
      tableSpecs = tableSpecs ?? null;
    }
  }
  if (!presentation && canonicalPackage && reportPlan) {
    try {
      presentation = buildPresentationViewModel({
        packageValue: canonicalPackage,
        plan: reportPlan,
        charts: (chartSpecs ?? []).filter((spec) => spec.omissionReason === null),
        tables: (tableSpecs ?? []).filter((spec) => spec.omissionReason === null),
        generatedAt: composedAt,
      });
    } catch {
      presentation = null;
    }
  }
  if (!originality && canonicalPackage && reportPlan && chartSpecs && tableSpecs) {
    try {
      const acceptedCharts = chartSpecs.filter((spec) => spec.omissionReason === null);
      const acceptedTables = tableSpecs.filter((spec) => spec.omissionReason === null);
      const set = computeReportFingerprints({ packageValue: canonicalPackage, plan: reportPlan, charts: acceptedCharts, tables: acceptedTables, identity: input.researchIdentity ?? null });
      originality = detectOriginalityCollision({ ticker: canonicalPackage.ticker, fingerprints: set, priors: [], generatedAt: composedAt });
    } catch {
      originality = null;
    }
  }
  if (reportPlan) (base as unknown as Record<string, unknown>).reportPlan = reportPlan;
  if (companyIdentity) (base as unknown as Record<string, unknown>).companyIdentity = companyIdentity;
  if (chartSpecs) (base as unknown as Record<string, unknown>).chartSpecs = chartSpecs;
  if (tableSpecs) (base as unknown as Record<string, unknown>).tableSpecs = tableSpecs;
  if (presentation) (base as unknown as Record<string, unknown>).presentation = presentation;
  if (originality) (base as unknown as Record<string, unknown>).originality = originality;
  if (canonicalPackage) (base as unknown as Record<string, unknown>).canonicalPackageId = (canonicalPackage as { packageId?: string }).packageId ?? null;
  return base;
}

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
  const canonicalPackage = options.canonicalPackage ?? (report as unknown as { canonicalPackage?: import("@/lib/research-package/types").CanonicalResearchPackage | null }).canonicalPackage ?? null;
  const researchIdentity = options.researchIdentity ?? (report as unknown as { researchIdentity?: import("@/lib/research-identity").ResearchDNA | null }).researchIdentity ?? null;
  return composeReport({
    ...options,
    context,
    canonicalPackage,
    researchIdentity,
    researchReport:
      options.researchReport !== undefined
        ? options.researchReport
        : report.researchReport ?? null,
    hasResearchDebates,
  });
}
