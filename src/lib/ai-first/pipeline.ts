/**
 * APEX RESEARCH — AI-FIRST ORCHESTRATION PIPELINE
 *
 * ONE dynamic AI pipeline (no sector gates, no archetype dispatch):
 *
 *   TICKER
 *    -> fetchQuoteSummary (yfinance, factual only)
 *    -> buildFactPack (provenance-tagged, no zero-fill)
 *    -> understandCompany (AI)
 *    -> buildModelSpec (AI formulas; code executes)
 *    -> executeForecast (deterministic)
 *    -> buildValuationSpec (AI selects method; code executes)
 *    -> executeValuation (deterministic)
 *    -> buildScenarios + flowScenarioThroughModel (AI deltas; code executes)
 *    -> chooseReverseVariable + solveRequiredValue (AI chooses; code solves)
 *    -> buildNarrative (AI thesis/risks/catalysts/competitive/moat)
 *    -> runQualityReview + adjudicateRegeneration (deterministic gates;
 *       LLM regeneration hooks when a transport is available)
 *    -> assembleResearchReport (versioned object; PDF renders this only)
 *
 * AXIOM: AI decides the model. Code executes the model.
 * YFINANCE is the only factual source. The LLM never does arithmetic,
 * never invents history, never hand-writes a target price.
 */

import { buildFactPack } from "./fact-pack";
import { understandCompany } from "./company-understanding";
import { buildModelSpec } from "./model-builder";
import { executeForecast } from "./forecast-engine";
import { buildValuationSpec } from "./valuation-builder";
import { executeValuation } from "./valuation-engine";
import {
  buildScenarios,
  flowScenarioThroughModel,
} from "./scenarios-builder";
import {
  chooseReverseVariable,
  solveRequiredValue,
  buildRevenueCagrSolver,
  currentPriceOf,
} from "./reverse-valuation";
import { buildNarrative } from "./narrative-builders";
import { runQualityReview, adjudicateRegeneration } from "./quality-review";
import { assembleResearchReport } from "./research-report";
import {
  resolveProviderRequestConfig,
  type CustomKeyConfig,
} from "../ai-providers";
import type {
  FactPack,
  CompanyUnderstanding,
  ForecastSpecification,
  ValuationSpecification,
  ResearchReport,
  ScenarioSpecification,
  Fact,
} from "./types";

export type PipelineTransport = (opts: {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}) => Promise<string>;

export interface AiFirstProgress {
  stage: string;
  detail?: string;
}

export interface RunAiFirstOptions {
  customKeyConfig?: CustomKeyConfig | null;
  /** Injected transport (tests / callers with their own LLM client). */
  transport?: PipelineTransport;
  onProgress?: (p: AiFirstProgress) => void;
}

