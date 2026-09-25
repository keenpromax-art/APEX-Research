import type { CanonicalResearchPackage } from "@/lib/research-package/types";
import type { PresentationViewModel } from "@/lib/report-plan/presentation";
import type { ChartSpec, TableSpec } from "./builder";

export const PDF_PLUMBING_VALIDATION_VERSION = "pdf-plumbing-validation-v1";

export interface PdfExtraction {
  version: typeof PDF_PLUMBING_VALIDATION_VERSION;
  ticker: string;
  viewHash: string;
  numericValues: Array<{ key: string; value: number }>;
  textValues: Array<{ key: string; text: string }>;
  chartCount: number;
  tableCount: number;
}

export interface PdfValidationDiagnostic {
  id: string;
  kind: "numeric" | "text" | "chart" | "table";
  passed: boolean;
  expected: string;
  actual: string;
}

export interface PdfValidationResult {
  version: typeof PDF_PLUMBING_VALIDATION_VERSION;
  passed: boolean;
  diagnostics: PdfValidationDiagnostic[];
  blockers: string[];
  warnings: string[];
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function extractPresentationNumbers(view: PresentationViewModel): Array<{ key: string; value: number }> {
  const out: Array<{ key: string; value: number }> = [];
  for (const metric of view.metrics) {
    if (metric.state === "available" && isFiniteNumber(metric.value)) out.push({ key: `metric:${metric.key}`, value: metric.value });
  }
  for (const chart of view.charts) {
    for (const point of chart.series) {
      if (point.state === "available" && isFiniteNumber(point.value)) out.push({ key: `chart:${chart.id}:${point.period}`, value: point.value as number });
    }
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

export function extractPresentationTexts(view: PresentationViewModel): Array<{ key: string; text: string }> {
  const out: Array<{ key: string; text: string }> = [];
  for (const metric of view.metrics) {
    out.push({ key: `metric:${metric.key}`, text: metric.display });
  }
  for (const table of view.tables) {
    for (const row of table.rows) {
      for (let i = 0; i < row.cells.length; i += 1) {
        out.push({ key: `table:${table.id}:${row.label}:${i}`, text: row.cells[i].display });
      }
    }
  }
  for (const label of view.visualLabels) {
    out.push({ key: `label:${label.slice(0, 40)}`, text: label });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

export function extractPdfPlumbing(view: PresentationViewModel): PdfExtraction {
  return {
    version: PDF_PLUMBING_VALIDATION_VERSION,
    ticker: view.ticker,
    viewHash: view.viewHash,
    numericValues: extractPresentationNumbers(view),
    textValues: extractPresentationTexts(view),
    chartCount: view.charts.length,
    tableCount: view.tables.length,
  };
}

export function validatePresentationAgainstCanonical(view: PresentationViewModel, packageValue: CanonicalResearchPackage): PdfValidationResult {
  const diagnostics: PdfValidationDiagnostic[] = [];
  const blockers: string[] = [];
  const warnings: string[] = [];
  const currentPrice = packageValue.sourceContext.stockData.currentPrice;
  const fairValue = packageValue.valuationResult.fairValuePerShare;
  const metricByKey = new Map(view.metrics.map((m) => [m.key, m]));
  const currentMetric = metricByKey.get("currentPrice");
  if (isFiniteNumber(currentPrice)) {
    const actual = currentMetric?.value;
    const passed = actual === currentPrice;
    diagnostics.push({ id: "PDF-NUM-01", kind: "numeric", passed, expected: String(currentPrice), actual: String(actual ?? currentMetric?.display ?? "missing") });
    if (!passed) blockers.push(`PDF-NUM-01: current price mismatch expected ${currentPrice} got ${actual ?? "missing"}`);
  } else if (currentMetric && currentMetric.state !== "unavailable") {
    diagnostics.push({ id: "PDF-NUM-01", kind: "numeric", passed: false, expected: "Unavailable", actual: currentMetric.display });
    blockers.push("PDF-NUM-01: current price should be Unavailable when canonical price is missing");
  } else {
    diagnostics.push({ id: "PDF-NUM-01", kind: "numeric", passed: true, expected: "Unavailable", actual: currentMetric?.display ?? "Unavailable" });
  }
  if (isFiniteNumber(fairValue)) {
    const actual = metricByKey.get("fairValue")?.value;
    const passed = actual === fairValue;
    diagnostics.push({ id: "PDF-NUM-02", kind: "numeric", passed, expected: String(fairValue), actual: String(actual ?? "missing") });
    if (!passed) blockers.push(`PDF-NUM-02: fair value mismatch expected ${fairValue} got ${actual ?? "missing"}`);
  } else if (metricByKey.get("fairValue")?.state !== "unavailable") {
    diagnostics.push({ id: "PDF-NUM-02", kind: "numeric", passed: false, expected: "Unavailable", actual: metricByKey.get("fairValue")?.display ?? "missing" });
    blockers.push("PDF-NUM-02: fair value should be Unavailable when canonical valuation is missing");
  } else {
    diagnostics.push({ id: "PDF-NUM-02", kind: "numeric", passed: true, expected: "Unavailable", actual: "Unavailable" });
  }
  const rating = packageValue.rating;
  const ratingDisplay = metricByKey.get("rating")?.display;
  const ratingPassed = ratingDisplay === rating || (ratingDisplay === "Unavailable" && !rating);
  diagnostics.push({ id: "PDF-TEXT-01", kind: "text", passed: ratingPassed, expected: String(rating), actual: String(ratingDisplay ?? "missing") });
  if (!ratingPassed) blockers.push(`PDF-TEXT-01: rating mismatch expected ${rating} got ${ratingDisplay}`);
  for (const chart of view.charts) {
    const passed = chart.omissionReason === null ? chart.series.length > 0 : true;
    diagnostics.push({ id: `PDF-CHART-${chart.id}`, kind: "chart", passed, expected: chart.omissionReason ?? "rendered", actual: chart.series.length > 0 ? `${chart.series.length} points` : "no points" });
    if (!passed) warnings.push(`PDF-CHART-${chart.id}: accepted chart has no series points`);
    if (chart.provenance === "illustrative" && chart.series.some((p) => p.state === "available" && isFiniteNumber(p.value))) {
      diagnostics.push({ id: `PDF-CHART-ILL-${chart.id}`, kind: "chart", passed: false, expected: "illustrative without factual values", actual: "illustrative with values" });
      blockers.push(`PDF-CHART-ILL-${chart.id}: illustrative chart must not carry factual values`);
    }
  }
  for (const table of view.tables) {
    const passed = table.omissionReason === null ? table.columns.length > 0 || table.rows.length > 0 : true;
    diagnostics.push({ id: `PDF-TABLE-${table.id}`, kind: "table", passed, expected: table.omissionReason ?? "rendered", actual: `${table.columns.length} cols ${table.rows.length} rows` });
    if (!passed) warnings.push(`PDF-TABLE-${table.id}: accepted table has no columns or rows`);
  }
  if (view.planHash.length !== 64) {
    diagnostics.push({ id: "PDF-PLAN-HASH", kind: "text", passed: false, expected: "64-char plan hash", actual: view.planHash });
    blockers.push("PDF-PLAN-HASH: presentation view is not bound to a hashed report plan");
  } else {
    diagnostics.push({ id: "PDF-PLAN-HASH", kind: "text", passed: true, expected: "64-char plan hash", actual: view.planHash.slice(0, 12) });
  }
  return { version: PDF_PLUMBING_VALIDATION_VERSION, passed: blockers.length === 0, diagnostics, blockers, warnings };
}

export function validateChartSpecAgainstCanonical(chart: ChartSpec, packageValue: CanonicalResearchPackage): PdfValidationDiagnostic[] {
  const out: PdfValidationDiagnostic[] = [];
  const currency = (packageValue.sourceContext.profile as unknown as Record<string, unknown>).currency;
  const expectedCurrency = chart.units === "currency" ? String(currency ?? "") : "";
  const actualCurrency = chart.currency ?? "";
  if (chart.units === "currency") {
    const passed = actualCurrency === expectedCurrency;
    out.push({ id: `CHART-CUR-${chart.id}`, kind: "chart", passed, expected: expectedCurrency || "package currency", actual: actualCurrency || "missing" });
  }
  if (chart.id === "chart-events" && chart.provenance !== "measured" && chart.provenance !== "illustrative") {
    out.push({ id: `CHART-PROV-${chart.id}`, kind: "chart", passed: false, expected: "measured or illustrative", actual: chart.provenance });
  }
  return out;
}

export function validateTableSpecAgainstCanonical(table: TableSpec, packageValue: CanonicalResearchPackage): PdfValidationDiagnostic[] {
  const out: PdfValidationDiagnostic[] = [];
  if (table.omissionReason === null && table.rows.length === 0) {
    out.push({ id: `TABLE-EMPTY-${table.id}`, kind: "table", passed: false, expected: "at least one row", actual: "no rows" });
  } else {
    out.push({ id: `TABLE-EMPTY-${table.id}`, kind: "table", passed: true, expected: "rows or omission", actual: `${table.rows.length} rows` });
  }
  void packageValue;
  return out;
}
