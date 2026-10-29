import { fmt, humanize, isNum, localDate, num, pct } from "./format";
import { measureText, PdfColor, PdfDocument, CONTENT_WIDTH, MARGIN_LEFT, MARGIN_RIGHT, PAGE_WIDTH, PAGE_HEIGHT, MARGIN_TOP, MARGIN_BOTTOM } from "./pdf";
import { buildXlsx, columnName, Sheet, SheetValue } from "./xlsx";
import { runAgents, renderActions, type AgentAction } from "./agents";

type AnyRecord = Record<string, any>;

export type ExportPayload = {
  ticker?: string;
  title?: string;
  generated_at?: string | null;
  company?: AnyRecord | null;
  listing?: AnyRecord | null;
  actuals?: AnyRecord | null;
  history?: AnyRecord[] | null;
  annual?: AnyRecord | null;
  forecast?: AnyRecord | null;
  dcf?: AnyRecord | null;
  sensitivity?: AnyRecord | null;
  reverse_dcf?: AnyRecord | null;
  report?: AnyRecord | null;
  rating?: string | null;
  target_price?: number | null;
  current_price?: number | null;
  upside?: number | null;
  horizon?: string | null;
  report_date?: string | null;
  peers?: string[] | null;
  assumptions?: AnyRecord | null;
  assumption_sources?: AnyRecord | null;
  data_quality?: AnyRecord | null;
  price_summary?: AnyRecord | null;
  provenance?: AnyRecord[] | null;
  validation?: AnyRecord[] | null;
  integrity?: AnyRecord | null;
  sector_profile?: AnyRecord | null;
  sector_model?: AnyRecord | null;
  scenarios?: AnyRecord | null;
  peer_comps?: AnyRecord | null;
  monte_carlo?: AnyRecord | null;
  is_synthetic?: boolean;
  data_source?: string | null;
  retrieved_at?: string | null;
  engine_version?: string | null;
  currency?: string | null;
  research_payload?: AnyRecord | null;
};

export type PdfLayoutIssue = { level: "error" | "warn" | "info"; check: string; detail: string };

const INK: PdfColor = { r: 0.05, g: 0.05, b: 0.05 };
const ACCENT: PdfColor = { r: 0.886, g: 0.137, b: 0.102 }; // Swiss red #E2231A
const POS: PdfColor = { r: 0.09, g: 0.42, b: 0.23 }; // restrained green for pass/BUY only
const NEG: PdfColor = { r: 0.75, g: 0.11, b: 0.11 };
const AMBER: PdfColor = { r: 0.71, g: 0.47, b: 0.05 };
const SERIES_DARK: PdfColor = { r: 0.3, g: 0.3, b: 0.3 }; // chart series beyond the accent
const SERIES_LIGHT: PdfColor = { r: 0.58, g: 0.58, b: 0.58 };
const RULE_GRAY = 0.82;

/** Negatives are flagged red; positives stay ink for a clean Swiss look. */
function trendColor(value?: number | null): PdfColor | undefined {
  if (!isNum(value) || value === 0) return undefined;
  return value < 0 ? NEG : undefined;
}

/**
 * Build one formatter for a whole table column so magnitudes share a single
 * unit (e.g. every cell in millions) instead of mixing 1.68B with 686.61M.
 */
function moneyColumnFormatter(values: unknown[]): (value: unknown) => string {
  const nums = values.filter(isNum) as number[];
  const maxAbs = nums.length ? Math.max(...nums.map((n) => Math.abs(n))) : 0;
  let div = 1;
  let suffix = "";
  if (maxAbs >= 1e12) { div = 1e12; suffix = "T"; }
  else if (maxAbs >= 1e9) { div = 1e9; suffix = "B"; }
  else if (maxAbs >= 1e6) { div = 1e6; suffix = "M"; }
  else if (maxAbs >= 1e3) { div = 1e3; suffix = "K"; }
  return (value: unknown) => {
    if (!isNum(value)) return "—";
    if (div === 1) return num(value, Math.abs(value) < 100 ? 1 : 0);
    const scaled = value / div;
    const digits = Math.abs(scaled) < 10 ? 2 : Math.abs(scaled) < 100 ? 1 : 0;
    return `${num(scaled, digits)}${suffix}`;
  };
}

function label(value: unknown, fallback = "—"): string {
  if (value === null || value === undefined || value === "") return fallback;
  if (isNum(value)) return num(value);
  return String(value);
}

/** Truncate to a measured width with an ellipsis, preferring word boundaries. */
function ellipsize(value: string, maxWidth: number, size: number): string {
  if (measureText(value, size, false) <= maxWidth) return value;
  const suffix = "...";
  let end = value.length;
  while (end > 0 && measureText(value.slice(0, end) + suffix, size, false) > maxWidth) end -= 1;
  const slice = value.slice(0, end);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
  return `${cut.replace(/[\s,]+$/, "")}${suffix}`;
}

function money(value: unknown, currency?: string): string {
  if (!isNum(value)) return "—";
  const formatted = Math.abs(value) < 1000 ? num(value, 2) : fmt(value);
  return `${formatted}${currency ? ` ${currency}` : ""}`;
}

function cellMoney(value: unknown): string {
  return isNum(value) ? fmt(value) : "—";
}

function pair(doc: PdfDocument, key: string, value: string, color?: PdfColor) {
  const keyWidth = measureText(key, 9, false);
  doc.row([
    { text: key, offset: 0, gray: 0.45, size: 9 },
    { text: value, offset: keyWidth + 12, align: "left", color, size: 9 },
  ], 2.5);
}

function yearOf(period: AnyRecord): string {
  const year = Number(String(period.period_end || period.year || "").slice(0, 4));
  return Number.isInteger(year) && year > 1990 && year < 2100 ? String(year) : "—";
}

// ---------------------------------------------------------------------------
// A–J section builders
// ---------------------------------------------------------------------------

function sectionA_cover(doc: PdfDocument, payload: ExportPayload, actions: AgentAction[] = []) {
  const company = payload.company || {};
  const listing = payload.listing || {};
  const currency = payload.currency || company.currency || listing.currency || "USD";
  const synthetic = payload.is_synthetic !== false;

  doc.rect(0, 0, CONTENT_WIDTH, 6, ACCENT);
  doc.space(12);
  doc.text("APEX TERMINAL  ·  EQUITY RESEARCH", { size: 8, bold: true, color: ACCENT, gap: 6 });
  doc.text(payload.title || `${payload.ticker || "APEX"} — Equity Research Note`, { size: 19, bold: true, color: INK, gap: 3 });
  doc.text(
    [payload.ticker, company.name, company.sector, company.industry].filter(Boolean).join("  ·  "),
    { size: 10, gray: 0.4, gap: 2 },
  );
  doc.text(
    `${listing.venueLabel || company.exchange || "Listing venue"}  ·  ${currency}  ·  ${payload.horizon || "12M"} outlook  ·  report date ${payload.report_date || "—"}`,
    { size: 9, gray: 0.45, gap: 2 },
  );
  doc.text(
    synthetic
      ? `Generated ${localDate(payload.generated_at || new Date().toISOString())} — deterministic client engine`
      : `Generated ${localDate(payload.generated_at || new Date().toISOString())} — market data: ${payload.data_source || "provider"} · retrieved ${localDate(payload.retrieved_at || payload.generated_at || new Date().toISOString())}`,
    {
      size: 8.5,
      gray: 0.5,
      gap: 8,
    },
  );
  doc.rule(8, RULE_GRAY);

  if (synthetic) {
    doc.callout(
      "SYNTHETIC DATA — NOT FOR INVESTMENT USE",
      "Every financial figure in this report is generated by the local deterministic engine from a synthetic fixture. " +
        "These are not company-reported financials, not audited disclosures, and must not be read as a description of any real company or used for investment decisions.",
      { accent: NEG, titleColor: NEG },
    );
  }
  renderActions(doc, actions.filter((a) => a.section === "cover"));
}

