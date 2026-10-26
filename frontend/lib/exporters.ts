import { humanize, isNum, localDate, num, pct, fmt, periodLabel } from "./format";
import { PdfDocument } from "./pdf";
import { buildXlsx, Sheet, SheetValue } from "./xlsx";

type AnyRecord = Record<string, any>;

export type ExportPayload = {
  ticker?: string;
  title?: string;
  forecast?: AnyRecord | null;
  dcf?: AnyRecord | null;
  sensitivity?: AnyRecord | null;
  report?: AnyRecord | null;
  research_payload?: AnyRecord | null;
  assumptions?: AnyRecord | null;
  data_quality?: AnyRecord | null;
  company?: AnyRecord | null;
  actuals?: AnyRecord | null;
  price_summary?: AnyRecord | null;
  generated_at?: string | null;
};

const CONTENT_WIDTH = 483;
const REPORT_SECTION_ORDER = [
  "executive_summary",
  "business_overview",
  "financial_performance",
  "strengths",
  "risks",
  "catalysts",
  "valuation_view",
  "conclusion",
  "disclaimer",
];

function label(value: unknown, fallback = "—"): string {
  if (value === null || value === undefined || value === "") return fallback;
  if (isNum(value)) return num(value);
  return String(value);
}

function money(value: unknown, currency?: string): string {
  if (!isNum(value)) return "—";
  return `${fmt(value)}${currency ? ` ${currency}` : ""}`;
}

function section(doc: PdfDocument, title: string) {
  doc.space(10).text(title, { size: 11.5, bold: true, gray: 0.08, gap: 6 });
}

function pair(doc: PdfDocument, key: string, value: string, indent = 0) {
  doc.row([
    { text: key, offset: indent, gray: 0.45 },
    { text: value, offset: CONTENT_WIDTH, align: "right" },
  ]);
}

function reportSections(report: AnyRecord): [string, unknown][] {
  const keys = [...REPORT_SECTION_ORDER, ...Object.keys(report).filter((key) => !REPORT_SECTION_ORDER.includes(key))];
  return keys.filter((key) => report[key] !== undefined && report[key] !== null).map((key) => [key, report[key]]);
}

function writeReportBlock(doc: PdfDocument, name: string, content: unknown) {
  doc.space(6).text(humanize(name), { size: 10, bold: true, gray: 0.2, gap: 3 });
  if (Array.isArray(content)) {
    content.forEach((item) => doc.text(`- ${label(item)}`, { size: 9.5, indent: 10, gap: 2 }));
    return;
  }
  if (content && typeof content === "object") {
    Object.entries(content as AnyRecord).forEach(([key, value]) =>
      doc.text(`${humanize(key)}: ${label(value)}`, { size: 9.5, indent: 10, gap: 2 }),
    );
    return;
  }
  doc.text(label(content), { size: 9.5, gray: 0.25, gap: 4 });
}

export function buildResearchPdf(payload: ExportPayload): Blob {
  const { doc, title } = buildReportDocument(payload);
  return new Blob([doc.build(title)], { type: "application/pdf" });
}

export function buildResearchPdfMeta(payload: ExportPayload): { blob: Blob; pages: number; size: number } {
  const { doc, title } = buildReportDocument(payload);
  const bytes = doc.build(title);
  return { blob: new Blob([bytes], { type: "application/pdf" }), pages: doc.pageCount, size: bytes.length };
}

