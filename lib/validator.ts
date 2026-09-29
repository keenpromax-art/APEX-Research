import type { AnalysisContext, AnalysisDocument, Block } from "./types";

const NUMBER_RE = /(?<![A-Za-z0-9])-?\$?\d[\d,]*(?:\.\d+)?\s?[%x]?(?![A-Za-z0-9])/g;
const SUFFIX_SCALE_RE = /^(-?[\d,]+(?:\.\d+)?)\s?([KkMmBbTt])?$/;
const DATE_RE = /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g;
const QUARTER_RE = /\b(?:Q[1-4]|FY\d{4}|H[12])(?:\s?FY?\d{4})?\b/g;
const ALLOWED_SMALL_INTEGERS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
const REL_TOLERANCE = 0.02;
const ABS_TOLERANCE = 0.005;

export class ValidationFailure extends Error {
  problems: string[];
  constructor(problems: string[]) {
    super(problems.slice(0, 10).join("; "));
    this.name = "ValidationFailure";
    this.problems = problems;
  }
}

export function parseDocument(raw: string): AnalysisDocument {
  let text = raw.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new ValidationFailure([`AI output is not valid JSON: ${e}`]);
  }
  const doc = data as Partial<AnalysisDocument>;
  if (typeof doc.title !== "string" || typeof doc.summary !== "string" || !Array.isArray(doc.blocks) || doc.blocks.length === 0) {
    throw new ValidationFailure(["AI output does not match the block schema: title, summary and non-empty blocks are required"]);
  }
  const VALID_BLOCK_TYPES = new Set([
    "heading",
    "paragraph",
    "metric",
    "table",
    "chart",
    "callout",
    "list",
    "formula",
    "provenance",
  ]);
  for (const [i, block] of doc.blocks.entries()) {
    if (!block || typeof block.type !== "string" || !VALID_BLOCK_TYPES.has(block.type)) {
      throw new ValidationFailure([`block[${i}]: missing or invalid type`]);
    }
  }
  return doc as AnalysisDocument;
}

export class OutputValidator {
  private known = new Set<number>();
  private metricIndex = new Map<string, number>();
  private seriesIndex = new Set<string>();

  constructor(private context: AnalysisContext) {
    this.collect();
  }

  validate(document: AnalysisDocument): void {
    const problems: string[] = [];
    document.blocks.forEach((block, i) => {
      problems.push(...this.validateBlock(block, i));
    });
    if (problems.length > 0) throw new ValidationFailure(problems);
  }

  private validateBlock(block: Block, index: number): string[] {
    const where = `block[${index}](${block.type})`;
    switch (block.type) {
      case "heading":
      case "paragraph":
        return this.checkText(block.content, where);
      case "callout":
        return this.checkText(block.content, where);
      case "list":
        return block.items.flatMap((item) => this.checkText(item, where));
      case "metric":
        return this.validateMetric(block, where);
      case "table":
        return block.rows.flatMap((row, r) =>
          row.flatMap((cell, c) =>
            typeof cell === "number" ? this.checkNumber(cell, `${where} row[${r}] col[${c}]`) : []
          )
        );
      case "chart":
        return this.validateChart(block, where);
      case "formula":
        return block.result !== null && block.result !== undefined
          ? this.checkNumber(block.result, where)
          : [];
      case "provenance":
        return block.items.flatMap((item) => [
          ...this.checkText(item.claim, where),
          ...(item.value !== null && item.value !== undefined ? this.checkNumber(item.value, where) : []),
        ]);
      default:
        return [];
    }
  }

  private validateMetric(block: Extract<Block, { type: "metric" }>, where: string): string[] {
    const problems: string[] = [];
    const metric = this.metricIndex.get(block.metricKey);
    if (metric === undefined) {
      problems.push(`${where}: unknown metricKey '${block.metricKey}'`);
    } else if (Math.abs(block.value - metric) > Math.max(0.001 * Math.abs(metric), 1e-9)) {
      problems.push(`${where}: value ${block.value} does not match metric '${block.metricKey}' (${metric})`);
    }
    if (block.change !== null && block.change !== undefined) {
      problems.push(...this.checkNumber(block.change, where));
    }
    return problems;
  }

