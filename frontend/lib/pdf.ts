const PAGE_WIDTH = 595.28; // A4 portrait, points
const PAGE_HEIGHT = 841.89;
const MARGIN_LEFT = 52;
const MARGIN_RIGHT = 52;
const MARGIN_TOP = 62;
const MARGIN_BOTTOM = 56;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;

// ---------------------------------------------------------------------------
// Font metrics — Adobe Helvetica / Helvetica-Bold AFM widths (units / 1000 em).
// Only printable ASCII (32..126) is needed: all text is ASCII-sanitised first.
// ---------------------------------------------------------------------------

const HELVETICA_WIDTHS: Record<number, number> = {
  32: 278, 33: 278, 34: 355, 35: 556, 36: 556, 37: 889, 38: 667, 39: 222, 40: 333, 41: 333,
  42: 389, 43: 584, 44: 278, 45: 333, 46: 278, 47: 278, 48: 556, 49: 556, 50: 556, 51: 556,
  52: 556, 53: 556, 54: 556, 55: 556, 56: 556, 57: 556, 58: 278, 59: 278, 60: 584, 61: 584,
  62: 584, 63: 556, 64: 1015, 65: 667, 66: 667, 67: 722, 68: 722, 69: 667, 70: 611, 71: 778,
  72: 722, 73: 278, 74: 500, 75: 667, 76: 556, 77: 833, 78: 722, 79: 778, 80: 667, 81: 778,
  82: 722, 83: 667, 84: 611, 85: 722, 86: 667, 87: 944, 88: 667, 89: 667, 90: 611, 91: 278,
  92: 278, 93: 278, 94: 469, 95: 556, 96: 278, 97: 556, 98: 556, 99: 500, 100: 556, 101: 556,
  102: 278, 103: 556, 104: 556, 105: 222, 106: 222, 107: 500, 108: 222, 109: 833, 110: 556,
  111: 556, 112: 556, 113: 556, 114: 333, 115: 500, 116: 278, 117: 556, 118: 500, 119: 722,
  120: 500, 121: 500, 122: 500, 123: 334, 124: 260, 125: 334, 126: 584,
};

const HELVETICA_BOLD_WIDTHS: Record<number, number> = {
  32: 278, 33: 333, 34: 474, 35: 556, 36: 556, 37: 889, 38: 722, 39: 278, 40: 333, 41: 333,
  42: 389, 43: 584, 44: 278, 45: 333, 46: 278, 47: 278, 48: 556, 49: 556, 50: 556, 51: 556,
  52: 556, 53: 556, 54: 556, 55: 556, 56: 556, 57: 556, 58: 333, 59: 333, 60: 584, 61: 584,
  62: 584, 63: 611, 64: 975, 65: 722, 66: 722, 67: 722, 68: 722, 69: 667, 70: 611, 71: 778,
  72: 722, 73: 278, 74: 556, 75: 722, 76: 611, 77: 833, 78: 722, 79: 778, 80: 667, 81: 778,
  82: 722, 83: 667, 84: 611, 85: 722, 86: 667, 87: 944, 88: 667, 89: 667, 90: 611, 91: 333,
  92: 278, 93: 333, 94: 584, 95: 556, 96: 333, 97: 556, 98: 611, 99: 556, 100: 611, 101: 556,
  102: 333, 103: 611, 104: 611, 105: 278, 106: 278, 107: 556, 108: 278, 109: 889, 110: 611,
  111: 611, 112: 611, 113: 611, 114: 389, 115: 556, 116: 333, 117: 611, 118: 556, 119: 778,
  120: 556, 121: 556, 122: 500, 123: 389, 124: 280, 125: 389, 126: 584,
};

export type PdfColor = { r: number; g: number; b: number };

/** Swiss red accent (#E2231A) used for section bars and table headers. */
export const PDF_ACCENT: PdfColor = { r: 0.886, g: 0.137, b: 0.102 };

export type PdfTextOptions = {
  size?: number;
  bold?: boolean;
  gray?: number;
  color?: PdfColor;
  indent?: number;
  gap?: number;
  leading?: number;
};

export type PdfColumn<Row> = {
  key: string;
  label: string;
  /** x offset in points from the left content edge (left edge of the column). */
  x: number;
  align?: "left" | "right";
  /** Cell text for a row; defaults to String(row[key] ?? ""). */
  format?: (row: Row, index: number) => string;
  /** Cell colour for a row (e.g. red for negative values). */
  color?: (row: Row, index: number) => PdfColor | undefined;
  bold?: (row: Row, index: number) => boolean;
};

