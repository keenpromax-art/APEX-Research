// ============================================================
// APEX RESEARCH — Units, Money & Strict Financial Metrics
// Single source of truth for units, currency scaling, and null-safety
// ============================================================

export type MetricStatus = "valid" | "missing" | "invalid" | "not_applicable";

export type SourceType = "reported" | "derived" | "assumption" | "consensus";

export interface FinancialMetric<T = number> {
  value: T | null;
  status: MetricStatus;
  unit: string;
  period?: string;
  source?: string;
  sourceType?: SourceType;
  provenanceNote?: string;
}

export interface Money {
  amount: number | null;
  currency: string;
  status: MetricStatus;
  scale?: "raw" | "thousand" | "lakh" | "million" | "crore" | "billion" | "trillion";
}

export interface ShareCount {
  shares: number | null;
  status: MetricStatus;
  source: string;
  period?: string;
}

// ─────────────────────────────────────────────────────────────
// Metric Constructor Helpers
// ─────────────────────────────────────────────────────────────
export function createMetric<T>(
  value: T | null | undefined,
  unit: string,
  statusOrOptions?: MetricStatus | {
    source?: string;
    sourceType?: SourceType;
    period?: string;
    provenanceNote?: string;
    isNotApplicable?: boolean;
  },
  sourceArg?: string,
  sourceTypeArg?: SourceType
): FinancialMetric<T> {
  const options = typeof statusOrOptions === "object" && statusOrOptions !== null
    ? statusOrOptions
    : {
        source: sourceArg,
        sourceType: sourceTypeArg,
        isNotApplicable: statusOrOptions === "not_applicable"
      };

  if (options?.isNotApplicable || statusOrOptions === "not_applicable") {
    return {
      value: null,
      status: "not_applicable",
      unit,
      period: options?.period,
      source: options?.source,
      sourceType: options?.sourceType,
      provenanceNote: options?.provenanceNote,
    };
  }

  if (value === null || value === undefined || (typeof value === "number" && (!isFinite(value) || isNaN(value)))) {
    return {
      value: null,
      status: typeof statusOrOptions === "string" && statusOrOptions !== "valid" ? statusOrOptions : "missing",
      unit,
      period: options?.period,
      source: options?.source,
      sourceType: options?.sourceType,
      provenanceNote: options?.provenanceNote,
    };
  }

  return {
    value,
    status: "valid",
    unit,
    period: options?.period,
    source: options?.source,
    sourceType: options?.sourceType,
    provenanceNote: options?.provenanceNote,
  };
}

export function createMoney(
  amount: number | null | undefined,
  currency = "INR",
  source = "Reported"
): Money {
  if (amount === null || amount === undefined || !isFinite(amount) || isNaN(amount)) {
    return { amount: null, currency, status: "missing" };
  }
  return { amount, currency, status: "valid" };
}

export function createShareCount(
  shares: number | null | undefined,
  source = "Reported",
  period?: string
): ShareCount {
  if (shares === null || shares === undefined || !isFinite(shares) || isNaN(shares) || shares <= 0) {
    return { shares: null, status: "missing", source, period };
  }
  return { shares, status: "valid", source, period };
}

// ─────────────────────────────────────────────────────────────
// Dimensional branded types  (P0 #2, #3 — no naked monetary numbers
// in NEW pipeline code; currency/scale ride with every money value)
// ─────────────────────────────────────────────────────────────
declare const __brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [__brand]: B };

/** Money dimension: value + currency + scale travel together. */
export interface MoneyDim {
  readonly kind: "money";
  readonly value: number;
  readonly currency: string;
  readonly scale: "raw" | "thousand" | "lakh" | "million" | "crore" | "billion" | "trillion";
}
export type Shares = Brand<number, "shares">;
export type Price = Brand<number, "price">;
export type Pct = Brand<number, "pct-fraction">;
export type Multiple = Brand<number, "multiple">;
export type Days = Brand<number, "days">;

export function asMoney(value: number, currency: string, scale: MoneyDim["scale"] = "raw"): MoneyDim {
  return { kind: "money", value: Number(value) || 0, currency: (currency || "UNKNOWN").toUpperCase(), scale };
}

export function asShares(value: number): Shares {
  return (Number(value) || 0) as Shares;
}

export function asPrice(value: number): Price {
  return (Number(value) || 0) as Price;
}

/** Fractions only (0.12 = 12%). Values outside [−5, 5] are returned as-is but flagged by callers. */
export function asPct(value: number): Pct {
  return (Number(value) || 0) as Pct;
}

export function asMultiple(value: number): Multiple {
  return (Number(value) || 0) as Multiple;
}

export function asDays(value: number): Days {
  return (Number(value) || 0) as Days;
}

/** Convert MoneyDim across display scales without touching currency. */
export function convertMoneyScale(m: MoneyDim, to: MoneyDim["scale"]): MoneyDim {
  const perUnit: Record<MoneyDim["scale"], number> = {
    raw: 1, thousand: 1e3, lakh: 1e5, million: 1e6, crore: 1e7, billion: 1e9, trillion: 1e12,
  };
  return { ...m, value: (m.value * (perUnit[m.scale] ?? 1)) / (perUnit[to] ?? 1), scale: to };
}

// ─────────────────────────────────────────────────────────────
// Dimensional bridge  (P0 #2, #3, #90 — Money {value, currency, scale};
// no naked monetary numbers in NEW pipeline code; dimensional ops in
// financial-kernel MoneyOps throw on USD×shares / %×USD style errors)
// ─────────────────────────────────────────────────────────────
import type { DimValue } from "./financial-kernel";

