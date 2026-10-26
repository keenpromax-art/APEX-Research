import { isNum } from "./format";

// ---------------------------------------------------------------------------
// Listing identity: tickers are mapped to their listing venue and currency so
// that a ".NS" (NSE, India) listing is never presented as a US/USD equity and
// INR figures are never silently mixed with USD figures.
// ---------------------------------------------------------------------------

export type Market = "US" | "IN" | "UK" | "JP" | "DE" | "DEMO";

export type ListingProfile = {
  ticker: string;
  baseTicker: string; // ticker without exchange suffix
  suffix: string; // e.g. ".NS"
  exchange: string;
  currency: string;
  market: Market;
  /** Human description of the venue, e.g. "NSE (India)". */
  venueLabel: string;
  isDemo: boolean;
};

const SUFFIX_MAP: Record<string, { exchange: string; currency: string; market: Market; venueLabel: string }> = {
  ".NS": { exchange: "NSE", currency: "INR", market: "IN", venueLabel: "NSE (India)" },
  ".BO": { exchange: "BSE", currency: "INR", market: "IN", venueLabel: "BSE (India)" },
  ".L": { exchange: "LSE", currency: "GBp", market: "UK", venueLabel: "LSE (United Kingdom)" },
  ".T": { exchange: "TSE", currency: "JPY", market: "JP", venueLabel: "TSE (Japan)" },
  ".DE": { exchange: "XETRA", currency: "EUR", market: "DE", venueLabel: "XETRA (Germany)" },
};

export function parseListing(tickerInput: unknown): ListingProfile {
  const raw = String(tickerInput ?? "").trim().toUpperCase();
  const suffixEntry = Object.entries(SUFFIX_MAP).find(([suffix]) => raw.endsWith(suffix));
  if (suffixEntry) {
    const [suffix, meta] = suffixEntry;
    return {
      ticker: raw,
      baseTicker: raw.slice(0, -suffix.length),
      suffix,
      exchange: meta.exchange,
      currency: meta.currency,
      market: meta.market,
      venueLabel: meta.venueLabel,
      isDemo: false,
    };
  }
  if (raw === "DEMO" || raw.startsWith("DEMO")) {
    return {
      ticker: raw,
      baseTicker: raw,
      suffix: "",
      exchange: "DEMO",
      currency: "USD",
      market: "DEMO",
      venueLabel: "Local demonstration fixture",
      isDemo: true,
    };
  }
  return {
    ticker: raw,
    baseTicker: raw,
    suffix: "",
    exchange: "NASDAQ / NYSE",
    currency: "USD",
    market: "US",
    venueLabel: "US listing (NASDAQ / NYSE)",
    isDemo: false,
  };
}

// ---------------------------------------------------------------------------
// Identity + data validation
// ---------------------------------------------------------------------------

export type IssueSeverity = "error" | "warn" | "info";

export type ValidationIssue = {
  severity: IssueSeverity;
  code: string;
  message: string;
  /** True when the issue blocks publishing a rating / target price. */
  blocking?: boolean;
};

export type IdentityContext = {
  ticker: string;
  company: Record<string, any>;
  normalized: Record<string, any>;
  priceSummary: Record<string, any> | null;
};

/**
 * Validate ticker/company/exchange/currency/share-count/period alignment before
 * a report can carry an investment rating. Blocking issues suppress the rating.
 */