export type PdfTableOptions<Row> = {
  fontSize?: number;
  headerFontSize?: number;
  rowHeight?: number;
  headerRule?: boolean;
  /** Minimum content height to keep with the heading before a break. */
  minHeadSpace?: number;
  sourceNote?: string;
};

function ascii(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201C\u201D\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/[\r\n]+/g, " ")
    .replace(/\u00B7/g, "|")
    .replace(/\u2022/g, "-")
    .replace(/\u00D7/g, "x")
    .replace(/\u03B2/g, "beta")
    .replace(/\u2192/g, "->")
    .replace(/\u2265/g, ">=")
    .replace(/\u2264/g, "<=")
    .replace(/\u2248/g, "~")
    .replace(/[^\u0020-\u007E]/g, "?");
}

function escapePdfText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** Width of `text` in points when drawn at `size` pt in the given face. */
export function measureText(value: string, size: number, bold = false): number {
  const table = bold ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS;
  let units = 0;
  for (const character of ascii(String(value))) {
    units += table[character.charCodeAt(0)] ?? 556;
  }
  return (units / 1000) * size;
}

/** Greedy word-wrap constrained by measured width, not character count. */
function wrapToWidth(value: string, maxWidth: number, size: number, bold = false): string[] {
  const source = value.length ? value : " ";
  const words = source.split(/\s+/);
  const lines: string[] = [];
  let line = "";

  const flush = () => {
    if (line.length) lines.push(line);
    line = "";
  };

  for (const word of words) {
    const candidate = line.length ? `${line} ${word}` : word;
    if (measureText(candidate, size, bold) <= maxWidth) {
      line = candidate;
      continue;
    }
    flush();
    if (measureText(word, size, bold) <= maxWidth) {
      line = word;
      continue;
    }
    // Hard-break an over-long token by measured width.
    let chunk = "";
    for (const character of word) {
      if (measureText(chunk + character, size, bold) > maxWidth && chunk.length) {
        lines.push(chunk);
        chunk = character;
      } else {
        chunk += character;
      }
    }
    line = chunk;
  }
  flush();
  return lines.length ? lines : [" "];
}

/** Round a range outward to "nice" axis bounds (1/2/2.5/5 x 10^n). */
function niceBounds(min: number, max: number): { lo: number; hi: number; step: number } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { lo: 0, hi: 1, step: 0.25 };
  if (min === max) {
    const pad = Math.abs(min) * 0.2 || 1;
    min -= pad;
    max += pad;
  }
  const span = max - min;
  const rawStep = span / 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;
  const stepFactor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  const step = stepFactor * magnitude;
  return { lo: Math.floor(min / step) * step, hi: Math.ceil(max / step) * step, step };
}

