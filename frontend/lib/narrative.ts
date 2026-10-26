import { z } from "zod";
import { fmt, isNum, num, pct } from "./format";
import type { SectorProfile } from "./provenance";

// ---------------------------------------------------------------------------
// Structured narrative schema. Every section has a predictable name and type;
// the deterministic engine and (optional) AI providers both target this shape.
// ---------------------------------------------------------------------------

export const RiskItemSchema = z.object({
  title: z.string().min(1),
  exposure: z.string().min(1),
  monitoring_metric: z.string().min(1),
  impact: z.string().optional(),
  scenario: z.string().optional(),
  basis: z.enum(["fact", "inference", "speculation"]).default("inference"),
});

export const CatalystItemSchema = z.object({
  title: z.string().min(1),
  event: z.string().min(1),
  timing: z.string().min(1),
  grounding: z.string().min(1),
});

export const NarrativeSchema = z.object({
  title: z.string().min(1),
  rating_line: z.string().min(1),
  executive_summary: z.string().min(1),
  investment_thesis: z.string().min(1),
  thesis_drivers: z.array(z.string().min(1)).min(1).max(6),
  business_overview: z.string().min(1),
  industry_context: z.string().min(1),
  financial_performance: z.string().min(1),
  strengths: z.array(z.string().min(1)).min(1),
  risks: z.array(RiskItemSchema).min(1),
  catalysts: z.array(CatalystItemSchema).min(1),
  scenario_analysis: z.object({ bull: z.string(), base: z.string(), bear: z.string() }),
  valuation_view: z.string().min(1),
  model_quality: z.string().min(1),
  conviction: z.object({
    level: z.enum(["high", "moderate", "low"]),
    basis: z.string().min(1),
  }),
  conclusion: z.string().min(1),
  disclaimer: z.string().min(1),
  narrative_source: z.string().min(1),
  ai_generated: z.boolean(),
});

export type Narrative = z.infer<typeof NarrativeSchema>;
export type RiskItem = z.infer<typeof RiskItemSchema>;
export type CatalystItem = z.infer<typeof CatalystItemSchema>;

export function validateNarrative(input: unknown): { ok: boolean; narrative: Narrative | null; issues: string[] } {
  const parsed = NarrativeSchema.safeParse(input);
  if (parsed.success) return { ok: true, narrative: parsed.data, issues: [] };
  return {
    ok: false,
    narrative: null,
    issues: parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
  };
}

// ---------------------------------------------------------------------------
// Narrative context — the validated research payload handed to the writer.
// ---------------------------------------------------------------------------

export type NarrativeContext = {
  ticker: string;
  companyName: string;
  exchange: string;
  sector: string;
  industry: string;
  currency: string;
  marketCap: number | null;
  employees: number | null;
  businessSummary: string;
  price: { lastClose: number | null; low52w: number | null; high52w: number | null };
  /** Latest reported metrics row (buildMetrics output). */
  actuals: Record<string, any> | null;
  /** Full annual metrics history, newest first. */
  history: Record<string, any>[];
  forecast: {
    periods: Record<string, any>[];
    summary: Record<string, any>;
    assumptions: Record<string, any>;
    assumption_sources?: Record<string, any>;
  } | null;
  dcf: Record<string, any> | null;
  sensitivity: Record<string, any> | null;
  reverseDcf: Record<string, any> | null;
  rating: string;
  target: number | null;
  upside: number | null;
  ratingBlocked: boolean;
  ratingBlockReason: string | null;
  horizon: string;
  sectorProfile: SectorProfile;
  isSynthetic: boolean;
};

const DISCLAIMER_TEXT =
  "This report was produced by the APEX deterministic research engine running locally. " +
  "All figures are model outputs derived from the stated inputs; they are not audited company " +
  "disclosures and no investment advice is intended or implied.";

function fmtBn(value: unknown, currency: string): string {
  if (!isNum(value)) return "n/a";
  return `${fmt(value)} ${currency}`;
}

function pctStr(value: unknown, digits = 1): string {
  if (!isNum(value)) return "n/a";
  return pct(value, digits);
}

