import type { ReportData } from "@/types/report";
import { validateReportIntegrity } from "@/lib/report-qa";
import { validateMasterReport } from "@/lib/report-validator";
import { buildEvidenceGraphFromReportData } from "@/lib/evidence-graph";
import { composeReportFromData } from "@/lib/report-composer";
import type { ReportTypeId, ResearchDepth } from "@/lib/report-types";

export interface FinalizeReportOptions {
  reportTypeId: ReportTypeId;
  depth: ResearchDepth;
  composedAt?: string;
  graphBuiltAt?: string;
}

export interface FinalizeReportResult {
  report: ReportData;
  compositionError: string | null;
  graphError: string | null;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function finalizeReport(input: ReportData, options: FinalizeReportOptions): FinalizeReportResult {
  const report: ReportData = {
    ...input,
    composedReport: null,
    researchGraph: null,
    qaReport: undefined,
    finalQAResult: undefined,
  };
  let compositionError: string | null = null;
  let graphError: string | null = null;

  const compose = () => {
    try {
      report.composedReport = composeReportFromData(report, {
        reportTypeId: options.reportTypeId,
        depth: options.depth,
        composedAt: options.composedAt,
      });
    } catch (error) {
      compositionError = errorText(error);
      report.composedReport = null;
    }
  };

  const buildGraph = () => {
    try {
      report.researchGraph = buildEvidenceGraphFromReportData(report, { builtAt: options.graphBuiltAt });
      if (report.composedReport) report.composedReport.evidenceGraph = report.researchGraph;
    } catch (error) {
      graphError = errorText(error);
      report.researchGraph = null;
    }
  };

  compose();
  buildGraph();

  try {
    report.qaReport = validateReportIntegrity(report);
  } catch (error) {
    graphError = graphError ?? `QA: ${errorText(error)}`;
  }

  try {
    if (report.masterReportFacts) report.finalQAResult = validateMasterReport(report.masterReportFacts, report);
  } catch (error) {
    graphError = graphError ?? `Final QA: ${errorText(error)}`;
  }

  compose();
  buildGraph();

  return { report, compositionError, graphError };
}
