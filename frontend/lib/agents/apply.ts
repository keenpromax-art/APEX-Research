import { PdfDocument, CONTENT_WIDTH, measureText, type PdfColor } from "../pdf";
import type { AgentAction } from "./types";
import { fmt, isNum, num, pct } from "../format";

type StdColumn = {
  key: string;
  label: string;
  x?: number;
  align?: "left" | "right";
  format?: (r: any, i: number) => string;
  bold?: (r: any, i: number) => boolean;
  color?: (r: any, i: number) => any;
};

type StdTable = { columns: StdColumn[]; rows: any[] };

const PDF_COLORS: Record<string, { r: number; g: number; b: number }> = {
  pos: { r: 0.09, g: 0.42, b: 0.23 },
  neg: { r: 0.75, g: 0.11, b: 0.11 },
  ink: { r: 0.05, g: 0.05, b: 0.05 },
  amber: { r: 0.71, g: 0.47, b: 0.05 },
  accent: { r: 0.886, g: 0.137, b: 0.102 },
};

function resolveColor(v: any): { r: number; g: number; b: number } | undefined {
  if (!v) return undefined;
  if (typeof v === "string") return PDF_COLORS[v];
  return v;
}

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

export function renderActions(doc: PdfDocument, actions: AgentAction[]): void {
  const pairBuffer: Array<{ key: string; val: string; color?: PdfColor }> = [];

  const flushPairs = () => {
    if (!pairBuffer.length) return;
    const colCount = 4;
    const colWidth = CONTENT_WIDTH / colCount;
    const rows = Math.ceil(pairBuffer.length / colCount);
    for (let row = 0; row < rows; row += 1) {
      const cells: Array<{ text: string; offset: number; align?: "left" | "right"; size?: number; bold?: boolean; gray?: number; color?: PdfColor }> = [];
      for (let col = 0; col < colCount; col += 1) {
        const idx = row * colCount + col;
        if (idx >= pairBuffer.length) break;
        const { key, val, color } = pairBuffer[idx];
        const x = col * colWidth;
        const colRight = x + colWidth;
        cells.push({ text: key, offset: x, gray: 0.45, size: 8.5 });
        cells.push({ text: val, offset: colRight, align: "right", color, size: 8.5 });
      }
      doc.row(cells, 2);
    }
    pairBuffer.length = 0;
  };

  for (const action of actions) {
    switch (action.kind) {
      case "addText":
        flushPairs();
        doc.text(action.target, {
          size: 8.8,
          gray: 0.2,
          gap: 3,
          leading: 1.4,
        });
        break;
      case "addPair": {
        const key = String(action.target).split(" · ")[0];
        const val = String(action.target).split(" · ").slice(1).join(" · ");
        const color = resolveColor((action.payload as any)?.color);
        pairBuffer.push({ key, val, color });
        break;
      }
      case "addCallout": {
        flushPairs();
        const accent = resolveColor((action.payload as any)?.accent);
        const titleColor = resolveColor((action.payload as any)?.titleColor ?? (action.payload as any)?.accent);
        doc.callout(String(action.target), String((action.payload as any)?.body ?? ""), {
          accent: accent ?? { r: 0.886, g: 0.137, b: 0.102 },
          titleColor: titleColor ?? { r: 0.886, g: 0.137, b: 0.102 },
        });
        break;
      }
      case "addTable": {
        flushPairs();
        const table = normalizeTable(action.payload);
        if (!table) continue;
        const columns = table.columns.map((c) => ({
          key: c.key,
          label: c.label,
          x: c.x ?? 0,
          align: c.align ?? "left",
          format: c.format ? ((r: any, i: number) => String(c.format!(r, i) ?? "")) : undefined,
          bold: c.bold ? ((r: any, i: number) => !!c.bold!(r, i)) : undefined,
          color: c.color ? ((r: any, i: number) => resolveColor(c.color!(r, i))) : undefined,
        }));
        doc.dataTable(columns, table.rows, { fontSize: 8, headerFontSize: 7 });
        break;
      }
      case "addSection":
        flushPairs();
        // Section headings are owned by the section builders; actions only annotate.
        break;
    }
  }
  flushPairs();
}