/** Build an OpenAI-compatible chat transport over ai-providers config. */
export function makeProviderTransport(
  customKeyConfig?: CustomKeyConfig | null
): PipelineTransport {
  const cfg = resolveProviderRequestConfig(customKeyConfig ?? null);
  if (!cfg.apiKey) {
    throw new Error(
      "No AI API key configured (server OPENROUTER_API_KEY or custom key required)."
    );
  }
  return async ({ system, user, temperature, maxTokens, jsonMode }) => {
    const res = await fetch(cfg.endpointUrl, {
      method: "POST",
      headers: cfg.headers,
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: temperature ?? 0.3,
        max_tokens: maxTokens ?? 3000,
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(
        `AI provider ${cfg.provider} HTTP ${res.status}: ${text.slice(0, 300)}`
      );
    }
    try {
      const parsed = JSON.parse(text);
      const content: string =
        parsed.choices?.[0]?.message?.content ?? parsed.content ?? text;
      return typeof content === "string" ? content : JSON.stringify(content);
    } catch {
      return text;
    }
  };
}

// ─────────────────────────────────────────────
// Mechanical fallback (NO LLM key available)
// ─────────────────────────────────────────────
// Honest generic preview: revenue-compounding model + DCF, confidence 0.2,
// no sector vocabulary, no invented peers/moat. Clearly labeled so the
// quality reviewer and the report mark it as non-AI output.

function latestMetric(pack: FactPack, re: RegExp): Fact | undefined {
  const cands = pack.incomeStatement.facts.filter(
    (f) => re.test(f.metric) && f.value !== undefined
  );
  return cands[cands.length - 1] ?? cands[0];
}

function revenueSeries(pack: FactPack): number[] {
  return pack.incomeStatement.facts
    .filter(
      (f) =>
        /revenue/i.test(f.metric) &&
        f.value !== undefined &&
        f.value > 0
    )
    .map((f) => f.value as number);
}

function mechanicalUnderstanding(pack: FactPack): CompanyUnderstanding {
  const name =
    pack.company.facts.find((f) => f.metric === "companyName")?.textValue ??
    pack.ticker;
  const desc =
    pack.company.facts.find((f) => f.metric === "description")?.textValue ??
    "";
  const sector =
    pack.company.facts.find((f) => f.metric === "sector")?.textValue ?? "";
  const industry =
    pack.company.facts.find((f) => f.metric === "industry")?.textValue ?? "";
  return {
    ticker: pack.ticker,
    companyName: name,
    whatItDoes: desc
      ? `Mechanical preview (no AI key): ${desc.slice(0, 600)}`
      : `Mechanical preview (no AI key) for ${name}. AI company understanding unavailable.`,
    howItMakesMoney:
      "Mechanical preview: revenue-driven abstraction pending AI analysis.",
    businessSegments: [],
    economicUnits: ["revenue"],
    primaryEconomicAbstraction: "revenue",
    revenueDrivers: [
      {
        name: "Revenue",
        mechanism: "Historical reported revenue compounds forward at the AI-unavailable mechanical growth estimate.",
        sourceFacts: ["totalRevenue"],
        statementLine: "totalRevenue",
      },
    ],
    costDrivers: [],
    marginDrivers: [],
    cashGenerationDrivers: [],
    balanceSheetDrivers: [],
    returnsDrivers: [],
    keyKpis: [
      {
        name: "Revenue",
        rationale: "Top-line scale anchors the mechanical preview.",
        availability: "yfinance",
        unit: "currency",
      },
    ],
    metricsToAvoid: [],
    statementsThatMatterMost: ["incomeStatement"],
    industryContext:
      [sector, industry].filter(Boolean).join(" / ") ||
      "Industry context pending AI analysis.",
    appropriateValuationMethods: [
      { method: "DCF", why: "Mechanical preview default; AI selection unavailable." },
    ],
    confidence: {
      overall: 0.2,
      dataQuality: "mechanical-preview",
      reasoning: "No AI transport available; generic revenue model used.",
    },
  };
}

function historicalCagr(series: number[]): number {
  if (series.length < 2) return 0.08;
  const first = series[0];
  const last = series[series.length - 1];
  if (!(first > 0 && last > 0)) return 0.08;
  const cagr = Math.pow(last / first, 1 / (series.length - 1)) - 1;
  if (!isFinite(cagr)) return 0.08;
  return Math.min(0.15, Math.max(-0.05, cagr));
}

function mechanicalModelSpec(pack: FactPack): ForecastSpecification {
  const revFact = latestMetric(pack, /totalRevenue|^revenue$/i);
  const niFact = latestMetric(pack, /netIncome/i);
  const baseRevenue = revFact?.value;
  const baseNI = niFact?.value;
  const margin =
    baseRevenue && baseNI && baseRevenue > 0 ? baseNI / baseRevenue : 0.1;
  const g = historicalCagr(revenueSeries(pack));
  const currency =
    pack.market.facts.find((f) => f.metric === "currentPrice")?.currency ??
    "currency";
  return {
    horizonYears: 5,
    horizonRationale:
      "Mechanical preview horizon (5Y); AI horizon selection unavailable.",
    variables: [
      {
        name: "revenue",
        label: "Revenue",
        baseValue: baseRevenue,
        unit: currency,
        kind: "input",
        statementLine: revFact?.metric,
      },
      {
        name: "netMargin",
        label: "Net margin",
        baseValue: margin,
        unit: "decimal",
        kind: "input",
      },
      {
        name: "netIncome",
        label: "Net income",
        baseValue: baseNI,
        unit: currency,
        kind: "computed",
      },
    ],
    formulas: [
      {
        id: "F1",
        equation: "Net income = Revenue × Net margin",
        expression: "revenue * netMargin",
        output: "netIncome",
        variables: ["revenue", "netMargin"],
        explanation:
          "Generic mechanical identity used only when AI model generation is unavailable.",
        sourceFacts: ["totalRevenue", "netIncome"],
        confidence: 0.3,
      },
    ],
    assumptions: [
      {
        id: "A1",
        assumption: `Revenue grows at ${(g * 100).toFixed(1)}% annually (historical CAGR)`,
        variable: "revenue",
        value: g,
        unit: "%",
        period: "Y1-Y5",
        rationale: "Historical revenue CAGR from yfinance facts.",
        historicalEvidence: "yfinance revenue history",
        confidence: 0.3,
      },
      {
        id: "A2",
        assumption: `Net margin held at ${(margin * 100).toFixed(1)}%`,
        variable: "netMargin",
        value: margin,
        unit: "decimal",
        period: "Y1-Y5",
        rationale: "Latest reported net margin held flat (mechanical).",
        historicalEvidence: "yfinance net income / revenue",
        confidence: 0.3,
      },
    ],
    driverPaths: {
      revenue: [g, g, g, g, g],
    },
  };
}

function mechanicalValuationSpec(): ValuationSpecification {
  return {
    methodology: "DCF",
    rationale:
      "Mechanical preview default (AI valuation selection unavailable).",
    variablesDrivingValuation: ["revenue", "netIncome"],
    assumptions: [
      {
        id: "AV1",
        assumption: "Discount rate 10%",
        variable: "wacc",
        value: 0.1,
        unit: "decimal",
        period: "Y1-Y5",
        rationale: "Mechanical default.",
        historicalEvidence: "",
        confidence: 0.2,
      },
      {
        id: "AV2",
        assumption: "Terminal growth 4%",
        variable: "terminalGrowth",
        value: 0.04,
        unit: "decimal",
        period: "terminal",
        rationale: "Mechanical default.",
        historicalEvidence: "",
        confidence: 0.2,
      },
    ],
    discountRate: 0.1,
    discountRateRationale: "Mechanical default (AI selection unavailable).",
    terminalAssumptions: { growth: 0.04, rationale: "Mechanical default." },
    methodsConsidered: [
      { method: "DCF", verdict: "selected", reason: "Mechanical default." },
    ],
  };
}

// ─────────────────────────────────────────────
// Deterministic report-text synthesis (no sector prose)
// ─────────────────────────────────────────────

function fmtMoney(v: number | undefined): string {
  if (v === undefined || !isFinite(v)) return "Not available from yfinance";
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  return String(Math.round(v * 100) / 100);
}

function buildHistoricalAnalysis(pack: FactPack): string {
  const revs = revenueSeries(pack);
  const last = revs[revs.length - 1];
  const cagr = revs.length >= 2 ? historicalCagr(revs) : null;
  const price = pack.market.facts.find((f) => f.metric === "currentPrice");
  const cap = pack.market.facts.find((f) => f.metric === "marketCap");
  return [
    `Historical analysis grounded in yfinance facts for ${pack.ticker}.`,
    last !== undefined
      ? `Latest reported revenue: ${fmtMoney(last)} (${revs.length} annual observations).`
      : `Revenue history: Not available from yfinance.`,
    cagr !== null
      ? `Historical revenue CAGR: ${(cagr * 100).toFixed(1)}% (computed deterministically from yfinance history).`
      : `Historical CAGR cannot be computed (insufficient yfinance history).`,
    price?.value !== undefined
      ? `Current price: ${price.value} ${price.currency ?? ""}; market cap: ${fmtMoney(cap?.value)}.`
      : `Market price: Not available from yfinance.`,
  ].join(" ");
}

// ─────────────────────────────────────────────
// Main entry
// ─────────────────────────────────────────────

export interface AiFirstRunResult {
  report: ResearchReport;
  factPack: FactPack;
  understanding: CompanyUnderstanding;
  forecastSpec: ForecastSpecification;
  valuationSpec: ValuationSpecification;
  regenerationCandidates: string[];
  aiUsed: boolean;
}

export async function runAiFirstResearch(
  ticker: string,
  rawQuoteSummary: Record<string, unknown>,
  opts: RunAiFirstOptions = {}
): Promise<AiFirstRunResult> {
  const t = ticker.toUpperCase();
  const emit = (stage: string, detail?: string) =>
    opts.onProgress?.({ stage, detail });

  // 1. Fact pack (deterministic, yfinance only)
  emit("fact-pack", "Normalizing yfinance payload");
  const factPack = buildFactPack(rawQuoteSummary, t);

  // 2. Transport: injected (tests) > provider (live key) > mechanical fallback
  let transport: PipelineTransport | null = opts.transport ?? null;
  let aiUsed = !!transport;
  if (!transport) {
    try {
      transport = makeProviderTransport(opts.customKeyConfig ?? null);
      aiUsed = true;
    } catch {
      transport = null;
      aiUsed = false;
    }
  }

  // 3. Company understanding
  emit("understanding", aiUsed ? "AI understanding company" : "Mechanical preview");
  const understanding: CompanyUnderstanding = aiUsed
    ? await understandCompany(transport!, factPack)
    : mechanicalUnderstanding(factPack);

  // 4. Model spec
  emit("model", "Building financial model specification");
  const forecastSpec: ForecastSpecification = aiUsed
    ? await buildModelSpec(transport!, { pack: factPack, understanding })
    : mechanicalModelSpec(factPack);

  // 5. Deterministic forecast
  emit("forecast", "Executing forecast (deterministic arithmetic)");
  const forecastOut = executeForecast({ model: forecastSpec, factPack });

  // 6. Valuation selection + execution
  emit("valuation", "Selecting + executing valuation");
  const valuationSpec: ValuationSpecification = aiUsed
    ? await buildValuationSpec(transport!, {
        pack: factPack,
        understanding,
        forecastSpec,
      })
    : mechanicalValuationSpec();
  const valuation = executeValuation(
    valuationSpec,
    forecastOut.forecast,
    factPack
  );

  // 7. Scenarios (AI deltas; deterministic flow-through)
  emit("scenarios", "Generating Bear/Base/Bull scenarios");
  let scenarios = mechanicalScenarios(forecastSpec);
  if (aiUsed) {
    try {
      const gen = await buildScenarios(transport!, factPack, understanding, forecastSpec);
      scenarios = gen.scenarios;
    } catch (e) {
      console.warn("[ai-first] scenario generation failed, mechanical deltas:", e);
    }
  }
  const flowed = scenarios.map((s) =>
    flowScenarioThroughModel(s, forecastSpec, factPack, valuationSpec)
  );
  const finalScenarios = flowed.map((f) => f.scenario);

  // 8. Reverse valuation (AI chooses variable; code solves)
  emit("reverse", "Solving reverse valuation");
  const chosen = chooseReverseVariable(understanding, valuation);
  const price = currentPriceOf(factPack);
  let reverse: ResearchReport["reverseValuation"] = null;
  if (chosen && price !== undefined) {
    if (chosen.variable === "revenueCagr") {
      const solver = buildRevenueCagrSolver(
        factPack,
        forecastSpec,
        valuationSpec,
        ({ model, factPack: fp }) => ({ forecast: executeForecast({ model, factPack: fp }).forecast }),
        (spec, fc, fp) => executeValuation(spec, fc, fp)
      );
      reverse = solveRequiredValue(chosen, price, solver);
    } else {
      // Non-CAGR variables: report the implied-requirement framing without
      // fabricating a solve path outside the deterministic engines.
      reverse = {
        variable: chosen.variable,
        requiredValue: NaN,
        interpretation: `${chosen.why} (Quantitative solve for '${chosen.variable}' beyond the revenue-CAGR solver is reported qualitatively in this run.)`,
      };
      if (!isFinite(reverse.requiredValue)) reverse = null;
    }
  }

  // 9. Narratives
  emit("narrative", "Writing thesis / risks / catalysts / moat");
  let narrative;
  if (aiUsed) {
    try {
      narrative = await buildNarrative(transport!, factPack, understanding, forecastSpec);
    } catch (e) {
      console.warn("[ai-first] narrative generation failed, mechanical fallback:", e);
      narrative = mechanicalNarrative(factPack, valuation);
      aiUsed = false;
    }
  } else {
    narrative = mechanicalNarrative(factPack, valuation);
  }

  // 10. Sensitivity (deterministic grid around the executed valuation)
  const sensitivity = buildSensitivity(valuationSpec, forecastOut.forecast, factPack);

  // 11. Assemble (pre-review) for quality gates
  const historicalAnalysis = buildHistoricalAnalysis(factPack);
  const upside =
    valuation.upsidePct !== undefined
      ? `${valuation.upsidePct.toFixed(1)}%`
      : "N/A (missing price/shares in yfinance)";
  const preReport = assembleResearchReport({
    companyUnderstanding: understanding,
    factPack,
    forecastSpec,
    formulas: forecastSpec.formulas,
    forecast: forecastOut.forecast,
    valuationSpec,
    valuation,
    scenarios: finalScenarios,
    thesis: narrative.thesis,
    risks: narrative.risks,
    catalysts: narrative.catalysts,
    competitiveAnalysis: narrative.competitiveAnalysis,
    moat: narrative.moat,
    historicalAnalysis,
    managementAnalysis: aiUsed
      ? "AI management analysis embedded in narrative; dedicated management desk pending."
      : "Management analysis unavailable in mechanical preview (no AI transport).",
    capitalAllocation: aiUsed
      ? "AI capital-allocation assessment embedded in narrative; dedicated schedule pending."
      : "Capital allocation unavailable in mechanical preview.",
    financialQuality: `Forecast identities: ${forecastOut.identityChecks.filter((c) => c.pass).length}/${forecastOut.identityChecks.length} checks pass (${forecastOut.plugs.join("; ") || "no plugs"}).`,
    sensitivity,
    reverseValuation: reverse,
    conclusion: aiUsed
      ? `${understanding.companyName} (${t}): ${valuation.methodology} fair value ${valuation.fairValuePerShare !== undefined ? valuation.fairValuePerShare.toFixed(2) : "N/A"} vs current ${price ?? "N/A"} (${upside} upside). See thesis/risks/scenarios for the full AI case.`
      : `Mechanical preview for ${t}: ${valuation.methodology} fair value ${valuation.fairValuePerShare !== undefined ? valuation.fairValuePerShare.toFixed(2) : "N/A"} (${upside}). Supply an AI key for company-specific research.`,
    reviews: [],
    reviewPassed: false,
    regenerationLog: [aiUsed ? "live-AI run" : "mechanical-preview (no AI transport)"],
  });

  // 12. Quality review (deterministic gates) + adjudication
  emit("review", "Running quality review");
  const review = runQualityReview(preReport, factPack);
  const adjudicated = adjudicateRegeneration(
    review.regenerationCandidates,
    review.perReviewer,
    preReport
  );
  const report: ResearchReport = {
    ...preReport,
    reviews: review.allFindings.map((f) => ({ ...f })),
    reviewPassed: review.passed,
    regenerationLog: [
      ...preReport.regenerationLog,
      `review score ${review.overallScore}; candidates: ${adjudicated.regenerate.join(", ") || "none"}`,
    ],
  };

  emit("done", `Review ${review.passed ? "passed" : "flagged"} (${review.overallScore}/100)`);
  return {
    report,
    factPack,
    understanding,
    forecastSpec,
    valuationSpec,
    regenerationCandidates: adjudicated.regenerate,
    aiUsed,
  };
}

function mechanicalScenarios(spec: ForecastSpecification): ScenarioSpecification[] {
  const g = spec.driverPaths["revenue"]?.[0] ?? 0.08;
  return (["bear", "base", "bull"] as const).map((name) => ({
    name,
    changedVariables: [
      {
        variable: "revenue",
        baseValue: g,
        scenarioValue: name === "bear" ? g - 0.03 : name === "bull" ? g + 0.03 : g,
        rationale:
          "Mechanical ±3pp revenue-growth delta (AI scenario generation unavailable).",
      },
    ],
    targetPrice: undefined as number | undefined,
    targetProvenance: "forecast" as const,
  }));
}

function mechanicalNarrative(
  pack: FactPack,
  valuation: { fairValuePerShare?: number; methodology: string }
) {
  const name =
    pack.company.facts.find((f) => f.metric === "companyName")?.textValue ??
    pack.ticker;
  const fv =
    valuation.fairValuePerShare !== undefined
      ? valuation.fairValuePerShare.toFixed(2)
      : "N/A";
  return {
    thesis: {
      thesis: `Mechanical preview for ${name}: ${valuation.methodology} fair value ${fv}. Supply an AI provider key for company-specific thesis, drivers, and valuation rationale.`,
      bullCase: ["AI bull case unavailable in mechanical preview."],
      bearCase: ["AI bear case unavailable in mechanical preview."],
      keyDebate: "Pending AI analysis.",
      keyInflectionPoints: [],
      whatMarketMayBeMissing: "Pending AI analysis.",
      whatCouldInvalidate: ["Mechanical assumptions are generic; AI review required."],
    },
    catalysts: [],
    risks: [
      {
        risk: "Mechanical-preview limitation",
        mechanism: "No AI transport was available, so forecasts use a generic revenue-compounding model.",
        affectedKpi: "Revenue",
        financialConsequence: "Forecast and valuation carry low confidence.",
        valuationConsequence: "Fair value is indicative only.",
        monitoringIndicator: "Re-run with an AI provider key configured.",
      },
    ],
    competitiveAnalysis: {
      competitors: [],
      insufficient: true,
      note: "AI competitive analysis unavailable in mechanical preview.",
    },
    moat: {
      hasMoat: false,
      sources: [],
      verdict: "Moat assessment pending AI analysis.",
    },
  };
}

function buildSensitivity(
  spec: ValuationSpecification,
  forecast: ResearchReport["forecast"],
  pack: FactPack
): Array<Record<string, number | string>> {
  const baseKe = spec.discountRate ?? 0.1;
  const baseG = spec.terminalAssumptions?.growth ?? 0.04;
  const out: Array<Record<string, number | string>> = [];
  for (const dKe of [-0.02, 0, 0.02]) {
    for (const dG of [-0.01, 0, 0.01]) {
      const trial: ValuationSpecification = {
        ...spec,
        discountRate: baseKe + dKe,
        terminalAssumptions: spec.terminalAssumptions
          ? { ...spec.terminalAssumptions, growth: baseG + dG }
          : { growth: baseG + dG, rationale: "sensitivity grid" },
      };
      try {
        const r = executeValuation(trial, forecast, pack);
        out.push({
          discountRate: Math.round((baseKe + dKe) * 1000) / 10,
          terminalGrowth: Math.round((baseG + dG) * 1000) / 10,
          fairValue:
            r.fairValuePerShare !== undefined
              ? Math.round(r.fairValuePerShare * 100) / 100
              : "N/A",
        });
      } catch {
        out.push({
          discountRate: baseKe + dKe,
          terminalGrowth: baseG + dG,
          fairValue: "N/A",
        });
      }
    }
  }
  return out;
}

export default { runAiFirstResearch, makeProviderTransport };