function sectionB_summary(doc: PdfDocument, payload: ExportPayload, actions: AgentAction[] = []) {
  const currency = payload.currency || "USD";
  const rating = payload.rating || "NOT RATED";
  const target = payload.target_price;
  const current = payload.current_price;
  const upside = payload.upside;
  const blocked = payload.integrity && payload.integrity.ratingAllowed === false;

  doc.heading("Investment Summary");

  const kpiHeight = 46;
  doc.hline(0, 0.2, 0.7);
  const colW = CONTENT_WIDTH / 4;
  const ratingColor = rating === "BUY" ? POS : rating === "SELL" || rating === "SSELL" ? NEG : blocked ? AMBER : INK;
  const kpis: { label: string; value: string; color?: PdfColor }[] = [
    { label: "RATING", value: String(rating).toUpperCase(), color: ratingColor },
    { label: `TARGET (${payload.horizon || "12M"})`, value: isNum(target) ? `${num(target)} ${currency}` : "—" },
    { label: "IMPLIED UPSIDE", value: isNum(upside) ? `${(upside >= 0 ? "+" : "")}${pct(upside)}` : "—", color: trendColor(upside) },
    { label: "LAST PRICE", value: isNum(current) ? `${num(current)} ${currency}` : "—" },
  ];
  kpis.forEach((kpi, index) => {
    if (index) doc.vline(index * colW, 0, kpiHeight, 0.88, 0.35);
    const x = index * colW + 12;
    doc.textAt(x, 11, kpi.label, { size: 7, bold: true, gray: 0.45 });
    doc.textAt(x, 25, kpi.value, { size: 12, bold: true, color: kpi.color ?? INK });
  });
  doc.hline(kpiHeight, 0.2, 0.7);
  doc.space(kpiHeight + 8);

  if (blocked) {
    doc.callout(
      "Rating withheld — data-integrity checks failed",
      (payload.integrity?.blockers || []).map((b: AnyRecord) => b.message).join(" ") ||
        "Integrity gates blocked the rating.",
      { accent: AMBER, titleColor: AMBER },
    );
  }

  const report = payload.report || {};
  if (report.rating_line) {
    doc.text(String(report.rating_line), { size: 9.5, bold: true, gray: 0.2, gap: 5 });
  }
  if (report.executive_summary) {
    doc.text(String(report.executive_summary), { size: 9.5, gray: 0.18, gap: 4, leading: 1.45 });
  }
  renderActions(doc, actions.filter((a) => a.section === "summary"));
}

function sectionC_company(doc: PdfDocument, payload: ExportPayload, actions: AgentAction[] = []) {
  const company = payload.company || {};
  const currency = payload.currency || "USD";
  const price = payload.price_summary || {};
  const sector = payload.sector_profile || {};

  doc.heading("Company & Industry");
  pair(doc, "Market cap", money(company.market_cap, currency));
  pair(doc, "Employees", isNum(company.fullTimeEmployees) ? Math.round(company.fullTimeEmployees).toLocaleString("en-US") : isNum(company.employees) ? Math.round(company.employees).toLocaleString("en-US") : label(company.employees));
  pair(doc, "Last close", money(price.last_close, currency));
  pair(doc, "52-week range", isNum(price.low_52w) ? `${num(price.low_52w)} - ${isNum(price.high_52w) ? num(price.high_52w) : "n/a"}` : "n/a");
  pair(doc, "Last reported period", label(company.last_data_date));

  if (report_text(company.summary)) {
    doc.space(4).text("Business overview", { size: 9.5, bold: true, gray: 0.3, gap: 3 });
    doc.text(String(company.summary), { size: 9.2, gray: 0.2, gap: 4, leading: 1.4 });
  }

  const report = payload.report || {};
  if (report.industry_context) {
    doc.space(2).text("Industry context", { size: 9.5, bold: true, gray: 0.3, gap: 3 });
    doc.text(String(report.industry_context), { size: 9.2, gray: 0.2, gap: 4, leading: 1.4 });
  }
  if (sector.watchMetrics && sector.watchMetrics.length) {
    doc.space(2).text("Sector metrics a professional note would track", { size: 9, bold: true, gray: 0.3, gap: 3 });
    sector.watchMetrics.forEach((metric: AnyRecord) => {
      const status = metric.available ? "available" : `unavailable — ${metric.note || "not disclosed"}`;
      doc.text(`•  ${metric.name}: ${status}`, { size: 8.8, indent: 8, gray: metric.available ? 0.2 : 0.4, gap: 1.5 });
    });
    doc.space(3);
  }
  renderActions(doc, actions.filter((a) => a.section === "company"));
}