function normalizeTable(payload: any): StdTable | null {
  if (!payload || typeof payload !== "object") return null;
  // Standard shape: { columns, rows }
  if (payload.columns && Array.isArray(payload.columns) && Array.isArray(payload.rows)) {
    return payload as StdTable;
  }
  // Legacy: peer comps { target, rows, medians, currency }
  if (payload.rows && Array.isArray(payload.rows) && payload.target) {
    const rows = [...payload.rows, { ticker: "Peer median", ...payload.medians, _median: true }];
    const columns = [
      { key: "ticker", label: "Ticker", x: 0 },
      { key: "mcap", label: "Market cap", x: 115, align: "right" as const, format: (r: any) => (r.mcap == null ? "—" : fmt(r.mcap)), bold: (r: any) => r._target || r._median },
      { key: "pe", label: "P/E", x: 200, align: "right" as const, format: (r: any) => fmtX(r.pe) },
      { key: "ev_ebitda", label: "EV/EBITDA", x: 300, align: "right" as const, format: (r: any) => fmtX(r.ev_ebitda) },
      { key: "pb", label: "P/B", x: 385, align: "right" as const, format: (r: any) => fmtX(r.pb) },
      { key: "ev_sales", label: "EV/sales", x: CONTENT_WIDTH, align: "right" as const, format: (r: any) => fmtX(r.ev_sales) },
    ];
    return { columns, rows: rows.map((r: any) => ({ ...r, _target: r.ticker?.includes("target") })) };
  }
  // Legacy: monte carlo { p, price, currency, iterations }
  if (payload.p && payload.iterations) {
    const p = payload.p;
    const rows = [
      { band: "P5", value: p.p5 },
      { band: "P25", value: p.p25 },
      { band: "Median (p50)", value: p.p50 },
      { band: "P75", value: p.p75 },
      { band: "P95", value: p.p95 },
    ].map((r) => ({ ...r, vs: isNum(r.value) && isNum(payload.price) && payload.price > 0 ? (r.value as number) / payload.price - 1 : null }));
    const columns = [
      { key: "band", label: "Band", x: 0, bold: (r: any) => r.band.startsWith("Median") },
      { key: "value", label: "Value per share", x: 190, align: "right" as const, format: (r: any) => isNum(r.value) ? `${num(r.value, 2)} ${payload.currency}` : "—" },
      { key: "vs", label: "vs last price", x: CONTENT_WIDTH, align: "right" as const, format: (r: any) => isNum(r.vs) ? `${r.vs >= 0 ? "+" : ""}${pct(r.vs)}` : "—", color: (r: any) => (isNum(r.vs) ? (r.vs < 0 ? "neg" : undefined) : undefined) },
    ];
    return { columns, rows };
  }
  // Legacy: sensitivity { waccValues, terminalValues, table, mode }
  if (payload.waccValues && payload.terminalValues && payload.table) {
    const columns = [
      { key: "wacc", label: "WACC", x: 0, format: (r: any) => pct(r.wacc, 1) },
      ...payload.terminalValues.map((v: any, i: number) => ({
        key: `t${i}`,
        label: payload.mode === "multiple" ? `${num(v, 1)}x` : pct(v, 1),
        x: 70 + ((CONTENT_WIDTH - 70) / payload.terminalValues.length) * (i + 1),
        align: "right" as const,
        format: (r: any) => isNum(r[`t${i}`]) ? num(r[`t${i}`], 2) : "—",
      })),
    ];
    const rows = payload.waccValues.map((w: any, ri: number) => {
      const row: any = { wacc: w };
      payload.terminalValues.forEach((_: any, ci: number) => { row[`t${ci}`] = payload.table[ri]?.[ci]; });
      return row;
    });
    return { columns, rows };
  }
  // Legacy: scenarios { rows, currency }
  if (payload.rows && Array.isArray(payload.rows) && payload.rows[0]?.scenario) {
    const columns = [
      { key: "scenario", label: "Scenario", x: 0 },
      { key: "growth", label: "Rev growth", x: 90, align: "right" as const, format: (r: any) => isNum(r.growth) ? pct(r.growth, 1) : "—" },
      { key: "margin", label: "Gross margin", x: 170, align: "right" as const, format: (r: any) => isNum(r.margin) ? pct(r.margin, 1) : "—" },
      { key: "value", label: `Value/share (${payload.currency})`, x: 260, align: "right" as const, format: (r: any) => isNum(r.value) ? num(r.value, 2) : "—" },
      { key: "ev", label: `EV (${payload.currency})`, x: 360, align: "right" as const, format: (r: any) => isNum(r.ev) ? fmt(r.ev) : "—" },
    ];
    return { columns, rows: payload.rows };
  }
  // Legacy: assumption sources { rows }
  if (payload.rows && Array.isArray(payload.rows) && payload.rows[0]?.driver) {
    const columns = [
      { key: "driver", label: "Driver", x: 0 },
      { key: "value", label: "Value", x: 170, align: "right" as const },
      { key: "source", label: "Source", x: 190, format: (r: any) => ellipsize(String(r.source), CONTENT_WIDTH - 190 - 52 - 8, 8) },
    ];
    return { columns, rows: payload.rows };
  }
  // Legacy: income history { periods }
  if (payload.periods && Array.isArray(payload.periods)) {
    return null; // handled inline by income agent via separate path
  }
  return null;
}

function fmtX(v: any): string {
  if (!isNum(v)) return "—";
  return v > 0 ? `${num(v, 1)}x` : "n.m.";
}