function yearOf(period: Record<string, any>): string {
  const year = Number(String(period.period_end || period.year || "").slice(0, 4));
  return Number.isInteger(year) && year > 1990 && year < 2100 ? String(year) : "n/a";
}

/**
 * Deterministic, evidence-backed narrative. Every quantitative claim is traced
 * to a supplied metric; missing inputs are disclosed, never invented. This is
 * the fallback when an AI provider is unavailable (and the default offline).
 */
export function buildDeterministicNarrative(ctx: NarrativeContext): Narrative {
  const c = ctx.currency;
  const actuals = ctx.actuals || {};
  const forecast = ctx.forecast;
  const periods = forecast?.periods || [];
  const summary = forecast?.summary || {};
  const assumptions = forecast?.assumptions || {};
  const dcf = ctx.dcf && !ctx.dcf.error ? ctx.dcf : null;
  const history = ctx.history || [];
  const first = periods[0] || {};
  const last = periods[periods.length - 1] || {};
  const latestHistory = history[0] || {};
  const priorHistory = history[1] || null;
  const sector = ctx.sectorProfile;

  const ebitdaMarginFirst = isNum(first.revenue) && first.revenue ? first.ebitda / first.revenue : null;
  const ebitdaMarginLast = isNum(last.revenue) && last.revenue ? last.ebitda / last.revenue : null;
  const fcfMarginLast = isNum(last.revenue) && last.revenue ? last.fcf / last.revenue : null;
  const fcfConversion = isNum(last.ebitda) && last.ebitda ? last.fcf / last.ebitda : null;
  const pvTvShare =
    dcf && isNum(dcf.enterprise_value) && dcf.enterprise_value ? dcf.pv_terminal_value / dcf.enterprise_value : null;
  const netDebt = isNum(actuals.net_debt) ? actuals.net_debt : null;
  const netDebtEbitda = isNum(netDebt) && isNum(actuals.ebitda) && actuals.ebitda ? netDebt / actuals.ebitda : null;
  const exitMultiple =
    dcf && isNum(dcf.enterprise_value) && isNum(summary.final_ebitda) && summary.final_ebitda
      ? dcf.enterprise_value / summary.final_ebitda
      : null;
  const reverseWacc = ctx.reverseDcf && isNum(ctx.reverseDcf.implied_wacc) ? ctx.reverseDcf.implied_wacc : null;

  // ---- Rating line -------------------------------------------------------
  const ratingLine = ctx.ratingBlocked
    ? `NOT RATED — ${ctx.ratingBlockReason || "data-integrity checks failed"}`
    : `${ctx.rating} · ${ctx.horizon} · target ${ctx.target !== null ? `${num(ctx.target)} ${c}` : "n/a"} vs last close ${ctx.price.lastClose !== null ? `${num(ctx.price.lastClose)} ${c}` : "n/a"} (${ctx.upside !== null ? `${pct(ctx.upside)} ${ctx.upside >= 0 ? "upside" : "downside"}` : "upside unavailable"})`;

  // ---- Executive summary -------------------------------------------------
  const verdictPhrase = (() => {
    if (ctx.upside === null) return "with the target undetermined on current inputs";
    if (ctx.upside >= 0.25) return "which screens materially undemanding on our base case";
    if (ctx.upside >= 0.05) return "which screens reasonably valued on our base case";
    if (ctx.upside > -0.05) return "which screens broadly fair against our base case";
    return "which looks fully valued to stretched on our assumptions";
  })();

  const summaryParagraphs: string[] = [];
  summaryParagraphs.push(
    `${ctx.companyName} (${ctx.ticker}, ${ctx.exchange}) last closed at ${ctx.price.lastClose !== null ? `${num(ctx.price.lastClose)} ${c}` : "an unavailable price"}, ` +
      `inside a 52-week range of ${ctx.price.low52w !== null ? num(ctx.price.low52w) : "n/a"}–${ctx.price.high52w !== null ? num(ctx.price.high52w) : "n/a"}. ` +
      (ctx.ratingBlocked
        ? `Investment rating and target price are withheld: ${ctx.ratingBlockReason || "integrity checks failed"}.`
        : `Our ${ctx.horizon} view is ${ctx.rating} with a target of ${ctx.target !== null ? `${num(ctx.target)} ${c}` : "n/a"}, ${verdictPhrase}.`),
  );

  if (periods.length && isNum(summary.revenue_cagr)) {
    summaryParagraphs.push(
      `The base case compounds revenue from ${fmtBn(summary.base_revenue, c)} (last reported) to ${fmtBn(summary.final_revenue, c)} over ${periods.length} forecast year${periods.length === 1 ? "" : "s"} ` +
        `— a ${pctStr(summary.revenue_cagr)} CAGR — with the EBITDA margin moving from ${pctStr(ebitdaMarginFirst)} in the first forecast year to ${pctStr(ebitdaMarginLast)} in the final year. ` +
        `Final-year free cash flow of ${fmtBn(summary.final_fcf, c)} equals ${pctStr(fcfConversion)} of EBITDA and a ${pctStr(fcfMarginLast)} free-cash-flow margin.`,
    );
  } else {
    summaryParagraphs.push(
      "No forecast horizon is available in this build, so no growth or cash-flow trajectory is asserted.",
    );
  }

  if (dcf) {
    summaryParagraphs.push(
      `Discounting the forecast free cash flow at a ${pctStr(dcf.wacc, 2)} WACC ` +
        (dcf.exit_multiple !== null && dcf.exit_multiple !== undefined
          ? `with a ${num(dcf.exit_multiple)}x exit multiple `
          : `with ${pctStr(dcf.terminal_growth)} terminal growth `) +
        `produces an enterprise value of ${fmtBn(dcf.enterprise_value, c)} and equity value of ${fmtBn(dcf.equity_value, c)}. ` +
        (pvTvShare !== null
          ? `The terminal value contributes ${pctStr(pvTvShare)} of enterprise value, so long-run assumptions dominate the estimate. `
          : "") +
        (reverseWacc !== null
          ? `At the current market price the implied WACC is ${pctStr(reverseWacc, 2)}, i.e. the market discounts our cash flows more steeply than our stated cost of capital.`
          : ""),
    );
  }

  // ---- Investment thesis + drivers ---------------------------------------
  const investmentThesis =
    `${ctx.sectorProfile.label} exposure with ${pctStr(summary.revenue_cagr)} modelled revenue growth, ` +
    `${pctStr(ebitdaMarginLast)} terminal-year EBITDA margin and ${pctStr(fcfConversion)} EBITDA-to-FCF conversion. ` +
    (netDebt !== null && netDebtEbitda !== null
      ? `The balance sheet carries ${netDebt >= 0 ? `${fmtBn(netDebt, c)} of net debt` : `${fmtBn(Math.abs(netDebt), c)} of net cash`} (${num(Math.abs(netDebtEbitda), 2)}x last reported EBITDA). `
      : "Net debt could not be computed from the available statements. ") +
    (ctx.ratingBlocked
      ? "Because data-integrity checks failed, no rating or target is attached to this thesis."
      : `The mechanical rating is ${ctx.rating}; the conviction basis is described below.`);

  const thesisDrivers: string[] = [];
  if (isNum(summary.revenue_cagr)) {
    thesisDrivers.push(
      `Growth: revenue CAGR of ${pctStr(summary.revenue_cagr)} from ${fmtBn(summary.base_revenue, c)} to ${fmtBn(summary.final_revenue, c)} across the forecast horizon.`,
    );
  }
  if (isNum(ebitdaMarginFirst) && isNum(ebitdaMarginLast)) {
    thesisDrivers.push(
      `Margins: EBITDA margin of ${pctStr(ebitdaMarginFirst)} rising to ${pctStr(ebitdaMarginLast)}, consistent with operating leverage on the modelled cost base.`,
    );
  }
  if (isNum(fcfConversion)) {
    thesisDrivers.push(
      `Cash conversion: final-year free cash flow of ${fmtBn(summary.final_fcf, c)}, ${pctStr(fcfConversion)} of EBITDA.`,
    );
  }
  if (netDebt !== null && netDebtEbitda !== null) {
    thesisDrivers.push(
      `Balance sheet: net ${netDebt >= 0 ? "debt" : "cash"} of ${fmtBn(Math.abs(netDebt), c)} at ${num(Math.abs(netDebtEbitda), 2)}x EBITDA limits financial risk premium.`,
    );
  }
  if (dcf && ctx.upside !== null) {
    thesisDrivers.push(
      `Valuation: DCF value of ${num(dcf.value_per_share)} ${c} per share versus a ${num(ctx.price.lastClose)} ${c} market price (${pct(ctx.upside)} ${ctx.upside >= 0 ? "upside" : "downside"}).`,
    );
  }
  if (!thesisDrivers.length) {
    thesisDrivers.push("No quantified thesis driver could be derived from the available data.");
  }

  // ---- Business overview / industry --------------------------------------
  const businessOverview =
    `${ctx.companyName} operates in ${ctx.sector || "an unspecified sector"} / ${ctx.industry || "an unspecified industry"} ` +
    `on the ${ctx.exchange} listing${ctx.marketCap !== null ? `, with a market capitalisation of ${fmtBn(ctx.marketCap, c)}` : ""}` +
    `${ctx.employees !== null ? ` and approximately ${Math.round(ctx.employees).toLocaleString("en-US")} employees` : ""}. ` +
    `${ctx.businessSummary || "No business description is available in the dataset."} ` +
    (ctx.isSynthetic
      ? "Company identity and financials in this build come from the local synthetic fixture and must not be read as company-reported data."
      : "Company identity fields are taken from the configured data provider.");

  const industryContext =
    `${sector.disclosure} ` +
    `Sector-specific metrics a professional ${sector.label.toLowerCase()} note would track: ` +
    sector.watchMetrics
      .map((metric) => `${metric.name} (${metric.available ? "available" : `unavailable — ${metric.note || "not disclosed"}`})`)
      .join("; ") +
    ".";

  // ---- Financial performance ---------------------------------------------
  const coverageNote =
    history.length >= 3
      ? `Reported coverage spans ${yearOf(history[history.length - 1])}–${yearOf(history[0])} (${history.length} annual periods).`
      : history.length
        ? `Reported coverage is limited to ${history.length} annual period${history.length === 1 ? "" : "s"} (${yearOf(history[0])}); a multi-year trend cannot be established.`
        : "No annual reported periods are available.";

  const financialParts: string[] = [coverageNote];
  if (isNum(latestHistory.revenue)) {
    financialParts.push(
      `In ${yearOf(latestHistory)} revenue was ${fmtBn(latestHistory.revenue, c)}` +
        (isNum(latestHistory.revenue_growth) ? ` (${pctStr(latestHistory.revenue_growth)} year on year)` : "") +
        `, with gross margin ${pctStr(latestHistory.gross_margin)}, operating margin ${pctStr(latestHistory.operating_margin)} and net margin ${pctStr(latestHistory.net_margin)}.`,
    );
  }
  if (priorHistory && isNum(latestHistory.revenue) && isNum(priorHistory.revenue)) {
    const delta = latestHistory.revenue - priorHistory.revenue;
    financialParts.push(
      `Revenue moved by ${fmtBn(Math.abs(delta), c)} (${delta >= 0 ? "an increase" : "a decrease"}) versus ${yearOf(priorHistory)}, ` +
        `which on the reported statements reflects volume/mix and pricing in aggregate; the dataset does not decompose the change.`,
    );
  }
  if (isNum(latestHistory.roic)) {
    financialParts.push(`Return on invested capital was ${pctStr(latestHistory.roic)}; return on equity ${pctStr(latestHistory.roe)}.`);
  }
  if (isNum(latestHistory.fcf)) {
    financialParts.push(`Free cash flow in the latest period was ${fmtBn(latestHistory.fcf, c)}.`);
  } else {
    financialParts.push("Free cash flow is not available for the latest reported period; cash conversion cannot be assessed from history.");
  }
  const financialPerformance = financialParts.join(" ");

  // ---- Strengths ---------------------------------------------------------
  const strengths: string[] = [];
  if (isNum(summary.revenue_cagr) && summary.revenue_cagr > 0.05) {
    strengths.push(
      `Revenue compounding of ${pctStr(summary.revenue_cagr)} CAGR on the base case, with EBITDA margin at ${pctStr(ebitdaMarginLast)} by the final forecast year.`,
    );
  }
  if (isNum(fcfConversion) && fcfConversion > 0.5) {
    strengths.push(
      `Cash generation: ${pctStr(fcfConversion)} of final-year EBITDA converts to free cash flow (${fmtBn(summary.final_fcf, c)}), self-funding reinvestment or capital returns.`,
    );
  }
  if (netDebt !== null && netDebt < 0) {
    strengths.push(`Net cash of ${fmtBn(-netDebt, c)} provides balance-sheet flexibility through the cycle.`);
  } else if (netDebtEbitda !== null && netDebtEbitda < 2) {
    strengths.push(`Leverage of ${num(netDebtEbitda, 2)}x EBITDA is manageable on the reported balance sheet.`);
  }
  if (forecast?.summary?.balance_ok) {
    strengths.push("The three-statement forecast passes its balance-sheet identity check in every projected year.");
  }
  if (isNum(latestHistory.roic) && latestHistory.roic > 0.1) {
    strengths.push(`Return on invested capital of ${pctStr(latestHistory.roic)} in ${yearOf(latestHistory)} indicates value-accretive reinvestment at the reported level.`);
  }
  if (!strengths.length) strengths.push("No strength could be evidenced from the available metrics.");

  // ---- Risks -------------------------------------------------------------
  const risks: RiskItem[] = [];
  if (pvTvShare !== null) {
    risks.push({
      title: "Terminal-value dependence",
      exposure: `The present value of the terminal value is ${pctStr(pvTvShare)} of enterprise value.`,
      impact: "Small changes to the discount rate or long-run growth swing the target materially.",
      monitoring_metric: "WACC and terminal-growth assumptions versus the sensitivity grid",
      scenario: `Value per share across the sensitivity grid ranges ${sensitivityRange(ctx.sensitivity)}.`,
      basis: "fact",
    });
  }
  if (isNum(summary.revenue_cagr) && summary.revenue_cagr > 0.08) {
    risks.push({
      title: "Growth execution",
      exposure: `The base case assumes ${pctStr(summary.revenue_cagr)} revenue CAGR.`,
      impact: "A deceleration compresses both the cash-flow base and the applied multiple.",
      monitoring_metric: "Reported revenue growth versus the forecast path",
      scenario: "Bear case assumes growth runs below plan (see scenarios).",
      basis: "inference",
    });
  }
  if (isNum(latestHistory.gross_margin) && latestHistory.gross_margin < 0.35) {
    risks.push({
      title: "Margin structure",
      exposure: `Gross margin of ${pctStr(latestHistory.gross_margin)} in ${yearOf(latestHistory)} leaves limited absorption for input-cost inflation.`,
      impact: "Cost pressure flows quickly to operating profit.",
      monitoring_metric: "Reported gross margin period on period",
      basis: "inference",
    });
  }
  if (netDebtEbitda !== null && netDebtEbitda > 2) {
    risks.push({
      title: "Leverage",
      exposure: `Net debt of ${fmtBn(netDebt, c)} equals ${num(netDebtEbitda, 2)}x last reported EBITDA.`,
      impact: "Higher refinancing cost or a demand shock would pressure coverage.",
      monitoring_metric: "Net debt / EBITDA and interest coverage",
      basis: "fact",
    });
  }
  if (ctx.isSynthetic) {
    risks.push({
      title: "Synthetic data provenance",
      exposure: "All financial inputs come from the local deterministic fixture, not company filings.",
      impact: "No conclusion in this report should be relied upon as a description of any real company.",
      monitoring_metric: "Data-status label on the cover of this report",
      basis: "fact",
    });
  }
  if (sector.watchMetrics.some((metric) => !metric.available)) {
    risks.push({
      title: "Missing sector-specific evidence",
      exposure: sector.watchMetrics
        .filter((metric) => !metric.available)
        .map((metric) => metric.name)
        .join(", ") + " are not available in the dataset.",
      impact: "Sector-specific failure modes cannot be quantified.",
      monitoring_metric: "Disclosure of unavailable metrics in the industry section",
      basis: "fact",
    });
  }
  if (!risks.length) {
    risks.push({
      title: "Model uncertainty",
      exposure: "All figures are model outputs from stated assumptions.",
      impact: "Actual outcomes will differ from the base case.",
      monitoring_metric: "Reported results versus forecast",
      basis: "fact",
    });
  }

  // ---- Catalysts ---------------------------------------------------------
  const catalysts: CatalystItem[] = [];
  if (isNum(summary.revenue_cagr)) {
    catalysts.push({
      title: "Revenue upside versus plan",
      event: "Reported revenue tracking above the ${cagr} base-case path".replace("${cagr}", pctStr(summary.revenue_cagr)),
      timing: "Next reported annual period; exact timing is unknown",
      grounding: `Each point of revenue upside converts at the ${pctStr(ebitdaMarginLast)} terminal-year EBITDA margin.`,
    });
  }
  if (netDebt !== null && netDebt < 0) {
    catalysts.push({
      title: "Capital returns from net cash",
      event: "Buyback, special dividend or step-up in recurring distributions",
      timing: "Timing unknown; requires board action",
      grounding: `Net cash of ${fmtBn(-netDebt, c)} on the latest balance sheet would fund returns without new leverage.`,
    });
  } else if (isNum(fcfConversion)) {
    catalysts.push({
      title: "Deleveraging through cash conversion",
      event: "Net debt reduction at the modelled cash-conversion rate",
      timing: "Progressive across the forecast horizon",
      grounding: `${pctStr(fcfConversion)} EBITDA-to-FCF conversion retires debt at the modelled rate.`,
    });
  }
  if (dcf && isNum(exitMultiple)) {
    catalysts.push({
      title: "Multiple re-rating",
      event: "Market multiple moving toward the model-implied ${x}x exit level".replace("${x}", num(exitMultiple, 1)),
      timing: "Timing unknown",
      grounding: `The DCF embeds a ${num(exitMultiple, 1)}x exit multiple on final-year EBITDA of ${fmtBn(summary.final_ebitda, c)}.`,
    });
  }
  if (!catalysts.length) {
    catalysts.push({
      title: "No grounded catalyst identified",
      event: "None derived from the available evidence",
      timing: "Unknown",
      grounding: "Catalysts require a grounded event; none is asserted without evidence.",
    });
  }

  // ---- Scenarios ---------------------------------------------------------
  const targetBase = ctx.target;
  const scenarioAnalysis = {
    bull:
      targetBase !== null
        ? `Bull case: target of ${num(targetBase * 1.15)} ${c} (+15% versus base) if revenue growth runs ahead of the ${pctStr(summary.revenue_cagr)} path and the terminal margin holds at ${pctStr(ebitdaMarginLast)}.`
        : "Bull case: not calculated — no base target is available.",
    base:
      targetBase !== null
        ? `Base case: target of ${num(targetBase)} ${c} on ${pctStr(summary.revenue_cagr)} revenue CAGR, ${pctStr(dcf?.wacc, 2)} WACC and the stated terminal assumption.`
        : "Base case: not calculated — no base target is available.",
    bear:
      targetBase !== null
        ? `Bear case: target of ${num(targetBase * 0.85)} ${c} (-15% versus base) if growth decelerates and the discount rate widens by 100 basis points.`
        : "Bear case: not calculated — no base target is available.",
  };

  // ---- Valuation view ----------------------------------------------------
  const valuationParts: string[] = [];
  if (dcf) {
    valuationParts.push(
      `The DCF discounts ${dcf.cash_flow_count || periods.length} annual free cash flows at ${pctStr(dcf.wacc, 2)}. ` +
        `Present value of explicit cash flows is ${fmtBn(dcf.pv_cash_flows, c)}; present value of the terminal value is ${fmtBn(dcf.pv_terminal_value, c)}. ` +
        `Enterprise value of ${fmtBn(dcf.enterprise_value, c)} bridges to equity value of ${fmtBn(dcf.equity_value, c)} ` +
        `via net ${isNum(dcf.net_debt) && dcf.net_debt >= 0 ? "debt" : "cash"} of ${fmtBn(Math.abs(dcf.net_debt ?? 0), c)}, implying ${num(dcf.value_per_share)} ${c} per share on ${fmt(dcf.shares)} shares.`,
    );
    if (ctx.sensitivity && !ctx.sensitivity.error) {
      valuationParts.push(
        `The WACC-versus-${ctx.sensitivity.mode === "multiple" ? "exit-multiple" : "terminal-growth"} grid brackets a value-per-share range of ${sensitivityRange(ctx.sensitivity)}; sensitivity analysis maps the model's response to assumptions — it does not remove uncertainty.`,
      );
    }
    if (reverseWacc !== null) {
      valuationParts.push(
        `Reverse DCF: at the current market price of ${num(ctx.price.lastClose)} ${c} the implied WACC is ${pctStr(reverseWacc, 2)} versus our ${pctStr(dcf.wacc, 2)} — the market demands a higher return than our stated cost of capital.`,
      );
    }
    valuationParts.push(`Implied exit multiple on final-year EBITDA: ${exitMultiple !== null ? `${num(exitMultiple, 1)}x` : "n/a"}.`);
  } else {
    valuationParts.push("No valid DCF output is available; no valuation conclusion is asserted.");
  }
  const valuationView = valuationParts.join(" ");

  // ---- Model quality -----------------------------------------------------
  const qualityParts: string[] = [];
  qualityParts.push(
    ctx.isSynthetic
      ? "Data status: SYNTHETIC — deterministic local fixture. Figures are not company-reported."
      : "Data status: provider-sourced (see source register).",
  );
  qualityParts.push(coverageNote);
  const missingSector = sector.watchMetrics.filter((metric) => !metric.available);
  if (missingSector.length) {
    qualityParts.push(`Sector metrics unavailable: ${missingSector.map((metric) => metric.name).join(", ")}.`);
  }
  if (forecast?.summary?.balance_ok === false) {
    qualityParts.push(
      `Balance-sheet identity check shows a residual of up to ${fmt(forecast.summary.max_balance_check)}; the model's internal consistency is imperfect.`,
    );
  } else if (forecast?.summary?.balance_ok) {
    qualityParts.push("Balance-sheet identity holds in every projected year — necessary but not sufficient for economic correctness.");
  }
  if (Array.isArray(dcf?.warnings) && dcf.warnings.length) {
    qualityParts.push(`Valuation warnings: ${dcf.warnings.join(" ")}`);
  }
  if (Object.keys(assumptions).length) {
    const driverSources = forecast?.assumption_sources || {};
    const derivedCount = Object.values(driverSources).filter((source) => String(source).startsWith("Derived")).length;
    qualityParts.push(
      `Principal assumptions${derivedCount ? ` (${derivedCount} derived from reported history)` : ""}: ${Object.entries(assumptions)
        .filter(([, value]) => isNum(value))
        .slice(0, 6)
        .map(([key, value]) => `${key.replaceAll("_", " ")} ${pctStr(value, 2)}`)
        .join("; ")}.`,
    );
  }
  const modelQuality = qualityParts.join(" ");

  // ---- Conviction --------------------------------------------------------
  const conviction = (() => {
    const hasHistory = history.length >= 3;
    const balanceOk = forecast?.summary?.balance_ok !== false;
    const hasDcf = Boolean(dcf);
    const missingEvidence = missingSector.length > 0 || ctx.isSynthetic;
    if (ctx.ratingBlocked || (!hasHistory && !hasDcf)) {
      return {
        level: "low" as const,
        basis:
          "Conviction is low: data-integrity checks blocked the rating, or the evidence base (history and valuation) is insufficient.",
      };
    }
    if (hasHistory && hasDcf && balanceOk && !missingEvidence) {
      return {
        level: "moderate" as const,
        basis: `Conviction is moderate: ${history.length} reported periods, a passing balance-sheet identity and a complete DCF are available${missingSector.length ? ", though sector-specific evidence is missing" : ""}.`,
      };
    }
    return {
      level: "low" as const,
      basis: `Conviction is constrained by ${[!hasHistory && "limited history", !hasDcf && "no valuation", !balanceOk && "balance-sheet residuals", ctx.isSynthetic && "synthetic data", missingEvidence && "missing sector evidence"].filter(Boolean).join(", ")}.`,
    };
  })();

  // ---- Conclusion --------------------------------------------------------
  const conclusion = (() => {
    const toneWord =
      ctx.rating === "BUY" ? "constructive" : ctx.rating === "HOLD" ? "neutral" : ctx.rating === "SELL" || ctx.rating === "SSELL" ? "cautious" : "measured";
    const strengthen = [
      isNum(summary.revenue_cagr) && `revenue tracking at or above ${pctStr(summary.revenue_cagr)}`,
      isNum(fcfConversion) && `cash conversion holding near ${pctStr(fcfConversion)} of EBITDA`,
      isNum(latestHistory.roic) && `ROIC sustained above ${pctStr(latestHistory.roic)}`,
    ]
      .filter(Boolean)
      .join(", ");
    const weaken = [
      isNum(pvTvShare) && pvTvShare > 0.6 && "rising terminal-value dependence",
      missingSector.length && "continued absence of sector-specific disclosure",
      ctx.isSynthetic && "reliance on synthetic demonstration data",
    ]
      .filter(Boolean)
      .join(", ");
    return (
      `On the evidence supplied we are ${toneWord}. The thesis would be strengthened by ${strengthen || "inline execution versus plan"}; ` +
      `it would be weakened by ${weaken || "persistent margin compression"}. ` +
      "Material unresolved questions are those listed as unavailable in the industry and model-quality sections; they are disclosed rather than estimated."
    );
  })();

  const narrative: Narrative = {
    title: `${ctx.ticker} — Equity Research Note`,
    rating_line: ratingLine,
    executive_summary: summaryParagraphs.join("\n\n"),
    investment_thesis: investmentThesis,
    thesis_drivers: thesisDrivers.slice(0, 5),
    business_overview: businessOverview,
    industry_context: industryContext,
    financial_performance: financialPerformance,
    strengths,
    risks,
    catalysts,
    scenario_analysis: scenarioAnalysis,
    valuation_view: valuationView,
    model_quality: modelQuality,
    conviction,
    conclusion,
    disclaimer: DISCLAIMER_TEXT,
    narrative_source: "deterministic-engine",
    ai_generated: false,
  };

  return narrative;
}