function buildReportDocument(payload: ExportPayload) {
  const doc = new PdfDocument();
  const title = payload?.title || `${payload?.ticker || "APEX"} — APEX Terminal Research Report`;
  const company = payload?.company || {};
  const forecast = payload?.forecast || null;
  const dcf = payload?.dcf || null;
  const sensitivity = payload?.sensitivity || null;
  const report = payload?.report || null;
  const actuals = payload?.actuals || null;
  const price = payload?.price_summary || company.price_summary || null;
  const currency = company.currency || payload?.price_summary?.currency || "USD";

  doc.text(title, { size: 17, bold: true, gray: 0.06, gap: 3 });
  doc.text(
    [payload?.ticker, company.name, company.sector].filter(Boolean).join("  ·  "),
    { size: 9.5, gray: 0.4, gap: 2 },
  );
  doc.text(`Generated ${localDate(payload.generated_at || new Date().toISOString())} · deterministic client engine`, {
    size: 8.5,
    gray: 0.5,
    gap: 8,
  });
  doc.rule();

  section(doc, "Market snapshot");
  if (price) {
    pair(doc, "Last close", num(price.last_close));
    pair(doc, "Day change", isNum(price.change_pct) ? `${pct(price.change_pct)} (${num(price.change)})` : "—");
    pair(doc, "52-week range", isNum(price.low_52w) ? `${num(price.low_52w)} – ${num(price.high_52w)}` : "—");
    pair(doc, "Average volume (3m)", isNum(price.avg_volume_3m) ? fmt(price.avg_volume_3m) : "—");
  }
  pair(doc, "Market cap", money(company.market_cap, currency));
  pair(doc, "Exchange / currency", `${label(company.exchange)} · ${currency}`);
  pair(doc, "Last reported period", label(company.last_data_date));

  if (actuals) {
    section(doc, `Reported figures — ${periodLabel(actuals.period_end)}`);
    pair(doc, "Revenue", money(actuals.revenue, currency));
    pair(doc, "Revenue growth", pct(actuals.revenue_growth));
    pair(doc, "Gross margin", pct(actuals.gross_margin));
    pair(doc, "Operating margin", pct(actuals.operating_margin));
    pair(doc, "Net margin", pct(actuals.net_margin));
    pair(doc, "ROE / ROA / ROIC", `${pct(actuals.roe)} / ${pct(actuals.roa)} / ${pct(actuals.roic)}`);
    pair(doc, "EBITDA", money(actuals.ebitda, currency));
    pair(doc, "Free cash flow", money(actuals.fcf, currency));
    pair(doc, "Net debt", money(actuals.net_debt, currency));
    pair(doc, "Diluted EPS", num(actuals.eps_diluted));
  }

  const periods: AnyRecord[] = Array.isArray(forecast?.periods) ? forecast.periods : [];
  if (periods.length) {
    section(doc, "Base-case forecast");
    doc.row(
      [
        { text: "Year", offset: 0, bold: true, size: 9 },
        { text: "Revenue", offset: 175, align: "right", bold: true, size: 9 },
        { text: "EBITDA", offset: 265, align: "right", bold: true, size: 9 },
        { text: "Net income", offset: 375, align: "right", bold: true, size: 9 },
        { text: "FCF", offset: 460, align: "right", bold: true, size: 9 },
      ],
      2,
    );
    periods.forEach((period) => {
      doc.row([
        { text: `Y${label(period.year)}`, offset: 0, gray: 0.3 },
        { text: fmt(period.revenue), offset: 175, align: "right" },
        { text: fmt(period.ebitda), offset: 265, align: "right" },
        { text: fmt(period.net_income), offset: 375, align: "right" },
        { text: fmt(period.fcf), offset: 460, align: "right" },
      ]);
    });
    doc.space(4);
    const summary = forecast?.summary || {};
    pair(doc, "Revenue CAGR", pct(summary.revenue_cagr));
    pair(doc, "Final revenue", money(summary.final_revenue, currency));
    pair(doc, "Final EBITDA", money(summary.final_ebitda, currency));
    pair(doc, "Final free cash flow", money(summary.final_fcf, currency));
    pair(doc, "Balance check", summary.balance_ok ? "Balanced" : "Mismatch");
  }

  if (dcf && !dcf.error) {
    section(doc, "Discounted cash flow");
    pair(doc, "WACC", pct(dcf.wacc, 2));
    pair(
      doc,
      dcf.exit_multiple !== undefined && dcf.exit_multiple !== null ? "Exit multiple" : "Terminal growth",
      dcf.exit_multiple !== undefined && dcf.exit_multiple !== null ? `${num(dcf.exit_multiple)}x` : pct(dcf.terminal_growth),
    );
    pair(doc, "PV of forecast cash flows", money(dcf.pv_cash_flows, currency));
    pair(doc, "PV of terminal value", money(dcf.pv_terminal_value, currency));
    pair(doc, "Enterprise value", money(dcf.enterprise_value, currency));
    pair(doc, "Equity value", money(dcf.equity_value, currency));
    pair(doc, "Value per share", num(dcf.value_per_share));
    pair(doc, "Market price", num(price?.last_close));
    if (isNum(dcf.value_per_share) && isNum(price?.last_close)) {
      pair(doc, "Implied upside", pct(dcf.value_per_share / price.last_close - 1));
    }
    pair(doc, "Discounted periods", label(dcf.cash_flow_count));
    (dcf.warnings || []).forEach((warning: string) =>
      doc.text(`! ${warning}`, { size: 9, gray: 0.35, indent: 6, gap: 2 }),
    );
  }

  const waccValues: number[] = Array.isArray(sensitivity?.wacc_values) ? sensitivity.wacc_values : [];
  const terminalValues: number[] = Array.isArray(sensitivity?.terminal_values) ? sensitivity.terminal_values : [];
  const table: any[][] = Array.isArray(sensitivity?.table) ? sensitivity.table : [];
  if (sensitivity && waccValues.length && terminalValues.length && table.length) {
    section(
      doc,
      sensitivity.mode === "multiple" ? "Sensitivity — WACC vs exit multiple" : "Sensitivity — WACC vs terminal growth",
    );
    const columnWidth = (CONTENT_WIDTH - 80) / terminalValues.length;
    doc.row([
      { text: "WACC", offset: 0, bold: true, size: 9 },
      ...terminalValues.map((value, index) => ({
        text: sensitivity.mode === "multiple" ? `${num(value, 1)}x` : pct(value),
        offset: 80 + columnWidth * (index + 1),
        align: "right" as const,
        bold: true,
        size: 9,
      })),
    ]);
    waccValues.forEach((waccValue, rowIndex) => {
      doc.row([
        { text: pct(waccValue), offset: 0, gray: 0.3 },
        ...(table[rowIndex] || []).map((value, columnIndex) => ({
          text: fmt(value),
          offset: 80 + columnWidth * (columnIndex + 1),
          align: "right" as const,
        })),
      ]);
    });
  }

  if (report) {
    section(doc, "Research note");
    reportSections(report).forEach(([name, content]) => writeReportBlock(doc, name, content));
  }

  const alerts: any[] = payload?.data_quality?.alerts || company.data_quality?.alerts || [];
  if (alerts.length) {
    section(doc, "Data quality");
    alerts.forEach((alert) =>
      doc.text(`- [${label(alert.level, "info")}] ${label(alert.message)}`, { size: 9, indent: 6, gap: 2 }),
    );
    pair(doc, "Retrieved", localDate(company.retrieved_at));
  }

  doc.space(14);
  doc.rule(6, 0.85);
  doc.text(
    "Generated by APEX Terminal. Figures are produced by the deterministic calculation engine; AI only writes narrative. Research software, not investment advice.",
    { size: 8, gray: 0.5, gap: 0 },
  );

  return { doc, title };
}