function report_text(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function sectionD_financials(doc: PdfDocument, payload: ExportPayload, actions: AgentAction[] = []) {
  const annual = payload.annual || {};
  const history: AnyRecord[] = Array.isArray(payload.history) ? payload.history : [];
  const currency = payload.currency || "USD";
  const sourceNote =
    payload.is_synthetic !== false
      ? `All figures in ${currency}. Synthetic local fixture.`
      : `All figures in ${currency}. Source: ${payload.data_source || "provider"}, retrieved ${payload.retrieved_at ? localDate(payload.retrieved_at) : "recently"}.`;

  doc.heading("Financial Statements — Reported History");

  const report = payload.report || {};
  if (report.financial_performance) {
    doc.space(2).text("Financial performance", { size: 9.5, bold: true, gray: 0.3, gap: 3 });
    doc.text(String(report.financial_performance), { size: 8.8, gray: 0.2, gap: 4, leading: 1.4 });
  }

  const income: AnyRecord[] = Array.isArray(annual.income_statement) ? annual.income_statement : [];
  const balance: AnyRecord[] = Array.isArray(annual.balance_sheet) ? annual.balance_sheet : [];
  const cashflow: AnyRecord[] = Array.isArray(annual.cash_flow) ? annual.cash_flow : [];

  const incomeKeys = [
    "revenue", "cost_of_revenue", "gross_profit", "operating_expense", "operating_income",
    "ebit", "da", "ebitda", "interest_expense", "pretax_income", "tax_expense", "net_income", "diluted_eps",
  ];
  const balanceKeys = [
    "total_assets", "current_assets", "cash", "accounts_receivable", "inventory", "ppe_net",
    "goodwill", "total_non_current_assets", "total_liabilities", "current_liabilities",
    "accounts_payable", "total_debt", "equity", "shares_issued",
  ];
  const cashflowKeys = [
    "operating_cash_flow", "da_cf", "stock_based_comp", "deferred_tax", "change_in_wc",
    "capex", "dividends_paid", "share_repurchase", "net_borrowings", "free_cash_flow", "end_cash",
  ];
  const CASH_SUBTOTALS = new Set(["operating_cash_flow", "free_cash_flow"]);

  function renderStatement(title: string, rows: AnyRecord[], keys: string[], emptyMsg: string) {
    if (!rows.length) {
      doc.space(4).callout(title + " unavailable", emptyMsg, { accent: AMBER, titleColor: AMBER });
      return;
    }
    const periods = rows.slice(0, 6);
    const presentKeys = keys.filter((key) => periods.some((row) => isNum(row.items?.[key])));
    if (!presentKeys.length) return;
    doc.space(6).text(title, { size: 9.5, bold: true, gray: 0.3, gap: 3 });
    const labelWidth = 150;
    const periodCount = periods.length;
    const periodWidth = (CONTENT_WIDTH - labelWidth) / periodCount;
    const cols: any[] = [
      {
        key: "line",
        label: "Line item",
        x: 0,
        format: (r: AnyRecord) => String(r.label),
        bold: (r: AnyRecord) => Boolean(r.subtotal),
      },
    ];
    periods.forEach((period, index) => {
      const rightEdge = labelWidth + (index + 1) * periodWidth;
      cols.push({
        key: `p${index}`,
        label: yearOf(period),
        x: rightEdge,
        align: "right" as const,
        format: (r: AnyRecord) => cellMoney(r.values[index]),
        bold: (r: AnyRecord) => Boolean(r.subtotal),
      });
    });
    const tableRows = presentKeys.map((key) => ({
      label: humanize(key),
      values: periods.map((period) => period.items?.[key] ?? null),
      subtotal: CASH_SUBTOTALS.has(key),
    }));
    doc.dataTable(cols, tableRows, { fontSize: 7.5, headerFontSize: 7, sourceNote });
  }

  renderStatement("Income statement", income, incomeKeys, "The dataset carries no income statement for this company.");
  renderStatement("Balance sheet", balance, balanceKeys, "The dataset carries no balance sheet for this company.");
  renderStatement("Cash-flow statement", cashflow, cashflowKeys, "The dataset carries no cash-flow statement for this company. Historical free cash flow, operating cash flow and capex are reported as null and are never estimated.");

  if (history.length) {
    doc.space(6).text("Key ratios - growth & margins", { size: 9.5, bold: true, gray: 0.3, gap: 3 });
    const fcfFmt = moneyColumnFormatter(history.map((r) => r.fcf));
    const ratioCols = [
      { key: "period", label: "Period", x: 0, format: (r: AnyRecord) => yearOf(r), bold: () => true },
      { key: "revenue_growth", label: "Rev growth", x: 80, align: "right" as const, format: (r: AnyRecord) => pct(r.revenue_growth), color: (r: AnyRecord) => trendColor(r.revenue_growth) },
      { key: "gross_margin", label: "Gross margin", x: 165, align: "right" as const, format: (r: AnyRecord) => pct(r.gross_margin) },
      { key: "operating_margin", label: "Op margin", x: 255, align: "right" as const, format: (r: AnyRecord) => pct(r.operating_margin) },
      { key: "net_margin", label: "Net margin", x: 330, align: "right" as const, format: (r: AnyRecord) => pct(r.net_margin) },
      { key: "ebitda_margin", label: "EBITDA margin", x: 415, align: "right" as const, format: (r: AnyRecord) => (isNum(r.ebitda) && isNum(r.revenue) && r.revenue ? pct(r.ebitda / r.revenue) : "—") },
      { key: "roic", label: "ROIC", x: 450, align: "right" as const, format: (r: AnyRecord) => pct(r.roic) },
      { key: "fcf", label: "FCF", x: CONTENT_WIDTH, align: "right" as const, format: (r: AnyRecord) => fcfFmt(r.fcf) },
    ];
    doc.dataTable(ratioCols, history, { fontSize: 8, headerFontSize: 7, sourceNote: "Derived from reported statements. Nulls preserved where data is missing." });

    doc.space(6).text("Key ratios - returns, leverage & per-share", { size: 9.5, bold: true, gray: 0.3, gap: 3 });
    const ndFmt = moneyColumnFormatter(history.map((r) => r.net_debt));
    const creditCols = [
      { key: "period", label: "Period", x: 0, format: (r: AnyRecord) => yearOf(r), bold: () => true },
      { key: "roe", label: "ROE", x: 80, align: "right" as const, format: (r: AnyRecord) => pct(r.roe), color: (r: AnyRecord) => trendColor(r.roe) },
      { key: "eps_diluted", label: "EPS", x: 145, align: "right" as const, format: (r: AnyRecord) => (isNum(r.eps_diluted) ? num(r.eps_diluted, 2) : "—"), color: (r: AnyRecord) => trendColor(r.eps_diluted) },
      { key: "current_ratio", label: "Current ratio", x: 240, align: "right" as const, format: (r: AnyRecord) => (isNum(r.current_ratio) ? num(r.current_ratio, 2) : "—") },
      { key: "net_debt", label: "Net debt", x: 330, align: "right" as const, format: (r: AnyRecord) => ndFmt(r.net_debt) },
      { key: "nd_ebitda", label: "Net debt/EBITDA", x: 415, align: "right" as const, format: (r: AnyRecord) => (isNum(r.net_debt) && isNum(r.ebitda) && r.ebitda ? `${num(r.net_debt / r.ebitda, 1)}x` : "—") },
      { key: "book_value_per_share", label: "Book value/sh", x: CONTENT_WIDTH, align: "right" as const, format: (r: AnyRecord) => (isNum(r.book_value_per_share) ? num(r.book_value_per_share, 2) : "—"), color: (r: AnyRecord) => trendColor(r.book_value_per_share) },
    ];
    doc.dataTable(creditCols, history, { fontSize: 8, headerFontSize: 7, sourceNote: "Returns, leverage and per-share ratios derived from reported statements. Nulls preserved where data is missing." });
  }

  // Trend chart across reported history.
  if (history.length >= 2) {
    const labels = history.slice().reverse().map((row) => yearOf(row));
    const revenueSeries = history.slice().reverse().map((row) => (isNum(row.revenue) ? row.revenue : null));
    const ebitdaSeries = history.slice().reverse().map((row) => (isNum(row.ebitda) ? row.ebitda : null));
    doc.space(4);
    doc.drawBars({
      labels,
      series: [
        { name: "Revenue", color: ACCENT, values: revenueSeries },
        { name: "EBITDA", color: SERIES_DARK, values: ebitdaSeries },
      ],
      height: 110,
      sourceNote: `Reported revenue and EBITDA (${payload.currency || "USD"}).`,
    });
  }
  renderActions(doc, actions.filter((a) => a.section === "financials"));
}

function sectionE_forecast(doc: PdfDocument, payload: ExportPayload, actions: AgentAction[] = []) {
  const forecast = payload.forecast || null;
  const periods: AnyRecord[] = Array.isArray(forecast?.periods) ? forecast.periods : [];
  const assumptions = payload.assumptions || forecast?.assumptions || {};
  const currency = payload.currency || "USD";

  doc.heading("Base-Case Forecast");
  if (!periods.length) {
    doc.text("No forecast horizon is available in this build.", { size: 9.5, gray: 0.3 });
    return;
  }

  const revFmt = moneyColumnFormatter(periods.map((r) => r.revenue));
  const ebitdaFmt = moneyColumnFormatter(periods.map((r) => r.ebitda));
  const ebitFmt = moneyColumnFormatter(periods.map((r) => r.ebit));
  const niFmt = moneyColumnFormatter(periods.map((r) => r.net_income));
  const fcfFmt = moneyColumnFormatter(periods.map((r) => r.free_cash_flow));
  const fcCols = [
    { key: "year", label: "Year", x: 0, format: (r: AnyRecord) => `Y${isNum(r.year) ? Math.round(r.year) : label(r.year)}`, bold: () => true },
    { key: "revenue", label: "Revenue", x: 80, align: "right" as const, format: (r: AnyRecord) => revFmt(r.revenue) },
    { key: "ebitda", label: "EBITDA", x: 160, align: "right" as const, format: (r: AnyRecord) => ebitdaFmt(r.ebitda) },
    { key: "ebit", label: "EBIT", x: 230, align: "right" as const, format: (r: AnyRecord) => ebitFmt(r.ebit) },
    { key: "net_income", label: "Net income", x: 310, align: "right" as const, format: (r: AnyRecord) => niFmt(r.net_income), color: (r: AnyRecord) => trendColor(r.net_income) },
    { key: "free_cash_flow", label: "FCF", x: 400, align: "right" as const, format: (r: AnyRecord) => fcfFmt(r.free_cash_flow), color: (r: AnyRecord) => trendColor(r.free_cash_flow) },
    { key: "shares", label: "Shares", x: CONTENT_WIDTH, align: "right" as const, format: (r: AnyRecord) => (isNum(r.shares) ? fmt(r.shares) : "—") },
  ];
  doc.dataTable(fcCols, periods, { fontSize: 8, headerFontSize: 7, sourceNote: `Forecast figures in ${currency}. Deterministic model output.` });

  const summary = forecast?.summary || {};
  doc.space(5);
  pair(doc, "Revenue CAGR", pct(summary.revenue_cagr), trendColor(summary.revenue_cagr));
  pair(doc, "Final revenue", money(summary.final_revenue, currency));
  pair(doc, "Final EBITDA", money(summary.final_ebitda, currency));
  pair(doc, "Final free cash flow", money(summary.final_fcf, currency));
  pair(doc, "Balance-sheet identity", summary.balance_ok ? "Balanced in every year" : "Mismatch", summary.balance_ok ? POS : NEG);

  doc.space(4).text("Forecast drivers (documented assumptions)", { size: 9, bold: true, gray: 0.3, gap: 3 });
  Object.entries(assumptions as AnyRecord).forEach(([key, value]) => {
    if (!isNum(value)) return;
    pair(doc, humanize(key), pct(value, 2));
  });
  const driverSources = payload.assumption_sources || forecast?.assumption_sources || null;
  if (driverSources) {
    const derivedCount = Object.values(driverSources as AnyRecord).filter((source) => String(source).startsWith("Derived")).length;
    doc.text(
      derivedCount
        ? `${derivedCount} of ${Object.keys(driverSources as AnyRecord).length} drivers are derived from reported history; the remainder are documented engine defaults or user inputs (per-driver sources in the provenance table).`
        : "Drivers are documented engine defaults or user inputs (per-driver sources in the provenance table).",
      { size: 8, gray: 0.35, gap: 3 },
    );
  }

  // Forecast revenue/EBITDA bar chart.
  const labels = periods.map((period) => `Y${isNum(period.year) ? Math.round(period.year) : label(period.year)}`);
  doc.space(4);
  doc.drawBars({
    labels,
      series: [
        { name: "Revenue", color: ACCENT, values: periods.map((p) => (isNum(p.revenue) ? p.revenue : null)) },
        { name: "EBITDA", color: SERIES_DARK, values: periods.map((p) => (isNum(p.ebitda) ? p.ebitda : null)) },
        { name: "FCF", color: SERIES_LIGHT, values: periods.map((p) => (isNum(p.free_cash_flow) ? p.free_cash_flow : null)) },
      ],
    height: 115,
    sourceNote: `Forecast revenue, EBITDA and free cash flow (${currency}).`,
  });
  renderActions(doc, actions.filter((a) => a.section === "forecast"));
}

function sectionF_valuation(doc: PdfDocument, payload: ExportPayload, actions: AgentAction[] = []) {
  const dcf = payload.dcf || null;
  const sensitivity = payload.sensitivity || null;
  const reverse = payload.reverse_dcf || null;
  const currency = payload.currency || "USD";

  doc.heading("Valuation — Discounted Cash Flow");

  const narrative = payload.report || {};
  if (narrative.valuation_view) {
    doc.space(2).text("Valuation view", { size: 9.5, bold: true, gray: 0.3, gap: 3 });
    doc.text(String(narrative.valuation_view), { size: 8.8, gray: 0.2, gap: 4, leading: 1.4 });
  }

  if (!dcf || dcf.error) {
    doc.callout("No valid DCF output", String(dcf?.error || "The discounted-cash-flow model did not produce a value."), { accent: AMBER, titleColor: AMBER });
    return;
  }

  doc.space(2).text("WACC build-up (CAPM, documented defaults)", { size: 9, bold: true, gray: 0.3, gap: 3 });
  const comps = dcf.wacc_components || {};
  const waccRows = [
    { component: "Risk-free rate", value: pct(comps.risk_free, 2) },
    { component: "Equity beta", value: num(comps.beta, 2) },
    { component: "Market risk premium", value: pct(comps.market_premium, 2) },
    { component: "Cost of equity (Rf + beta x MRP)", value: pct(comps.cost_of_equity, 2) },
    { component: "Pre-tax cost of debt", value: pct(comps.cost_of_debt, 2) },
    { component: "Tax rate", value: pct(comps.tax_rate, 2) },
    { component: "After-tax cost of debt", value: pct(comps.after_tax_cost_of_debt, 2) },
    { component: "Equity / debt weight", value: `${pct(comps.equity_weight, 0)} / ${pct(comps.debt_weight, 0)}` },
    { component: "WACC applied", value: pct(dcf.wacc, 2), bold: true, color: INK },
  ];
  doc.dataTable([
    { key: "component", label: "Component", x: 0, format: (r: AnyRecord) => r.component, bold: (r: AnyRecord) => r.bold },
    { key: "value", label: "Value", x: 300, align: "right" as const, format: (r: AnyRecord) => r.value, color: (r: AnyRecord) => r.color },
  ], waccRows, { fontSize: 8.5, headerFontSize: 7 });

  doc.space(4).text("Free cash flows and discounting", { size: 9, bold: true, gray: 0.3, gap: 3 });
  const forecast = payload.forecast || null;
  const periods: AnyRecord[] = Array.isArray(forecast?.periods) ? forecast.periods : [];
  const flows: number[] = Array.isArray(forecast?.periods) ? forecast.periods.map((p: AnyRecord) => p.fcf) : [];
  if (flows.length) {
    const pvFlows = flows.map((f) => (isNum(f) ? f / Math.pow(1 + dcf.wacc, flows.indexOf(f) + 1) : null));
    const discFcfFmt = moneyColumnFormatter(flows);
    const discPvFmt = moneyColumnFormatter(pvFlows);
    const discCols = [
      { key: "year", label: "Year", x: 0, format: (_r: AnyRecord, i: number) => `Y${i + 1}`, bold: () => true },
      { key: "fcf", label: "Free cash flow", x: 90, align: "right" as const, format: (_r: AnyRecord, i: number) => discFcfFmt(flows[i]), color: (_r: AnyRecord, i: number) => trendColor(flows[i]) },
      { key: "df", label: "Discount factor", x: 210, align: "right" as const, format: (_r: AnyRecord, i: number) => num(1 / Math.pow(1 + dcf.wacc, i + 1), 4) },
      { key: "pv", label: "Present value", x: CONTENT_WIDTH, align: "right" as const, format: (_r: AnyRecord, i: number) => discPvFmt(pvFlows[i]) },
    ];
    doc.dataTable(discCols, flows.map((f, i) => ({ fcf: f, i })), { fontSize: 8, headerFontSize: 7 });
  }

  doc.space(4).text("Enterprise-to-equity bridge", { size: 9, bold: true, gray: 0.3, gap: 3 });
  pair(doc, "PV of explicit cash flows", money(dcf.pv_cash_flows, currency));
  pair(doc, "PV of terminal value", money(dcf.pv_terminal_value, currency));
  const tvShare = isNum(dcf.enterprise_value) && dcf.enterprise_value ? dcf.pv_terminal_value / dcf.enterprise_value : null;
  pair(doc, "Terminal value share of EV", pct(tvShare), tvShare !== null && tvShare > 0.6 ? AMBER : undefined);
  pair(doc, "Enterprise value", money(dcf.enterprise_value, currency), INK);
  pair(doc, `Net ${isNum(dcf.net_debt) && dcf.net_debt >= 0 ? "debt" : "cash"}`, money(Math.abs(dcf.net_debt ?? 0), currency));
  pair(doc, "Equity value", money(dcf.equity_value, currency), INK);
  pair(doc, "Shares outstanding", isNum(dcf.shares) ? fmt(dcf.shares) : "—");
  pair(doc, "Value per share", isNum(dcf.value_per_share) ? `${num(dcf.value_per_share)} ${currency}` : "—", INK);
  const finalEbitda = forecast?.summary?.final_ebitda;
  const exitMultiple = isNum(dcf.enterprise_value) && isNum(finalEbitda) && finalEbitda ? dcf.enterprise_value / finalEbitda : null;
  pair(doc, "Implied exit multiple on final EBITDA", exitMultiple !== null ? `${num(exitMultiple, 1)}x` : "—");
  if (isNum(payload.current_price) && payload.current_price > 0 && isNum(dcf.value_per_share)) {
    const implied = dcf.value_per_share / payload.current_price - 1;
    pair(doc, "Implied upside vs last price", pct(implied), trendColor(implied));
  }
  (dcf.warnings || []).forEach((warning: string) => doc.text(`! ${warning}`, { size: 8.5, gray: 0.35, indent: 6, gap: 2 }));

  // Sensitivity grid.
  const waccValues: number[] = Array.isArray(sensitivity?.wacc_values) ? sensitivity.wacc_values : [];
  const terminalValues: number[] = Array.isArray(sensitivity?.terminal_values) ? sensitivity.terminal_values : [];
  const table: any[][] = Array.isArray(sensitivity?.table) ? sensitivity.table : [];
  if (sensitivity && !sensitivity.error && waccValues.length && terminalValues.length && table.length) {
    doc.space(6).text(
      sensitivity.mode === "multiple" ? "Sensitivity — WACC vs exit multiple" : "Sensitivity — WACC vs terminal growth",
      { size: 9, bold: true, gray: 0.3, gap: 3 },
    );
    const firstCol = 70;
    const colWidth = (CONTENT_WIDTH - firstCol) / terminalValues.length;
    const sensCols = [
      { key: "wacc", label: "WACC", x: 0, format: (r: AnyRecord) => pct(r.wacc, 1) },
      ...terminalValues.map((value, index) => ({
        key: `t${index}`,
        label: sensitivity.mode === "multiple" ? `${num(value, 1)}x` : pct(value, 1),
        x: firstCol + colWidth * (index + 1),
        align: "right" as const,
        format: (r: AnyRecord) => (isNum(r[`t${index}`]) ? num(r[`t${index}`], 2) : "—"),
      })),
    ];
    const sensRows = waccValues.map((waccValue, rowIndex) => {
      const row: AnyRecord = { wacc: waccValue };
      terminalValues.forEach((_, columnIndex) => {
        row[`t${columnIndex}`] = table[rowIndex]?.[columnIndex];
      });
      return row;
    });
    doc.dataTable(sensCols, sensRows, { fontSize: 8, headerFontSize: 7, sourceNote: `Value per share (${currency}). Sensitivity maps model response to assumptions; it does not remove uncertainty.` });
  }

  const scenarios = payload.scenarios;
  if (scenarios && typeof scenarios === "object") {
    const keys = ["bull", "base", "bear"].filter((k) => scenarios[k]);
    if (keys.length) {
      doc.space(6).text("Scenario comparison", { size: 9, bold: true, gray: 0.3, gap: 3 });
      const scenCols = [
        { key: "scenario", label: "Scenario", x: 0, format: (r: AnyRecord) => String(r.scenario) },
        { key: "growth", label: "Rev growth", x: 90, align: "right" as const, format: (r: AnyRecord) => isNum(r.growth) ? pct(r.growth, 1) : "—" },
        { key: "margin", label: "Gross margin", x: 170, align: "right" as const, format: (r: AnyRecord) => isNum(r.margin) ? pct(r.margin, 1) : "—" },
        { key: "value", label: `Value/share (${currency})`, x: 260, align: "right" as const, format: (r: AnyRecord) => isNum(r.value) ? num(r.value, 2) : "—" },
        { key: "ev", label: `EV (${currency})`, x: 360, align: "right" as const, format: (r: AnyRecord) => isNum(r.ev) ? fmt(r.ev) : "—" },
      ];
      const scenRows = keys.map((k) => {
        const s = scenarios[k];
        return {
          scenario: s?.label || k,
          growth: s?.assumptions?.revenue_growth,
          margin: s?.assumptions?.gross_margin,
          value: s?.dcf_value_per_share,
          ev: s?.enterprise_value,
        };
      });
      doc.dataTable(scenCols, scenRows, { fontSize: 8, headerFontSize: 7, sourceNote: "Scenarios reflect distinct driver assumptions on revenue growth, margins, capex and tax; they are not price adjustments." });
    }
  }

  if (reverse && !reverse.error && isNum(reverse.implied_wacc)) {
    doc.space(4).callout(
      "Reverse DCF at the current market price",
      `At a market price of ${num(reverse.current_price)} ${currency} the implied WACC is ${pct(reverse.implied_wacc, 2)}, ` +
        `versus our stated ${pct(dcf.wacc, 2)}. The market discounts these cash flows more steeply than our cost of capital.`,
      { accent: ACCENT },
    );
  }

  const report = payload.report || {};
  if (report.scenario_analysis) {
    doc.space(4).text("Scenario analysis", { size: 9, bold: true, gray: 0.3, gap: 3 });
    const scen = report.scenario_analysis;
    doc.text(`Bull: ${scen.bull || "n/a"}`, { size: 8.8, gray: 0.2, indent: 6, gap: 2 });
    doc.text(`Base: ${scen.base || "n/a"}`, { size: 8.8, gray: 0.2, indent: 6, gap: 2 });
    doc.text(`Bear: ${scen.bear || "n/a"}`, { size: 8.8, gray: 0.2, indent: 6, gap: 2 });
  }
  renderActions(doc, actions.filter((a) => a.section === "valuation"));
}

function sectionG_risks(doc: PdfDocument, payload: ExportPayload, actions: AgentAction[] = []) {
  const report = payload.report || {};

  doc.heading("Risks & Catalysts");

  const strengths: string[] = Array.isArray(report.strengths) ? report.strengths : [];
  if (strengths.length) {
    doc.space(2).text("Strengths", { size: 9.5, bold: true, gray: 0.3, gap: 3 });
    strengths.forEach((item) => doc.text(`•  ${String(item)}`, { size: 9, indent: 8, gray: 0.2, gap: 2 }));
  }

  const risks: AnyRecord[] = Array.isArray(report.risks) ? report.risks : [];
  if (risks.length) {
    doc.space(4).text("Risks", { size: 9.5, bold: true, gray: 0.3, gap: 3 });
    risks.forEach((risk) => {
      if (typeof risk === "string") {
        doc.text(`•  ${risk}`, { size: 9, indent: 8, gray: 0.2, gap: 2 });
        return;
      }
      doc.text(risk.title || "Risk", { size: 9, bold: true, indent: 8, color: NEG, gap: 1.5 });
      if (risk.exposure) doc.text(`Exposure: ${risk.exposure}`, { size: 8.7, indent: 14, gray: 0.2, gap: 1 });
      if (risk.impact) doc.text(`Impact: ${risk.impact}`, { size: 8.7, indent: 14, gray: 0.2, gap: 1 });
      if (risk.monitoring_metric) doc.text(`Monitoring metric: ${risk.monitoring_metric}`, { size: 8.7, indent: 14, gray: 0.35, gap: 1 });
      if (risk.scenario) doc.text(`Scenario: ${risk.scenario}`, { size: 8.7, indent: 14, gray: 0.35, gap: 1 });
      if (risk.basis) doc.text(`Basis: ${risk.basis}`, { size: 8, indent: 14, gray: 0.45, gap: 3 });
    });
  }

  const catalysts: AnyRecord[] = Array.isArray(report.catalysts) ? report.catalysts : [];
  if (catalysts.length) {
    doc.space(4).text("Catalysts", { size: 9.5, bold: true, gray: 0.3, gap: 3 });
    catalysts.forEach((catalyst) => {
      if (typeof catalyst === "string") {
        doc.text(`•  ${catalyst}`, { size: 9, indent: 8, gray: 0.2, gap: 2 });
        return;
      }
      doc.text(catalyst.title || "Catalyst", { size: 9, bold: true, indent: 8, color: POS, gap: 1.5 });
      if (catalyst.event) doc.text(`Event: ${catalyst.event}`, { size: 8.7, indent: 14, gray: 0.2, gap: 1 });
      if (catalyst.timing) doc.text(`Timing: ${catalyst.timing}`, { size: 8.7, indent: 14, gray: 0.2, gap: 1 });
      if (catalyst.grounding) doc.text(`Grounding: ${catalyst.grounding}`, { size: 8.7, indent: 14, gray: 0.35, gap: 3 });
    });
  }
  renderActions(doc, actions.filter((a) => a.section === "risks"));
}

function sectionH_modelQuality(doc: PdfDocument, payload: ExportPayload, actions: AgentAction[] = []) {
  const report = payload.report || {};
  const forecast = payload.forecast || null;
  const dcf = payload.dcf || null;

  doc.heading("Model Quality & Integrity Review");

  const conviction = report.conviction;
  if (conviction) {
    doc.callout(
      `Conviction: ${String(conviction.level || "").toUpperCase()}`,
      String(conviction.basis || ""),
      { accent: conviction.level === "low" ? AMBER : ACCENT },
    );
  }

  if (report.model_quality) {
    doc.space(2).text(String(report.model_quality), { size: 9, gray: 0.2, gap: 4, leading: 1.4 });
  }

  doc.space(2).text("Automated checks", { size: 9, bold: true, gray: 0.3, gap: 3 });
  pair(doc, "Balance-sheet identity", forecast?.summary?.balance_ok ? "Pass" : "Check residual", forecast?.summary?.balance_ok ? POS : AMBER);
  if (!forecast?.summary?.balance_ok) {
    pair(doc, "Largest residual", label(forecast?.summary?.max_balance_check));
  }
  pair(doc, "DCF produced a value", dcf && !dcf.error ? "Yes" : "No", dcf && !dcf.error ? POS : NEG);
  pair(doc, "Valuation warnings", dcf?.warnings?.length ? String(dcf.warnings.length) : "0", dcf?.warnings?.length ? AMBER : undefined);

  const validation: AnyRecord[] = Array.isArray(payload.validation) ? payload.validation : [];
  const errors = validation.filter((v) => v.severity === "error" || v.blocking);
  const warns = validation.filter((v) => v.severity === "warn" && !v.blocking);
  pair(doc, "Integrity errors (blocking)", String(errors.length), errors.length ? NEG : POS);
  pair(doc, "Integrity warnings", String(warns.length), warns.length ? AMBER : undefined);
  if (validation.length) {
    doc.space(2).text("Validation detail", { size: 8.5, bold: true, gray: 0.35, gap: 2 });
    validation.forEach((issue) => {
      const tag = issue.severity === "error" || issue.blocking ? "ERROR" : issue.severity === "warn" ? "WARN" : "INFO";
      const color = issue.severity === "error" || issue.blocking ? NEG : issue.severity === "warn" ? AMBER : undefined;
      doc.text(`[${tag}] ${issue.code}: ${issue.message}`, { size: 8, indent: 6, color, gray: color ? undefined : 0.4, gap: 1.5 });
    });
  }
  renderActions(doc, actions.filter((a) => a.section === "modelQuality"));
}

function sectionI_sources(doc: PdfDocument, payload: ExportPayload, actions: AgentAction[] = []) {
  doc.heading("Sources & Methodology");

  const provenance: AnyRecord[] = Array.isArray(payload.provenance) ? payload.provenance : [];
  if (provenance.length) {
    doc.space(2).text("Data sources (numbered)", { size: 9, bold: true, gray: 0.3, gap: 3 });
    const srcCols = [
      { key: "n", label: "#", x: 0, format: (_r: AnyRecord, i: number) => String(i + 1) },
      { key: "metric", label: "Metric", x: 22, format: (r: AnyRecord) => String(r.metric) },
      { key: "value", label: "Value", x: 150, align: "right" as const, format: (r: AnyRecord) => String(r.value_label) },
      { key: "period", label: "Period", x: 215, format: (r: AnyRecord) => label(r.period) },
      { key: "status", label: "Status", x: 295, format: (r: AnyRecord) => String(r.status) },
      { key: "source", label: "Source", x: 345, format: (r: AnyRecord) => ellipsize(String(r.source), CONTENT_WIDTH - 345, 7) },
    ];
    doc.dataTable(srcCols, provenance, { fontSize: 7, headerFontSize: 6.5, rowHeight: 13 });
  }

  doc.space(5).text("Methodology", { size: 9, bold: true, gray: 0.3, gap: 3 });
  doc.text(
    "Forecast: a deterministic three-statement model driven by the documented assumptions in the forecast section. " +
      "Valuation: unlevered free cash flows discounted at a CAPM-built WACC, with a Gordon-growth or exit-multiple terminal value. " +
      "Rating: a mechanical band on model upside (BUY ≥ +10%, HOLD within ±10%, SELL below −10%), withheld entirely when integrity gates fail. " +
      "Every figure is a model output; the deterministic engine writes the narrative from those outputs and never invents numbers.",
    { size: 8.8, gray: 0.2, gap: 4, leading: 1.4 },
  );

  const peers: string[] = Array.isArray(payload.peers) ? payload.peers : [];
  pair(doc, "Peer set", peers.length ? peers.join(", ") : "None supplied (comparables omitted)");
  renderActions(doc, actions.filter((a) => a.section === "sources"));
}

function sectionJ_conclusion(doc: PdfDocument, payload: ExportPayload, actions: AgentAction[] = []) {
  const report = payload.report || {};

  doc.heading("Conclusion");
  if (report.conclusion) {
    doc.text(String(report.conclusion), { size: 9.5, gray: 0.18, gap: 5, leading: 1.45 });
  }
  if (report.investment_thesis) {
    doc.space(2).text("Investment thesis", { size: 9, bold: true, gray: 0.3, gap: 3 });
    doc.text(String(report.investment_thesis), { size: 9, gray: 0.2, gap: 3, leading: 1.4 });
  }
  const drivers: string[] = Array.isArray(report.thesis_drivers) ? report.thesis_drivers : [];
  if (drivers.length) {
    doc.space(2).text("Thesis drivers", { size: 9, bold: true, gray: 0.3, gap: 3 });
    drivers.forEach((driver) => doc.text(`•  ${driver}`, { size: 8.8, indent: 8, gray: 0.2, gap: 2 }));
  }

  doc.space(10);
  doc.rule(4, RULE_GRAY);
  doc.text("Disclaimer", { size: 8.5, bold: true, gray: 0.45, gap: 2 });
  doc.text(String(report.disclaimer || "Generated by the APEX deterministic engine. Research software, not investment advice."), {
    size: 7.5,
    gray: 0.5,
    gap: 4,
  });

  renderActions(doc, actions.filter((a) => a.section === "conclusion"));
}

function buildReportDocument(payload: ExportPayload) {
  const doc = new PdfDocument();
  const coordinator = runAgents(payload);
  const actions = coordinator.actions;
  const title = payload?.title || `${payload?.ticker || "APEX"} — Equity Research Note`;
  const footerLeft = [payload?.ticker, payload?.company?.name, "APEX Terminal"].filter(Boolean).join("  ·  ");
  doc.setRunningHeader([payload?.ticker, payload?.company?.name].filter(Boolean).join(" · "));

  sectionA_cover(doc, payload, actions);
  sectionB_summary(doc, payload, actions);
  sectionC_company(doc, payload, actions);
  sectionD_financials(doc, payload, actions);
  sectionE_forecast(doc, payload, actions);
  sectionF_valuation(doc, payload, actions);
  sectionG_risks(doc, payload, actions);
  sectionH_modelQuality(doc, payload, actions);
  sectionI_sources(doc, payload, actions);
  sectionJ_conclusion(doc, payload, actions);

  return { doc, title, footerLeft };
}

export function buildResearchPdf(payload: ExportPayload): Blob {
  const { doc, title, footerLeft } = buildReportDocument(payload);
  return new Blob([doc.build(title, footerLeft)], { type: "application/pdf" });
}

export function buildResearchPdfMeta(payload: ExportPayload): { blob: Blob; pages: number; size: number; bytes: Uint8Array } {
  const { doc, title, footerLeft } = buildReportDocument(payload);
  const bytes = doc.build(title, footerLeft);
  return { blob: new Blob([bytes], { type: "application/pdf" }), pages: doc.pageCount, size: bytes.length, bytes };
}

// ---------------------------------------------------------------------------
// Programmatic PDF layout inspection (independent of visual rendering)
// ---------------------------------------------------------------------------

const REQUIRED_SECTIONS = [
  "Investment Summary",
  "Company & Industry",
  "Financial Statements",
  "Base-Case Forecast",
  "Valuation",
  "Risks & Catalysts",
  "Model Quality",
  "Sources & Methodology",
  "Conclusion",
];

// Malformed render artifacts. "null" is only treated as malformed when it is a
// bare value token (its own text op or surrounded by non-letters with no
// following word) — never when it appears mid-sentence in prose.
const MALFORMED_TEXT = /NaN|Infinity|undefined|\[object Object\]|(?<![A-Za-z])null(?![A-Za-z]|\s+[A-Za-z])/;
const LONG_DECIMAL = /\b\d{2,}\.\d{5,}\b/;

export function inspectPdfBytes(bytes: Uint8Array): PdfLayoutIssue[] {
  const issues: PdfLayoutIssue[] = [];
  let body = "";
  for (let i = 0; i < bytes.length; i += 1) body += String.fromCharCode(bytes[i]);

  const streams = body.match(/stream\n([\s\S]*?)\nendstream/g) || [];
  const allText: string[] = [];
  let headingCount = 0;

  streams.forEach((streamBlock, pageIndex) => {
    const content = streamBlock.replace(/^stream\n/, "").replace(/\nendstream$/, "");
    const lines = content.split("\n");
    let lastTextWasHeading = false;
    let textOpsOnPage = 0;

    lines.forEach((line) => {
      const match = line.match(/\/(F\d)\s+([\d.]+)\s+Tf.*?1 0 0 1\s+([\d.-]+)\s+([\d.-]+)\s+Tm\s+\((.*)\)\s+Tj/);
      if (!match) return;
      const font = match[1];
      const size = Number(match[2]);
      const x = Number(match[3]);
      const y = Number(match[4]);
      const rawText = match[5].replace(/\\([()\\])/g, "$1");
      allText.push(rawText);
      textOpsOnPage += 1;
      lastTextWasHeading = font === "F2" && size >= 11 && size <= 13;
      if (lastTextWasHeading) headingCount += 1;

      // Bounds: text left edge inside margins; baseline inside vertical content band.
      // Header (top margin) and footer (bottom margin) text is exempt from the
      // content-band y check — it is intentionally placed in the margin strip.
      const isRunningChrome = y < MARGIN_BOTTOM - 20 || y > PAGE_HEIGHT - MARGIN_TOP + 2;
      const textWidth = measureText(rawText, size, font === "F2");
      if (x < MARGIN_LEFT - 2 || x + textWidth > PAGE_WIDTH - MARGIN_RIGHT + 2) {
        issues.push({
          level: "error",
          check: "layout.bounds.x",
          detail: `Page ${pageIndex + 1}: text "${rawText.slice(0, 40)}" at x=${x.toFixed(1)} (width ${textWidth.toFixed(1)}) escapes the ${MARGIN_LEFT}–${(PAGE_WIDTH - MARGIN_RIGHT).toFixed(1)} content band.`,
        });
      }
      if (isRunningChrome) {
        // Header/footer y is outside the content band by design; only flag if it
        // goes past the physical page edge.
        if (y < 10 || y > PAGE_HEIGHT - 10) {
          issues.push({
            level: "error",
            check: "layout.bounds.y",
            detail: `Page ${pageIndex + 1}: running-header/footer text "${rawText.slice(0, 40)}" baseline y=${y.toFixed(1)} is off the physical page.`,
          });
        }
      }
      if (MALFORMED_TEXT.test(rawText)) {
        issues.push({
          level: "error",
          check: "layout.malformed",
          detail: `Page ${pageIndex + 1}: malformed value "${rawText.slice(0, 60)}" rendered into the PDF.`,
        });
      }
      if (LONG_DECIMAL.test(rawText)) {
        issues.push({
          level: "warn",
          check: "layout.precision",
          detail: `Page ${pageIndex + 1}: over-precise number "${rawText.slice(0, 60)}" (should be rounded for display).`,
        });
      }
    });

    // Orphan heading: last text op on the page is a section heading.
    if (textOpsOnPage > 0 && lastTextWasHeading) {
      issues.push({
        level: "warn",
        check: "layout.orphan_heading",
        detail: `Page ${pageIndex + 1} ends with a heading and no following content.`,
      });
    }
  });

  const joined = allText.join("\n");
  REQUIRED_SECTIONS.forEach((section) => {
    if (!joined.includes(section)) {
      issues.push({ level: "error", check: "content.section_missing", detail: `Required section "${section}" not found in the PDF.` });
    }
  });

  if (headingCount === 0) {
    issues.push({ level: "error", check: "content.empty", detail: "No section headings were rendered." });
  }

  if (!issues.some((issue) => issue.check.startsWith("layout.bounds"))) {
    issues.push({ level: "info", check: "layout.bounds", detail: "All text positions are inside the content margins." });
  }
  issues.push({ level: "info", check: "content.sections", detail: `${REQUIRED_SECTIONS.length} required sections checked; ${headingCount} headings rendered.` });

  return issues;
}

// ---------------------------------------------------------------------------
// XLSX export
// ---------------------------------------------------------------------------

function keyValueRows(record: AnyRecord | null | undefined): SheetValue[][] {
  if (!record) return [];
  return Object.entries(record)
    .filter(([, value]) => typeof value !== "object" || value === null)
    .map(([key, value]) => [humanize(String(key)), value as SheetValue]);
}

export function buildResearchXlsx(payload: ExportPayload): Blob {
  const company = payload?.company || {};
  const forecast = payload?.forecast || null;
  const dcf = payload?.dcf || null;
  const sensitivity = payload?.sensitivity || null;
  const actuals = payload?.actuals || null;
  const price = payload?.price_summary || company.price_summary || null;
  const currency = payload?.currency || company.currency || "USD";

  const sheets: Sheet[] = [];

  sheets.push({
    name: "Summary",
    rows: [
      ["APEX Terminal research export"],
      ["Generated", new Date().toISOString()],
      [],
      ["Ticker", payload?.ticker || ""],
      ["Company", company.name || ""],
      ["Exchange", company.exchange || ""],
      ["Currency", currency],
      ["Sector", company.sector || ""],
      ["Industry", company.industry || ""],
      ["Market cap", company.market_cap ?? ""],
      ["Last close", price?.last_close ?? ""],
      ["52w low", price?.low_52w ?? ""],
      ["52w high", price?.high_52w ?? ""],
      ["Rating", payload?.rating ?? ""],
      ["Target price", payload?.target_price ?? ""],
      ["Upside", payload?.upside ?? ""],
      ["Synthetic fixture", payload?.is_synthetic === false ? "no" : "yes"],
      ["Data source", payload?.data_source || "APEX local deterministic fixture"],
      ["Retrieved", payload?.retrieved_at || ""],
      [],
      ["Latest revenue", actuals?.revenue ?? ""],
      ["Latest net margin", actuals?.net_margin ?? ""],
      ["Latest FCF", actuals?.fcf ?? ""],
      ["Value per share (DCF)", dcf?.value_per_share ?? ""],
    ],
  });

  const periods: AnyRecord[] = Array.isArray(forecast?.periods) ? forecast.periods : [];
  if (periods.length) {
    const columns = ["year", "revenue", "gross_profit", "operating_expense", "ebit", "ebitda", "net_income", "eps", "operating_cash_flow", "capex", "free_cash_flow", "cash", "debt", "equity", "total_assets", "total_liabilities", "balance_check", "shares"];
    sheets.push({
      name: "Forecast",
      rows: [
        ["Year", ...columns.slice(1).map((column) => humanize(column))],
        ...periods.map((period) => columns.map((column) => (period[column] ?? "") as SheetValue)),
      ],
    });
  }

  const history: AnyRecord[] = Array.isArray(payload?.history) ? payload.history : [];
  if (history.length) {
    const hCols = ["period_end", "revenue", "revenue_growth", "gross_margin", "operating_margin", "net_margin", "ebitda", "net_income", "eps_diluted", "roe", "roic", "fcf", "net_debt"];
    sheets.push({
      name: "History",
      rows: [
        hCols.map((column) => humanize(column)),
        ...history.map((row) => hCols.map((column) => (row[column] ?? "") as SheetValue)),
      ],
    });
  }

  const annualStmt: any = payload?.annual || {};
  const stmtIncome: AnyRecord[] = Array.isArray(annualStmt.income_statement) ? annualStmt.income_statement : [];
  const stmtBalance: AnyRecord[] = Array.isArray(annualStmt.balance_sheet) ? annualStmt.balance_sheet : [];
  const stmtCash: AnyRecord[] = Array.isArray(annualStmt.cash_flow) ? annualStmt.cash_flow : [];
  if (stmtIncome.length || stmtBalance.length || stmtCash.length) {
    const incomeKeys = ["revenue", "cost_of_revenue", "gross_profit", "operating_expense", "operating_income", "ebit", "da", "ebitda", "interest_expense", "pretax_income", "tax_expense", "net_income", "diluted_eps"];
    const balanceKeys = ["total_assets", "current_assets", "cash", "accounts_receivable", "inventory", "ppe_net", "goodwill", "total_non_current_assets", "total_liabilities", "current_liabilities", "accounts_payable", "total_debt", "equity", "shares_issued"];
    const cashKeys = ["operating_cash_flow", "da_cf", "stock_based_comp", "deferred_tax", "change_in_wc", "capex", "dividends_paid", "share_repurchase", "net_borrowings", "free_cash_flow", "end_cash"];
    const allKeys = [...incomeKeys, ...balanceKeys, ...cashKeys];
    const periods = (stmtIncome.length ? stmtIncome : stmtBalance.length ? stmtBalance : stmtCash).slice(0, 8);
    const presentKeys = allKeys.filter((key) => [...stmtIncome, ...stmtBalance, ...stmtCash].some((row) => isNum(row?.items?.[key])));
    const header = ["Line item", ...periods.map((row: AnyRecord) => yearOf(row))];
    const rows: SheetValue[][] = [header];
    presentKeys.forEach((key) => {
      rows.push([humanize(key), ...periods.map((period: AnyRecord) => {
        const src = (key in (stmtIncome[0]?.items || {})) ? stmtIncome : (key in (stmtBalance[0]?.items || {})) ? stmtBalance : stmtCash;
        const row = src.find((r: AnyRecord) => r.period_end === period.period_end);
        return (row?.items?.[key] ?? "") as SheetValue;
      })]);
    });
    const lastCol = columnName(periods.length + 1);
    const sqref = `B2:${lastCol}${rows.length}`;
    sheets.push({
      name: "Statements",
      rows,
      freeze: { row: 1, col: 1 },
      conditionalFormats: [{ sqref, type: "dataBar", color: "FF5B9BD5" }],
    });
  }

  const assumptions = payload?.assumptions || forecast?.assumptions || null;
  if (assumptions) {
    const driverSources = (payload?.assumption_sources || forecast?.assumption_sources || {}) as AnyRecord;
    const rows: SheetValue[][] = [
      ["Driver", "Value", "Source"],
      ...Object.entries(assumptions as AnyRecord)
        .filter(([, value]) => typeof value !== "object" || value === null)
        .map(([key, value]) => [
          humanize(String(key)),
          value as SheetValue,
          String(driverSources[key] || "Engine default (documented assumption)"),
        ]),
    ];
    sheets.push({ name: "Drivers", rows });
  }

  if (dcf) {
    const dcfRows: SheetValue[][] = [["Metric", "Value"], ...keyValueRows(dcf)];
    const comps = dcf.wacc_components;
    if (comps) {
      dcfRows.push([]);
      dcfRows.push(["WACC build-up", ""]);
      Object.entries(comps as AnyRecord).forEach(([key, value]) => dcfRows.push([humanize(key), value as SheetValue]));
    }
    sheets.push({ name: "DCF", rows: dcfRows });
  }

  const waccValues: number[] = Array.isArray(sensitivity?.wacc_values) ? sensitivity.wacc_values : [];
  const terminalValues: number[] = Array.isArray(sensitivity?.terminal_values) ? sensitivity.terminal_values : [];
  const matrix: any[][] = Array.isArray(sensitivity?.table) ? sensitivity.table : [];
  if (sensitivity && !sensitivity.error && waccValues.length && terminalValues.length && matrix.length) {
    sheets.push({
      name: "Sensitivity",
      rows: [
        [`WACC vs ${sensitivity.mode === "multiple" ? "exit multiple" : "terminal growth"}`, ...terminalValues.map((value) => value as SheetValue)],
        ...waccValues.map((waccValue, rowIndex) => [
          waccValue as SheetValue,
          ...(matrix[rowIndex] || []).map((value) => (isNum(value) ? value : "")),
        ]),
      ],
    });
  }

  const provenance: AnyRecord[] = Array.isArray(payload?.provenance) ? payload.provenance : [];
  if (provenance.length) {
    const pCols = ["metric", "value_label", "unit", "currency", "period", "source", "retrieved_at", "status"];
    sheets.push({
      name: "Provenance",
      rows: [
        pCols.map((column) => humanize(column)),
        ...provenance.map((row) => pCols.map((column) => (row[column] ?? "") as SheetValue)),
      ],
    });
  }

  const report = payload?.report || null;
  if (report) {
    const skip = new Set(["narrative_source", "ai_generated"]);
    sheets.push({
      name: "Report",
      rows: [
        ["Section", "Content"],
        ...Object.entries(report)
          .filter(([key]) => !skip.has(key))
          .map(([key, value]) => [
            humanize(key),
            Array.isArray(value)
              ? value
                  .map((item: any) =>
                    item && typeof item === "object"
                      ? `- ${item.title || ""}: ${item.exposure || item.event || ""}${item.monitoring_metric ? ` (monitor: ${item.monitoring_metric})` : ""}`
                      : `- ${String(item)}`,
                  )
                  .join("\n")
              : value && typeof value === "object"
                ? JSON.stringify(value)
                : String(value ?? ""),
          ]),
      ],
    });
  }

  const alerts: any[] = payload?.data_quality?.alerts || company.data_quality?.alerts || [];
  if (alerts.length) {
    sheets.push({
      name: "Data quality",
      rows: [["Level", "Message"], ...alerts.map((alert) => [label(alert.level, "info"), label(alert.message)])],
    });
  }

  const validation: AnyRecord[] = Array.isArray(payload?.validation) ? payload.validation : [];
  if (validation.length) {
    sheets.push({
      name: "Validation",
      rows: [["Severity", "Code", "Message"], ...validation.map((issue) => [label(issue.severity), label(issue.code), label(issue.message)])],
    });
  }

  return new Blob([buildXlsx(sheets)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
