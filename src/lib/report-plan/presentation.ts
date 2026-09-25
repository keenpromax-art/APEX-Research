import { stableHash } from "@/lib/research-ledger/stable";
import type { CanonicalResearchPackage } from "@/lib/research-package/types";
import type { ReportPlan } from "./types";
import type { ChartSpec, TableSpec } from "@/lib/report-charts/builder";

export const PRESENTATION_VIEW_MODEL_VERSION = "presentation-view-model-v1";
export const PRESENTATION_HASH_DOMAIN = "presentation-view-model/v1";

export type PresentationValueState = "available" | "unavailable" | "not-meaningful";
export type PresentationProvenance = "measured" | "derived" | "illustrative" | "unavailable";

export interface PresentationMetric {
  key: string;
  label: string;
  display: string;
  value: number | null;
  state: PresentationValueState;
  provenance: PresentationProvenance;
  sourceId: string | null;
  derivationId: string | null;
  currency: string | null;
  units: string | null;
}

export interface PresentationStatementCell {
  period: string;
  value: number | null;
  display: string;
  state: PresentationValueState;
  provenance: PresentationProvenance;
}

export interface PresentationStatementView {
  id: string;
  title: string;
  columns: string[];
  rows: Array<{ label: string; cells: PresentationStatementCell[] }>;
  currency: string | null;
  units: string;
  state: PresentationValueState;
}

export interface PresentationSensitivityView {
  state: PresentationValueState;
  rows: Array<{ label: string; values: Array<{ display: string; value: number | null; state: PresentationValueState }> }>;
  provenance: PresentationProvenance;
  note: string;
}

export interface PresentationEventView {
  id: string;
  headline: string;
  eventDate: string;
  measured: boolean;
  displayLabel: string;
  immediateReturnPct: number | null;
  multiDayReturnPct: number | null;
  provenance: PresentationProvenance;
}