function keyValueRows(record: AnyRecord | null | undefined, keys?: string[]): SheetValue[][] {
  if (!record) return [];
  const entries = keys ? keys.filter((key) => key in record).map((key) => [key, record[key]] as const) : Object.entries(record);
  return entries.map(([key, value]) => [
    humanize(String(key)),
    typeof value === "object" && value !== null ? JSON.stringify(value) : (value as SheetValue),
  ]);
}

export function buildResearchXlsx(payload: ExportPayload): Blob {
  const company = payload?.company || {};
  const forecast = payload?.forecast || null;
  const dcf = payload?.dcf || null;
  const sensitivity = payload?.sensitivity || null;
  const report = payload?.report || null;
  const actuals = payload?.actuals || null;
  const price = payload?.price_summary || company.price_summary || null;
  const currency = company.currency || "USD";

  const sheets: Sheet[] = [];

  sheets.push({
    name: "Summary",
    rows: [
      ["APEX Terminal export"],
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
      ["Day change", price?.change_pct ?? ""],
      ["52w low", price?.low_52w ?? ""],
      ["52w high", price?.high_52w ?? ""],
      ["Last reported period", company.last_data_date || actuals?.period_end || ""],
      ["Synthetic fixture", company.demo ? "yes" : "no"],
      [],
      ["Latest revenue", actuals?.revenue ?? ""],
      ["Latest net margin", actuals?.net_margin ?? ""],
      ["Latest ROE", actuals?.roe ?? ""],
      ["Latest FCF", actuals?.fcf ?? ""],
      ["Latest net debt", actuals?.net_debt ?? ""],
      ["Value per share (DCF)", dcf?.value_per_share ?? ""],
    ],
  });

  const periods: AnyRecord[] = Array.isArray(forecast?.periods) ? forecast.periods : [];
  if (periods.length) {
    const columns = [
      "year",
      "revenue",
      "gross_profit",
      "operating_expense",
      "ebit",
      "ebitda",
      "net_income",
      "eps",
      "operating_cash_flow",
      "capex",
      "free_cash_flow",
      "cash",
      "debt",
      "equity",
      "total_assets",
      "total_liabilities",
      "balance_check",
      "shares",
    ];
    sheets.push({
      name: "Forecast",
      rows: [
        ["Year", ...columns.slice(1).map((column) => humanize(column))],
        ...periods.map((period) => columns.map((column) => (period[column] ?? "") as SheetValue)),
      ],
    });
  }

  if (actuals) {
    sheets.push({ name: "Actuals", rows: [["Metric", "Value"], ...keyValueRows(actuals)] });
  }

  const assumptions = payload?.assumptions || forecast?.assumptions || null;
  if (assumptions) {
    sheets.push({ name: "Assumptions", rows: [["Assumption", "Value"], ...keyValueRows(assumptions)] });
  }

  if (dcf) {
    sheets.push({ name: "DCF", rows: [["Metric", "Value"], ...keyValueRows(dcf)] });
  }

  const waccValues: number[] = Array.isArray(sensitivity?.wacc_values) ? sensitivity.wacc_values : [];
  const terminalValues: number[] = Array.isArray(sensitivity?.terminal_values) ? sensitivity.terminal_values : [];
  const matrix: any[][] = Array.isArray(sensitivity?.table) ? sensitivity.table : [];
  if (sensitivity && waccValues.length && terminalValues.length && matrix.length) {
    sheets.push({
      name: "Sensitivity",
      rows: [
        [
          `WACC vs ${sensitivity.mode === "multiple" ? "exit multiple" : "terminal growth"}`,
          ...terminalValues.map((value) => value as SheetValue),
        ],
        ...waccValues.map((waccValue, rowIndex) => [
          waccValue as SheetValue,
          ...(matrix[rowIndex] || []).map((value) => (isNum(value) ? value : "")),
        ]),
      ],
    });
  }

  if (report) {
    sheets.push({
      name: "Report",
      rows: [
        ["Section", "Content"],
        ...reportSections(report).map(([name, content]) => [
          humanize(name),
          Array.isArray(content)
            ? content.map((item) => `- ${label(item)}`).join("\n")
            : content && typeof content === "object"
              ? JSON.stringify(content)
              : label(content),
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

  return new Blob([buildXlsx(sheets)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