  private validateChart(block: Extract<Block, { type: "chart" }>, where: string): string[] {
    const problems: string[] = [];
    if (block.ref !== null && block.ref !== undefined) {
      if (!this.seriesIndex.has(block.ref)) problems.push(`${where}: unknown series ref '${block.ref}'`);
    }
    if (block.data) {
      for (const point of block.data) problems.push(...this.checkNumber(point.value, where));
    }
    if (block.ref === null && !block.data) problems.push(`${where}: chart needs either a ref or inline data`);
    return problems;
  }

  private checkText(text: string, where: string): string[] {
    const cleaned = text.replace(DATE_RE, " ").replace(QUARTER_RE, " ");
    const problems: string[] = [];
    for (const match of cleaned.matchAll(NUMBER_RE)) {
      const parsed = parseNumber(match[0]);
      if (parsed !== null) problems.push(...this.checkNumber(parsed, where));
    }
    return problems;
  }

  private checkNumber(value: number, where: string): string[] {
    if (this.isAllowedUnchecked(value)) return [];
    if (this.matchesKnown(value)) return [];
    return [`${where}: number ${value} is not traceable to the provided dataset`];
  }

  private isAllowedUnchecked(value: number): boolean {
    if (value === 0) return true;
    if (Number.isInteger(value) && ALLOWED_SMALL_INTEGERS.has(value)) return true;
    if (Number.isInteger(value) && value >= 1990 && value <= 2030) return true;
    return false;
  }

  private matchesKnown(value: number): boolean {
    for (const known of this.known) {
      if (Math.abs(value - known) <= Math.max(REL_TOLERANCE * Math.abs(known), ABS_TOLERANCE)) return true;
    }
    return false;
  }

  private collect(): void {
    for (const company of this.context.companies) {
      this.collectNumbers(company.market);
      this.collectNumbers(company.price);
      this.collectNumbers(company.valuation);
      this.collectNumbers(company.analystData);
      for (const statement of [
        company.financials.incomeStatement,
        company.financials.balanceSheet,
        company.financials.cashFlow,
      ]) {
        this.collectStatement(statement);
      }
      for (const statement of Object.values(company.financials.quarterly)) {
        this.collectStatement(statement);
      }
      for (const dividend of company.dividends ?? []) this.addNumber(dividend.amount);
      for (const row of company.earnings?.recent ?? []) this.collectNumbers(row);
      for (const [key, metric] of Object.entries(company.derivedMetrics)) {
        if (metric.value !== null && metric.value !== undefined) {
          this.addNumber(metric.value);
          this.metricIndex.set(key, metric.value);
        }
        for (const periodValue of Object.values(metric.byPeriod ?? {})) {
          if (periodValue !== null) this.addNumber(periodValue);
        }
      }
      for (const [seriesName, points] of Object.entries(company.series)) {
        this.seriesIndex.add(seriesName);
        for (const point of points) this.addNumber(point.value);
      }
    }
  }

  private collectStatement(statement: unknown): void {
    if (!statement || typeof statement !== "object") return;
    const lineItems = (statement as { lineItems?: Record<string, Record<string, number | null>> }).lineItems;
    if (!lineItems) return;
    for (const values of Object.values(lineItems)) {
      for (const value of Object.values(values)) {
        if (typeof value === "number") this.addNumber(value);
      }
    }
  }

  private collectNumbers(obj: unknown): void {
    if (Array.isArray(obj)) {
      for (const value of obj) this.collectNumbers(value);
    } else if (obj && typeof obj === "object") {
      for (const value of Object.values(obj)) this.collectNumbers(value);
    } else if (typeof obj === "number") {
      this.addNumber(obj);
    }
  }

  private addNumber(value: number): void {
    this.known.add(value);
    this.known.add(value * 100);
    this.known.add(value / 1_000_000);
    this.known.add(value / 1_000_000_000);
  }
}

function parseNumber(token: string): number | null {
  let cleaned = token.replace(/,/g, "").replace("$", "").trim();
  const isPercent = cleaned.endsWith("%");
  if (isPercent) cleaned = cleaned.slice(0, -1);
  cleaned = cleaned.replace(/[xX]$/, "").trim();
  const match = SUFFIX_SCALE_RE.exec(cleaned);
  if (!match) return null;
  const value = parseFloat(match[1]);
  if (Number.isNaN(value)) return null;
  const suffix = (match[2] ?? "").toLowerCase();
  const scale = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[suffix as "k" | "m" | "b" | "t"] ?? 1;
  return (value * scale) / (isPercent ? 100 : 1);
}
