export const isNum = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export function fmt(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (!isNum(value)) return String(value);
  const abs = Math.abs(value);
  if (abs >= 1e12) return (value / 1e12).toFixed(2) + "T";
  if (abs >= 1e9) return (value / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return (value / 1e6).toFixed(2) + "M";
  if (abs >= 1e3) return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function signed(value: unknown, digits = 2): string {
  if (!isNum(value)) return "—";
  return (value >= 0 ? "+" : "") + value.toFixed(digits);
}

export function pct(value: unknown, digits = 1): string {
  if (!isNum(value)) return "—";
  return (value * 100).toFixed(digits) + "%";
}

export function num(value: unknown, digits = 2): string {
  if (!isNum(value)) return "—";
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function money(value: unknown, currency = "USD"): string {
  if (!isNum(value)) return "—";
  return value.toLocaleString(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  });
}

export function periodLabel(period: unknown): string {
  if (typeof period !== "string") return "—";
  if (/^\d{4}-\d{2}-\d{2}/.test(period)) return period.slice(0, 7);
  return period;
}

/** Whole keys needing hyphenation or acronym restructuring. */
const HUMANIZE_PHRASES: Record<string, string> = {
  change_in_wc: "Change in working capital",
  da_cf: "D&A",
  stock_based_comp: "Stock-based compensation",
  total_non_current_assets: "Total non-current assets",
  total_non_current_liabilities: "Total non-current liabilities",
  ppe_net: "PP&E, net",
  end_cash: "Ending cash",
  cash_and_equivalents: "Cash & equivalents",
  short_term_investments: "Short-term investments",
  long_term_debt: "Long-term debt",
  working_capital: "Working capital",
};

/** Financial acronyms and units that title case mangles. Exact word match. */
const HUMANIZE_ACRONYMS: Record<string, string> = {
  ebit: "EBIT",
  ebitda: "EBITDA",
  eps: "EPS",
  da: "D&A",
  sga: "SG&A",
  wc: "WC",
  nwc: "NWC",
  ppe: "PP&E",
  capex: "Capex",
  opex: "Opex",
  wacc: "WACC",
  roic: "ROIC",
  roe: "ROE",
  roa: "ROA",
  dcf: "DCF",
  ev: "EV",
  fcf: "FCF",
  cagr: "CAGR",
  ltm: "LTM",
  ttm: "TTM",
  yoy: "YoY",
  arr: "ARR",
  nrr: "NRR",
  rpo: "RPO",
  pct: "%",
  ai: "AI",
};

/** Little words stay lowercase in sentence-style labels. */
const HUMANIZE_SMALL_WORDS = new Set(["of", "in", "on", "at", "and", "or", "vs", "the", "for", "per", "to", "a"]);

/**
 * Snake_case keys become sentence-style labels ("deferred_tax" -> "Deferred tax")
 * so financial statements read like prose; acronyms are preserved ("eps" -> "EPS").
 * Inputs that already contain capitals are treated as pre-formatted and keep
 * their per-word casing.
 */
export function humanize(value: string): string {
  const phrase = HUMANIZE_PHRASES[value.toLowerCase()];
  if (phrase) return phrase;
  const preFormatted = value !== value.toLowerCase();
  return value
    .replaceAll("_", " ")
    .split(" ")
    .map((word, index) => {
      const lower = word.toLowerCase();
      const acronym = HUMANIZE_ACRONYMS[lower];
      if (acronym) return acronym;
      if (index > 0 && HUMANIZE_SMALL_WORDS.has(lower)) return lower;
      if (index > 0 && !preFormatted) return lower;
      return lower.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

export function safeNumber(value: unknown, fallback = 0): number {
  if (isNum(value)) return value;
  const parsed = typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function tone(value: unknown): string {
  if (!isNum(value)) return "text-muted";
  if (value > 0) return "text-pos";
  if (value < 0) return "text-neg";
  return "text-muted";
}

export function localDate(value: unknown): string {
  if (typeof value !== "string") return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