function formatAxis(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(abs >= 1e10 ? 0 : 1)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}K`;
  if (abs === 0) return "0";
  if (abs < 1) return value.toFixed(2);
  return value.toFixed(abs < 100 ? 1 : 0);
}

export type ChartSeries = {
  name: string;
  values: (number | null)[];
  color: PdfColor;
};

export type ChartOptions = {
  labels: string[];
  series: ChartSeries[];
  height?: number;
  unit?: string;
  sourceNote?: string;
  /** Format for value labels / tooltip-ish annotations. */
  valueFormat?: (value: number) => string;
};

export class PdfDocument {
  private pages: string[][] = [];
  private cursorY = PAGE_HEIGHT - MARGIN_TOP;
  private runningHeader: string | null = null;

  constructor() {
    this.pages.push([]);
  }

  get width(): number {
    return CONTENT_WIDTH;
  }

  get pageCount(): number {
    return this.pages.length;
  }

  get bottomLimit(): number {
    return MARGIN_BOTTOM;
  }

  /** Text shown top-right on every page after the first. */
  setRunningHeader(value: string | null) {
    this.runningHeader = value ? ascii(String(value)) : null;
    return this;
  }

  /** Content height currently remaining on this page. */
  remaining(): number {
    return this.cursorY - MARGIN_BOTTOM;
  }

  /** Ensure at least `height` pt of vertical room, else start a new page. */
  ensureSpace(height: number) {
    if (this.cursorY - height < MARGIN_BOTTOM) this.newPage();
    return this;
  }

  private newPage() {
    this.pages.push([]);
    this.cursorY = PAGE_HEIGHT - MARGIN_TOP;
  }

  text(value: unknown, options: PdfTextOptions = {}) {
    const size = options.size ?? 9.5;
    const bold = options.bold ?? false;
    const gray = options.gray ?? 0.15;
    const indent = options.indent ?? 0;
    const leading = size * (options.leading ?? 1.4);
    const maxWidth = CONTENT_WIDTH - indent;
    const lines = wrapToWidth(ascii(String(value ?? "")), maxWidth, size, bold);
    const font = bold ? "F2" : "F1";

    lines.forEach((line) => {
      this.ensureSpace(leading);
      const baseline = this.cursorY - size * 0.85;
      const paint = options.color
        ? `${options.color.r.toFixed(3)} ${options.color.g.toFixed(3)} ${options.color.b.toFixed(3)} rg`
        : `${gray} g`;
      this.pages[this.pages.length - 1].push(
        `BT /${font} ${size} Tf ${paint} 1 0 0 1 ${MARGIN_LEFT + indent} ${baseline.toFixed(2)} Tm (${escapePdfText(line)}) Tj ET`,
      );
      this.cursorY -= leading;
    });

    this.cursorY -= options.gap ?? 3;
    return this;
  }

  row(
    cells: { text: string; offset: number; align?: "left" | "right"; size?: number; bold?: boolean; gray?: number; color?: PdfColor }[],
    gap = 3,
  ) {
    const size = Math.max(...cells.map((cell) => cell.size ?? 9), 8);
    const leading = size * 1.35;
    this.ensureSpace(leading);
    const baseline = this.cursorY - size * 0.85;

    cells.forEach((cell) => {
      const cellSize = cell.size ?? size;
      const text = ascii(String(cell.text ?? ""));
      const textWidth = measureText(text, cellSize, cell.bold ?? false);
      const x =
        cell.align === "right" ? MARGIN_LEFT + cell.offset - textWidth : MARGIN_LEFT + Math.max(0, cell.offset);
      const paint = cell.color
        ? `${cell.color.r.toFixed(3)} ${cell.color.g.toFixed(3)} ${cell.color.b.toFixed(3)} rg`
        : `${cell.gray ?? 0.15} g`;
      this.pages[this.pages.length - 1].push(
        `BT /${cell.bold ? "F2" : "F1"} ${cellSize} Tf ${paint} 1 0 0 1 ${x.toFixed(2)} ` +
          `${baseline.toFixed(2)} Tm (${escapePdfText(text)}) Tj ET`,
      );
    });

    this.cursorY -= leading + gap;
    return this;
  }

  rect(x: number, yTop: number, width: number, height: number, color: PdfColor) {
    const y = this.cursorY - yTop - height;
    this.pages[this.pages.length - 1].push(
      `${color.r.toFixed(3)} ${color.g.toFixed(3)} ${color.b.toFixed(3)} rg ` +
        `${(MARGIN_LEFT + x).toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f`,
    );
    return this;
  }

  textAt(x: number, yTop: number, value: string, options: PdfTextOptions = {}) {
    const size = options.size ?? 9.5;
    const font = options.bold ? "F2" : "F1";
    const baseline = this.cursorY - yTop - size * 0.85;
    const text = ascii(String(value ?? ""));
    const paint = options.color
      ? `${options.color.r.toFixed(3)} ${options.color.g.toFixed(3)} ${options.color.b.toFixed(3)} rg`
      : `${options.gray ?? 0.15} g`;
    this.pages[this.pages.length - 1].push(
      `BT /${font} ${size} Tf ${paint} 1 0 0 1 ${(MARGIN_LEFT + x).toFixed(2)} ${baseline.toFixed(2)} Tm (${escapePdfText(text)}) Tj ET`,
    );
    return this;
  }

  /** Right-aligned textAt convenience. */
  textRightAt(rightOffsetFromLeft: number, yTop: number, value: string, options: PdfTextOptions = {}) {
    const size = options.size ?? 9.5;
    const width = measureText(String(value ?? ""), size, options.bold ?? false);
    return this.textAt(rightOffsetFromLeft - width, yTop, value, options);
  }

  rule(gap = 8, gray = 0.8, thickness = 0.5) {
    this.ensureSpace(6);
    const y = this.cursorY - 2;
    this.pages[this.pages.length - 1].push(
      `${gray} G ${thickness} w ${MARGIN_LEFT} ${y.toFixed(2)} m ${(MARGIN_LEFT + CONTENT_WIDTH).toFixed(2)} ${y.toFixed(2)} l S`,
    );
    this.cursorY = y - gap;
    return this;
  }

  /** Horizontal rule `yTop` points below the cursor; does not move the cursor. */
  hline(yTop: number, gray = 0.8, thickness = 0.5, color?: PdfColor) {
    const y = this.cursorY - yTop;
    const stroke = color
      ? `${color.r.toFixed(3)} ${color.g.toFixed(3)} ${color.b.toFixed(3)} RG`
      : `${gray} G`;
    this.pages[this.pages.length - 1].push(
      `${stroke} ${thickness} w ${MARGIN_LEFT} ${y.toFixed(2)} m ${(MARGIN_LEFT + CONTENT_WIDTH).toFixed(2)} ${y.toFixed(2)} l S`,
    );
    return this;
  }

  /** Vertical hairline at `x` from the content edge, running `length` down from `yTop`. */
  vline(x: number, yTop: number, length: number, gray = 0.8, thickness = 0.5) {
    const yTopAbs = this.cursorY - yTop;
    this.pages[this.pages.length - 1].push(
      `${gray} G ${thickness} w ${(MARGIN_LEFT + x).toFixed(2)} ${yTopAbs.toFixed(2)} m ${(MARGIN_LEFT + x).toFixed(2)} ${(yTopAbs - length).toFixed(2)} l S`,
    );
    return this;
  }

  /** Short accent rule (section marker). */
  accentRule(color: PdfColor, width = 26, height = 2.5, gap = 5) {
    this.ensureSpace(height + gap);
    this.rect(0, 0, width, height, color);
    this.cursorY -= height + gap;
    return this;
  }

  space(height = 8) {
    this.cursorY -= height;
    if (this.cursorY < MARGIN_BOTTOM) this.newPage();
    return this;
  }

  nudge(delta: number) {
    this.cursorY -= delta;
    if (this.cursorY < MARGIN_BOTTOM) this.newPage();
    return this;
  }

  /**
   * Section heading with orphan protection: keeps at least `minContentBelow`
   * points of room under the heading, else pushes it to the next page.
   */
  heading(title: string, options: { size?: number; color?: PdfColor; minContentBelow?: number; gap?: number } = {}) {
    const size = options.size ?? 11.5;
    const leading = size * 1.35;
    const minContentBelow = options.minContentBelow ?? 74;
    const needed = leading + 6 + minContentBelow; // heading + gap + first content block
    if (this.cursorY - needed < MARGIN_BOTTOM) this.newPage();
    this.accentRule(options.color ?? PDF_ACCENT, 26, 2.5, 5);
    this.text(title, { size, bold: true, color: options.color ?? { r: 0.08, g: 0.09, b: 0.11 }, gap: options.gap ?? 5 });
    return this;
  }

  /**
   * Typeset a data table. Repeats the header row when the table splits across
   * pages. Delimited by rules only (red accent bar on top, dark rule under the
   * header, hairline row rules) — no fills, per data-ink discipline.
   */
  dataTable<Row>(
    columns: PdfColumn<Row>[],
    rows: Row[],
    options: PdfTableOptions<Row> = {},
  ) {
    const fontSize = options.fontSize ?? 8.5;
    const headerFontSize = options.headerFontSize ?? 7;
    const rowHeight = options.rowHeight ?? Math.max(16, fontSize * 1.7);
    const headerHeight = Math.max(18, headerFontSize * 2.2);

    const drawHeader = () => {
      this.ensureSpace(headerHeight + rowHeight);
      // Red accent bar along the top edge of the table.
      this.rect(0, -2.5, CONTENT_WIDTH, 2.5, PDF_ACCENT);
      columns.forEach((column) => {
        const label = ascii(column.label.toUpperCase());
        const textWidth = measureText(label, headerFontSize, true);
        const x =
          column.align === "right" ? MARGIN_LEFT + column.x - textWidth : MARGIN_LEFT + Math.max(0, column.x);
        this.pages[this.pages.length - 1].push(
          `BT /F2 ${headerFontSize} Tf 0.12 0.12 0.14 rg 1 0 0 1 ${x.toFixed(2)} ` +
            `${(this.cursorY - headerFontSize * 1.5).toFixed(2)} Tm (${escapePdfText(label)}) Tj ET`,
        );
      });
      this.cursorY -= headerHeight;
      if (options.headerRule !== false) {
        const y = this.cursorY;
        this.pages[this.pages.length - 1].push(`0.2 G 0.6 w ${MARGIN_LEFT} ${y.toFixed(2)} m ${(MARGIN_LEFT + CONTENT_WIDTH).toFixed(2)} ${y.toFixed(2)} l S`);
      }
    };

    drawHeader();

    rows.forEach((row, index) => {
      if (this.cursorY - rowHeight < MARGIN_BOTTOM) {
        this.newPage();
        drawHeader();
      }
      const baseline = this.cursorY - fontSize * 0.85;
      columns.forEach((column) => {
        const cellText = ascii(column.format ? String(column.format(row, index) ?? "") : String((row as any)?.[column.key] ?? ""));
        const bold = column.bold ? column.bold(row, index) : false;
        const cellColor = column.color ? column.color(row, index) : undefined;
        const textWidth = measureText(cellText, fontSize, bold);
        const x =
          column.align === "right" ? MARGIN_LEFT + column.x - textWidth : MARGIN_LEFT + Math.max(0, column.x);
        const paint = cellColor
          ? `${cellColor.r.toFixed(3)} ${cellColor.g.toFixed(3)} ${cellColor.b.toFixed(3)} rg`
          : "0.12 0.12 0.14 rg";
        this.pages[this.pages.length - 1].push(
          `BT /${bold ? "F2" : "F1"} ${fontSize} Tf ${paint} 1 0 0 1 ${x.toFixed(2)} ` +
            `${baseline.toFixed(2)} Tm (${escapePdfText(cellText)}) Tj ET`,
        );
      });
      this.cursorY -= rowHeight;
      // Hairline rule between rows for legibility.
      if (index < rows.length - 1) {
        const y = this.cursorY;
        this.pages[this.pages.length - 1].push(`0.9 G 0.3 w ${MARGIN_LEFT} ${y.toFixed(2)} m ${(MARGIN_LEFT + CONTENT_WIDTH).toFixed(2)} ${y.toFixed(2)} l S`);
      }
    });

    // Solid rule under the table.
    const y = this.cursorY + 1;
    this.pages[this.pages.length - 1].push(`0.2 G 0.6 w ${MARGIN_LEFT} ${y.toFixed(2)} m ${(MARGIN_LEFT + CONTENT_WIDTH).toFixed(2)} ${y.toFixed(2)} l S`);
    this.cursorY -= 4;

    if (options.sourceNote) this.sourceNote(options.sourceNote);
    return this;
  }

  sourceNote(text: string) {
    this.ensureSpace(12);
    this.text(`Source: ${text}`, { size: 7, gray: 0.5, gap: 4, leading: 1.25 });
    return this;
  }

  /**
   * Line-delimited note: semantic rule on top, coloured title, body, hairline
   * closing rule. Lines instead of boxes — no panel fill, no left-border card.
   */
  callout(title: string, body: string, options: { accent?: PdfColor; titleColor?: PdfColor } = {}) {
    const accent = options.accent ?? PDF_ACCENT;
    const titleColor = options.titleColor ?? accent;
    const bodySize = 8.8;
    const bodyLines = wrapToWidth(ascii(body), CONTENT_WIDTH, bodySize, false);
    const titleBlock = title ? 13 : 0;
    const height = 7 + titleBlock + bodyLines.length * bodySize * 1.4 + 4;
    this.ensureSpace(height + 6);
    this.hline(0, 0, 0.9, accent);
    let used = 7;
    if (title) {
      this.textAt(0, used, title, { size: 8, bold: true, color: titleColor });
      used += titleBlock;
    }
    bodyLines.forEach((line, index) => {
      this.textAt(0, used + index * bodySize * 1.4, line, { size: bodySize, gray: 0.2 });
    });
    this.hline(height, 0.72, 0.4);
    this.cursorY -= height + 6;
    return this;
  }

  /**
   * Vector bar chart with absolute-path rendering. Handles negatives via a zero
   * baseline, draws gridlines with "nice" axis bounds, a legend and x labels.
   */
  drawBars(options: ChartOptions & { width?: number }) {
    const width = options.width ?? CONTENT_WIDTH;
    const height = options.height ?? 120;
    const labels = options.labels;
    const series = options.series;
    if (!labels.length || !series.length) return this;

    const allValues = series.flatMap((entry) => entry.values.filter((value): value is number => isFiniteNumber(value)));
    if (!allValues.length) return this;
    const { lo, hi, step } = niceBounds(Math.min(0, ...allValues), Math.max(0, ...allValues));
    const plotLeft = 48;
    const plotWidth = width - plotLeft - 8;
    const plotTop = 8;
    const plotHeight = height - plotTop - 24;

    this.ensureSpace(height + 18);
    const page = this.pages[this.pages.length - 1];
    const originY = this.cursorY; // top of the chart box
    // lo sits at the bottom of the plot, hi at the top (values grow upward).
    const yAbs = (value: number) => originY - plotTop - plotHeight + ((value - lo) / (hi - lo || 1)) * plotHeight;

    // Gridlines + y-axis labels.
    for (let value = lo; value <= hi + step / 2; value += step) {
      const y = yAbs(value);
      const isZero = Math.abs(value) < 1e-12;
      const grid = isZero ? 0.55 : 0.9;
      const weight = isZero ? 0.5 : 0.3;
      page.push(`${grid} G ${weight} w ${MARGIN_LEFT + plotLeft} ${y.toFixed(2)} m ${MARGIN_LEFT + plotLeft + plotWidth} ${y.toFixed(2)} l S`);
      const label = formatAxis(value);
      const labelWidth = measureText(label, 6.5, false);
      page.push(
        `BT /F1 6.5 Tf 0.45 0.47 0.52 rg 1 0 0 1 ${(MARGIN_LEFT + plotLeft - labelWidth - 5).toFixed(2)} ${(y - 2.2).toFixed(2)} Tm (${escapePdfText(label)}) Tj ET`,
      );
    }

    const groupWidth = plotWidth / labels.length;
    const barGap = Math.min(8, groupWidth * 0.2);
    const usable = groupWidth - barGap;
    const barWidth = usable / series.length;

    labels.forEach((rawLabel, labelIndex) => {
      const groupX = MARGIN_LEFT + plotLeft + labelIndex * groupWidth + barGap / 2;
      series.forEach((entry, seriesIndex) => {
        const value = entry.values[labelIndex];
        if (!isFiniteNumber(value)) return;
        const x = groupX + seriesIndex * barWidth;
        const yValue = yAbs(value);
        const zeroY = yAbs(0);
        const barTop = Math.min(yValue, zeroY);
        const barHeight = Math.max(0.8, Math.abs(zeroY - yValue));
        page.push(
          `${entry.color.r.toFixed(3)} ${entry.color.g.toFixed(3)} ${entry.color.b.toFixed(3)} rg ` +
            `${x.toFixed(2)} ${barTop.toFixed(2)} ${(barWidth * 0.86).toFixed(2)} ${barHeight.toFixed(2)} re f`,
        );
      });
      // X label.
      const label = ascii(String(rawLabel));
      const labelWidth = measureText(label, 6.5, false);
      const labelX = MARGIN_LEFT + plotLeft + labelIndex * groupWidth + groupWidth / 2 - labelWidth / 2;
      page.push(
        `BT /F1 6.5 Tf 0.4 0.42 0.47 rg 1 0 0 1 ${labelX.toFixed(2)} ${(originY - height + 12).toFixed(2)} Tm (${escapePdfText(label)}) Tj ET`,
      );
    });

    this.drawLegend(series, originY - height - 2);
    this.cursorY = originY - height - 8;
    if (this.cursorY < MARGIN_BOTTOM) this.newPage();
    if (options.sourceNote) this.sourceNote(options.sourceNote);
    return this;
  }

  /** Vector multi-line chart (trends). Nulls break the line. */
  drawLines(options: ChartOptions & { width?: number }) {
    const width = options.width ?? CONTENT_WIDTH;
    const height = options.height ?? 110;
    const labels = options.labels;
    const series = options.series;
    if (!labels.length || !series.length) return this;

    const allValues = series.flatMap((entry) => entry.values.filter((value): value is number => isFiniteNumber(value)));
    if (!allValues.length) return this;
    const { lo, hi, step } = niceBounds(Math.min(0, ...allValues), Math.max(0, ...allValues));
    const plotLeft = 48;
    const plotWidth = width - plotLeft - 8;
    const plotTop = 8;
    const plotHeight = height - plotTop - 24;

    this.ensureSpace(height + 18);
    const page = this.pages[this.pages.length - 1];
    const originY = this.cursorY;
    const xAt = (index: number) => MARGIN_LEFT + plotLeft + (labels.length === 1 ? plotWidth / 2 : (index / (labels.length - 1)) * plotWidth);
    // lo sits at the bottom of the plot, hi at the top (values grow upward).
    const yAbs = (value: number) => originY - plotTop - plotHeight + ((value - lo) / (hi - lo || 1)) * plotHeight;

    for (let value = lo; value <= hi + step / 2; value += step) {
      const y = yAbs(value);
      const isZero = Math.abs(value) < 1e-12;
      const grid = isZero ? 0.55 : 0.9;
      const weight = isZero ? 0.5 : 0.3;
      page.push(`${grid} G ${weight} w ${MARGIN_LEFT + plotLeft} ${y.toFixed(2)} m ${MARGIN_LEFT + plotLeft + plotWidth} ${y.toFixed(2)} l S`);
      const label = formatAxis(value);
      const labelWidth = measureText(label, 6.5, false);
      page.push(
        `BT /F1 6.5 Tf 0.45 0.47 0.52 rg 1 0 0 1 ${(MARGIN_LEFT + plotLeft - labelWidth - 5).toFixed(2)} ${(y - 2.2).toFixed(2)} Tm (${escapePdfText(label)}) Tj ET`,
      );
    }

    series.forEach((entry) => {
      const color = `${entry.color.r.toFixed(3)} ${entry.color.g.toFixed(3)} ${entry.color.b.toFixed(3)} RG`;
      let penDown = false;
      let previousX = 0;
      let previousY = 0;
      entry.values.forEach((value, index) => {
        if (!isFiniteNumber(value)) {
          penDown = false;
          return;
        }
        const x = xAt(index);
        const y = yAbs(value);
        if (penDown) page.push(`${color} 1.1 w ${previousX.toFixed(2)} ${previousY.toFixed(2)} m ${x.toFixed(2)} ${y.toFixed(2)} l S`);
        // Marker dot.
        page.push(
          `${entry.color.r.toFixed(3)} ${entry.color.g.toFixed(3)} ${entry.color.b.toFixed(3)} rg ` +
            `${(x - 1.3).toFixed(2)} ${(y - 1.3).toFixed(2)} 2.6 2.6 re f`,
        );
        penDown = true;
        previousX = x;
        previousY = y;
      });
    });

    labels.forEach((rawLabel, index) => {
      const label = ascii(String(rawLabel));
      const labelWidth = measureText(label, 6.5, false);
      const x = xAt(index) - labelWidth / 2;
      page.push(
        `BT /F1 6.5 Tf 0.4 0.42 0.47 rg 1 0 0 1 ${x.toFixed(2)} ${(originY - height + 12).toFixed(2)} Tm (${escapePdfText(label)}) Tj ET`,
      );
    });

    this.drawLegend(series, originY - height - 2);
    this.cursorY = originY - height - 8;
    if (this.cursorY < MARGIN_BOTTOM) this.newPage();
    if (options.sourceNote) this.sourceNote(options.sourceNote);
    return this;
  }

  private drawLegend(series: ChartSeries[], baselineY: number) {
    let x = 48;
    series.forEach((entry) => {
      const page = this.pages[this.pages.length - 1];
      page.push(
        `${entry.color.r.toFixed(3)} ${entry.color.g.toFixed(3)} ${entry.color.b.toFixed(3)} rg ` +
          `${(MARGIN_LEFT + x).toFixed(2)} ${(baselineY - 4).toFixed(2)} 8 4.5 re f`,
      );
      const nameWidth = measureText(entry.name, 6.8, false);
      page.push(
        `BT /F1 6.8 Tf 0.35 0.37 0.42 rg 1 0 0 1 ${(MARGIN_LEFT + x + 11).toFixed(2)} ${(baselineY - 3.6).toFixed(2)} Tm (${escapePdfText(ascii(entry.name))}) Tj ET`,
      );
      x += 11 + nameWidth + 14;
    });
    return this;
  }

  build(title: string, footerLeft?: string) {
    const pageCount = this.pages.length;
    const streams = this.pages.map((ops, index) => {
      const extras: string[] = [];
      const pageNumber = index + 1;
      // Running header on pages after the first.
      if (this.runningHeader && pageNumber > 1) {
        const headerY = PAGE_HEIGHT - 40;
        const rightText = this.runningHeader.slice(0, 90);
        const rightWidth = measureText(rightText, 7.5, false);
        extras.push(
          `BT /F1 7.5 Tf 0.45 0.47 0.52 rg 1 0 0 1 ${(PAGE_WIDTH - MARGIN_RIGHT - rightWidth).toFixed(2)} ${headerY.toFixed(2)} Tm (${escapePdfText(rightText)}) Tj ET`,
          `0.85 G 0.4 w ${MARGIN_LEFT} ${(headerY - 6).toFixed(2)} m ${(PAGE_WIDTH - MARGIN_RIGHT).toFixed(2)} ${(headerY - 6).toFixed(2)} l S`,
        );
      }
      // Footer: rule + label + page number on every page.
      const y = 38;
      extras.push(`0.85 G 0.4 w ${MARGIN_LEFT} ${y} m ${(PAGE_WIDTH - MARGIN_RIGHT).toFixed(2)} ${y} l S`);
      if (footerLeft) {
        const leftText = ascii(String(footerLeft)).slice(0, 90);
        extras.push(
          `BT /F1 7 Tf 0.5 0.52 0.56 rg 1 0 0 1 ${MARGIN_LEFT} ${y - 13} Tm (${escapePdfText(leftText)}) Tj ET`,
        );
      }
      const rightText = `${pageNumber} / ${pageCount}`;
      const rightWidth = measureText(rightText, 7, false);
      extras.push(
        `BT /F1 7 Tf 0.5 0.52 0.56 rg 1 0 0 1 ${(PAGE_WIDTH - MARGIN_RIGHT - rightWidth).toFixed(2)} ${y - 13} Tm (${escapePdfText(rightText)}) Tj ET`,
      );
      return [...ops, ...extras].join("\n");
    });

    const infoId = 4 + pageCount * 2 + 1;
    const objectCount = infoId;
    const objects: string[] = new Array(objectCount + 1);
    objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
    const kids = Array.from({ length: pageCount }, (_, index) => `${5 + index * 2} 0 R`).join(" ");
    objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`;
    objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
    objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
    objects[infoId] = `<< /Title (${escapePdfText(ascii(title))}) /Producer (APEX Terminal) /Creator (APEX Research Engine) >>`;

    streams.forEach((stream, index) => {
      const pageId = 5 + index * 2;
      const contentId = pageId + 1;
      objects[pageId] =
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        "/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> " +
        `/Contents ${contentId} 0 R >>`;
      objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    });

    const chunks: string[] = ["%PDF-1.4\n%\u00E2\u00E3\u00CF\u00D3\n"];
    let offset = chunks[0].length;
    const offsets: number[] = new Array(objectCount + 1).fill(0);
    for (let id = 1; id <= objectCount; id += 1) {
      offsets[id] = offset;
      const serialized = `${id} 0 obj\n${objects[id]}\nendobj\n`;
      chunks.push(serialized);
      offset += serialized.length;
    }
    const xrefOffset = offset;
    const xrefLines = [`xref\n0 ${objectCount + 1}\n`, "0000000000 65535 f \n"];
    for (let id = 1; id <= objectCount; id += 1) {
      xrefLines.push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
    }
    const trailer = `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R /Info ${infoId} 0 R >>\n`;
    const tail = `startxref\n${xrefOffset}\n%%EOF\n`;
    const body = [...chunks, ...xrefLines, trailer, tail].join("");

    const bytes = new Uint8Array(body.length);
    for (let index = 0; index < body.length; index += 1) {
      bytes[index] = body.charCodeAt(index) & 0xff;
    }
    return bytes;
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export { PAGE_WIDTH, PAGE_HEIGHT, MARGIN_LEFT, MARGIN_RIGHT, MARGIN_TOP, MARGIN_BOTTOM, CONTENT_WIDTH };
