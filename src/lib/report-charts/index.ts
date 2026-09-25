export { listChartCatalog, listTableCatalog, isKnownChartId, isKnownTableId, getChartCatalogEntry, getTableCatalogEntry, CHART_CATALOG_VERSION, TABLE_CATALOG_VERSION } from "./catalog";
export type { ChartCatalogEntry, TableCatalogEntry, ChartProvenancePolicy } from "./catalog";
export { buildChartSpecs, buildTableSpecs, verifyChartSpec, verifyTableSpec, CHART_SPEC_VERSION, TABLE_SPEC_VERSION, CHART_BUILDER_HASH_DOMAIN } from "./builder";
export type { ChartSpec, ChartSeriesPoint, TableSpec, TableCell, SpecProvenance, SpecState, BuildSpecsInput } from "./builder";
export { validateChartProposals, validateTableProposals, filterProposalsToCatalog } from "./proposal";
export type { ProposalValidation } from "./proposal";
export { extractPresentationNumbers, extractPresentationTexts, extractPdfPlumbing, validatePresentationAgainstCanonical, validateChartSpecAgainstCanonical, validateTableSpecAgainstCanonical, PDF_PLUMBING_VALIDATION_VERSION } from "./pdf-validation";
export type { PdfExtraction, PdfValidationDiagnostic, PdfValidationResult } from "./pdf-validation";