export interface PresentationViewModel {
  version: typeof PRESENTATION_VIEW_MODEL_VERSION;
  ticker: string;
  generatedAt: string;
  planHash: string;
  currency: string | null;
  metrics: PresentationMetric[];
  statements: PresentationStatementView[];
  sensitivity: PresentationSensitivityView;
  events: PresentationEventView[];
  charts: ChartSpec[];
  tables: TableSpec[];
  disclosures: string[];
  visualLabels: string[];
  viewHash: string;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function metricAvailable(key: string, label: string, value: unknown, opts: { provenance?: PresentationProvenance; sourceId?: string | null; derivationId?: string | null; currency?: string | null; units?: string | null; format?: (n: number) => string } = {}): PresentationMetric {
  if (isFiniteNumber(value)) {
    const format = opts.format ?? ((n: number) => String(n));
    return { key, label, display: format(value), value, state: "available", provenance: opts.provenance ?? "derived", sourceId: opts.sourceId ?? null, derivationId: opts.derivationId ?? null, currency: opts.currency ?? null, units: opts.units ?? null };
  }
  return { key, label, display: "Unavailable", value: null, state: "unavailable", provenance: "unavailable", sourceId: opts.sourceId ?? null, derivationId: opts.derivationId ?? null, currency: opts.currency ?? null, units: opts.units ?? null };
}

function metricNotMeaningful(key: string, label: string, opts: { currency?: string | null; units?: string | null } = {}): PresentationMetric {
  return { key, label, display: "N/M", value: null, state: "not-meaningful", provenance: "unavailable", sourceId: null, derivationId: null, currency: opts.currency ?? null, units: opts.units ?? null };
}

function cellFor(value: unknown, period: string, provenance: PresentationProvenance): PresentationStatementCell {
  if (isFiniteNumber(value)) {
    return { period, value, display: value.toLocaleString("en", { maximumFractionDigits: 0 }), state: "available", provenance };
  }
  return { period, value: null, display: "Unavailable", state: "unavailable", provenance: "unavailable" };
}

export interface BuildPresentationInput {
  packageValue: CanonicalResearchPackage;
  plan: ReportPlan;
  charts: ChartSpec[];
  tables: TableSpec[];
  generatedAt: string;
}

export function buildPresentationViewModel(input: BuildPresentationInput): PresentationViewModel {
  const pkg = input.packageValue;
  const currency = (() => {
    const value = (pkg.sourceContext.profile as unknown as Record<string, unknown>).currency;
    return typeof value === "string" && value.trim() ? value.trim() : null;
  })();
  const currentPrice = pkg.sourceContext.stockData.currentPrice;
  const fairValue = pkg.valuationResult.fairValuePerShare;
  const upside = pkg.valuationResult.upsidePct;
  const metrics: PresentationMetric[] = [];
  metrics.push(metricAvailable("currentPrice", "Current price", currentPrice, { provenance: "measured", sourceId: "SRC:QUOTE:CURRENT_PRICE", currency, units: currency ?? undefined }));
  metrics.push(metricAvailable("fairValue", "Fair value", fairValue, { provenance: "derived", derivationId: "DER:VALUATION:FAIR_VALUE", currency, units: currency ?? undefined }));
  if (isFiniteNumber(upside)) {
    metrics.push({ key: "upside", label: "Upside", display: `${(upside).toFixed(1)}%`, value: upside, state: "available", provenance: "derived", sourceId: null, derivationId: "DER:VALUATION:UPSIDE", currency: null, units: "percent" });
  } else {
    metrics.push({ key: "upside", label: "Upside", display: "Unavailable", value: null, state: "unavailable", provenance: "unavailable", sourceId: null, derivationId: null, currency: null, units: "percent" });
  }
  const rating = pkg.rating;
  if (rating === "BUY" || rating === "HOLD" || rating === "SELL" || rating === "NR") {
    metrics.push({ key: "rating", label: "Rating", display: rating, value: null, state: "available", provenance: "derived", sourceId: null, derivationId: "DER:VALUATION:RATING", currency: null, units: null });
  } else {
    metrics.push({ key: "rating", label: "Rating", display: "Unavailable", value: null, state: "unavailable", provenance: "unavailable", sourceId: null, derivationId: null, currency: null, units: null });
  }
  const roeLike = (() => {
    const rows = (pkg.sourceContext.annualFinancials ?? []) as unknown as Array<Record<string, unknown>>;
    const latest = rows[rows.length - 1];
    if (!latest) return null;
    const net = latest.netIncome;
    const equity = latest.totalEquity;
    if (isFiniteNumber(net) && isFiniteNumber(equity) && (equity as number) > 0) {
      const ratio = (net as number) / (equity as number);
      if (Math.abs(ratio) > 3) return "not-meaningful";
      return ratio;
    }
    return null;
  })();
  if (roeLike === "not-meaningful") {
    metrics.push(metricNotMeaningful("roe", "Return on equity", { units: "percent" }));
  } else if (isFiniteNumber(roeLike)) {
    metrics.push({ key: "roe", label: "Return on equity", display: `${((roeLike as number) * 100).toFixed(1)}%`, value: roeLike as number, state: "available", provenance: "derived", sourceId: null, derivationId: "DER:RATIOS:ROE", currency: null, units: "percent" });
  } else {
    metrics.push({ key: "roe", label: "Return on equity", display: "Unavailable", value: null, state: "unavailable", provenance: "unavailable", sourceId: null, derivationId: null, currency: null, units: "percent" });
  }
  const statements: PresentationStatementView[] = [];
  const annual = (pkg.sourceContext.annualFinancials ?? []) as unknown as Array<Record<string, unknown>>;
  const periods = annual.map((row) => String(row.year ?? row.period ?? "Unknown"));
  const revenueCells = annual.map((row, i) => cellFor(row.revenue ?? row.totalRevenue ?? row.totalFeeRevenue, periods[i] ?? "Unknown", "measured"));
  const netCells = annual.map((row, i) => cellFor(row.netIncome, periods[i] ?? "Unknown", "measured"));
  if (annual.length > 0) {
    statements.push({
      id: "statements-canonical-history",
      title: "Reported history",
      columns: periods,
      rows: [
        { label: "Revenue", cells: revenueCells },
        { label: "Net income", cells: netCells },
      ],
      currency,
      units: currency ?? "currency",
      state: "available",
    });
  } else {
    statements.push({
      id: "statements-canonical-history",
      title: "Reported history",
      columns: [],
      rows: [],
      currency,
      units: currency ?? "currency",
      state: "unavailable",
    });
  }
  const forecastRows = (pkg.executedForecast?.incomeStatement ?? []) as Array<{ period?: string; values?: Record<string, number | undefined> }>;
  if (forecastRows.length > 0) {
    const forecastPeriods = forecastRows.map((row) => String(row.period ?? "Unknown"));
    const forecastRevenue = forecastRows.map((row, i) => {
      const values = row.values ?? {};
      const value = values.revenue ?? values.totalRevenue;
      return cellFor(value, forecastPeriods[i] ?? "Unknown", "derived");
    });
    statements.push({
      id: "statements-canonical-forecast",
      title: "Executed canonical forecast",
      columns: forecastPeriods,
      rows: [{ label: "Revenue", cells: forecastRevenue }],
      currency,
      units: currency ?? "currency",
      state: "available",
    });
  }
  const sensitivityInput = pkg.sensitivityAnalysis ?? pkg.sensitivity ?? null;
  let sensitivity: PresentationSensitivityView;
  if (Array.isArray(sensitivityInput) && sensitivityInput.length > 0) {
    const rows = (sensitivityInput as Array<Record<string, unknown>>).slice(0, 12).map((row, index) => {
      const entries = Object.entries(row).slice(0, 6).map(([key, value]) => {
        if (isFiniteNumber(value)) return { display: String(value), value, state: "available" as const };
        return { display: "Unavailable", value: null, state: "unavailable" as const };
      });
      return { label: `Row ${index + 1}`, values: entries };
    });
    sensitivity = { state: "available", rows, provenance: "derived", note: "Precomputed canonical sensitivity. Presentation does not recompute." };
  } else if (sensitivityInput && typeof sensitivityInput === "object" && !Array.isArray(sensitivityInput)) {
    sensitivity = { state: "available", rows: [{ label: "Canonical sensitivity", values: [{ display: "See canonical package", value: null, state: "unavailable" }] }], provenance: "derived", note: "Precomputed canonical sensitivity. Presentation does not recompute." };
  } else {
    sensitivity = { state: "unavailable", rows: [], provenance: "unavailable", note: "Sensitivity is unavailable in the canonical package." };
  }
  const rawEvents = (pkg as unknown as { eventPriceMovements?: Array<Record<string, unknown>> }).eventPriceMovements ?? [];
  const events: PresentationEventView[] = rawEvents.slice(0, 8).map((event, index) => {
    const measured = event.measured === true;
    const headline = typeof event.headline === "string" && event.headline.trim() ? event.headline.trim().slice(0, 220) : `Event ${index + 1}`;
    const eventDate = typeof event.eventDate === "string" ? event.eventDate : "Unavailable";
    const immediate = isFiniteNumber(event.immediateReturnPct) ? (event.immediateReturnPct as number) : null;
    const multi = isFiniteNumber(event.multiDayReturnPct) ? (event.multiDayReturnPct as number) : null;
    if (!measured) {
      return { id: String(event.id ?? `event-${index}`), headline, eventDate, measured: false, displayLabel: "Illustrative event — not factual. No chart.", immediateReturnPct: null, multiDayReturnPct: null, provenance: "illustrative" as const };
    }
    return { id: String(event.id ?? `event-${index}`), headline, eventDate, measured: true, displayLabel: headline, immediateReturnPct: immediate, multiDayReturnPct: multi, provenance: "measured" as const };
  });
  const disclosures: string[] = [];
  if (!isFiniteNumber(currentPrice)) disclosures.push("Current price is unavailable in the canonical package.");
  if (!isFiniteNumber(fairValue)) disclosures.push("Fair value is unavailable; valuation is not publication-ready.");
  if (events.length === 0) disclosures.push("No measured event price movements are available.");
  const visualLabels: string[] = [];
  for (const chart of input.charts) {
    if (chart.provenance === "illustrative") visualLabels.push(`${chart.id}: Illustrative visual — not factual.`);
    if (chart.omissionReason) visualLabels.push(`${chart.id}: Omitted — ${chart.omissionReason}`);
  }
  for (const table of input.tables) {
    if (table.omissionReason) visualLabels.push(`${table.id}: Omitted — ${table.omissionReason}`);
  }
  const provisional = {
    version: PRESENTATION_VIEW_MODEL_VERSION as "presentation-view-model-v1",
    ticker: pkg.ticker,
    generatedAt: input.generatedAt,
    planHash: input.plan.planHash,
    currency,
    metrics,
    statements,
    sensitivity,
    events,
    charts: input.charts,
    tables: input.tables,
    disclosures,
    visualLabels,
  };
  const viewHash = stableHash(provisional, PRESENTATION_HASH_DOMAIN);
  return { ...provisional, viewHash };
}

export function getPresentationMetric(view: PresentationViewModel, key: string): PresentationMetric | null {
  return view.metrics.find((m) => m.key === key) ?? null;
}

export function presentationMetricDisplay(view: PresentationViewModel, key: string): string {
  return getPresentationMetric(view, key)?.display ?? "Unavailable";
}