/** Lift a legacy Money metric into a dimension-checked value (null when missing). */
export function toDimValue(m: Money | null | undefined): DimValue | null {
  if (!m || m.amount === null || !Number.isFinite(m.amount)) return null;
  return { kind: "money", value: m.amount as number, currency: m.currency };
}

/** Lift a share count into a dimension-checked value (null when missing). */
export function toDimShares(shares: number | null | undefined): DimValue | null {
  if (shares === null || shares === undefined || !Number.isFinite(shares) || shares <= 0) return null;
  return { kind: "shares", value: shares };
}

/** Lift a price into a dimension-checked value (null when missing). */
export function toDimPrice(price: number | null | undefined, currency?: string): DimValue | null {
  if (price === null || price === undefined || !Number.isFinite(price) || price <= 0) return null;
  return { kind: "price", value: price, currency };
}

// ─────────────────────────────────────────────────────────────
// Presentation-Layer Formatting (ONLY for UI/PDF display)
// NEVER use formatted strings inside calculation internals
// ─────────────────────────────────────────────────────────────
export function getCurrencySymbol(currency = "INR"): string {
  const c = currency.toUpperCase();
  if (c === "INR") return "₹";
  if (c === "USD") return "$";
  if (c === "EUR") return "€";
  if (c === "GBP") return "£";
  if (c === "JPY") return "¥";
  return c + " ";
}

export interface FormatMoneyOptions {
  currency?: string;
  displayScale?: "auto" | "raw" | "crore" | "lakh" | "million" | "billion" | "trillion";
  decimals?: number;
  showCurrency?: boolean;
}

export function formatMoney(
  input: number | FinancialMetric<number> | Money | null | undefined,
  options: FormatMoneyOptions = {}
): string {
  const {
    currency = "INR",
    displayScale = "auto",
    decimals = 2,
    showCurrency = true,
  } = options;

  let val: number | null = null;
  let status: MetricStatus = "valid";

  if (input === null || input === undefined) {
    return "N/A";
  }

  if (typeof input === "number") {
    val = input;
  } else if ("status" in input && "amount" in input) {
    val = input.amount;
    status = input.status;
  } else if ("status" in input && "value" in input) {
    val = input.value;
    status = input.status;
  }

  if (status !== "valid" || val === null || !isFinite(val) || isNaN(val)) {
    return "N/A";
  }

  // Exact zero check
  if (val === 0) {
    const sym = showCurrency ? getCurrencySymbol(currency) : "";
    return `${sym}0.00`;
  }

  const sym = showCurrency ? getCurrencySymbol(currency) : "";
  const sign = val < 0 ? "-" : "";
  const abs = Math.abs(val);

  if (currency.toUpperCase() === "INR") {
    if (displayScale === "crore" || (displayScale === "auto" && abs >= 1e7)) {
      return `${sign}${sym}${(abs / 1e7).toLocaleString("en-IN", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })} Cr`;
    }
    if (displayScale === "lakh" || (displayScale === "auto" && abs >= 1e5)) {
      return `${sign}${sym}${(abs / 1e5).toLocaleString("en-IN", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })} L`;
    }
    return `${sign}${sym}${abs.toLocaleString("en-IN", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}`;
  }

  // Western scales (USD, EUR, etc.)
  if (displayScale === "trillion" || (displayScale === "auto" && abs >= 1e12)) {
    return `${sign}${sym}${(abs / 1e12).toFixed(decimals)}T`;
  }
  if (displayScale === "billion" || (displayScale === "auto" && abs >= 1e9)) {
    return `${sign}${sym}${(abs / 1e9).toFixed(decimals)}B`;
  }
  if (displayScale === "million" || (displayScale === "auto" && abs >= 1e6)) {
    return `${sign}${sym}${(abs / 1e6).toFixed(decimals)}M`;
  }

  return `${sign}${sym}${abs.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

export function formatPercent(
  val: number | FinancialMetric<number> | null | undefined,
  decimals = 1,
  includeSign = false
): string {
  let num: number | null = null;
  if (typeof val === "number") {
    num = val;
  } else if (val && "value" in val) {
    num = val.value;
  }

  if (num === null || num === undefined || !isFinite(num) || isNaN(num)) {
    return "N/A";
  }

  const pct = num * 100;
  const sign = includeSign && pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(decimals)}%`;
}

export function formatMultiple(
  val: number | FinancialMetric<number> | null | undefined,
  decimals = 1
): string {
  let num: number | null = null;
  if (typeof val === "number") {
    num = val;
  } else if (val && "value" in val) {
    num = val.value;
  }

  if (num === null || num === undefined || !isFinite(num) || isNaN(num) || num <= 0) {
    return "N/A";
  }

  return `${num.toFixed(decimals)}x`;
}

export function formatShares(shares: number | null | undefined, currency = "INR"): string {
  if (shares === null || shares === undefined || !isFinite(shares) || isNaN(shares) || shares <= 0) {
    return "N/A";
  }

  if (currency.toUpperCase() === "INR") {
    if (shares >= 1e7) {
      return `${(shares / 1e7).toFixed(2)} Cr shares`;
    }
    if (shares >= 1e5) {
      return `${(shares / 1e5).toFixed(2)} Lakh shares`;
    }
  } else {
    if (shares >= 1e9) {
      return `${(shares / 1e9).toFixed(2)}B shares`;
    }
    if (shares >= 1e6) {
      return `${(shares / 1e6).toFixed(2)}M shares`;
    }
  }

  return `${shares.toLocaleString()} shares`;
}
