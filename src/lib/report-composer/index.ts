/**
 * APEX RESEARCH — Report Composer (Phase 5 entry point)
 *
 * research → ComposedReport → PDF renderer. The composer only wires
 * outline + module references; the PDF stays presentation-only.
 */
export * from "./types";
export {
  composeReport,
  composeReportFromData,
  moduleContextFromReportData,
} from "./compose";
export {
  planComposedPdf,
  composedPdfReportTitle,
  type ComposedPdfPlan,
  type ComposedPdfPagePlan,
} from "./pdf-plan";