export function validateIdentity(ctx: IdentityContext): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const listing = parseListing(ctx.ticker);
  const info = ctx.normalized?.info || {};
  const company = ctx.company || {};

  if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(listing.ticker)) {
    issues.push({
      severity: "error",
      code: "ticker.format",
      message: `"${ctx.ticker}" is not a recognised ticker symbol format.`,
      blocking: true,
    });
  }

  // Exchange / currency consistency: an NSE listing must not claim a US venue.
  const declaredCurrency = String(company.currency || info.currency || "");
  if (declaredCurrency && declaredCurrency !== listing.currency) {
    issues.push({
      severity: "error",
      code: "currency.mismatch",
      message: `Listing ${listing.venueLabel} trades in ${listing.currency} but the dataset declares ${declaredCurrency}; figures were not converted.`,
      blocking: true,
    });
  }

  const declaredExchange = String(company.exchange || info.exchange || "");
  if (listing.market === "IN" && declaredExchange && !/NSE|BSE/i.test(declaredExchange)) {
    issues.push({
      severity: "error",
      code: "exchange.mismatch",
      message: `${listing.ticker} maps to ${listing.venueLabel} but the dataset declares "${declaredExchange}".`,
      blocking: true,
    });
  }

  // Share count.
  const shares = info.sharesOutstanding;
  if (!isNum(shares) || shares <= 0) {
    issues.push({
      severity: "error",
      code: "shares.missing",
      message: "Shares outstanding are missing or non-positive; per-share values cannot be trusted.",
      blocking: true,
    });
  }

  // Price.
  const lastClose = ctx.priceSummary?.last_close;
  if (!isNum(lastClose) || lastClose <= 0) {
    issues.push({
      severity: "error",
      code: "price.missing",
      message: "No usable last close price; upside and rating are suppressed.",
      blocking: true,
    });
  }

  // Period alignment: annual statements must be strictly descending and unique.
  const annual: any[] = ctx.normalized?.annual?.income_statement || [];
  if (!annual.length) {
    issues.push({
      severity: "error",
      code: "history.missing",
      message: "No annual income-statement periods are available.",
      blocking: true,
    });
  } else {
    const periods = annual.map((row) => String(row.period_end || ""));
    const years = periods.map((period) => Number(period.slice(0, 4)));
    const invalidYear = years.some((year) => !Number.isInteger(year) || year < 1990 || year > 2100);
    if (invalidYear) {
      issues.push({
        severity: "error",
        code: "period.malformed",
        message: "At least one fiscal period has a malformed year label.",
        blocking: true,
      });
    }
    const duplicates = years.filter((year, index) => years.indexOf(year) !== index);
    if (duplicates.length) {
      issues.push({
        severity: "error",
        code: "period.duplicate",
        message: `Duplicate fiscal years detected (${[...new Set(duplicates)].join(", ")}).`,
        blocking: true,
      });
    }
    for (let index = 1; index < years.length; index += 1) {
      if (years[index] >= years[index - 1]) {
        issues.push({
          severity: "warn",
          code: "period.order",
          message: "Annual periods are not in strict descending order; coverage is reported as supplied.",
        });
        break;
      }
    }
    if (annual.length < 3) {
      issues.push({
        severity: "warn",
        code: "history.short",
        message: `Only ${annual.length} annual period(s) available; multi-year trend tables are limited.`,
      });
    }
    // Staleness: latest period more than ~18 months before "now".
    const latestEnd = Date.parse(`${String(annual[0].period_end || "").slice(0, 10)}T00:00:00Z`);
    if (Number.isFinite(latestEnd)) {
      const monthsOld = (Date.now() - latestEnd) / (30.44 * 24 * 3600 * 1000);
      if (monthsOld > 18) {
        issues.push({
          severity: "warn",
          code: "data.stale",
          message: `Latest reported period is ~${Math.round(monthsOld)} months old; estimates may be stale.`,
        });
      }
    }
  }

  // Currency single-currency rule inside statements (no mixed-currency flags exist
  // in the fixture schema, but market-cap sanity vs price x shares catches unit bugs).
  const marketCap = info.marketCap;
  if (isNum(marketCap) && isNum(shares) && shares > 0 && isNum(lastClose)) {
    const implied = shares * lastClose;
    if (implied > 0 && (marketCap / implied > 4 || marketCap / implied < 0.25)) {
      issues.push({
        severity: "warn",
        code: "units.mismatch",
        message: `Market cap (${marketCap}) differs from price x shares (${Math.round(implied)}) by more than 4x; check units/currency.`,
      });
    }
  }

  // Synthetic data: every offline fixture is labelled, never hidden.
  if (company.demo || listing.isDemo) {
    issues.push({
      severity: "warn",
      code: "data.synthetic",
      message: "Figures come from the deterministic local fixture (synthetic demonstration data).",
    });
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Provenance rows
// ---------------------------------------------------------------------------

export type ProvenanceStatus = "actual" | "estimate" | "assumption" | "synthetic" | "derived";

export type ProvenanceRow = {
  metric: string;
  value_label: string;
  unit: string;
  currency: string | null;
  period: string | null;
  source: string;
  retrieved_at: string | null;
  status: ProvenanceStatus;
};

export type ProvenanceContext = {
  ticker: string;
  listing: ListingProfile;
  normalized: Record<string, any>;
  actuals: Record<string, any> | null;
  forecast: Record<string, any> | null;
  dcf: Record<string, any> | null;
  assumptions: Record<string, any> | null;
  /** Per-driver source labels (user input / derived from reported history / engine default). */
  assumptionSources?: Record<string, any> | null;
  retrievedAt: string | null;
  isSynthetic: boolean;
  /** Label for provider-sourced rows, e.g. "Yahoo Finance (retrieved ...)" */
  source?: string;
};

function statusFor(isSynthetic: boolean, kind: ProvenanceStatus): ProvenanceStatus {
  // Synthetic fixture data is always tagged as synthetic regardless of kind.
  if (isSynthetic && (kind === "actual" || kind === "estimate")) return "synthetic";
  return kind;
}

export function buildProvenanceRows(ctx: ProvenanceContext): ProvenanceRow[] {
  const rows: ProvenanceRow[] = [];
  const source = ctx.isSynthetic
    ? "APEX local deterministic fixture (synthetic)"
    : ctx.source || "Configured market-data provider";
  const retrieved = ctx.retrievedAt ?? null;
  const currency = ctx.listing.currency;

  const actuals = ctx.actuals || {};
  const annual: any[] = ctx.normalized?.annual?.income_statement || [];
  const period = annual[0]?.period_end ? String(annual[0].period_end).slice(0, 10) : null;

  const add = (
    metric: string,
    value: unknown,
    unit: string,
    kind: ProvenanceStatus,
    rowCurrency: string | null = null,
    rowPeriod: string | null = period,
  ) => {
    rows.push({
      metric,
      value_label: isNum(value) ? value.toLocaleString("en-US", { maximumFractionDigits: 2 }) : value == null ? "n/a" : String(value),
      unit,
      currency: rowCurrency,
      period: rowPeriod,
      source,
      retrieved_at: retrieved,
      status: statusFor(ctx.isSynthetic, kind),
    });
  };

  add("Revenue", actuals.revenue, `${currency} absolute`, "actual", currency);
  add("Revenue growth", actuals.revenue_growth, "% (decimal)", "derived", null);
  add("Gross margin", actuals.gross_margin, "% (decimal)", "derived", null);
  add("Operating margin", actuals.operating_margin, "% (decimal)", "derived", null);
  add("Net income", actuals.net_income, `${currency} absolute`, "actual", currency);
  add("EBITDA", actuals.ebitda, `${currency} absolute`, "actual", currency);
  add("Free cash flow", actuals.fcf, `${currency} absolute`, "actual", currency);
  add("Net debt", actuals.net_debt, `${currency} absolute`, "derived", currency);
  add("Diluted EPS", actuals.eps_diluted, `${currency} per share`, "actual", currency);
  add("Shares outstanding", ctx.normalized?.info?.sharesOutstanding, "shares", "actual", null);

  const assumptions = ctx.assumptions || {};
  const assumptionSources = ctx.assumptionSources || {};
  Object.entries(assumptions).forEach(([key, value]) => {
    if (!isNum(value)) return;
    const sourceLabel = String(assumptionSources[key] || "User / engine default (documented assumption)");
    rows.push({
      metric: `Assumption: ${key.replaceAll("_", " ")}`,
      value_label: String(Number(value.toPrecision(6))),
      unit: key.includes("rate") || key.includes("margin") || key.includes("pct") || key.includes("growth") || key.includes("dilution") || key.includes("sweep") || key.includes("payout") ? "% (decimal)" : "scalar",
      currency: null,
      period: "forecast horizon",
      source: sourceLabel,
      retrieved_at: null,
      status: sourceLabel.startsWith("Derived") ? "derived" : "assumption",
    });
  });

  if (ctx.dcf && !ctx.dcf.error) {
    add("DCF value per share", ctx.dcf.value_per_share, `${currency} per share`, "derived", currency, "valuation date");
    add("WACC", ctx.dcf.wacc, "% (decimal)", "assumption", null, "valuation date");
    add("Enterprise value", ctx.dcf.enterprise_value, `${currency} absolute`, "derived", currency, "valuation date");
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Integrity gates
// ---------------------------------------------------------------------------

export type IntegrityGates = {
  ratingAllowed: boolean;
  targetAllowed: boolean;
  blockers: ValidationIssue[];
  warnings: ValidationIssue[];
};

export function integrityGates(issues: ValidationIssue[]): IntegrityGates {
  const blockers = issues.filter((issue) => issue.severity === "error" || issue.blocking);
  return {
    ratingAllowed: blockers.length === 0,
    targetAllowed: blockers.length === 0,
    blockers,
    warnings: issues.filter((issue) => issue.severity !== "error" && !issue.blocking),
  };
}

// ---------------------------------------------------------------------------
// Sector analytical modules — only frame questions the data can answer, and
// explicitly disclose sector-specific metrics that are NOT in the dataset.
// Never synthesises segment shares, market shares or customer names.
// ---------------------------------------------------------------------------

export type SectorProfile = {
  key: "bank" | "software" | "energy" | "manufacturing" | "consumer" | "generic";
  label: string;
  /** Metrics a professional note in this sector would cover. */
  watchMetrics: { name: string; available: boolean; note?: string }[];
  /** Framing sentence used in the narrative when data is missing. */
  disclosure: string;
};

const SECTOR_RULES: { match: RegExp; build: (label: string) => SectorProfile }[] = [
  {
    match: /bank|financial|insurance|capital|securities/i,
    build: (label) => ({
      key: "bank",
      label,
      watchMetrics: [
        { name: "Net interest margin (NIM)", available: false, note: "not present in the statement schema" },
        { name: "Asset quality (GNPA / NNPA)", available: false, note: "not present in the statement schema" },
        { name: "Capital adequacy (CET-1)", available: false, note: "not present in the statement schema" },
        { name: "Loan growth & deposits", available: false, note: "not present in the statement schema" },
        { name: "Return on equity", available: true },
      ],
      disclosure:
        "A banking note would normally analyse net interest margin, asset quality and capital adequacy. " +
        "The current dataset carries only generic corporate statements, so those metrics are unavailable and are not estimated.",
    }),
  },
  {
    match: /software|semiconductor|technolog|it services|information|electronics|internet/i,
    build: (label) => ({
      key: "software",
      label,
      watchMetrics: [
        { name: "Revenue growth", available: true },
        { name: "Gross margin", available: true },
        { name: "Operating margin / operating leverage", available: true },
        { name: "Cash conversion", available: true },
        { name: "Recurring-revenue mix (ARR / NRR)", available: false, note: "not disclosed in the dataset" },
      ],
      disclosure:
        "Recurring-revenue metrics (ARR, net revenue retention, RPO) are not present in the dataset; " +
        "growth and margin analysis relies on reported total revenue only.",
    }),
  },
  {
    match: /oil|gas|energy|mining|chemical|agro|fertiliz|metals|utilities/i,
    build: (label) => ({
      key: "energy",
      label,
      watchMetrics: [
        { name: "Revenue and margins", available: true },
        { name: "Working-capital intensity", available: true },
        { name: "Commodity price exposure", available: false, note: "no realised-price or volume split in the dataset" },
        { name: "Reserves / production volumes", available: false, note: "not disclosed in the dataset" },
        { name: "Project/asset pipeline", available: false, note: "not disclosed in the dataset" },
      ],
      disclosure:
        "Commodity price and volume splits, reserves and project pipelines are not available; cyclicality " +
        "is discussed only through reported revenue and margin history.",
    }),
  },
  {
    match: /manufactur|industrial|engineering|auto|equipment|construction|renewable/i,
    build: (label) => ({
      key: "manufacturing",
      label,
      watchMetrics: [
        { name: "Revenue and EBITDA margin", available: true },
        { name: "Capex intensity", available: true },
        { name: "Working capital (receivables, inventory, payables)", available: true },
        { name: "Order book / book-to-bill", available: false, note: "not disclosed in the dataset" },
        { name: "Capacity utilisation", available: false, note: "not disclosed in the dataset" },
        { name: "Project margins / execution", available: false, note: "not disclosed in the dataset" },
      ],
      disclosure:
        "Order book, book-to-bill, capacity utilisation and project-margin detail are not disclosed in the " +
        "dataset; execution risk is assessed only via reported margins, capex and working-capital trends.",
    }),
  },
  {
    match: /consumer|retail|food|beverage|pharma|health|media/i,
    build: (label) => ({
      key: "consumer",
      label,
      watchMetrics: [
        { name: "Revenue growth", available: true },
        { name: "Gross margin (pricing / mix)", available: true },
        { name: "Working-capital intensity", available: true },
        { name: "Volume vs price decomposition", available: false, note: "not disclosed in the dataset" },
        { name: "Brand / market-share data", available: false, note: "not disclosed in the dataset" },
      ],
      disclosure:
        "Volume-vers-price decomposition and market-share data are not available; mix and pricing commentary " +
        "is limited to margin movements in reported figures.",
    }),
  },
];

export function sectorProfile(sector: unknown, industry: unknown): SectorProfile {
  const haystack = `${String(sector ?? "")} ${String(industry ?? "")}`;
  const rule = SECTOR_RULES.find((entry) => entry.match.test(haystack));
  const label = String(sector || industry || "General");
  return rule
    ? rule.build(label)
    : {
        key: "generic",
        label,
        watchMetrics: [
          { name: "Revenue growth", available: true },
          { name: "Margins", available: true },
          { name: "Cash conversion", available: true },
          { name: "Balance-sheet leverage", available: true },
          { name: "Segment / geographic split", available: false, note: "not disclosed in the dataset" },
        ],
        disclosure:
          "No sector-specific data (segments, geographies, volumes) is available in the dataset; the analysis " +
          "is limited to consolidated reported and modelled figures.",
      };
}
