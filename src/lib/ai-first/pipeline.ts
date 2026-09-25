/**
 * APEX RESEARCH — AI-FIRST ORCHESTRATION PIPELINE
 *
 * ONE dynamic AI pipeline (no sector gates, no archetype dispatch):
 *
 *   TICKER
 *    -> fetchQuoteSummary (yfinance, factual only)
 *    -> buildFactPack (provenance-tagged, no zero-fill)
 *    -> understandCompany (AI)
 *    -> buildResearchPlan (what do we not know?)
 *    -> buildEconomicEngine (AI: statement bindings + value questions)
 *    -> buildResearchDiscovery (identify gaps + collect evidence + seed writers)
 *    -> buildDebatesEarly (AI: 3-5 value debates BEFORE forecast, seeded by discovery)
 *    -> buildEvidenceMap (claims → [F-...] evidence + confidence)
 *    -> buildModelSpec (AI formulas + debate-driven drivers; code executes)
 *    -> executeForecast (deterministic)
 *    -> buildValuationSpec (AI selects method with debates/evidence; code executes)
 *    -> executeValuation (deterministic)
 *    -> buildScenarios + flowScenarioThroughModel (AI deltas; code executes)
 *    -> chooseReverseVariable + solveRequiredValue (AI chooses; code solves)
 *    -> enhanceResearchDiscovery (merge margin path / valuation / reverse gap)
 *    -> buildNarrative (AI EXPLAINS thesis/risks/catalysts/competitive/moat from research)
 *    -> runQualityReview + adjudicateRegeneration (deterministic gates;
 *       LLM regeneration hooks when a transport is available)
 *    -> assembleResearchReport (versioned object; PDF renders this only)
 *
 * AXIOM: AI decides the model. Code executes the model.
 * YFINANCE is the only factual source. The LLM never does arithmetic,
 * never invents history, never hand-writes a target price.
 */

import { buildFactPack, verifyFactPack } from "./fact-pack";
import { buildResearchAnalytics } from "../research-package/analytics";
import type { ResearchAnalytics } from "../research-package/analytics";
import { decomposeResearchConfidence } from "../research-package/confidence";
import type { ConfidenceDecomposition } from "../research-package/confidence";
import type { PeerCandidateProvider, PeerProfileInput } from "../peer-discovery/types";
import { buildHistoricalAnalysisPack, renderHistoricalAnalysisPack } from "./historical-analysis";
import { buildAnalystBrief } from "./analyst-brief";
import { buildResearchPlan, compileResearchRetrievalTasks, mechanicalResearchPlan, type ResearchPlan } from "./research-planner";
import { executeResearchRetrieval } from "../research-retrieval/retrieval";
import type { ExecuteResearchRetrievalOptions, ResearchRetrievalResult } from "../research-retrieval/types";
import { buildCanonicalEvidenceRegistry } from "../research-retrieval/evidence";
import type { CanonicalEvidenceRegistry } from "../research-retrieval/evidence";
import { buildCanonicalResearchLineage } from "../research-lineage/builder";
import { buildResearchLineageGraph, validateResearchLineageGraph } from "../research-lineage/graph";
import { deepFreeze } from "../research-ledger/immutable";
import { stableHash as ledgerStableHash } from "../research-ledger/stable";
import type { ResearchLineageGraph } from "../research-lineage/types";
import { buildDebatesEarly, mechanicalDebates } from "./debate-engine";
import { buildEconomicEngine, mechanicalEconomicEngine } from "./economic-engine";
import { buildEvidenceMap, mechanicalEvidenceMap } from "./evidence-mapper";
import {
  buildResearchDiscovery,
  mechanicalResearchDiscovery,
  enhanceResearchDiscovery,
  applyDiscoverySeeds,
  renderResearchDiscovery,
} from "./research-discovery";
import { understandCompany } from "./company-understanding";
import { buildModelSpec } from "./model-builder";
import { ModelSpecValidationError, validateModelSpec, type ModelSpecValidationResult } from "./model-spec-validator";
import { selectAccountingArchitecture } from "./accounting-architecture";
import { executeForecast } from "./forecast-engine";
import { buildValuationSpec } from "./valuation-builder";
import { executeValuationMatrix } from "./valuation-engine";
import {
  buildScenarios,
  executeScenarioSet,
} from "./scenarios-builder";
import {
  buildReverseValuationPlan,
  validateReverseValuationPlan,
} from "./reverse-planner";
import {
  currentPriceOf,
  solveReverseValuation,
} from "./reverse-valuation";
import { runValuationSensitivity, toLegacySensitivityGrid } from "./sensitivity-engine";
import { runMonteCarlo } from "./monte-carlo";
import { stableHash, stableId } from "./valuation-helpers";
import { buildNarrative } from "./narrative-builders";
import { runQualityReview, adjudicateRegeneration, canonicalQaContextForReport } from "./quality-review";
import { assembleResearchReport } from "./research-report";
import { runCanonicalQa } from "../canonical-qa/decision";
import { runBoundedRegeneration } from "../canonical-qa/regeneration";
import { buildReproducibilityMetadata, hashReproducibilityMetadata } from "../canonical-qa/reproducibility";
import { buildMachineAuditPackage } from "../canonical-qa/audit-package";
import { AI_FIRST_PROMPT_VERSION } from "./llm";
import { globalStageCache, hashStageInput } from "../research-runs/stage-cache";
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
  EconomicEngine,
  ThesisEngineOutput,
  EvidenceMap,
  Debate,
  ResearchDiscoveryPack,
  ReviewFinding,
  ValuationMatrix,
  SensitivityAnalysis,
  MonteCarloResult,
  ReverseValuationPlan,
  ReverseValuationResult,
  ScenarioSetValidation,
  Catalyst,
  Risk,
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
  factPack?: FactPack;
  retrievalProvider?: ExecuteResearchRetrievalOptions["provider"];
  retrieval?: Omit<ExecuteResearchRetrievalOptions, "ticker" | "asOf" | "now">;
  retrievalProviderAllowlist?: readonly string[];
  retrievalLimits?: ExecuteResearchRetrievalOptions["limits"];
  retrievalNow?: string;
  retrievalSignal?: AbortSignal;
  retrievalTimestamp?: string;
  /** Optional broad candidate universe for economic peer discovery. */
  peerUniverse?: readonly PeerProfileInput[] | null;
  /** Optional candidate-universe provider for economic peer discovery. */
  peerProvider?: PeerCandidateProvider | null;
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

function periodScore(period: string | undefined): number {
  if (!period) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(period);
  if (Number.isFinite(parsed)) return parsed;
  const year = period.match(/(?:19|20)\d{2}/)?.[0];
  return year ? Number(year) : Number.NEGATIVE_INFINITY;
}

function latestMetric(pack: FactPack, re: RegExp): Fact | undefined {
  return pack.incomeStatement.facts
    .filter((fact) => re.test(fact.metric) && fact.value !== undefined)
    .sort((left, right) => periodScore(right.reportingPeriod ?? right.fiscalPeriod ?? right.period) - periodScore(left.reportingPeriod ?? left.fiscalPeriod ?? left.period) || (right.factId ?? "").localeCompare(left.factId ?? ""))[0];
}