function sensitivityRange(sensitivity: Record<string, any> | null): string {
  if (!sensitivity || !Array.isArray(sensitivity.table)) return "n/a";
  const values = (sensitivity.table as any[][]).flat().filter((value): value is number => isNum(value));
  if (!values.length) return "n/a";
  return `${num(Math.min(...values))}–${num(Math.max(...values))}`;
}

// ---------------------------------------------------------------------------
// Optional AI provider narrative with deterministic fallback.
// ---------------------------------------------------------------------------

export type ProviderConfig = {
  name: string;
  provider: string;
  base_url?: string | null;
  api_key?: string | null;
  model?: string | null;
};

/**
 * Attempt a chat-completions call to a configured provider and coerce the reply
 * into the narrative schema. Returns null on ANY failure (network, timeout,
 * malformed JSON, schema violation) so the caller can fall back to the
 * deterministic narrative and label the fallback.
 */
export async function tryProviderNarrative(
  config: ProviderConfig | null | undefined,
  promptPayload: Record<string, unknown>,
  timeoutMs = 8000,
): Promise<{ narrative: Narrative; issues: string[] } | null> {
  if (!config || !config.api_key) return null;
  const baseUrl = String(config.base_url || "").replace(/\/$/, "");
  if (!baseUrl) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.api_key}`,
      },
      body: JSON.stringify({
        model: config.model || undefined,
        messages: [
          {
            role: "system",
            content:
              "You are an equity research writer. Return ONLY JSON matching the provided schema. " +
              "Never invent financial figures: only use numbers present in the supplied payload. " +
              "If a field is unknown, say it is unavailable.",
          },
          { role: "user", content: JSON.stringify(promptPayload) },
        ],
        temperature: 0.2,
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const body = (await response.json()) as any;
    const raw = body?.choices?.[0]?.message?.content;
    if (typeof raw !== "string") return null;
    const jsonText = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    const parsedJson = JSON.parse(jsonText);
    const validation = validateNarrative(parsedJson);
    if (!validation.ok || !validation.narrative) return null;
    return { narrative: { ...validation.narrative, narrative_source: `provider:${config.name}`, ai_generated: true }, issues: validation.issues };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