function revenueSeries(pack: FactPack): number[] {
  return pack.incomeStatement.facts
    .filter((fact) => /revenue/i.test(fact.metric) && fact.value !== undefined && fact.value > 0)
    .sort((left, right) => periodScore(left.reportingPeriod ?? left.fiscalPeriod ?? left.period) - periodScore(right.reportingPeriod ?? right.fiscalPeriod ?? right.period))
    .map((fact) => fact.value as number);
}

/** Exported for content-depth tests (deterministic, no LLM). */
export function mechanicalUnderstanding(pack: FactPack): CompanyUnderstanding {
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
  // Computed mechanical depth (deterministic yfinance facts — no invention).
  const revs = revenueSeries(pack);
  const cagr = historicalCagr(revs);
  const revScale = revs.length ? revs[revs.length - 1] : 0;
  const niHist = pack.incomeStatement.facts.filter((f) => /netIncome/i.test(f.metric) && f.value !== undefined).sort((left, right) => periodScore(right.reportingPeriod ?? right.fiscalPeriod ?? right.period) - periodScore(left.reportingPeriod ?? left.fiscalPeriod ?? left.period)).map((f) => f.value as number);
  const lastNi = niHist.length ? niHist[0] : 0;
  const lastMargin = revScale > 0 ? lastNi / revScale : 0;
  const ocfHist = pack.cashFlow.facts.filter((f) => /operatingCashFlow/i.test(f.metric) && f.value !== undefined).sort((left, right) => periodScore(right.reportingPeriod ?? right.fiscalPeriod ?? right.period) - periodScore(left.reportingPeriod ?? left.fiscalPeriod ?? left.period)).map((f) => f.value as number);
  const lastOcf = ocfHist.length ? ocfHist[0] : 0;
  const debtNow = pack.balanceSheet.facts.filter((f) => /totalDebt/i.test(f.metric) && f.value !== undefined).sort((left, right) => periodScore(right.reportingPeriod ?? right.fiscalPeriod ?? right.period) - periodScore(left.reportingPeriod ?? left.fiscalPeriod ?? left.period))[0]?.value ?? 0;
  const eqNow = pack.balanceSheet.facts.filter((f) => /totalEquity/i.test(f.metric) && f.value !== undefined).sort((left, right) => periodScore(right.reportingPeriod ?? right.fiscalPeriod ?? right.period) - periodScore(left.reportingPeriod ?? left.fiscalPeriod ?? left.period))[0]?.value ?? 0;
  const where = [sector, industry].filter(Boolean).join(" / ") || "its disclosed market";
  return {
    ticker: pack.ticker,
    companyName: name,
    whatItDoes: desc
      ? `Mechanical preview (no AI key): ${desc.slice(0, 600)} The company operates in ${where} with trailing revenue of scale ${revScale > 0 ? revScale.toFixed(0) : "undisclosed"} across ${revs.length} reported period(s). Business segments, footprint detail and strategy require AI analysis or filings — see unknowns.`
      : `Mechanical preview (no AI key) for ${name} (${where}). AI company understanding unavailable; trailing revenue ${revScale > 0 ? revScale.toFixed(0) : "undisclosed"} over ${revs.length} period(s).`,
    howItMakesMoney:
      `Mechanical preview: revenue ${revs.length > 1 ? `compounding at ${(cagr * 100).toFixed(1)}% CAGR over ${revs.length} periods` : "trajectory pending more history"} with net margin ${(lastMargin * 100).toFixed(1)}% on the latest print${ocfHist.length ? `; operating cash flow ${lastOcf.toFixed(0)} ${lastOcf > 0 ? "validates" : "does not currently validate"} reported earnings` : "; cash validation pending statement detail"}. Full revenue equation (volume × realization × mix) requires AI analysis.`,
    businessSegments: [],
    economicUnits: ["revenue"],
    primaryEconomicAbstraction: "revenue",
    revenueDrivers: [
      {
        name: "Revenue",
        mechanism: `Historical reported revenue compounds forward at ${(cagr * 100).toFixed(1)}% CAGR (${revs.length} periods; mechanical growth estimate, AI-unavailable). Volume vs realization split unknown — requires filings.`,
        sourceFacts: ["totalRevenue"],
        statementLine: "totalRevenue",
      },
    ],
    costDrivers: [],
    marginDrivers: niHist.length
      ? [
          {
            name: "Net margin band",
            mechanism: `Net margin printed ${(lastMargin * 100).toFixed(1)}% on the latest print; margin defense vs expansion decides earnings leverage. Cost structure detail requires AI analysis.`,
            sourceFacts: ["netIncome"],
            statementLine: "netIncome",
          },
        ]
      : [],
    cashGenerationDrivers: ocfHist.length
      ? [
          {
            name: "Operating cash conversion",
            mechanism: `Latest operating cash flow ${lastOcf.toFixed(0)} against revenue scale ${revScale.toFixed(0)}; conversion quality decides earnings defensibility. Working-capital chain requires AI analysis.`,
            sourceFacts: ["operatingCashFlow"],
            statementLine: "operatingCashFlow",
          },
        ]
      : [],
    balanceSheetDrivers: debtNow > 0 || eqNow > 0
      ? [
          {
            name: "Funded leverage",
            mechanism: `Reported debt ${debtNow.toFixed(0)} against equity ${eqNow.toFixed(0)}; balance-sheet capacity constrains growth funding and downside. Maturity detail requires filings.`,
            sourceFacts: ["totalDebt"],
            statementLine: "totalDebt",
          },
        ]
      : [],
    returnsDrivers: [],
    capitalEngines: [],
    keyKpis: [
      {
        name: "Revenue",
        rationale: `Top-line scale anchors the mechanical preview (${(cagr * 100).toFixed(1)}% CAGR).`,
        availability: "yfinance",
        unit: "currency",
      },
      ...(niHist.length
        ? [
            {
              name: "Net margin",
              rationale: `Latest ${(lastMargin * 100).toFixed(1)}% — earnings leverage indicator.`,
              availability: "yfinance" as const,
              unit: "percent",
            },
          ]
        : []),
    ],
    metricsToAvoid: [],
    statementsThatMatterMost: ["incomeStatement"],
    industryContext:
      [sector, industry].filter(Boolean).join(" / ") +
        (revs.length
          ? ` — trailing revenue scale ${revScale.toFixed(0)}, ${(cagr * 100).toFixed(1)}% CAGR, latest net margin ${(lastMargin * 100).toFixed(1)}%. Cycle position and share require AI analysis.`
          : " — industry context pending AI analysis."),
    appropriateValuationMethods: [
      { method: "DCF", why: "Mechanical preview default; AI selection unavailable." },
    ],
    confidence: {
      overall: 0.2,
      dataQuality: "mechanical-preview",
      reasoning: "No AI transport available; computed yfinance trajectories used, generic revenue model retained.",
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
  const revenueFactId = revFact?.factId;
  const netIncomeFactId = latestMetric(pack, /netIncome/i)?.factId;
  return {
    horizonYears: 5,
    horizonRationale:
      "Mechanical preview horizon (5Y); AI horizon selection unavailable.",
    variables: [
      {
        id: "V-revenue",
        name: "revenue",
        label: "Revenue",
        ...(baseRevenue !== undefined ? { baseValue: baseRevenue } : {}),
        ...(revenueFactId ? { baseFactId: revenueFactId } : {}),
        unit: currency,
        kind: "input",
        statementLine: revFact?.metric,
      },
      {
        id: "V-netMargin",
        name: "netMargin",
        label: "Net margin",
        ...(baseRevenue !== undefined && baseNI !== undefined ? { baseValue: margin } : {}),
        unit: "decimal",
        kind: "input",
      },
      {
        id: "V-netIncome",
        name: "netIncome",
        label: "Net income",
        ...(baseNI !== undefined ? { baseValue: baseNI } : {}),
        unit: currency,
        kind: "computed",
        statementLine: "netIncome",
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
        sourceFacts: [revenueFactId ?? revFact?.metric ?? "totalRevenue", netIncomeFactId ?? "netIncome"].filter((value): value is string => !!value),
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
        rationale: "Historical revenue CAGR from canonical facts.",
        historicalEvidence: revenueFactId ?? "totalRevenue",
        ...(revenueFactId ? { factIds: [revenueFactId], evidenceIds: [revenueFactId] } : {}),
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
        historicalEvidence: [revenueFactId, netIncomeFactId].filter((value): value is string => !!value).join(" ") || "netIncome / revenue",
        ...([revenueFactId, netIncomeFactId].filter((value): value is string => !!value).length > 0 ? { factIds: [revenueFactId, netIncomeFactId].filter((value): value is string => !!value), evidenceIds: [revenueFactId, netIncomeFactId].filter((value): value is string => !!value) } : {}),
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
  try {
    const hist = buildHistoricalAnalysisPack(pack);
    return renderHistoricalAnalysisPack(hist);
  } catch {
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
  researchPlan: ResearchPlan;
  aiUsed: boolean;
  modelValidation?: ModelSpecValidationResult;
  forecastStatus?: "ready" | "blocked" | "incomplete";
  valuationMatrix?: ValuationMatrix;
  scenarioValidation?: ScenarioSetValidation;
  sensitivityAnalysis?: SensitivityAnalysis;
  monteCarlo?: MonteCarloResult;
  reverseValuationPlan?: ReverseValuationPlan;
  reverseValuationResult?: ReverseValuationResult;
  retrieval?: ResearchRetrievalResult;
  evidenceRegistry?: CanonicalEvidenceRegistry;
  lineage?: ResearchLineageGraph;
  artifactIds?: ResearchReport["artifactIds"];
  researchAnalytics?: ResearchAnalytics;
  confidenceDecomposition?: ConfidenceDecomposition;
  canonicalQa?: ResearchReport["canonicalQa"];
  reproducibility?: ResearchReport["reproducibility"];
  auditPackage?: ResearchReport["auditPackage"];
  regeneratedStages?: string[];
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
  const factPack = opts.factPack ?? buildFactPack(rawQuoteSummary, t, { retrievalTimestamp: opts.retrievalTimestamp });

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

  // 3b. Research planner (what do we not know? what research is required?)
  // Deterministic fallback keeps pipeline honest when no AI key.
  let researchPlan: Awaited<ReturnType<typeof buildResearchPlan>> | ReturnType<typeof mechanicalResearchPlan> = mechanicalResearchPlan(factPack, understanding);
  if (aiUsed) {
    emit("research-plan", "Planning research gaps and required evidence");
    try {
      researchPlan = await buildResearchPlan(transport!, factPack, understanding);
    } catch (e) {
      console.warn("[ai-first] research planner failed, using mechanical plan:", e);
      researchPlan = mechanicalResearchPlan(factPack, understanding);
    }
  }
  const retrievalTasks = compileResearchRetrievalTasks(researchPlan, { asOf: researchPlan.asOf ?? factPack.retrievalTimestamp });
  emit("retrieval", retrievalTasks.length > 0 ? "Executing injected retrieval tasks" : "No retrieval tasks");
  let retrieval: ResearchRetrievalResult;
  try {
    retrieval = await executeResearchRetrieval(retrievalTasks, {
      ticker: t,
      asOf: researchPlan.asOf ?? factPack.retrievalTimestamp,
      now: opts.retrievalNow ?? factPack.retrievalTimestamp,
      provider: opts.retrievalProvider ?? opts.retrieval?.provider ?? null,
      ...(opts.retrievalProviderAllowlist ? { providerAllowlist: opts.retrievalProviderAllowlist } : opts.retrieval?.providerAllowlist || opts.retrieval?.allowedProviders ? { providerAllowlist: opts.retrieval.providerAllowlist ?? opts.retrieval.allowedProviders } : {}),
      ...(opts.retrievalLimits ? { limits: opts.retrievalLimits } : opts.retrieval?.limits ? { limits: opts.retrieval.limits } : {}),
      ...(opts.retrieval?.maxBytes !== undefined ? { maxBytes: opts.retrieval.maxBytes } : {}),
      ...(opts.retrieval?.maxDocumentBytes !== undefined ? { maxDocumentBytes: opts.retrieval.maxDocumentBytes } : {}),
      ...(opts.retrieval?.maxTotalBytes !== undefined ? { maxTotalBytes: opts.retrieval.maxTotalBytes } : {}),
      ...(opts.retrieval?.timeoutMs !== undefined ? { timeoutMs: opts.retrieval.timeoutMs } : {}),
      ...(opts.retrievalSignal ? { signal: opts.retrievalSignal } : opts.retrieval?.signal ? { signal: opts.retrieval.signal } : {}),
    });
  } catch (error) {
    const failedRetrievalBase = {
      version: "research-retrieval-v1" as const,
      status: "failed" as const,
      retrievalStatus: "failed" as const,
      available: true,
      isAvailable: true,
      providerConfigured: Boolean(opts.retrievalProvider ?? opts.retrieval?.provider),
      providerId: (opts.retrievalProvider ?? opts.retrieval?.provider)?.id ?? null,
      providerAllowlist: [...(opts.retrievalProviderAllowlist ?? opts.retrieval?.providerAllowlist ?? opts.retrieval?.allowedProviders ?? ["injected", "fixture", "test", "mock"])].sort(),
      ticker: t,
      asOf: researchPlan.asOf ?? factPack.retrievalTimestamp,
      startedAt: opts.retrievalNow ?? factPack.retrievalTimestamp,
      completedAt: opts.retrievalNow ?? factPack.retrievalTimestamp,
      tasks: retrievalTasks.map((task) => ({ taskId: task.id, status: "failed" as const, attempts: 0, resultRefs: [], documentIds: [], evidenceIds: [], diagnostics: [error instanceof Error ? error.message : String(error)] })),
      documents: [],
      evidence: [],
      diagnostics: ["RETRIEVAL_EXECUTION_FAILED"],
      publicationBlocked: true,
    };
    retrieval = deepFreeze({ ...failedRetrievalBase, resultHash: ledgerStableHash(failedRetrievalBase, "research-retrieval/result/v1") }) as unknown as ResearchRetrievalResult;
  }
  const evidenceRegistry = buildCanonicalEvidenceRegistry({ factPack, retrieval, asOf: retrieval.asOf });
  const retrievalTaskResults = new Map(retrieval.tasks.map((task) => [task.taskId, task]));
  const executedRetrievalTasks = retrievalTasks.map((task) => {
    const result = retrievalTaskResults.get(task.id);
    return {
      ...task,
      status: result?.status ?? task.status,
      attempts: result?.attempts ?? task.attempts,
      resultRefs: result?.resultRefs ?? task.resultRefs,
      ...(result?.error || result?.diagnostics.length ? { blocker: result?.error ?? result?.diagnostics.join("; ") } : {}),
    };
  });
  researchPlan = { ...researchPlan, retrievalTasks: executedRetrievalTasks, retrievalTaskQueue: executedRetrievalTasks, taskQueue: executedRetrievalTasks, tasks: executedRetrievalTasks };
  emit("evidence-registry", `Registered ${evidenceRegistry.items.length} canonical evidence items`);

  // 3c. Economic Engine — what physically determines revenue/margins/cash/capital
  emit("economic-engine", "Building economic engine + statement bindings");
  let economicEngine: EconomicEngine;
  if (aiUsed) {
    try {
      economicEngine = await buildEconomicEngine(transport!, factPack, understanding);
    } catch (e) {
      console.warn("[ai-first] economic engine failed, mechanical fallback:", e);
      economicEngine = mechanicalEconomicEngine(factPack, understanding);
    }
  } else {
    economicEngine = mechanicalEconomicEngine(factPack, understanding);
  }

  // 3c2. Research Discovery — identify gaps NOW, collect evidence, seed writers
  // (architecture per COLPAL audit: discovery before thesis/narrative writers)
  emit("research-discovery", "Identifying research gaps + collecting evidence");
  const discoveryBaseOpts = {
    researchPlanUnknowns: (researchPlan as { unknowns?: string[] })?.unknowns,
  };
  let researchDiscovery: ResearchDiscoveryPack;
  if (aiUsed) {
    try {
      researchDiscovery = await buildResearchDiscovery(
        transport!,
        factPack,
        understanding,
        economicEngine,
        discoveryBaseOpts
      );
    } catch (e) {
      console.warn("[ai-first] research discovery AI failed, mechanical fallback:", e);
      researchDiscovery = mechanicalResearchDiscovery(
        factPack,
        understanding,
        economicEngine,
        discoveryBaseOpts
      );
    }
  } else {
    researchDiscovery = mechanicalResearchDiscovery(
      factPack,
      understanding,
      economicEngine,
      discoveryBaseOpts
    );
  }

  // 3d. Research debates BEFORE forecast — debates must inform driver paths
  emit("debates", "Building debate-driven thesis (pre-forecast)");
  let debateOutput: ThesisEngineOutput;
  if (aiUsed) {
    try {
      debateOutput = await buildDebatesEarly(
        transport!,
        factPack,
        understanding,
        economicEngine,
        researchDiscovery
      );
    } catch (e) {
      console.warn("[ai-first] early debate engine failed, building partial brief for fallback:", e);
      const partialBrief = buildAnalystBrief({ pack: factPack, understanding });
      debateOutput = mechanicalDebates(partialBrief, factPack);
    }
  } else {
    debateOutput = mechanicalDebates(buildAnalystBrief({ pack: factPack, understanding }), factPack);
  }

  // 3e. Evidence mapper — every major claim mapped to [F-...] or marked unsupported
  emit("evidence-map", "Mapping debates/claims to [F-...] evidence");
  let evidenceMap: EvidenceMap;
  if (aiUsed) {
    try {
      evidenceMap = await buildEvidenceMap(transport!, {
        pack: factPack,
        understanding,
        engine: economicEngine,
        debates: debateOutput,
      });
    } catch (e) {
      console.warn("[ai-first] evidence mapper failed, mechanical fallback:", e);
      evidenceMap = mechanicalEvidenceMap({
        pack: factPack,
        understanding,
        engine: economicEngine,
        debates: debateOutput,
      });
    }
  } else {
    evidenceMap = mechanicalEvidenceMap({
      pack: factPack,
      understanding,
      engine: economicEngine,
      debates: debateOutput,
    });
  }

  // 4. Model spec — receives economic engine + research debates so drivers encode the case
  emit("model", "Building financial model specification (debate-driven drivers)");
  let forecastSpec: ForecastSpecification;
  let modelValidation: ModelSpecValidationResult | undefined;
  if (aiUsed) {
    try {
      forecastSpec = await buildModelSpec(transport!, {
        pack: factPack,
        understanding,
        engine: economicEngine,
        debates: debateOutput,
      });
    } catch (error) {
      if (error instanceof ModelSpecValidationError && error.spec) {
        forecastSpec = error.spec;
        modelValidation = error.validation;
      } else {
        forecastSpec = mechanicalModelSpec(factPack);
      }
    }
  } else {
    forecastSpec = mechanicalModelSpec(factPack);
  }
  if (!modelValidation) modelValidation = validateModelSpec(forecastSpec, factPack, { requireEvidence: true, enforceCanonicalBases: true, allowUnresolvedBaseValues: true });
  forecastSpec = { ...forecastSpec, validation: { valid: modelValidation.valid, issues: modelValidation.issues.map((entry) => `${entry.code}: ${entry.message}`) } };

  emit("forecast", "Executing forecast (deterministic arithmetic)");
  const forecastArchitecture = selectAccountingArchitecture({ understanding, engine: economicEngine, factPack });
  const modelId = forecastSpec.modelId ?? stableId("MODEL", [factPack.factPackId ?? factPack.contentHash ?? factPack.ticker, forecastArchitecture.id, forecastSpec.horizonYears, forecastSpec.variables.map((variable) => [variable.name, variable.baseValue])]);
  forecastSpec = { ...forecastSpec, modelId, architecture: forecastArchitecture.id };
  const rawForecastOut = executeForecast({ model: forecastSpec, factPack, architecture: forecastArchitecture, validation: modelValidation });
  const forecastId = forecastSpec.forecastId ?? stableId("FCST", [modelId, factPack.factPackId ?? factPack.contentHash ?? factPack.ticker, rawForecastOut.forecast.status, rawForecastOut.forecast.incomeStatement.map((year) => year.values)]);
  forecastSpec = { ...forecastSpec, forecastId };
  const forecastOut = {
    ...rawForecastOut,
    forecast: { ...rawForecastOut.forecast, modelId, forecastId },
  };

  emit("valuation", "Selecting + executing valuation matrix");
  let valuationSpec: ValuationSpecification = aiUsed
    ? await buildValuationSpec(transport!, {
        pack: factPack,
        understanding,
        forecastSpec,
        engine: economicEngine,
        debates: debateOutput,
        evidenceMap,
      })
    : mechanicalValuationSpec();
  valuationSpec = { ...valuationSpec, modelId, architecture: forecastArchitecture.id };
  const valuationMatrix: ValuationMatrix = executeValuationMatrix({
    specification: valuationSpec,
    forecast: forecastOut.forecast,
    factPack,
    architecture: forecastArchitecture.id,
    requireEvidence: true,
    selectedMethod: valuationSpec.selectedMethod ?? valuationSpec.methodology,
  });
  const valuation = valuationMatrix.methods.find((entry) => entry.methodId === valuationMatrix.primaryMethod)
    ?? valuationMatrix.methods.find((entry) => entry.methodId === valuationMatrix.selectedMethod)
    ?? valuationMatrix.methods[0];

  emit("scenarios", "Generating Bear/Base/Bull scenarios");
  let scenarioSpecs = mechanicalScenarios(forecastSpec, factPack);
  if (aiUsed && forecastOut.forecast.status === "ready") {
    try {
      const generated = await buildScenarios(transport!, factPack, understanding, forecastSpec);
      if (generated.validation.valid) scenarioSpecs = generated.scenarios;
    } catch (error) {
      console.warn("[ai-first] scenario generation failed, mechanical deltas:", error);
    }
  }
  const scenarioValuationSpec = valuation?.executedFrom ?? valuationSpec;
  const scenarioExecution = executeScenarioSet(scenarioSpecs, forecastSpec, forecastOut.forecast, factPack, scenarioValuationSpec, {
    architecture: forecastArchitecture.id,
    requireEvidence: true,
  });
  const finalScenarios = scenarioExecution.scenarios;

  const sensitivityAnalysis: SensitivityAnalysis = runValuationSensitivity({
    specification: scenarioValuationSpec,
    forecast: forecastOut.forecast,
    factPack,
    forecastSpec,
    architecture: forecastArchitecture.id,
    requireEvidence: true,
  });
  const monteCarlo: MonteCarloResult = runMonteCarlo({
    specification: scenarioValuationSpec,
    forecast: forecastOut.forecast,
    factPack,
    forecastSpec,
    architecture: forecastArchitecture.id,
    requireEvidence: true,
    seed: stableHash(`${factPack.factPackId ?? factPack.ticker}:${modelId}:${valuationMatrix.primaryMethod ?? valuationSpec.methodology}`),
    sampleCount: 500,
    variables: sensitivityAnalysis.runs.filter((run) => run.status === "ready" && run.lowValue < run.highValue).map((run) => ({
      variable: run.variable,
      source: run.source,
      distribution: { type: "uniform", min: run.lowValue, max: run.highValue },
    })),
  });

  emit("reverse", "Validating and solving AI reverse-valuation plan");
  const price = currentPriceOf(factPack);
  let reversePlan: ReverseValuationPlan = {
    id: stableId("REVPLAN", [factPack.ticker, modelId, "forecast-blocked"]),
    variable: "revenueCagr",
    why: "No AI reverse plan was executed.",
    unit: "decimal",
    range: { min: Number.NaN, max: Number.NaN },
    economicLinkage: "Unavailable",
    forecastLinkage: "Unavailable",
    modelVariable: "",
    forecastLine: "",
    method: valuation?.methodology ?? valuationSpec.methodology,
    factIds: [],
    evidenceIds: [],
    status: forecastOut.forecast.status === "ready" ? "unavailable" : "invalid",
    diagnostics: forecastOut.forecast.status === "ready" ? [] : [{ code: "FORECAST_BLOCKED", severity: "error", message: "Reverse valuation is blocked by forecast status." }],
    blockers: forecastOut.forecast.status === "ready" ? ["No AI reverse-valuation plan is available without a transport."] : ["Forecast is blocked."],
    publicationBlocked: true,
  };
  if (aiUsed && forecastOut.forecast.status === "ready" && valuation?.status === "ready") {
    try {
      reversePlan = await buildReverseValuationPlan(transport!, {
        pack: factPack,
        understanding,
        forecastSpec,
        valuation,
        architecture: forecastArchitecture.id,
      });
    } catch (error) {
      reversePlan = {
        ...reversePlan,
        status: "unavailable",
        blockers: [`AI reverse plan unavailable: ${error instanceof Error ? error.message : String(error)}`],
        publicationBlocked: true,
      };
    }
  }
  reversePlan = validateReverseValuationPlan(reversePlan, {
    pack: factPack,
    understanding,
    forecastSpec,
    valuation,
    architecture: forecastArchitecture.id,
  });
  let reverseResult: ReverseValuationResult;
  if (forecastOut.forecast.status !== "ready") {
    reverseResult = {
      id: stableId("REV", [reversePlan.id, "forecast-blocked"]),
      variable: reversePlan.variable,
      status: "blocked",
      interpretation: "Reverse valuation is unavailable because the canonical forecast is blocked.",
      plan: reversePlan,
      targetPrice: price,
      diagnostics: reversePlan.diagnostics ?? [],
      blockers: ["Forecast is blocked."],
      publicationBlocked: true,
    };
  } else if (reversePlan.status === "viable") {
    reverseResult = solveReverseValuation({ plan: reversePlan, forecastSpec, factPack, valuationSpec: scenarioValuationSpec, architecture: forecastArchitecture.id, requireEvidence: true, canonicalForecast: forecastOut.forecast }, price);
  } else {
    reverseResult = {
      id: stableId("REV", [reversePlan.id, "unavailable"]),
      variable: reversePlan.variable,
      status: "unavailable",
      interpretation: reversePlan.blockers?.join(" ") ?? "Reverse valuation is unavailable.",
      plan: reversePlan,
      targetPrice: price,
      diagnostics: reversePlan.diagnostics ?? [],
      blockers: reversePlan.blockers ?? ["Reverse valuation is unavailable."],
      publicationBlocked: true,
    };
  }
  const reverse: ResearchReport["reverseValuation"] = reverseResult.status === "ready" && typeof reverseResult.requiredValue === "number" && isFinite(reverseResult.requiredValue)
    ? { variable: reverseResult.variable, requiredValue: reverseResult.requiredValue as number, interpretation: reverseResult.interpretation }
    : null;

  // 8b. Enhance discovery with model outputs (margin path, valuation, reverse gap)
  // Deterministic merge — keeps AI enrichment, adds post-valuation evidence.
  try {
    const marginPathKey = Object.keys(forecastSpec.driverPaths).find((k) => /margin/i.test(k));
    const forecastMarginPath = marginPathKey ? forecastSpec.driverPaths[marginPathKey] : undefined;
    let reverseGapPct: number | undefined;
    if (reverse && reverse.variable === "revenueCagr" && isFinite(reverse.requiredValue)) {
      const modelG = forecastSpec.driverPaths["revenue"]?.[0];
      if (typeof modelG === "number" && isFinite(modelG)) {
        reverseGapPct = (reverse.requiredValue - modelG) * 100;
      }
    }
    researchDiscovery = enhanceResearchDiscovery(researchDiscovery, factPack, understanding, economicEngine, {
      forecastMarginPath,
      reverseGapPct,
      valuation: {
        methodology: valuation.methodology,
        fairValuePerShare: valuation.fairValuePerShare,
      },
    });
  } catch (e) {
    console.warn("[ai-first] discovery enhancement skipped:", e);
  }

  // 8c. Canonical AnalystBrief — single source of truth for narrative stages
  // Built deterministically from all prior outputs; eliminates context drift.
  emit("analyst-brief", "Assembling canonical Analyst Brief");
  const analystBrief = buildAnalystBrief({
    pack: factPack,
    understanding,
    forecastSpec,
    forecast: forecastOut.forecast,
    valuationSpec,
    valuation,
    scenarios: finalScenarios,
  });
  // Inject research-planner gaps + research debates into brief
  try {
    const rpUnknowns = (researchPlan as any)?.unknowns as string[] | undefined;
    const rpRequired = (researchPlan as any)?.requiredResearch as string[] | undefined;
    if (rpUnknowns?.length) analystBrief.missingInformation = [...new Set([...analystBrief.missingInformation, ...rpUnknowns])];
    if (rpRequired?.length) analystBrief.contradictions = [...analystBrief.contradictions, `Required research per planner: ${rpRequired.slice(0, 3).join(", ")}`];
    analystBrief.coreDebate =
      debateOutput.debates[debateOutput.centralDebateIndex]?.debate ||
      debateOutput.thesis.slice(0, 200) ||
      analystBrief.coreDebate;
    if (understanding.whyThisCompany) analystBrief.evidenceLines.push(`WHY THIS COMPANY: ${understanding.whyThisCompany}`);
    if (economicEngine.valueQuestions?.length) {
      analystBrief.evidenceLines.push(`ENGINE VALUE QUESTIONS: ${economicEngine.valueQuestions.join(" | ")}`);
    }
    for (const d of debateOutput.debates) {
      analystBrief.evidenceLines.push(
        `RESEARCH DEBATE: ${d.debate} | FOR: ${d.evidenceFor.map((e) => e.evidence).join("; ")} | AGAINST: ${d.evidenceAgainst.map((e) => e.evidence).join("; ")} | financial: ${d.financialConsequence || "n/a"} | valuation: ${d.valuationConsequence || "n/a"}`
      );
    }
    analystBrief.evidenceLines.push(`CENTRAL THESIS (debate stage): ${debateOutput.thesis}`);
    analystBrief.evidenceLines.push(`EVIDENCE MAP confidence: ${evidenceMap.overallConfidence.toFixed(2)}; unsupported: ${evidenceMap.unsupported.slice(0, 4).join(" | ") || "none"}`);
    for (const item of evidenceMap.items.slice(0, 12)) {
      analystBrief.evidenceLines.push(`EVIDENCE [${item.direction}/T${item.tier}/c${item.confidence.toFixed(2)}]: ${item.claim} — ${item.evidence.slice(0, 140)} ${item.factIds.join(" ")}`);
    }
    analystBrief.evidenceLines.push(`RETRIEVAL STATUS: ${retrieval.status}; provider=${retrieval.providerId ?? "unavailable"}; documents=${retrieval.documents.length}; evidence=${retrieval.evidence.length}.`);
    for (const document of retrieval.documents.slice(0, 10)) {
      analystBrief.evidenceLines.push(`RETRIEVED DOCUMENT [${document.documentId}]: ${document.title}; source=${document.sourceId}; type=${document.sourceType}; status=${document.status}.`);
    }
    analystBrief.evidenceLines.push(renderResearchDiscovery(researchDiscovery).slice(0, 6000));
    const discMissing = researchDiscovery.gaps.filter((g) => g.status === "missing");
    for (const g of discMissing.slice(0, 6)) {
      analystBrief.missingInformation.push(`${g.area}: ${g.question} (${g.why})`);
    }
    analystBrief.missingInformation = [...new Set(analystBrief.missingInformation)];
  } catch {}

  // 9. Narratives — EXPLAIN debates/evidence (do not invent); chain-structured catalysts/moat
  emit("narrative", "Writing thesis / risks / catalysts / moat (explains research debates)");
  let narrative;
  if (aiUsed) {
    try {
      const cfForNarrative = (forecastOut as any).canonicalForecast ?? (forecastOut.forecast as any);
      const narrativeCf = (typeof cfForNarrative === "object" && "basis" in cfForNarrative) ? cfForNarrative : undefined;
      narrative = await buildNarrative(transport!, factPack, understanding, forecastSpec, narrativeCf, {
        engine: economicEngine,
        debates: debateOutput,
        evidenceMap,
        discovery: researchDiscovery,
      });
      // Prefer debate-engine central thesis when narrative thesis is generic
      if (debateOutput && debateOutput.thesis && debateOutput.confidence > 0.5) {
        const debateThesis = debateOutput.thesis;
        const isGenericNarrative = /mechanical preview|pending ai analysis/i.test(narrative.thesis.thesis) || narrative.thesis.thesis.length < 60;
        if (isGenericNarrative || debateOutput.confidence > 0.7) {
          narrative.thesis.thesis = debateThesis;
          if (debateOutput.keyUncertainty) narrative.thesis.keyDebate = debateOutput.debates[debateOutput.centralDebateIndex]?.debate || debateOutput.keyUncertainty;
          if (debateOutput.invalidationCondition) narrative.thesis.whatCouldInvalidate = [debateOutput.invalidationCondition, ...narrative.thesis.whatCouldInvalidate].slice(0, 5);
          if (debateOutput.monitoringKpi) {
            if (!narrative.risks.some((r) => r.monitoringIndicator.includes(debateOutput!.monitoringKpi))) {
              narrative.risks = narrative.risks.map((r, i) => i === 0 ? { ...r, monitoringIndicator: `${r.monitoringIndicator} | Debate monitor: ${debateOutput!.monitoringKpi}` } : r);
            }
          }
        }
      }
    } catch (e) {
      console.warn("[ai-first] narrative generation failed, mechanical fallback:", e);
      narrative = mechanicalNarrative(factPack, valuation);
      aiUsed = false;
    }
  } else {
    narrative = mechanicalNarrative(factPack, valuation);
  }

  // 9b. Guarantee non-empty writer sections from discovery seeds (COLPAL fix:
  // no blank catalysts/risks/moat/thesis when evidence seeds exist)
  narrative = applyDiscoverySeeds(narrative, researchDiscovery);
  const sensitivity = toLegacySensitivityGrid(sensitivityAnalysis);
  const artifactIds: NonNullable<ResearchReport["artifactIds"]> = {
    ...(factPack.factPackId ? { factPackId: factPack.factPackId } : {}),
    modelIds: [modelId],
    forecastIds: [forecastId],
    valuationIds: valuationMatrix.methods.flatMap((entry) => entry.id ? [entry.id] : []),
    scenarioIds: finalScenarios.flatMap((scenario) => scenario.id ? [scenario.id] : []),
    sensitivityIds: sensitivityAnalysis.runs.flatMap((run) => [run.id]),
    monteCarloIds: monteCarlo.id ? [monteCarlo.id] : [],
    reverseIds: [reverseResult.id],
    retrievalIds: [retrieval.resultHash],
    documentIds: retrieval.documents.map((document) => document.documentId),
    evidenceIds: evidenceRegistry.items.map((item) => item.id),
  };
  narrative = linkNarrativeContracts(narrative, researchDiscovery, artifactIds, forecastOut.forecast, valuationMatrix.primaryMethod ?? valuationSpec.methodology);

  // 10b. Institutional research analytics — deterministic, built from the fact
  // pack, the canonical evidence registry and the already-retrieved documents.
  // No additional live source fetch happens here: an absent provider yields an
  // explicit unavailable status rather than a fabricated peer or promise.
  emit("research-analytics", "Building peer, history, earnings-quality and capital-allocation artifacts");
  const analytics = await buildResearchAnalytics({
    factPack,
    understanding,
    retrieval,
    evidenceRegistry,
    researchDiscovery,
    factPackVerified: verifyFactPack(factPack),
    forecastSpec,
    forecast: forecastOut.forecast,
    valuation,
    retrievalStatus: retrieval.status,
    lineageTraceable: true,
    ...(opts.peerUniverse !== undefined ? { peerUniverse: opts.peerUniverse } : {}),
    ...(opts.peerProvider !== undefined ? { peerProvider: opts.peerProvider } : {}),
  });

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
    valuationMatrix,
    scenarios: finalScenarios,
    scenarioValidation: scenarioExecution.validation,
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
    financialQuality: `Forecast status: ${forecastOut.forecast.status ?? "blocked"}; identities: ${forecastOut.identityChecks.filter((check) => check.pass).length}/${forecastOut.identityChecks.length} critical checks pass (${forecastOut.plugs.join("; ") || "no plugs"}); blockers: ${forecastOut.blockers.join("; ") || "none"}.`,
    sensitivity,
    sensitivityAnalysis,
    monteCarlo,
    reverseValuation: reverse,
    reverseValuationResult: reverseResult,
    reverseValuationPlan: reversePlan,
    artifactIds,
    conclusion: aiUsed
      ? `${understanding.companyName} (${t}): ${valuation.methodology} fair value ${valuation.fairValuePerShare !== undefined ? valuation.fairValuePerShare.toFixed(2) : "N/A"} vs current ${price ?? "N/A"} (${upside} upside). See thesis/risks/scenarios for the full AI case.`
      : `Mechanical preview for ${t}: ${valuation.methodology} fair value ${valuation.fairValuePerShare !== undefined ? valuation.fairValuePerShare.toFixed(2) : "N/A"} (${upside}). Supply an AI key for company-specific research.`,
    reviews: [],
    reviewPassed: false,
    regenerationLog: [aiUsed ? "live-AI run" : "mechanical-preview (no AI transport)"],
    economicEngine,
    debates: debateOutput.debates as Debate[],
    evidenceMap,
    researchDiscovery,
    researchPlan,
    peerDiscovery: analytics.peerDiscovery,
    normalizedHistory: analytics.normalizedHistory,
    earningsQuality: analytics.earningsQuality,
    capitalAllocationLedger: analytics.capitalAllocation,
    managementCredibility: analytics.managementCredibility,
    guidanceReconciliation: analytics.guidanceReconciliation,
  });

  // 12. Quality review (deterministic gates) + adjudication
  emit("review", "Running quality review");
  const review = runQualityReview(preReport, factPack);
  const adjudicated = adjudicateRegeneration(
    review.regenerationCandidates,
    review.perReviewer,
    preReport
  );
  const forecastReviewFindings: ReviewFinding[] = forecastOut.forecast.status === "ready" ? [] : [{
    reviewer: "Forecast architecture gate",
    severity: "blocker",
    component: "forecast",
    finding: `Forecast is not publication-ready: ${forecastOut.forecast.blockers?.join("; ") || "critical identity checks did not pass"}`,
    recommendation: "Resolve model validation and integrated statement identity blockers before publication.",
  }];
  const report: ResearchReport = {
    ...preReport,
    reviews: [...review.allFindings.map((finding) => ({ ...finding })), ...forecastReviewFindings],
    reviewPassed: review.passed && forecastOut.forecast.status === "ready",
    regenerationLog: [
      ...preReport.regenerationLog,
      `review score ${review.overallScore}; candidates: ${adjudicated.regenerate.join(", ") || "none"}`,
      `forecast status ${forecastOut.forecast.status ?? "blocked"}`,
    ],
  };
  report.retrieval = retrieval;
  report.evidenceRegistry = evidenceRegistry;
  let lineage: ResearchLineageGraph;
  try {
    lineage = buildCanonicalResearchLineage({
      subjectId: t,
      factPack,
      sourceDocuments: retrieval.documents,
      retrieval,
      evidenceRegistry,
      forecastSpec: forecastSpec as unknown as Record<string, unknown>,
      valuationSpec: valuationSpec as unknown as Record<string, unknown>,
      executedForecast: forecastOut.forecast as unknown as Record<string, unknown>,
      valuationMatrix: valuationMatrix as unknown as Record<string, unknown>,
      report,
      researchPlan,
      extraBlockers: retrieval.diagnostics,
    });
  } catch (error) {
    lineage = buildResearchLineageGraph({ subjectId: t, nodes: [], edges: [] });
  }
  report.lineage = lineage;
  const lineageValidation = validateResearchLineageGraph(lineage);
  if (retrieval.status === "unavailable" || retrieval.status === "failed") {
    report.reviews.push({ reviewer: "Research retrieval gate", severity: "blocker", component: "retrieval", finding: `Retrieval is ${retrieval.status}.`, recommendation: "Configure an allowlisted retrieval provider and resolve failed tasks before publication." });
    report.reviewPassed = false;
  }
  if (!lineageValidation.materialClaimsTraceable) {
    report.reviews.push({ reviewer: "Research lineage gate", severity: "blocker", component: "lineage", finding: lineageValidation.blockers.join("; ") || "Material claim lineage is incomplete.", recommendation: "Provide source-to-claim paths or explicit reviewed blockers for every material claim." });
    report.reviewPassed = false;
  }

  emit("confidence", "Decomposing confidence across data, model, assumption, forecast and valuation");
  const confidenceDecomposition = decomposeResearchConfidence({
    subjectId: t,
    generatedAt: analytics.generatedAt,
    report,
    assumptionCount: forecastSpec.assumptions.length,
    factPackVerified: verifyFactPack(factPack),
    currencyBlocked: false,
    retrievalStatus: retrieval.status,
    lineageTraceable: lineageValidation.materialClaimsTraceable,
    peerDiscovery: analytics.peerDiscovery,
    history: analytics.normalizedHistory,
    earningsQuality: analytics.earningsQuality,
    capitalAllocation: analytics.capitalAllocation,
    managementCredibility: analytics.managementCredibility,
    guidanceReconciliation: analytics.guidanceReconciliation,
    evidenceIds: evidenceRegistry.items.map((item) => item.id),
  });
  report.confidenceDecomposition = confidenceDecomposition;
  for (const note of analytics.diagnostics) {
    report.regenerationLog.push(`research-analytics ${note}`);
  }
  const qaGeneratedAt = factPack.retrievalTimestamp || analytics.generatedAt;
  const reproducibility = buildReproducibilityMetadata({
    provider: aiUsed ? "ai-transport" : "mechanical",
    model: aiUsed ? "ai-pipeline-model" : "mechanical-preview",
    temperature: 0.3,
    maxTokens: 3000,
    tokenBudget: 3000,
    promptVersion: report.promptVersion || AI_FIRST_PROMPT_VERSION,
    promptText: report.promptVersion || AI_FIRST_PROMPT_VERSION,
    pipelineVersion: "apex-ai-first-pipeline-v1",
    factPackVersion: factPack.version,
    factPack,
    modelSpec: forecastSpec,
    assumptions: forecastSpec.assumptions,
    forecast: report.forecast,
    valuation: report.valuation,
    report,
    generatedAt: qaGeneratedAt,
  });
  const reproducibilityHash = hashReproducibilityMetadata(reproducibility);
  const qaContext = { ...canonicalQaContextForReport(report, factPack), retrievalStatus: retrieval.status, retrievalTimestamp: factPack.retrievalTimestamp, now: qaGeneratedAt, generatedAt: qaGeneratedAt };
  const initialCanonicalQa = runCanonicalQa(report, factPack, qaContext, { generatedAt: qaGeneratedAt, reproducibilityHash });
  const bounded = await runBoundedRegeneration(report, factPack, qaContext, { generatedAt: qaGeneratedAt, maxAttempts: 2, ...(transport ? { transport } : {}) });
  const mergedAttempts = [...initialCanonicalQa.attempts, ...bounded.attempts];
  const canonicalQa = bounded.attempts.length > 0 ? runCanonicalQa(bounded.report, factPack, qaContext, { generatedAt: qaGeneratedAt, attempts: mergedAttempts, reproducibilityHash }) : { ...initialCanonicalQa, attempts: mergedAttempts };
  const regeneratedStages: string[] = [...bounded.regeneratedStages];
  if (bounded.attempts.some((a) => a.status === "fixed")) {
    const fixedReport = bounded.report as unknown as ResearchReport;
    if (fixedReport.forecast) report.forecast = fixedReport.forecast;
    if (fixedReport.valuation) report.valuation = fixedReport.valuation;
    if (fixedReport.scenarios) report.scenarios = fixedReport.scenarios;
    report.regenerationLog.push(`canonical-qa regeneration: ${regeneratedStages.join(",") || "none"}`);
  }
  report.canonicalQa = canonicalQa;
  report.qaDecision = canonicalQa.decision;
  report.reproducibility = reproducibility;
  report.regenerationAttempts = mergedAttempts;
  const auditPackage = buildMachineAuditPackage({
    report,
    evidenceRegistry,
    model: forecastSpec,
    forecast: report.forecast,
    valuation: report.valuation,
    assumptions: forecastSpec.assumptions,
    qa: canonicalQa,
    researchPlan,
    lineage,
    reproducibility,
    generatedAt: qaGeneratedAt,
  });
  report.auditPackage = auditPackage;
  report.auditPackageHash = auditPackage.packageHash;
  const stageInputHash = hashStageInput({ ticker: t, factPackHash: factPack.contentHash ?? t, modelId, forecastId });
  globalStageCache.set({ stage: "ai-first-report", inputHash: stageInputHash, pipelineVersion: "apex-ai-first-pipeline-v1", modelVersion: modelId, promptVersion: report.promptVersion, dataVersion: factPack.contentHash ?? t }, { reportHash: auditPackage.reportHash, qaDecision: canonicalQa.decision }, { factPackHash: factPack.contentHash ?? t }, qaGeneratedAt);
  emit("done", `Review ${report.reviewPassed ? "passed" : "flagged"} (${review.overallScore}/100)`);
  return {
    report,
    factPack,
    understanding,
    forecastSpec,
    valuationSpec,
    regenerationCandidates: adjudicated.regenerate,
    researchPlan,
    aiUsed,
    modelValidation,
    forecastStatus: forecastOut.forecast.status,
    valuationMatrix,
    scenarioValidation: scenarioExecution.validation,
    sensitivityAnalysis,
    monteCarlo,
    reverseValuationPlan: reversePlan,
    reverseValuationResult: reverseResult,
    retrieval,
    evidenceRegistry,
    lineage,
    artifactIds,
    researchAnalytics: analytics,
    confidenceDecomposition,
    canonicalQa,
    reproducibility,
    auditPackage,
    regeneratedStages,
  };
}

function mechanicalScenarios(spec: ForecastSpecification, pack?: FactPack): ScenarioSpecification[] {
  const revenueKey = Object.keys(spec.driverPaths).find((key) => key.toLowerCase() === "revenue" && spec.driverPaths[key].length === spec.horizonYears);
  const path = revenueKey ? [...spec.driverPaths[revenueKey]] : [];
  const baseValue = path[0] ?? 0;
  const probabilities = { bear: 0.25, base: 0.5, bull: 0.25 } as const;
  return (["bear", "base", "bull"] as const).map((name) => {
    const delta = name === "bear" ? -0.03 : name === "bull" ? 0.03 : 0;
    const changedVariables = revenueKey ? [{
      variable: revenueKey,
      baseValue,
      scenarioValue: baseValue + delta,
      path: path.map((value) => value + delta),
      rationale: "Mechanical revenue-growth scenario; deterministic execution still validates every result.",
    }] : [];
    return {
      name,
      changedVariables,
      probability: probabilities[name],
      targetPrice: undefined,
      targetProvenance: "forecast" as const,
      id: stableId("SCEN", [pack?.ticker ?? "mechanical", spec.modelId, name, changedVariables.map((change) => [change.variable, change.path])]),
    };
  });
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

function linkNarrativeContracts<T extends { catalysts: Catalyst[]; risks: Risk[] }>(
  narrative: T,
  discovery: ResearchDiscoveryPack,
  artifactIds: NonNullable<ResearchReport["artifactIds"]>,
  forecast: ResearchReport["forecast"],
  methodId: string,
): T {
  const validFactIds = new Set<string>([
    ...discovery.evidenceItems.flatMap((item) => item.factIds),
    ...discovery.catalystSeeds.flatMap((seed) => seed.factIds),
    ...discovery.riskSeeds.flatMap((seed) => seed.factIds),
  ].filter((id): id is string => typeof id === "string"));
  const lineFor = (variable: string): { statement: "incomeStatement" | "balanceSheet" | "cashFlow"; line: string } => {
    const text = variable.toLowerCase();
    const statement = /cash|capex|workingcapital|cfo|depreciation|dividend/.test(text)
      ? "cashFlow"
      : /equity|debt|asset|liabil|book/.test(text)
        ? "balanceSheet"
        : "incomeStatement";
    return { statement, line: variable || (statement === "cashFlow" ? "cfo" : statement === "balanceSheet" ? "totalEquity" : "revenue") };
  };
  const baseTrace = {
    modelIds: [...artifactIds.modelIds],
    scenarioIds: [...artifactIds.scenarioIds],
    sensitivityIds: [...artifactIds.sensitivityIds],
    valuationIds: [...artifactIds.valuationIds],
  };
  const catalysts = narrative.catalysts.map((catalyst, index) => {
    const variable = String(catalyst.financialVariable ?? "revenue");
    const impact = lineFor(variable);
    const matchingSeed = discovery.catalystSeeds.find((seed) => seed.catalyst === catalyst.catalyst || seed.catalyst.includes(String(catalyst.catalyst).slice(0, 20)));
    const factIds = [...new Set(matchingSeed?.factIds ?? [])].filter((id) => validFactIds.has(id));
    return {
      ...catalyst,
      id: String(catalyst.id ?? stableId("CAT", [artifactIds.modelIds, index, catalyst.catalyst])),
      traceability: { factIds, ...baseTrace },
      financialImpactContract: {
        ...impact,
        direction: catalyst.direction ?? "mixed",
        unit: forecast.incomeStatement[0]?.values?.[variable] !== undefined ? "currency" : "ratio_or_count",
        scenarioIds: [...artifactIds.scenarioIds],
        description: catalyst.forecastImpact,
      },
      valuationImpactContract: {
        methodId,
        metric: "fair_value_per_share",
        direction: catalyst.direction ?? "mixed",
        sensitivityIds: [...artifactIds.sensitivityIds],
        scenarioIds: [...artifactIds.scenarioIds],
        description: catalyst.valuationImpact,
      },
    };
  });
  const risks = narrative.risks.map((risk, index) => {
    const impact = lineFor(String(risk.affectedKpi ?? "revenue"));
    const matchingSeed = discovery.riskSeeds.find((seed) => seed.risk === risk.risk || seed.risk.includes(String(risk.risk).slice(0, 20)));
    const factIds = [...new Set(matchingSeed?.factIds ?? [])].filter((id) => validFactIds.has(id));
    return {
      ...risk,
      id: String(risk.id ?? stableId("RISK", [artifactIds.modelIds, index, risk.risk])),
      traceability: { factIds, ...baseTrace },
      financialImpactContract: {
        ...impact,
        direction: "negative",
        unit: "currency_or_ratio",
        scenarioIds: [...artifactIds.scenarioIds],
        description: risk.financialConsequence,
      },
      valuationImpactContract: {
        methodId,
        metric: "fair_value_per_share",
        direction: "negative",
        sensitivityIds: [...artifactIds.sensitivityIds],
        scenarioIds: [...artifactIds.scenarioIds],
        description: risk.valuationConsequence,
      },
    };
  });
  return { ...narrative, catalysts, risks } as T;
}

export default { runAiFirstResearch, makeProviderTransport };
