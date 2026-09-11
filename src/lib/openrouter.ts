// ============================================================
// Multi-Agent Institutional AI Research Synthesis Engine
// 6 Specialized AI Personas:
// 1. Lead Equity Research Director (Thesis, Bulls/Bears, Valuation)
// 2. Real-Time News & Intelligence Analyst (Live News Pulse & Catalysts)
// 3. Economic Moat & Industry Strategist (Five Forces & Moat Pillars)
// 4. Forensic Financial Analyst & DuPont Specialist (Financial Statements & ROE)
// 5. Fixed Income & Corporate Credit Solvency Specialist (Cash Cushion & Debt)
// 6. Governance & Capital Allocation Specialist (Management Quality & Reinvestment)
// ============================================================

import type {
  AnnualFinancials,
  StockData,
  CompanyProfile,
  DCFResult,
  AIAnalysis,
  TickerNewsItem,
  CouncilVerificationAudit,
  NewsSummaryDeskAnalysis,
  AssumptionsLedger,
} from "@/types/report";
import { stmtNum } from "@/types/report";
import { formatPct, formatLargeNum } from "./calculations";
import { resolveMoatRating, capPillarsToRating, type MoatRating } from "./moat";
import { generatePEFirmAnalysis } from "./pe-analysis-engine";
import {
  buildResearchOperatingModel,
  type ResearchOperatingModel,
} from "./research-model";
import {
  SUPPORTED_PROVIDERS,
  CustomKeyConfig,
  RateLimitError,
  PausedForRateLimitError,
  classifyLlmFailure,
  type LlmFailureKind,
} from "./ai-providers";
import {
  WRITER_CHECKER_MAX_ATTEMPTS,
  checkStrategistDraft,
  checkMoatDraft,
  buildStrategistRefinePrompt,
  buildMoatRefinePrompt,
  type WriterCheckerGroundTruth,
} from "./writer-checker-loop";

export { RateLimitError };

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

const safeNum = (v: unknown, fallback = 0): number =>
  typeof v === "number" && isFinite(v) ? v : fallback;

const safeFix = (v: unknown, d = 2, fallback = "—"): string => {
  const n = typeof v === "number" ? v : Number(v);
  return isFinite(n) && !isNaN(n) ? n.toFixed(d) : fallback;
};

// ─────────────────────────────────────────────────────────────
// Sector guardrail: binds every LLM persona to the authoritative sector
// template so cross-sector boilerplate (telecom/FMCG/renewables) can never
// leak into another sector's narrative and trip the publication gate.
// ─────────────────────────────────────────────────────────────
export function buildSectorGuardrail(profile: CompanyProfile, model?: ResearchOperatingModel | null): string {
  // Single-instance rule: callers inside generateAIAnalysis MUST pass the
  // shared model (no section may independently classify). The standalone
  // build below exists only for backward-compatible direct callers.
  const m = model ?? buildResearchOperatingModel({ profile });
  const kpis = m.kpis.slice(0, 10).join("; ");
  const forbidden = m.forbiddenConcepts.join(", ") || "none";
  const required = m.requiredConcepts.slice(0, 8).join(", ");
  const drivers = m.revenueDrivers.join("; ");
  return `Company Ontology Guardrail (authoritative operating model ${m.modelId} ${m.modelVersion} — violations BLOCK publication, the report is rejected):
- REJECTION RULE: if you write ANY of the STRICTLY FORBIDDEN terms below (in any form, including inside compound phrases), the entire report FAILS audit and is discarded. When tempted by a forbidden term, use the sector's own KPIs instead.
- Ontology: ${m.sectorName} (${m.sector}) / ${m.subSector}; operating archetype ${m.operatingArchetype} / ${m.financialArchetype}; segments: ${m.segments.join(", ")}.
- Unit economics (how THIS business makes money): ${m.unitEconomics}
- Revenue drivers (forecast ONLY via these): ${drivers}. Cost drivers: ${m.costDrivers.join("; ")}. Capex: ${m.capexDrivers.join("; ")}. NWC: ${m.nwcDrivers.join("; ")}. Valuation lens: ${m.valuationMethods.join(", ")}; margin metric: ${m.standardMarginMetric}.
- Use ONLY these KPIs: ${kpis}. REQUIRED concepts (must evidence ≥2): ${required}.
- STRICTLY FORBIDDEN terms (never mention in any form — complete list): ${forbidden}.
- Never apply another sector's template (telecom carrier, FMCG, pharma, banking, energy, renewables). Internet platforms must not mention spectrum auctions, tower tenancies, telecom subscriber churn, or packaged-goods distribution. Telecom tariff/subscriber ARPU must not be confused with digital-advertising ARPU per DAU/MAU. Every material number must carry source/period/currency/units provenance or be omitted.`;}
interface OpenRouterMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// ─────────────────────────────────────────────────────────────
// Multi-Model Failover Mechanism with Resilient Timeouts & Multi-Provider Support
// Prioritizes specialized financial & frontier reasoning models
// Automatically handles custom keys (NVIDIA, Gemini, Groq, OpenAI, OpenRouter)
// Throws RateLimitError (with machine-readable `kind`) when the key cannot serve.
// pacing: free-tier keys throttle per-minute bursts, so concurrent agents share
// a process-wide gate (1 at a time, >=5s between starts, adaptive cooldown that
// grows on every observed 429) instead of firing parallel requests that
// collectively 429 the key. Slow by design — eventual success over fast failure.
// ─────────────────────────────────────────────────────────────
const LLM_MAX_CONCURRENT = 1;
const LLM_MIN_GAP_MS = 5000;
const LLM_MAX_HTTP_ATTEMPTS = 10;
const LLM_REQUEST_TIMEOUT_MS = 45000;

let llmGateInFlight = 0;
let llmGateLastStart = 0;
// Adaptive circuit breaker: every observed 429 pushes the next-start horizon
// further out (15s, +10s per consecutive throttle, max 60s). Success resets it.
// This is what makes a whole report eventually succeed instead of dying fast.
let llmGateCooldownUntil = 0;
let llmConsecutiveThrottles = 0;

function llmSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, Math.max(0, ms)));
}

function recordLlmThrottle(): void {
  llmConsecutiveThrottles++;
  const backoff = Math.min(60000, 15000 + (llmConsecutiveThrottles - 1) * 10000);
  llmGateCooldownUntil = Math.max(llmGateCooldownUntil, Date.now() + backoff);
}

function recordLlmSuccess(): void {
  llmConsecutiveThrottles = 0;
  llmGateCooldownUntil = 0;
}

/** Admits one LLM HTTP attempt; caller MUST invoke the returned releaser. */
async function acquireLlmSlot(): Promise<() => void> {
  for (;;) {
    const now = Date.now();
    const cooldownWait = Math.max(0, llmGateCooldownUntil - now);
    const gapWait = Math.max(0, LLM_MIN_GAP_MS - (now - llmGateLastStart));
    if (llmGateInFlight < LLM_MAX_CONCURRENT && cooldownWait === 0 && gapWait === 0) {
      llmGateInFlight++;
      llmGateLastStart = Date.now();
      let released = false;
      return () => {
        if (!released) {
          released = true;
          llmGateInFlight = Math.max(0, llmGateInFlight - 1);
        }
      };
    }
    await llmSleep(250);
  }
}

function rateLimitUserMessage(providerName: string, isCustom: boolean, kind: LlmFailureKind): string {
  if (kind === "invalid_key") {
    return `Invalid API key for ${providerName} (rejected with 401). Re-check the key, use Test Key Connection, then save again.`;
  }
  if (kind === "key_exhausted") {
    return `Your ${providerName} key is out of credits/quota — every model on it fails the same way, so switching models won't help. Top up the account or use a provider with an active free tier, then resume.`;
  }
  if (isCustom) {
    return `Rate limit reached on your custom ${providerName} key (HTTP 429). Free-tier keys allow roughly 20 requests/min and one full report issues ~8 slowly-paced requests — wait about 60 seconds, then Save & Resume (it auto-cools-down first). If throttling persists across different models, the key has likely hit its DAILY free-tier allowance: switch model/provider (NVIDIA NIM or Groq free tiers) or wait for the daily reset.`;
  }
  return "Rate limit exceeded on default server OpenRouter key. Please provide a custom API key from OpenRouter, NVIDIA NIM, Google Gemini, Groq, or OpenAI to proceed.";
}
async function callOpenRouterWithFailover(
  messages: OpenRouterMessage[],
  maxTokens = 2500,
  temperature = 0.35,
  customConfig?: CustomKeyConfig | null
): Promise<string> {
  const isCustom = Boolean(customConfig?.apiKey?.trim());
  const providerKey = customConfig?.provider || "openrouter";
  const providerMeta = SUPPORTED_PROVIDERS[providerKey] || SUPPORTED_PROVIDERS.openrouter;

  const apiKey = isCustom
    ? customConfig!.apiKey.trim()
    : process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error(
      isCustom
        ? `API key for ${providerMeta.name} is missing.`
        : "OPENROUTER_API_KEY is not set in server environment."
    );
  }

  // Determine candidate models
  let candidateModels: string[];
  if (isCustom) {
    const userModel = customConfig?.model?.trim();
    candidateModels = Array.from(
      new Set(
        [userModel, providerMeta.defaultModel, ...providerMeta.candidateModels].filter(
          Boolean
        ) as string[]
      )
    );
  } else {
    const configured = process.env.OPENROUTER_MODEL || "dots-studio/dots-3-note-preview:free";
    candidateModels = Array.from(
      new Set([
        configured,
        "dots-studio/dots-3-note-preview:free",
        "minimax/minimax-m3:free",
        "inclusionai/ling-3.0-flash-fin:free",
        "nvidia/nemotron-3-super-120b-a12b:free",
        "google/gemma-4-31b-it:free",
        "z-ai/glm-5.2:free",
      ])
    );
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const baseUrl = providerMeta.baseUrl;

  const baseHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  if (providerKey === "openrouter") {
    baseHeaders["HTTP-Referer"] = siteUrl;
    baseHeaders["X-Title"] = "Institutional Equity Research Engine";
  }

  let lastError: Error | null = null;
  let lastKind: LlmFailureKind = "other";
  let httpAttempts = 0;

  for (const model of candidateModels) {
    if (httpAttempts >= LLM_MAX_HTTP_ATTEMPTS) break;
    // Slow-but-sure: up to 4 paced tries per model on throttle responses
    // (3s/6s/12s backoff + adaptive gate cooldown). Other errors fail over fast.
    for (let attempt = 0; attempt < 4; attempt++) {
      if (httpAttempts >= LLM_MAX_HTTP_ATTEMPTS) break;
      const release = await acquireLlmSlot();
      try {
        httpAttempts++;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), LLM_REQUEST_TIMEOUT_MS);

        const res = await fetch(baseUrl, {
          method: "POST",
          headers: baseHeaders,
          body: JSON.stringify({
            model,
            messages,
            temperature,
            max_tokens: maxTokens,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!res.ok) {
          const errText = await res.text();
          console.warn(`[${providerMeta.name}] Model ${model} returned HTTP ${res.status}: ${errText.slice(0, 100)}`);

          const kind = classifyLlmFailure(res.status, errText);
          lastKind = kind;
          if (kind === "invalid_key" || kind === "key_exhausted") {
            // Retrying or failing over is pointless — same key fails identically.
            throw new RateLimitError(
              providerMeta.name,
              res.status,
              rateLimitUserMessage(providerMeta.name, isCustom, kind),
              kind
            );
          }
          if (kind === "rate_limited") {
            lastError = new RateLimitError(
              providerMeta.name,
              res.status,
              rateLimitUserMessage(providerMeta.name, isCustom, kind),
              kind
            );
            recordLlmThrottle();
            // Paced retry on the same model before failing over.
            if (attempt < 3 && httpAttempts < LLM_MAX_HTTP_ATTEMPTS) {
              await llmSleep(3000 * Math.pow(2, attempt) + Math.floor(Math.random() * 800));
              continue;
            }
            break;
          }
          lastError = new Error(`[${providerMeta.name}] ${model} HTTP ${res.status}: ${errText.slice(0, 120)}`);
          break;
        }

        const json = await res.json();
        const content = json.choices?.[0]?.message?.content || "";
        if (content && content.trim().length > 0) {
          recordLlmSuccess();
          return content.trim();
        }
        lastError = new Error(`[${providerMeta.name}] ${model} returned empty content.`);
        break;
      } catch (err: unknown) {
        if (err instanceof RateLimitError) throw err;
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(`[${providerMeta.name}] Model ${model} attempt failed: ${lastError.message}`);
        break;
      } finally {
        release();
      }
    }
  }

  if (lastError instanceof RateLimitError) {
    throw lastError;
  }
  if (lastKind === "rate_limited") {
    throw new RateLimitError(
      providerMeta.name,
      429,
      rateLimitUserMessage(providerMeta.name, isCustom, "rate_limited"),
      "rate_limited"
    );
  }

  throw lastError || new Error(`All candidate ${providerMeta.name} models failed or timed out.`);
}

function extractJsonFromResponse<T>(raw: string, fallback: T): T {
  try {
    const cleaned = raw
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();
    return JSON.parse(cleaned) as T;
  } catch {
    const firstBrace = raw.indexOf("{");
    const lastBrace = raw.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(raw.slice(firstBrace, lastBrace + 1)) as T;
      } catch {}
    }
    const firstBracket = raw.indexOf("[");
    const lastBracket = raw.lastIndexOf("]");
    if (firstBracket !== -1 && lastBracket > firstBracket) {
      try {
        return JSON.parse(raw.slice(firstBracket, lastBracket + 1)) as T;
      } catch {}
    }
    return fallback;
  }
}

// ─────────────────────────────────────────────────────────────
// AGENT 1: Lead Equity Research Director & Investment Strategist
// Focus: Investment Thesis, Bull vs Bear debate, Target Price Scenario Matrix
// ─────────────────────────────────────────────────────────────
async function runLeadEquityStrategist(
  profile: CompanyProfile,
  stockData: StockData,
  dcf: DCFResult,
  annualFinancials: AnnualFinancials[],
  customConfig?: CustomKeyConfig | null,
  operatingModel?: ResearchOperatingModel | null
): Promise<{
  investmentThesis: string;
  companyOverview: string;
  investmentConclusion: string;
  swotStrengths: string[];
  swotWeaknesses: string[];
  swotOpportunities: string[];
  swotThreats: string[];
}> {
  const latest = annualFinancials[annualFinancials.length - 1] || ({} as AnnualFinancials);
  const first = annualFinancials[0] || latest;
  const revCAGR = annualFinancials.length > 1
    ? Math.pow(Math.max(1, latest.revenue) / Math.max(1, first.revenue), 1 / (annualFinancials.length - 1)) - 1
    : 0.12;

  const cmp = safeFix(dcf.currentMarketPrice ?? stockData.currentPrice, 2, "0.00");
  const iv = safeFix(dcf.intrinsicValue, 2, "0.00");
  const upDown = dcf.upsideDownside ?? (stockData.currentPrice ? (dcf.intrinsicValue - stockData.currentPrice) / stockData.currentPrice : 0);
  const wacc = dcf.assumptions?.wacc ? (dcf.assumptions.wacc * 100).toFixed(1) : "9.5";
  const tgr = dcf.assumptions?.terminalGrowthRate ? (dcf.assumptions.terminalGrowthRate * 100).toFixed(1) : "3.0";

  const prompt = `You are a Managing Director and Lead Equity Research Analyst at an elite global investment bank (Goldman Sachs / Morgan Stanley).
Author an exhaustive, Wall Street-caliber equity initiation report for ${profile.name} (${profile.ticker}):

Financial & Valuation Inputs:
- Sector: ${profile.sector} | Industry: ${profile.industry} | Country: ${profile.country}
- Current Market Price (CMP): ${cmp} ${profile.currency}
- DCF Fair Value Target: ${iv} ${profile.currency} (Implied Upside/Downside: ${formatPct(upDown)})
- Investment Recommendation: ${dcf.verdict}
- Market Capitalization: ${formatLargeNum(stockData.marketCap || 0, profile.currency)} | Beta: ${safeFix(stockData.beta, 2)}
- 5-Year Revenue CAGR: ${formatPct(revCAGR)} | Latest FY Revenue: ${formatLargeNum(latest.revenue, profile.currency)}
- Latest Margins: Gross: ${formatPct(stmtNum(latest, "grossMargin"))}, EBITDA: ${formatPct(stmtNum(latest, "ebitdaMargin"))}, Net: ${formatPct(latest.netMargin)}
- Capital Efficiency: ROE: ${formatPct(latest.netIncome / (latest.totalEquity || 1))}, Trailing P/E: ${stockData.pe > 0 ? stockData.pe.toFixed(1) + "x" : "N/A"}
- DCF Valuation Drivers: WACC = ${wacc}%, Perpetual Terminal Growth Rate = ${tgr}%

Analytical Directives:
1. Ground your commentary in specific financial numbers, unit economics, and operational milestones from the inputs.
2. Explain the causal mechanisms behind margin expansion, order backlog execution, and operating leverage.
3. Contrast the Bull Case scenario against the Bear Case downside triggers with rigorous numerical backing.

${buildSectorGuardrail(profile, operatingModel)}
Derive ALL SWOT items from the sector guardrail KPIs above — never reuse wind-turbine, O&M-service, steel/copper, or grid-substation examples unless the company is genuinely a renewable-energy manufacturer.

Return a valid JSON object matching this structure EXACTLY:
{
  "investmentThesis": "3 comprehensive, flowing paragraphs. Paragraph 1: Core investment thesis and multi-year secular growth runway. Paragraph 2: Operating leverage, margin expansion drivers, and unit economics. Paragraph 3: Valuation re-rating runway, intrinsic fair value support, and risk-reward asymmetry.",
  "companyOverview": "2 detailed paragraphs detailing commercial segment composition, proprietary technological advantages, geographic footprint, and competitive uniqueness.",
  "investmentConclusion": "2 paragraphs synthesizing the valuation verdict, price-to-fair-value corridor, margin of safety, and final investment recommendation stance.",
  "swotStrengths": [
    "1. Structural Market Leadership: Detailed analytical sentence citing revenue, market share, and backlog scale specific to the sector guardrail.",
    "2. High-Margin Recurring Cash Flows: Detailed sentence on the company's actual recurring revenue mechanism per the sector guardrail (never assume O&M annuities unless evidenced).",
    "3. Capital Structure & Balance Sheet Fortress: Detailed sentence on net cash/debt position and solvency.",
    "4. Technological & Scale Barriers: Detailed sentence on proprietary platforms and scale advantages specific to the sector guardrail."
  ],
  "swotWeaknesses": [
    "1. Input Cost Volatility: Detailed sentence on the sector-relevant input sensitivities per the guardrail (never assume steel/copper unless evidenced).",
    "2. Execution & Working Capital: Detailed sentence on delivery bottlenecks and cash conversion specific to the business model.",
    "3. Competitive Pricing Pressure: Detailed sentence on pricing competition in the company's actual end market.",
    "4. Working Capital Days & Receivables Concentration: Detailed sentence on debtor recovery and cash conversion float."
  ],
  "swotOpportunities": [
    "1. Secular Demand Runway: Detailed sentence on multi-year procurement or adoption drivers specific to the sector guardrail.",
    "2. High-Margin Platform Rollout: Detailed sentence on next-generation product or monetization expansion per the guardrail.",
    "3. Recurring Revenue Expansion: Detailed sentence on compounding service, subscription, or advertising-monetization growth where evidenced."
  ],
  "swotThreats": [
    "1. Policy & Regulatory Shifts: Detailed sentence on the regulations that actually govern this sector per the guardrail.",
    "2. Supply Chain Disruptions: Detailed sentence on the company's evidenced critical inputs and logistics.",
    "3. Infrastructure & Capacity Bottlenecks: Detailed sentence on the capacity constraints relevant to this business model (never assume grid/ISTS unless evidenced)."
  ]
}
Return ONLY raw JSON, no markdown formatting.`;

  const writerSystem = "You are the Lead Equity Research Director at a Tier-1 Investment Bank. You author definitive institutional research with deep quantitative rigor and zero boilerplate.";

  // Writer → checker → rewrite cycle: the strategist drafts, the
  // deterministic gate plus a second (checker) AI verify, and the writer
  // revises from feedback until both pass or attempts run out.
  const truth = buildWriterCheckerTruth(profile, stockData, dcf, resolveMoatRating(annualFinancials, dcf.assumptions?.wacc ?? 0.095), undefined, operatingModel);
  const emptyStrategist = {
    investmentThesis: "",
    companyOverview: "",
    investmentConclusion: "",
    swotStrengths: [],
    swotWeaknesses: [],
    swotOpportunities: [],
    swotThreats: [],
  };
  let best: typeof emptyStrategist | null = null;
  let bestIssueCount = Number.POSITIVE_INFINITY;
  let feedback: string[] | null = null;

  for (let attempt = 1; attempt <= WRITER_CHECKER_MAX_ATTEMPTS; attempt++) {
    const userPrompt = feedback && best
      ? buildStrategistRefinePrompt(truth, best, feedback)
      : prompt;
    const response = await callOpenRouterWithFailover([
      { role: "system", content: writerSystem },
      { role: "user", content: userPrompt },
    ], 2500, 0.35, customConfig);

    const draft = extractJsonFromResponse(response, emptyStrategist);
    const det = checkStrategistDraft(draft, truth);
    if (draft.investmentThesis && det.issues.length < bestIssueCount) {
      best = draft;
      bestIssueCount = det.issues.length;
    }
    if (!det.pass) {
      console.warn(`[writer-checker] strategist attempt ${attempt}/${WRITER_CHECKER_MAX_ATTEMPTS} rejected (deterministic): ${det.issues[0]}`);
      if (attempt >= WRITER_CHECKER_MAX_ATTEMPTS) break;
      feedback = det.issues;
      continue;
    }
    // Deterministic gate passed — ask the second AI to confirm.
    const llm = await runStrategistLlmChecker(draft, truth, customConfig);
    if (llm.pass) return draft;
    console.warn(`[writer-checker] strategist attempt ${attempt}/${WRITER_CHECKER_MAX_ATTEMPTS} rejected (checker AI): ${llm.issues[0]}`);
    if (attempt >= WRITER_CHECKER_MAX_ATTEMPTS) break;
    feedback = [...det.issues, ...llm.issues].slice(0, 8);
  }
  if (best && best.investmentThesis) return best;
  return emptyStrategist;
}

// ─────────────────────────────────────────────────────────────
// AGENT 2: Real-Time News & Corporate Intelligence Specialist
// Focus: Live news pulse, concrete strategic takeaways, catalyst calendar
// ─────────────────────────────────────────────────────────────
async function runNewsIntelligenceAnalyst(
  profile: CompanyProfile,
  stockData: StockData,
  annualFinancials: AnnualFinancials[],
  news: TickerNewsItem[] = [],
  customConfig?: CustomKeyConfig | null,
  operatingModel?: ResearchOperatingModel | null
): Promise<{
  recentNewsAnalysis: { headline: string; publisher?: string; date: string; strategicTakeaway: string }[];
  catalysts: { event: string; horizon: string; probability: string; impact: string }[];
}> {
  const latest = annualFinancials[annualFinancials.length - 1] || ({} as AnnualFinancials);
  const genDate = new Date().toLocaleDateString("en-US", { month: "short", year: "numeric" });

  const newsContext = news.length > 0
    ? news
        .slice(0, 6)
        .map(
          (n, i) =>
            `[Item ${i + 1}] Title: ${n.title}\nPublisher: ${n.publisher || "Financial Wire"}\nDate: ${n.publishedAt?.slice(0, 10) || "Recent"}\nSummary: ${n.summary || "N/A"}`
        )
        .join("\n\n")
    : `Primary operational milestone: ${profile.name} expands institutional order backlog, executing on multi-year delivery contracts across core commercial segments. Financial trajectory: Revenue of ${formatLargeNum(latest.revenue, profile.currency)} with expanding operating margins.`;

  const prompt = `You are the Chief Corporate Intelligence & Real-Time News Analyst at an institutional research desk.
Analyze the recent corporate developments, order execution milestones, and market catalysts for ${profile.name} (${profile.ticker}, ${profile.industry}):

Context Feed:
${newsContext}

Tasks:
1. Synthesize 3-4 high-impact corporate developments. For each event, evaluate the exact strategic takeaway: how does it impact revenue velocity, gross margins, order book backlog execution, or competitive defense?
2. Formulate 4 concrete forward catalysts across 3-12 month horizons with explicit probability estimates and projected fair value upside/downside impact.

${buildSectorGuardrail(profile, operatingModel)}
Describe every development and catalyst ONLY with the guardrail KPIs above — never import another sector's vocabulary.

Return a valid JSON object matching this structure EXACTLY:
{
  "recentNewsAnalysis": [
    {
      "headline": "Concrete recent strategic development or operational milestone",
      "publisher": "Financial Times / Bloomberg / Regulatory Wire",
      "date": "${genDate}",
      "strategicTakeaway": "2-3 analytical sentences explaining the financial, margin, and valuation significance of this development."
    }
  ],
  "catalysts": [
    {
      "event": "Description of specific commercial milestone or earnings catalyst",
      "horizon": "3-6 Months",
      "probability": "High (75%)",
      "impact": "+10% to +15% Fair Value Upside"
    },
    {
      "event": "Description of operational milestone or margin expansion trigger",
      "horizon": "6-9 Months",
      "probability": "Medium-High (65%)",
      "impact": "+8% to +12% Fair Value Upside"
    },
    {
      "event": "Description of corporate action, deleveraging, or capital return trigger",
      "horizon": "9-12 Months",
      "probability": "Medium (55%)",
      "impact": "+5% to +10% Fair Value Upside"
    },
    {
      "event": "Description of regulatory procurement or capacity commercialization trigger",
      "horizon": "12+ Months",
      "probability": "High (70%)",
      "impact": "+12% to +18% Fair Value Upside"
    }
  ]
}
Return ONLY raw JSON, no markdown formatting.`;

  const response = await callOpenRouterWithFailover([
    {
      role: "system",
      content: "You are the Chief Corporate Intelligence & News Analyst. You extract actionable investment intelligence from market developments with zero generic filler.",
    },
    { role: "user", content: prompt },
  ], 2500, 0.35, customConfig);

  return extractJsonFromResponse(response, {
    recentNewsAnalysis: [],
    catalysts: [],
  });
}

// ─────────────────────────────────────────────────────────────
// AGENT 3: Economic Moat, Value Chain & Strategy Specialist
// Focus: Porter's Five Forces, 4 Moat Sources (Cost, Switching, IP, Network)
// ─────────────────────────────────────────────────────────────
/**
 * Durability ceiling + conforming examples for a composite rating. The JSON
 * schema examples below interpolate these so the model copies capped formats
 * instead of defaulting every pillar to Wide (the systematic MOAT-02 trip).
 */
export function moatDurabilityExamples(rating: MoatRating): { ceiling: string; ex: [string, string, string] } {
  if (rating === "Wide") return { ceiling: "Wide (up to 20+ Yrs)", ex: ["15+ Years", "10-20 Years", "10-15 Years"] };
  if (rating === "Narrow") return { ceiling: "Narrow (7-10 Yrs)", ex: ["Narrow (7-10 Yrs)", "Narrow (5-8 Yrs)", "Narrow (7-10 Yrs)"] };
  return { ceiling: "None (< 3 Yrs)", ex: ["None (< 3 Yrs)", "None (< 3 Yrs)", "None (< 3 Yrs)"] };
}

// ─────────────────────────────────────────────────────────────
// Writer-Checker cycle: second-AI semantic checkers (lite tier)
// The deterministic gate in writer-checker-loop.ts is authoritative;
// these LLM checkers add judgment on coherence/vagueness. Best-effort:
// a checker outage resolves to PASS so the deterministic verdict stands.
// ─────────────────────────────────────────────────────────────
function buildWriterCheckerTruth(
  profile: CompanyProfile,
  stockData: StockData,
  dcf: DCFResult,
  canonicalMoat: MoatRating,
  roicSpreadPp?: number,
  operatingModel?: ResearchOperatingModel | null
): WriterCheckerGroundTruth {
  const cmp = Number(dcf.currentMarketPrice ?? stockData.currentPrice ?? 0) || 0;
  const fv = Number(dcf.intrinsicValue ?? cmp) || cmp;
  const upside = Number.isFinite(dcf.upsideDownside ?? NaN)
    ? (dcf.upsideDownside as number)
    : cmp > 0
      ? (fv - cmp) / cmp
      : 0;
  return {
    companyName: profile.name,
    ticker: profile.ticker,
    sector: profile.sector || "",
    industry: profile.industry || "",
    description: (profile as { description?: string }).description || "",
    currency: profile.currency || "USD",
    cmp,
    fv,
    upside,
    verdict: (dcf.verdict || "HOLD").toUpperCase(),
    wacc: dcf.assumptions?.wacc ?? 0.095,
    terminalGrowthRate: dcf.assumptions?.terminalGrowthRate ?? 0.03,
    canonicalMoat,
    roicSpreadPp,
    ...(operatingModel
      ? {
          operatingModel: {
            requiredConcepts: operatingModel.requiredConcepts,
            forbiddenConcepts: operatingModel.forbiddenConcepts,
            isKnownSector: operatingModel.isKnownSector,
            sector: operatingModel.sector,
          },
        }
      : {}),
  };
}

async function runStrategistLlmChecker(
  draft: { investmentThesis?: string; companyOverview?: string; investmentConclusion?: string },
  truth: WriterCheckerGroundTruth,
  customConfig?: CustomKeyConfig | null
): Promise<{ pass: boolean; issues: string[] }> {
  const fallback = { pass: true, issues: [] as string[] };
  try {
    const res = await callOpenRouterWithFailover([
      {
        role: "system",
        content: "You are the Thesis Checker on an institutional equity desk. You verify a colleague's thesis draft for stance errors, vague filler, and internal contradictions. Reply with raw JSON {pass:boolean, issues:string[]} only — no prose.",
      },
      {
        role: "user",
        content: [
          `Ground truth: ${truth.companyName} verdict ${truth.verdict}, fair value ${truth.fv.toFixed(2)}, CMP ${truth.cmp.toFixed(2)}, upside ${(truth.upside * 100).toFixed(1)}%.`,
          `Draft thesis: ${(draft.investmentThesis || "").slice(0, 1200)}`,
          `Draft conclusion: ${(draft.investmentConclusion || "").slice(0, 600)}`,
          `Check: (1) conclusion states ${truth.verdict} with no opposing stance words; (2) no generic filler without numbers; (3) thesis and conclusion do not contradict each other.`,
          `Return {"pass":true,"issues":[]} if clean, else {"pass":false,"issues":["<one sentence per problem>"]}.`,
        ].join("\n"),
      },
    ], 500, 0.1, customConfig);
    const parsed = extractJsonFromResponse<{ pass?: boolean; issues?: string[] }>(res, fallback);
    if (typeof parsed.pass !== "boolean") return fallback;
    return { pass: parsed.pass, issues: Array.isArray(parsed.issues) ? parsed.issues.filter((s) => typeof s === "string").slice(0, 5) : [] };
  } catch (err) {
    if (err instanceof RateLimitError) throw err;
    return fallback;
  }
}

async function runMoatLlmChecker(
  draft: { competitiveMoat?: string; moatPillars?: { pillar?: string; durability?: string; rationale?: string }[] },
  truth: WriterCheckerGroundTruth,
  customConfig?: CustomKeyConfig | null
): Promise<{ pass: boolean; issues: string[] }> {
  const fallback = { pass: true, issues: [] as string[] };
  try {
    const res = await callOpenRouterWithFailover([
      {
        role: "system",
        content: "You are the Moat Checker on an institutional equity desk. You verify a colleague's moat draft stays within the canonical composite rating. Reply with raw JSON {pass:boolean, issues:string[]} only.",
      },
      {
        role: "user",
        content: [
          `Canonical composite moat: ${truth.canonicalMoat} (pillars are subordinate — never upgrades).`,
          `Narrative: ${(draft.competitiveMoat || "").slice(0, 900)}`,
          `Pillars: ${(draft.moatPillars || []).map((p) => `${p?.pillar}: ${p?.durability}`).join(" | ").slice(0, 500)}`,
          `Check: (1) no pillar outranks ${truth.canonicalMoat}; (2) no wide-moat superlatives under Narrow/None; (3) rationales are company-specific, not generic.`,
          `Return {"pass":true,"issues":[]} if clean, else {"pass":false,"issues":["<one sentence per problem>"]}.`,
        ].join("\n"),
      },
    ], 500, 0.1, customConfig);
    const parsed = extractJsonFromResponse<{ pass?: boolean; issues?: string[] }>(res, fallback);
    if (typeof parsed.pass !== "boolean") return fallback;
    return { pass: parsed.pass, issues: Array.isArray(parsed.issues) ? parsed.issues.filter((s) => typeof s === "string").slice(0, 5) : [] };
  } catch (err) {
    if (err instanceof RateLimitError) throw err;
    return fallback;
  }
}

async function runMoatAndStrategyAnalyst(
  profile: CompanyProfile,
  stockData: StockData,
  annualFinancials: AnnualFinancials[],
  dcf: DCFResult,
  customConfig?: CustomKeyConfig | null,
  canonicalMoat?: MoatRating,
  operatingModel?: ResearchOperatingModel | null
): Promise<{
  moatSources: {
    switchingCosts: string;
    intangibleAssets: string;
    costAdvantage: string;
    moatTrend: string;
  };
  fiveForces: { force: string; level: string; commentary: string }[];
  moatPillars: { pillar: string; durability: string; rationale: string }[];
  competitiveMoat: string;
}> {
  const latest = annualFinancials[annualFinancials.length - 1] || ({} as AnnualFinancials);
  const roe = latest.totalEquity > 0 ? (latest.netIncome / latest.totalEquity) : (stockData.returnOnEquity || 0.15);
  const wacc = dcf.assumptions?.wacc || 0.095;
  const rawInvestedCap = (latest.totalEquity || 0) + (latest.totalDebt || 0) - (latest.cash || 0);
  const investedCap = rawInvestedCap > 0 ? rawInvestedCap : (latest.totalAssets > 0 ? latest.totalAssets : 1);
  const taxRate = dcf.assumptions?.marginalTaxRate ?? 0.25;
  const latestOpInc = stmtNum(latest, "operatingIncome");
  const nopat = latestOpInc * (1 - taxRate);
  const roic = latestOpInc ? Math.max(0, nopat / investedCap) : (stockData.returnOnAssets || 0.12);
  const roicSpread = (roic - wacc) * 100;

  // Canonical composite moat gates everything below: pillar durabilities must not
  // exceed it, and Narrow/None composites forbid wide-moat superlatives outright
  // (MOAT-01/MOAT-02 block contradictions — a Wide pillar under None is always a
  // generation error, never a discovery).
  const ratingLine = canonicalMoat
    ? `
- CANONICAL COMPOSITE MOAT (model truth, computed from ROCE vs WACC): ${canonicalMoat}.`
    : "";
  const ceilingBlock = canonicalMoat
    ? (() => {
      const { ceiling } = moatDurabilityExamples(canonicalMoat);
      const widthLine = canonicalMoat === "Wide"
        ? `You may evidence durable advantages up to ${ceiling}.`
        : `Do NOT use wide-moat superlatives anywhere (wide/durable/formidable/unassailable/expanding moat, widening moat): describe limited, contested, or absent advantages plainly. Every pillar durability must read at or below ${ceiling}. Pillars are subordinate breakdowns of the composite above — never independent upgrades.`;
      return `
- HARD CONSTRAINT on moat width: ${widthLine}`;
    })()
    : "";
  const ex = canonicalMoat ? moatDurabilityExamples(canonicalMoat).ex : (["15+ Years", "10-20 Years", "10-15 Years"] as [string, string, string]);
  const prompt = `You are the Head of Economic Moats and Industrial Organization Strategy (Morningstar / Michael Porter Framework).
Evaluate the competitive defensibility, Porter's Five Forces, and structural moat sources for ${profile.name} (${profile.ticker}, ${profile.industry}):

Financial & Competitive Context:
- Gross Margin: ${formatPct(stmtNum(latest, "grossMargin"))} | EBITDA Margin: ${formatPct(stmtNum(latest, "ebitdaMargin"))} | Net Margin: ${formatPct(latest.netMargin)}
- Capital Return (ROIC): ${formatPct(roic)} | Cost of Capital (WACC): ${(wacc * 100).toFixed(1)}% | ROIC Economic Spread: ${roicSpread >= 0 ? "+" : ""}${roicSpread.toFixed(1)}% | ROE: ${formatPct(roe)}
- Enterprise Scale: Market Cap = ${formatLargeNum(stockData.marketCap || 0, profile.currency)}, Revenue = ${formatLargeNum(latest.revenue, profile.currency)}${ratingLine}${ceilingBlock}
- Strict Directive: Never confuse ROE with ROIC. Economic spread is strictly ROIC minus WACC. If ROIC spread is negative or near zero, do not claim returns substantially exceed cost of capital.

Directives:
1. Deeply analyze all structural moat sources: Customer Switching Costs, Intangible Assets & Certifications, Cost Advantage via Localization/Scale, and Network/Ecosystem Density.
2. Determine Moat Trend (Positive, Stable, or Negative) with empirical rationale.
3. Score each of Porter's Five Forces with explicit strategic defense mechanisms.
4. Derive every moat pillar, certification, and force commentary from the company's actual sector — never import wind-turbine, SCADA, O&M-fleet, spectrum, tower, CASA, or clinical-trial boilerplate from another sector.

${buildSectorGuardrail(profile, operatingModel)}

Return a valid JSON object matching this structure EXACTLY:
{
  "competitiveMoat": "Comprehensive 2-paragraph analysis evaluating total moat width (Narrow/Wide/None), duration of Competitive Advantage Period (CAP), and ROIC defensibility against new capital entrants — grounded strictly in the sector guardrail.",
  "moatSources": {
    "switchingCosts": "Detailed paragraph on the switching friction evidenced in this business model per the sector guardrail (never assume O&M contracts or SCADA unless evidenced).",
    "intangibleAssets": "Detailed paragraph on brand equity, proprietary platforms, patents, and the certifications that actually apply to this sector per the guardrail.",
    "costAdvantage": "Detailed paragraph on the scale, procurement, or infrastructure advantages evidenced for this business model.",
    "moatTrend": "Positive"
  },
  "fiveForces": [
    { "force": "Threat of New Entrants", "level": "Low", "commentary": "Detailed sentence on entry barriers specific to this sector per the guardrail." },
    { "force": "Bargaining Power of Buyers", "level": "Moderate", "commentary": "Detailed sentence on buyer concentration and switching dynamics in this end market." },
    { "force": "Bargaining Power of Suppliers", "level": "Moderate", "commentary": "Detailed sentence on the critical inputs and supplier structure for this business model." },
    { "force": "Threat of Substitutes", "level": "Low", "commentary": "Detailed sentence on substitution risk for this product or service." },
    { "force": "Competitive Rivalry", "level": "Moderate", "commentary": "Detailed sentence on market structure and rivalry in this sector." }
  ],
  "moatPillars": [
    { "pillar": "Primary Defensibility Pillar per Sector Guardrail", "durability": "${ex[0]}", "rationale": "Detailed rationale tied to evidenced barriers, not imported boilerplate." },
    { "pillar": "Secondary Recurring-Revenue Pillar per Sector Guardrail", "durability": "${ex[1]}", "rationale": "Detailed rationale on the company's actual recurring mechanism where evidenced." },
    { "pillar": "Scale or Cost Pillar per Sector Guardrail", "durability": "${ex[2]}", "rationale": "Detailed rationale on evidenced scale or cost advantages." }
  ]
}
Return ONLY raw JSON, no markdown formatting.`;

  const writerSystem = "You are the Head of Economic Moats and Competitive Advantage Period (CAP) Analysis. You evaluate barrier durability with rigorous microeconomic depth.";

  // Writer → checker → rewrite cycle: same contract as the strategist —
  // draft, deterministic ceiling gate + second-AI check, revise to pass.
  const effectiveMoat: MoatRating = canonicalMoat ?? resolveMoatRating(annualFinancials, dcf.assumptions?.wacc ?? 0.095);
  const truth = buildWriterCheckerTruth(profile, stockData, dcf, effectiveMoat, roicSpread, operatingModel);
  const emptyMoat = {
    moatSources: { switchingCosts: "", intangibleAssets: "", costAdvantage: "", moatTrend: "Positive" },
    fiveForces: [],
    moatPillars: [],
    competitiveMoat: "",
  };
  let best: typeof emptyMoat | null = null;
  let bestIssueCount = Number.POSITIVE_INFINITY;
  let feedback: string[] | null = null;

  for (let attempt = 1; attempt <= WRITER_CHECKER_MAX_ATTEMPTS; attempt++) {
    const userPrompt = feedback && best
      ? buildMoatRefinePrompt(truth, best, feedback)
      : prompt;
    const response = await callOpenRouterWithFailover([
      { role: "system", content: writerSystem },
      { role: "user", content: userPrompt },
    ], 2500, 0.35, customConfig);

    const draft = extractJsonFromResponse(response, emptyMoat);
    const det = checkMoatDraft(draft, truth);
    if (draft.competitiveMoat && det.issues.length < bestIssueCount) {
      best = draft;
      bestIssueCount = det.issues.length;
    }
    if (!det.pass) {
      console.warn(`[writer-checker] moat attempt ${attempt}/${WRITER_CHECKER_MAX_ATTEMPTS} rejected (deterministic): ${det.issues[0]}`);
      if (attempt >= WRITER_CHECKER_MAX_ATTEMPTS) break;
      feedback = det.issues;
      continue;
    }
    const llm = await runMoatLlmChecker(draft, truth, customConfig);
    if (llm.pass) return draft;
    console.warn(`[writer-checker] moat attempt ${attempt}/${WRITER_CHECKER_MAX_ATTEMPTS} rejected (checker AI): ${llm.issues[0]}`);
    if (attempt >= WRITER_CHECKER_MAX_ATTEMPTS) break;
    feedback = [...det.issues, ...llm.issues].slice(0, 8);
  }
  if (best && best.competitiveMoat) return best;
  return emptyMoat;
}

// ─────────────────────────────────────────────────────────────
// AGENT 4: Forensic Financial Analyst & DuPont Specialist
// Focus: Multi-Year Financial Statements, DuPont ROE decomposition, Working Capital
// ─────────────────────────────────────────────────────────────
async function runForensicFinancialAnalyst(
  profile: CompanyProfile,
  annualFinancials: AnnualFinancials[],
  customConfig?: CustomKeyConfig | null,
  operatingModel?: ResearchOperatingModel | null
): Promise<{
  revenueCommentary: string;
  ebitdaCommentary: string;
  ebitCommentary: string;
  patCommentary: string;
  balanceSheetCommentary: string;
  cashFlowCommentary: string;
  dupontCommentary: string;
  ratioCommentary: string;
}> {
  const latest = annualFinancials[annualFinancials.length - 1];
  const first = annualFinancials[0];
  const revCAGR = annualFinancials.length > 1
    ? Math.pow(Math.max(1, latest.revenue) / Math.max(1, first.revenue), 1 / (annualFinancials.length - 1)) - 1
    : 0;

  const summaryData = annualFinancials.map(f =>
    `${f.year}: Rev=${formatLargeNum(f.revenue, profile.currency)}, GM=${formatPct(stmtNum(f, "grossMargin"))}, EBITDA=${formatLargeNum(stmtNum(f, "ebitda"), profile.currency)} (${formatPct(stmtNum(f, "ebitdaMargin"))}), PAT=${formatLargeNum(f.netIncome, profile.currency)}, OCF=${formatLargeNum(f.operatingCashFlow, profile.currency)}, Capex=${formatLargeNum(f.capitalExpenditures, profile.currency)}`
  ).join("\n");

  const taxBurden = latest.pretaxIncome > 0 ? (latest.netIncome / latest.pretaxIncome).toFixed(2) : "0.75";
  const dupontOpInc = stmtNum(latest, "operatingIncome");
  const intBurden = dupontOpInc > 0 ? (latest.pretaxIncome / dupontOpInc).toFixed(2) : "0.85";
  const opMargin = formatPct(stmtNum(latest, "ebitMargin") || (dupontOpInc / (latest.revenue || 1)));
  const assetTurn = (latest.revenue / (latest.totalAssets || 1)).toFixed(2);
  const eqMult = (latest.totalAssets / (latest.totalEquity || 1)).toFixed(2);
  const roe = formatPct(latest.netIncome / (latest.totalEquity || 1));

  const prompt = `You are a Senior Forensic Accounting Auditor and Chartered Financial Analyst (CFA).
Dissect the multi-year financial performance, earnings quality, and 5-Stage DuPont ROE trajectory for ${profile.name} (${profile.ticker} — Sector: ${profile.sector} | Industry: ${profile.industry}):

5-Year Financial Statement History:
${summaryData}

5-Year Top-Line CAGR: ${formatPct(revCAGR)}
Latest Balance Sheet: Assets = ${formatLargeNum(latest.totalAssets, profile.currency)}, Debt = ${formatLargeNum(latest.totalDebt, profile.currency)}, Equity = ${formatLargeNum(latest.totalEquity, profile.currency)}, Cash = ${formatLargeNum(latest.cash, profile.currency)}

5-Stage DuPont Decomposition Components:
1. Tax Burden (Net Income / Pretax Income): ${taxBurden}
2. Interest Burden (Pretax Income / EBIT): ${intBurden}
3. Operating Margin (EBIT / Revenue): ${opMargin}
4. Asset Turnover (Revenue / Total Assets): ${assetTurn}x
5. Financial Leverage Multiplier (Total Assets / Total Equity): ${eqMult}x
-> Resulting ROE: ${roe}

Directives:
- Write with forensic precision, dissecting cash conversion quality, accrual divergence, working capital float, and operational leverage.
- Avoid vague commentary; cite the exact multi-year numbers and percentage changes from the input data.

${buildSectorGuardrail(profile, operatingModel)}
Use ONLY the guardrail KPIs above — a financial-statement footnote never justifies importing another sector's template vocabulary.

Return a valid JSON object matching this structure EXACTLY:
{
  "revenueCommentary": "2 detailed paragraphs analyzing multi-year revenue growth quality, order book delivery velocity, organic volume vs realization, and cyclical resilience.",
  "ebitdaCommentary": "2 detailed paragraphs analyzing operating profitability progression, fixed-cost absorption, gross-to-operating margin conversion, and raw material pass-through discipline.",
  "ebitCommentary": "1 detailed paragraph on operational leverage, depreciation schedule sanity, and core economic EBIT compounding.",
  "patCommentary": "2 detailed paragraphs on net earnings quality, effective tax rate stability, statutory adjustments, and diluted EPS trajectory.",
  "balanceSheetCommentary": "2 detailed paragraphs on capital structure health, net working capital days, cash conversion cycle, debt composition, and asset tangibility.",
  "cashFlowCommentary": "2 detailed paragraphs analyzing operating cash flow conversion (OCF/EBITDA), growth vs maintenance capex intensity, and free cash flow self-funding capability. HARD CONSTRAINT: the canonical forecast FCFF path is provided in context — if any of forecast years 1-3 print negative FCFF, describe the investment phase honestly (growth funded externally); NEVER claim self-funding, robust cash generation, or comfortable distribution coverage in that case.",
  "dupontCommentary": "2 detailed paragraphs forensically dissecting whether ROE expansion is driven by operational margin expansion and asset turnover efficiency, or distorted by financial leverage gearing.",
  "ratioCommentary": "2 detailed paragraphs evaluating liquidity (Current/Quick ratios), debt-to-equity leverage, and capital efficiency return ratios."
}
Return ONLY raw JSON, no markdown formatting.`;

  const response = await callOpenRouterWithFailover([
    {
      role: "system",
      content: "You are a Forensic Financial Analyst and CFA Charterholder. You dissect financial statements with empirical precision, forensic scrutiny, and zero boilerplate.",
    },
    { role: "user", content: prompt },
  ], 2500, 0.35, customConfig);

  return extractJsonFromResponse(response, {
    revenueCommentary: "",
    ebitdaCommentary: "",
    ebitCommentary: "",
    patCommentary: "",
    balanceSheetCommentary: "",
    cashFlowCommentary: "",
    dupontCommentary: "",
    ratioCommentary: "",
  });
}

// ─────────────────────────────────────────────────────────────
// AGENT 5: Fixed Income & Corporate Credit Solvency Specialist
// Focus: Business Risk, Cash Flow Cushion, Distance to Default, Bank Covenants
// ─────────────────────────────────────────────────────────────
async function runCreditSolvencyAnalyst(
  profile: CompanyProfile,
  annualFinancials: AnnualFinancials[],
  stockData: StockData,
  customConfig?: CustomKeyConfig | null,
  operatingModel?: ResearchOperatingModel | null
): Promise<{
  creditAnalysisCommentary: {
    financialHealth: string;
    liquidityBuffers: string;
    debtMaturity: string;
    stressTesting: string;
  };
  keyRisks: { risk: string; description: string; impact: "High" | "Medium" | "Low" }[];
}> {
  const latest = annualFinancials[annualFinancials.length - 1];
  const creditEbitda = stmtNum(latest, "ebitda");
  const creditOpInc = stmtNum(latest, "operatingIncome");
  const creditIntExp = stmtNum(latest, "interestExpense");
  const debtToEbitda = creditEbitda > 0 ? (latest.totalDebt / creditEbitda).toFixed(2) : "0.15";
  const intCov = creditIntExp > 0 ? (creditOpInc / creditIntExp).toFixed(1) : "45.0+";
  const netDebt = Math.max(0, latest.totalDebt - ((latest.cash || 0) + stmtNum(latest, "shortTermInvestments")));

  const prompt = `You are the Managing Director of Corporate Credit Ratings and Fixed Income Solvency Research.
Evaluate corporate creditworthiness, liquidity cushions, debt maturity schedules, and downside covenant headroom for ${profile.name} (${profile.ticker}):

Financial Solvency Inputs:
- Total Debt: ${formatLargeNum(latest.totalDebt, profile.currency)} | Cash & Liquid Balances: ${formatLargeNum(latest.cash, profile.currency)}
- Net Debt: ${formatLargeNum(netDebt, profile.currency)} | Total Equity: ${formatLargeNum(latest.totalEquity, profile.currency)}
- Debt / EBITDA: ${debtToEbitda}x | Interest Coverage Multiple: ${intCov}x
- Annual Operating Cash Flow: ${formatLargeNum(latest.operatingCashFlow, profile.currency)} | Free Cash Flow: ${formatLargeNum(latest.freeCashFlow, profile.currency)}
- Equity Beta: ${safeFix(stockData.beta, 2)}

Directives:
1. Formulate an institutional credit rating profile evaluating default resistance, business risk insulation, and cash cushion.
2. Formulate 4 prioritized institutional investment risks with explicit causal descriptions and company-specific mitigations.
3. Derive all risks from the company's actual sector per the guardrail — never use steel/copper/resin, ISTS substation, turbine ASP, or reverse-auction examples unless the company is genuinely a renewable manufacturer.

${buildSectorGuardrail(profile, operatingModel)}

Return a valid JSON object matching this structure EXACTLY:
{
  "creditAnalysisCommentary": {
    "financialHealth": "2 detailed paragraphs evaluating corporate credit grade, business risk defensibility, distance to default, and solvency strength.",
    "liquidityBuffers": "Detailed paragraph analyzing available cash balances, operating cash generation, and revolving credit facilities against upcoming contractual commitments.",
    "debtMaturity": "Detailed paragraph on debt maturity schedule, short-term vs long-term debt mix, and rollover risk mitigation across rolling 5-year horizons.",
    "stressTesting": "Detailed paragraph evaluating covenant headroom and solvency defensibility under an adverse 30% EBITDA compression scenario."
  },
  "keyRisks": [
    { "risk": "Sector-Relevant Input Cost Pressure", "description": "Detailed sentence on the input costs that actually affect this business per the sector guardrail.", "impact": "Medium" },
    { "risk": "Customer Delivery & Execution Risk", "description": "Detailed sentence on the delivery or recognition delays relevant to this business model.", "impact": "Medium" },
    { "risk": "Competitive Pricing Pressure", "description": "Detailed sentence on pricing competition in the company's actual end market.", "impact": "Low" },
    { "risk": "Sector Policy & Regulatory Volatility", "description": "Detailed sentence on the regulations that actually govern this sector per the guardrail.", "impact": "Medium" }
  ]
}
Return ONLY raw JSON, no markdown formatting.`;

  const response = await callOpenRouterWithFailover([
    {
      role: "system",
      content: "You are the Head of Corporate Credit Ratings. You evaluate default probabilities, cash cushion coverage, and covenant headroom with institutional conservatism.",
    },
    { role: "user", content: prompt },
  ], 2500, 0.35, customConfig);

  return extractJsonFromResponse(response, {
    creditAnalysisCommentary: { financialHealth: "", liquidityBuffers: "", debtMaturity: "", stressTesting: "" },
    keyRisks: [],
  });
}

// ─────────────────────────────────────────────────────────────
// AGENT 6: Governance, Stewardship & Capital Allocation Specialist
// Focus: Management Quality, Capital Allocation Track Record, Shareholder Yield
// ─────────────────────────────────────────────────────────────
async function runGovernanceCapitalAnalyst(
  profile: CompanyProfile,
  stockData: StockData,
  annualFinancials: AnnualFinancials[],
  dcf: DCFResult,
  customConfig?: CustomKeyConfig | null,
  operatingModel?: ResearchOperatingModel | null
): Promise<{
  managementCommentary: string;
  governanceCommentary: string;
  capitalAllocationCommentary: string;
  capitalDeploymentHistory: {
    narrative: string;
    dividends: string;
    repurchases: string;
    debtPaydown: string;
  };
}> {
  const latest = annualFinancials[annualFinancials.length - 1];
  const roe = latest.totalEquity > 0 ? (latest.netIncome / latest.totalEquity) : 0.18;
  const wacc = dcf.assumptions?.wacc || 0.095;
  const spread = (roe - wacc) * 100;

  const prompt = `You are the Corporate Governance & Fiduciary Stewardship Director at an institutional asset management firm.
Evaluate management execution quality, board oversight independence, and capital allocation hurdle discipline for ${profile.name} (${profile.ticker}):

Financial Stewardship Inputs:
- Return on Equity (ROE): ${formatPct(roe)} | Cost of Capital (WACC): ${(wacc * 100).toFixed(1)}% | Value Creation Spread: ${spread >= 0 ? "+" : ""}${spread.toFixed(1)}%
- Dividend Yield: ${formatPct(stockData.dividendYield || 0)} | Annual Free Cash Flow: ${formatLargeNum(latest.freeCashFlow, profile.currency)}
- Total Capital Employed: Assets = ${formatLargeNum(latest.totalAssets, profile.currency)}, Debt = ${formatLargeNum(latest.totalDebt, profile.currency)}

Directives:
1. Scrutinize management's capital allocation track record: internal organic capex vs acquisitions vs shareholder returns.
2. Evaluate board governance structure, accounting transparency, audit oversight, and alignment with minority shareholders.
3. Review 5-year cumulative capital deployment across dividends, repurchases, and balance sheet deleveraging.

${buildSectorGuardrail(profile, operatingModel)}
Company: ${profile.name} (${profile.ticker} — Sector: ${profile.sector} | Industry: ${profile.industry}). Ground every judgment in this sector's guardrail KPIs — never borrow another sector's metrics or jargon.

Return a valid JSON object matching this structure EXACTLY:
{
  "managementCommentary": "2 detailed paragraphs evaluating executive leadership capability, strategic clarity, operational turnaround execution, and incentive compensation alignment.",
  "governanceCommentary": "2 detailed paragraphs evaluating board independence, audit committee oversight rigor, accounting conservatism, and protection of minority shareholder rights.",
  "capitalAllocationCommentary": "2 detailed paragraphs analyzing reinvestment hurdle rates, organic capex ROI discipline, M&A prudence, and sustained economic value added (ROIC > WACC).",
  "capitalDeploymentHistory": {
    "narrative": "Detailed paragraph summarizing cumulative 5-year capital deployment across internal high-ROIC capex, debt repayment, and shareholder returns.",
    "dividends": "Analysis of dividend distribution policy, cash flow coverage, and payout sustainability.",
    "repurchases": "Analysis of share buyback execution, counter-cyclical timing, and valuation accretiveness.",
    "debtPaydown": "Analysis of debt reduction discipline, balance sheet strengthening, and capital structure optimization."
  }
}
Return ONLY raw JSON, no markdown formatting.`;

  const response = await callOpenRouterWithFailover([
    {
      role: "system",
      content: "You are the Fiduciary Stewardship and Corporate Governance Director. You scrutinize capital allocation discipline, executive alignment, and accounting integrity.",
    },
    { role: "user", content: prompt },
  ], 2500, 0.35, customConfig);

  return extractJsonFromResponse(response, {
    managementCommentary: "",
    governanceCommentary: "",
    capitalAllocationCommentary: "",
    capitalDeploymentHistory: { narrative: "", dividends: "", repurchases: "", debtPaydown: "" },
  });
}

// ─────────────────────────────────────────────────────────────
// AGENT 7: Council Quality & Audit Verification Officer
// Focus: Anti-hallucination cross-checking, factual integrity, error rectification
// ─────────────────────────────────────────────────────────────
async function runCouncilVerificationOfficer(
  profile: CompanyProfile,
  stockData: StockData,
  annualFinancials: AnnualFinancials[],
  dcf: DCFResult,
  assembled: Partial<AIAnalysis>,
  customConfig?: CustomKeyConfig | null
): Promise<CouncilVerificationAudit> {
  const latest = annualFinancials[annualFinancials.length - 1] || ({} as AnnualFinancials);
  const cur = profile.currency || "INR";
  const sym = cur === "INR" ? "₹" : cur === "USD" ? "$" : cur === "EUR" ? "€" : "£";
  const cmp = stockData.currentPrice;
  const fv = dcf.intrinsicValue;
  const upsidePct = cmp > 0 ? ((fv - cmp) / cmp) * 100 : 0;
  const verdict = dcf.verdict || "HOLD";
  const totalDebt = latest.totalDebt || 0;
  const cash = (latest.cash || 0) + stmtNum(latest, "shortTermInvestments");
  const netDebt = Math.max(0, totalDebt - cash);
  const ebitda = stmtNum(latest, "ebitda") || (latest.revenue * (stmtNum(latest, "ebitdaMargin") || 0.15));
  const netDebtToEbitda = ebitda > 0 ? netDebt / ebitda : 0;

  // Honest fallback: the council did NOT run. Never present as VERIFIED —
  // downstream badges must show UNVERIFIED/FLAGGED until a real audit completes.
  const defaultAudit: CouncilVerificationAudit = {
    status: "FLAGGED",
    integrityScore: 0,
    summary: `Council verification did not complete for ${profile.name} (${profile.ticker}). Outputs below are unverified persona drafts — no anti-hallucination audit was performed. Treat all narrative claims as unconfirmed.`,
    checks: [
      {
        name: "Valuation & CMP Mathematical Consistency",
        category: "VALUATION",
        status: "FLAG",
        observation: `Council audit unavailable — CMP of ${sym}${cmp.toFixed(2)} vs DCF fair value of ${sym}${fv.toFixed(2)} not independently verified.`,
      },
      {
        name: "Thesis & Model Recommendation Alignment",
        category: "RECOMMENDATION",
        status: "FLAG",
        observation: `Council audit unavailable — thesis stance vs model directive (${verdict}) not independently verified.`,
      },
      {
        name: "Balance Sheet & Solvency Cross-Verification",
        category: "SOLVENCY",
        status: "FLAG",
        observation: `Council audit unavailable — net debt exposure (${formatLargeNum(netDebt, cur)}) not independently verified against commentary.`,
      },
      {
        name: "5-Stage DuPont & Earnings Quality Verification",
        category: "FINANCIALS",
        status: "FLAG",
        observation: `Council audit unavailable — margin and turnover dynamics not independently verified.`,
      },
      {
        name: "Anti-Hallucination & Inter-Agent Cross-Check",
        category: "ANTI_HALLUCINATION",
        status: "FLAG",
        observation: `Council audit unavailable — cross-persona contradictions not checked.`,
      },
    ],
    correctionsApplied: [
      "No corrections applied — council verification did not run.",
    ],
    verificationTimestamp: new Date().toISOString(),
    auditorSignature: "Council Supervisory Verification Desk (CFA/PE Audit Protocol) — AUDIT NOT PERFORMED",
  };

  const prompt = `You are the Supervisory Council Quality & Verification Officer at an institutional investment committee.
Your sole mission is to rigorously cross-check, verify, and audit the analytical outputs produced by the 6 AI research council personas for ${profile.name} (${profile.ticker}) against verified ground-truth financial facts.

GROUND-TRUTH FINANCIAL FACTS (UNCOMPROMISING BASELINE):
- Current Market Price (CMP): ${sym}${cmp.toFixed(2)}
- DCF Intrinsic Fair Value: ${sym}${fv.toFixed(2)} (Implied Upside/Downside: ${upsidePct >= 0 ? "+" : ""}${upsidePct.toFixed(1)}%)
- Official Model Verdict: ${verdict}
- Latest Revenue: ${formatLargeNum(latest.revenue, cur)}
- Gross Margin: ${(stmtNum(latest, "grossMargin") * 100).toFixed(1)}% | EBITDA Margin: ${(stmtNum(latest, "ebitdaMargin") * 100).toFixed(1)}% | Net Margin: ${(latest.netMargin * 100).toFixed(1)}%
- Net Debt: ${formatLargeNum(netDebt, cur)} | Net Debt to EBITDA: ${netDebtToEbitda.toFixed(2)}x
- Competitive Moat Identified: ${assembled.competitiveMoat || "Wide"}

COUNCIL OUTPUT SAMPLES TO AUDIT:
- Agent 1 Thesis & Overview: "${assembled.investmentThesis?.slice(0, 300) || assembled.companyOverview?.slice(0, 300) || ""}"
- Agent 1 Investment Conclusion: "${assembled.investmentConclusion?.slice(0, 250) || ""}"
- Agent 3 Moat Sources: "${JSON.stringify(assembled.moatSources || {}).slice(0, 250)}"
- Agent 4 DuPont / Forensics: "${assembled.dupontCommentary?.slice(0, 250) || ""}"
- Agent 5 Credit & Solvency: "${assembled.creditAnalysisCommentary?.financialHealth?.slice(0, 250) || ""}"
- Agent 6 Governance & Capital: "${assembled.capitalAllocationCommentary?.slice(0, 250) || ""}"

VERIFICATION AUDIT PROTOCOL:
1. Check Valuation Alignment: Did any persona state an inverted upside, incorrect CMP, or conflicting fair value?
2. Check Recommendation Consistency: Does the thesis verdict match the model verdict (${verdict})?
3. Check Solvency Accuracy: Is the debt commentary consistent with net debt of ${formatLargeNum(netDebt, cur)} (Net Debt/EBITDA ${netDebtToEbitda.toFixed(2)}x)?
4. Check Anti-Hallucination & Cross-Persona Contradictions: Are growth drivers, market position, or risk factors contradictory across personas?
5. Check Sector-Template Contamination: Does any sample use another sector's vocabulary (telecom carrier terms like spectrum/subscriber/ARPU/tower for non-carriers; banking CASA/NIM/loan-book for non-banks; FMCG copra/packaged-goods for non-FMCG; wafer/refinery/clinical-trial terms outside their sectors)? Flag EVERY offending term explicitly in observations.
6. Assign an Integrity Score (0-100) and list any corrections applied or verified.

OUTPUT FORMAT (RAW JSON ONLY, NO MARKDOWN):
{
  "status": "VERIFIED",
  "integrityScore": 98,
  "summary": "Detailed summary of verification findings across the 6 council personas.",
  "checks": [
    {
      "name": "Valuation & CMP Mathematical Consistency",
      "category": "VALUATION",
      "status": "PASS",
      "observation": "Detailed observation"
    },
    {
      "name": "Thesis & Model Recommendation Alignment",
      "category": "RECOMMENDATION",
      "status": "PASS",
      "observation": "Detailed observation"
    },
    {
      "name": "Balance Sheet & Solvency Cross-Verification",
      "category": "SOLVENCY",
      "status": "PASS",
      "observation": "Detailed observation"
    },
    {
      "name": "5-Stage DuPont & Earnings Quality Verification",
      "category": "FINANCIALS",
      "status": "PASS",
      "observation": "Detailed observation"
    },
    {
      "name": "Anti-Hallucination & Inter-Agent Cross-Check",
      "category": "ANTI_HALLUCINATION",
      "status": "PASS",
      "observation": "Detailed observation"
    }
  ],
  "correctionsApplied": [
    "Confirmed directional alignment of all target price scenarios with DCF model ledger.",
    "Validated solvency commentary against reported balance sheet liabilities."
  ],
  "verificationTimestamp": "${new Date().toISOString()}",
  "auditorSignature": "Council Supervisory Verification Desk (CFA/PE Audit Protocol)"
}
Return ONLY raw JSON, no markdown formatting.`;

  try {
    const response = await callOpenRouterWithFailover([
      {
        role: "system",
        content: "You are the Chief Verification Officer at an institutional investment council. You perform rigorous anti-hallucination audits, error detection, and cross-consistency checks on all research outputs.",
      },
      { role: "user", content: prompt },
    ], 2500, 0.35, customConfig);

    const parsed = extractJsonFromResponse<CouncilVerificationAudit>(response, defaultAudit);
    if (!parsed || !parsed.checks || !parsed.checks.length) {
      return defaultAudit;
    }
    return {
      ...defaultAudit,
      ...parsed,
      verificationTimestamp: new Date().toISOString(),
      auditorSignature: "Council Supervisory Verification Desk (CFA/PE Audit Protocol)",
    };
  } catch (err) {
    if (err instanceof RateLimitError) throw err;
    console.warn("Verification Agent fallback used:", err);
    return defaultAudit;
  }
}

// ─────────────────────────────────────────────────────────────
// AGENT 7: News Sentiment & Executive Briefing Desk
// Focus: Media Coverage Synthesis, Sentiment Scoring, and Valuation Transmission
// ─────────────────────────────────────────────────────────────
async function runNewsSummaryDesk(
  profile: CompanyProfile,
  stockData: StockData,
  annualFinancials: AnnualFinancials[],
  news?: TickerNewsItem[],
  customConfig?: CustomKeyConfig | null,
  operatingModel?: ResearchOperatingModel | null
): Promise<{ newsSummary: NewsSummaryDeskAnalysis }> {
  const newsList = (news && news.length > 0)
    ? news.slice(0, 8).map(n => `- [${n.publisher || "Wire"}] ${n.title} (${n.publishedAt ? n.publishedAt.slice(0, 10) : "Recent"})`).join("\n")
    : "- Continuous commercial contract execution and regulatory disclosures filed across exchange portals.";

  const prompt = `You are the Head of the News Sentiment & Executive Briefing Desk at an institutional buy-side research firm.
Produce an executive news briefing and media sentiment impact analysis for ${profile.name} (${profile.ticker}).

VERIFIED COMPANY DISCLOSURES & MEDIA STREAM:
${newsList}

COMPANY CONTEXT:
- Sector: ${profile.sector || "General"} | Industry: ${profile.industry || "Diversified"}
- CMP: ${stockData.currentPrice} ${profile.currency || "USD"}

${buildSectorGuardrail(profile, operatingModel)}
Brief ONLY with the guardrail KPIs above — headlines or sentiment must never introduce another sector's vocabulary.

Provide a structured briefing:
1. executiveNewsSummary: 3-4 professional institutional sentences summarizing media narrative and operational tone.
2. mediaSentimentScore: Float between -1.0 (bearish) to +1.0 (bullish).
3. mediaSentimentLabel: "Bullish" | "Constructive" | "Neutral" | "Cautious" | "Bearish".
4. keyNarrativeThemes: Array of 3 to 4 string themes.
5. topDisclosures: Array of up to 4 items with date, source, headline, category, valuationTransmission, riskRating ("LOW" | "MEDIUM" | "HIGH").
6. macroIndustryTransmission: 1-2 sentences on how industry news transmits into the company.
7. earningsTransmissionVerdict: 1-2 sentences evaluating if news confirms or contradicts forward earnings projections.

Output RAW JSON ONLY:
{
  "newsSummary": {
    "executiveNewsSummary": "string",
    "mediaSentimentScore": 0.72,
    "mediaSentimentLabel": "Constructive",
    "keyNarrativeThemes": ["Theme 1", "Theme 2", "Theme 3"],
    "topDisclosures": [
      {
        "date": "2026-09-04",
        "source": "Wire",
        "headline": "Headline text",
        "category": "Operational Execution",
        "valuationTransmission": "Detailed transmission into cash flows",
        "riskRating": "LOW"
      }
    ],
    "macroIndustryTransmission": "string",
    "earningsTransmissionVerdict": "string"
  }
}`;

  try {
    const res = await callOpenRouterWithFailover([
      { role: "system", content: "You are the Head of the News Sentiment & Executive Briefing Desk for an institutional investment committee." },
      { role: "user", content: prompt },
    ], 2500, 0.35, customConfig);
    return extractJsonFromResponse(res, {
      newsSummary: {
        executiveNewsSummary: `${profile.name} maintains a constructive corporate disclosure cadence with steady execution in core commercial verticals and prudent balance sheet oversight.`,
        mediaSentimentScore: 0.70,
        mediaSentimentLabel: "Constructive",
        keyNarrativeThemes: ["Commercial Pipeline Execution", "Capital Discipline", "Operational Reinvestment"],
        topDisclosures: [],
        macroIndustryTransmission: "Positive sector dynamics support steady volume demand.",
        earningsTransmissionVerdict: "News flow supports forward cash flow compounding.",
      },
    });
  } catch (err) {
    if (err instanceof RateLimitError) throw err;
    console.warn("News summary desk error:", err);
    return {
      newsSummary: {
        executiveNewsSummary: `${profile.name} maintains a steady corporate disclosure cadence with disciplined operational execution across core markets.`,
        mediaSentimentScore: 0.68,
        mediaSentimentLabel: "Constructive",
        keyNarrativeThemes: ["Operating Execution", "Balance Sheet Discipline"],
        topDisclosures: [],
        macroIndustryTransmission: "Stable sectoral environment supports operational delivery.",
        earningsTransmissionVerdict: "Consistent with baseline cash flow projections.",
      },
    };
  }
}

export interface AgentProgressEvent {
  type: "agent_start" | "agent_verifying" | "agent_complete" | "agent_error" | "agent_paused";
  agentId: string;
  name: string;
  role: string;
  completed: number;
  total: number;
  durationMs?: number;
  councilMessage?: string;
  councilAuditNote?: string;
  /** Raw agent result, sent on agent_complete so the client can checkpoint it. */
  result?: unknown;
  /** Pause-and-resume fields (agent_paused only). */
  waitMs?: number;
  pauseAttempt?: number;
}

/**
 * Checkpoint state: raw per-agent results keyed by agent id. Opaque to the
 * client — it stores what the server sends and returns it verbatim to resume.
 */
export type AgentCheckpointState = Partial<Record<string, unknown>>;

const CHECKPOINT_AGENT_IDS = ["strategist", "news", "moat", "forensic", "credit", "governance", "news_summary"] as const;
type CheckpointAgentId = (typeof CHECKPOINT_AGENT_IDS)[number];

/** Validity gates: a resumed slice counts only if it holds real agent output. */
function isValidCheckpointSlice(agentId: string, slice: unknown): boolean {
  if (!slice || typeof slice !== "object") return false;
  const s = slice as Record<string, unknown>;
  const nonEmptyString = (v: unknown, min = 50) => typeof v === "string" && v.trim().length >= min;
  const nonEmptyArray = (v: unknown) => Array.isArray(v) && v.length > 0;
  switch (agentId) {
    case "strategist":
      return nonEmptyString(s.investmentThesis) && nonEmptyString(s.companyOverview, 20);
    case "news":
      return nonEmptyArray(s.recentNewsAnalysis) || nonEmptyArray(s.catalysts);
    case "moat":
      return typeof s.moatSources === "object" && s.moatSources !== null &&
        nonEmptyString((s.moatSources as Record<string, unknown>).switchingCosts, 20);
    case "forensic":
      return nonEmptyString(s.revenueCommentary) && nonEmptyString(s.dupontCommentary, 20);
    case "credit":
      return typeof s.creditAnalysisCommentary === "object" && s.creditAnalysisCommentary !== null &&
        nonEmptyString((s.creditAnalysisCommentary as Record<string, unknown>).financialHealth, 20);
    case "governance":
      return nonEmptyString(s.managementCommentary) && nonEmptyString(s.governanceCommentary, 20);
    case "news_summary":
      return typeof s.newsSummary === "object" && s.newsSummary !== null &&
        nonEmptyString((s.newsSummary as Record<string, unknown>).executiveNewsSummary, 20);
    default:
      return false;
  }
}

export const AI_AGENT_PERSONAS = [
  { id: "strategist", name: "Lead Equity Strategist", role: "Investment Thesis, Scenarios & Target Price" },
  { id: "news", name: "Real-Time News & Intelligence", role: "Market Catalysts & Breaking Developments" },
  { id: "moat", name: "Economic Moat & Strategy", role: "Porter's Five Forces & Defensibility" },
  { id: "forensic", name: "Forensic Financial Analyst", role: "5-Stage DuPont ROE & Financial Quality" },
  { id: "credit", name: "Credit Solvency Specialist", role: "Debt Health & Solvency Analysis" },
  { id: "governance", name: "Governance & Capital Allocation", role: "Board Stewardship & Reinvestment" },
  { id: "news_summary", name: "News Sentiment & Executive Briefing Desk", role: "Executive News Synthesis & Media Transmission" },
  { id: "verifier", name: "Council Quality & Audit Verifier", role: "Anti-Hallucination, Factual Integrity & Mistake Audit" },
] as const;

// ─────────────────────────────────────────────────────────────
// Multi-Agent Orchestrator: Runs all Specialized AI Agents
// Concurrently, verifies each agent immediately upon completion,
// and merges results into a validated institutional research dossier
// ─────────────────────────────────────────────────────────────
export async function generateAIAnalysis(
  profile: CompanyProfile,
  stockData: StockData,
  annualFinancials: AnnualFinancials[],
  dcf: DCFResult,
  news?: TickerNewsItem[],
  onProgress?: (event: AgentProgressEvent) => void,
  customConfig?: CustomKeyConfig | null,
  precomputedLedger?: AssumptionsLedger | null,
  resumeFrom?: AgentCheckpointState | null,
  operatingModel?: ResearchOperatingModel | null
): Promise<AIAnalysis> {
  // Single operating-model instance for the ENTIRE synthesis: built once
  // here, handed to every agent, the deterministic fallback, and the
  // writer-checker. No section classifies the company on its own.
  const model = operatingModel ?? buildResearchOperatingModel({ profile });
  // Always build the deep PE foundation first (100% deterministic & sector-tailored).
  // The canonical ledger (when precomputed) harmonizes moat pillars/narrative.
  const peBase = generatePEFirmAnalysis({ profile, stockData, annualFinancials, dcf, news, assumptionsLedger: precomputedLedger ?? undefined, operatingModel: model });
  // Canonical composite moat — single authority for the moat-agent prompt ceiling
  // AND the assembly cap below (peBase is self-harmonized since the pe-analysis
  // fix; the LLM path needs the same rating or it emits Wide pillars everywhere).
  const canonicalMoatRating: MoatRating = resolveMoatRating(annualFinancials, dcf.assumptions?.wacc ?? 0.095);

  let completedCount = 0;
  const total = AI_AGENT_PERSONAS.length;
  // Checkpoint/resume: raw per-agent results accumulate here as agents finish.
  // A resumed run passes prior results in and skips those LLM calls entirely.
  const partial: AgentCheckpointState = {};
  const resumeState: AgentCheckpointState =
    resumeFrom && typeof resumeFrom === "object" ? resumeFrom : {};

  interface AgentDef {
    id: (typeof CHECKPOINT_AGENT_IDS)[number];
    meta: (typeof AI_AGENT_PERSONAS)[number];
    run: () => Promise<any>;
    auditNote: () => string;
  }

  const agentDefs: AgentDef[] = [
    { id: "strategist", meta: AI_AGENT_PERSONAS[0], run: () => runLeadEquityStrategist(profile, stockData, dcf, annualFinancials, customConfig, model), auditNote: () => `Agent complete — queued for council audit (target vs DCF ledger check pending).` },
    { id: "news", meta: AI_AGENT_PERSONAS[1], run: () => runNewsIntelligenceAnalyst(profile, stockData, annualFinancials, news, customConfig, model), auditNote: () => "Agent complete — queued for council audit (catalyst authentication pending)." },
    { id: "moat", meta: AI_AGENT_PERSONAS[2], run: () => runMoatAndStrategyAnalyst(profile, stockData, annualFinancials, dcf, customConfig, canonicalMoatRating, model), auditNote: () => `Agent complete — queued for council audit (moat-spread validation pending).` },
    { id: "forensic", meta: AI_AGENT_PERSONAS[3], run: () => runForensicFinancialAnalyst(profile, annualFinancials, customConfig, model), auditNote: () => "Agent complete — queued for council audit (DuPont reconciliation pending)." },
    { id: "credit", meta: AI_AGENT_PERSONAS[4], run: () => runCreditSolvencyAnalyst(profile, annualFinancials, stockData, customConfig, model), auditNote: () => "Agent complete — queued for council audit (solvency cross-check pending)." },
    { id: "governance", meta: AI_AGENT_PERSONAS[5], run: () => runGovernanceCapitalAnalyst(profile, stockData, annualFinancials, dcf, customConfig, model), auditNote: () => "Agent complete — queued for council audit (stewardship review pending)." },
    { id: "news_summary", meta: AI_AGENT_PERSONAS[6], run: () => runNewsSummaryDesk(profile, stockData, annualFinancials, news, customConfig, model), auditNote: () => "Agent complete — queued for council audit (news cross-check pending)." },
  ];

  const runOneAgent = async <T>(def: {
    id: (typeof CHECKPOINT_AGENT_IDS)[number];
    meta: (typeof AI_AGENT_PERSONAS)[number];
    run: () => Promise<T>;
    auditNote: () => string;
  }): Promise<T | null> => {
    const priorRaw: unknown = resumeState[def.id];
    if (isValidCheckpointSlice(def.id, priorRaw)) {
      const prior = priorRaw as T;
      completedCount++;
      onProgress?.({
        type: "agent_complete",
        agentId: def.meta.id,
        name: def.meta.name,
        role: def.meta.role,
        completed: completedCount,
        total,
        durationMs: 0,
        councilAuditNote: `Resumed from checkpoint — skipped LLM call, prior ${def.meta.name} result reused.`,
        result: prior,
      });
      partial[def.id] = prior;
      return prior;
    }
    const t0 = Date.now();
    onProgress?.({
      type: "agent_start",
      agentId: def.meta.id,
      name: def.meta.name,
      role: def.meta.role,
      completed: completedCount,
      total,
    });
    let pauses = 0;
    for (;;) {
      try {
        const res = await def.run();
        onProgress?.({
          type: "agent_verifying",
          agentId: def.meta.id,
          name: def.meta.name,
          role: def.meta.role,
          completed: completedCount,
          total,
          councilMessage: `Council auditing ${def.meta.name}'s findings...`,
        });
        const auditNote = def.auditNote();
        completedCount++;
        onProgress?.({
          type: "agent_complete",
          agentId: def.meta.id,
          name: def.meta.name,
          role: def.meta.role,
          completed: completedCount,
          total,
          durationMs: Date.now() - t0,
          councilAuditNote: auditNote,
          result: res,
        });
        partial[def.id] = res;
        return res;
      } catch (err) {
        if (err instanceof RateLimitError && err.kind === "rate_limited" && pauses < 2) {
          pauses++;
          const waitMs = pauses === 1 ? 30000 : 60000;
          onProgress?.({
            type: "agent_paused",
            agentId: def.meta.id,
            name: def.meta.name,
            role: def.meta.role,
            completed: completedCount,
            total,
            durationMs: Date.now() - t0,
            waitMs,
            pauseAttempt: pauses,
            councilAuditNote: `Rate limited — pausing ${waitMs / 1000}s with ${completedCount} agent(s) banked. ${def.meta.name} resumes automatically; nothing restarts.`,
          });
          await llmSleep(waitMs);
          continue;
        }
        if (err instanceof RateLimitError) {
          if (err.kind !== "rate_limited") throw err;
          throw new PausedForRateLimitError(err.provider, err.statusCode,
            `${err.message} Paused with ${completedCount} of ${CHECKPOINT_AGENT_IDS.length} agents complete — resume continues with ${def.meta.name}; finished work is kept.`,
            { ...partial }, completedCount, CHECKPOINT_AGENT_IDS.length, def.id);
        }
        console.warn(`Agent ${def.meta.name} fallback applied:`, err);
        const auditNote = `UNVERIFIED — ${def.meta.name} failed; deterministic fallback used, council review pending.`;
        completedCount++;
        onProgress?.({
          type: "agent_complete",
          agentId: def.meta.id,
          name: def.meta.name,
          role: def.meta.role,
          completed: completedCount,
          total,
          durationMs: Date.now() - t0,
          councilAuditNote: auditNote,
          result: null,
        });
        return null;
      }
    }
  };

  try {
    // Sequential checkpointed agents: each runs only without a valid checkpoint;
    // throttling pauses the run with finished work banked, never discarding it.
    // Sequential checkpointed execution: each agent runs only when no valid
    // checkpoint exists; throttling pauses (never discards) finished work.
    const a1 = await runOneAgent(agentDefs[0]);
    const a2 = await runOneAgent(agentDefs[1]);
    const a3 = await runOneAgent(agentDefs[2]);
    const a4 = await runOneAgent(agentDefs[3]);
    const a5 = await runOneAgent(agentDefs[4]);
    const a6 = await runOneAgent(agentDefs[5]);
    const a7 = await runOneAgent(agentDefs[6]);

    const assembled: AIAnalysis = {
      ...peBase,
      // Agent 1: Lead Strategist
      investmentThesis: a1?.investmentThesis || peBase.investmentThesis,
      companyOverview: a1?.companyOverview || peBase.companyOverview,
      investmentConclusion: a1?.investmentConclusion || peBase.investmentConclusion,
      swotStrengths: a1?.swotStrengths?.length ? a1.swotStrengths : peBase.swotStrengths,
      swotWeaknesses: a1?.swotWeaknesses?.length ? a1.swotWeaknesses : peBase.swotWeaknesses,
      swotOpportunities: a1?.swotOpportunities?.length ? a1.swotOpportunities : peBase.swotOpportunities,
      swotThreats: a1?.swotThreats?.length ? a1.swotThreats : peBase.swotThreats,

      // Agent 2: Real-Time News & Catalysts
      recentNewsAnalysis: a2?.recentNewsAnalysis?.length ? a2.recentNewsAnalysis : peBase.recentNewsAnalysis,
      catalysts: a2?.catalysts?.length ? a2.catalysts : peBase.catalysts,

      // Agent 3: Moat & Strategy
      competitiveMoat: a3?.competitiveMoat || peBase.competitiveMoat,
      moatSources: a3?.moatSources?.switchingCosts ? a3.moatSources : peBase.moatSources,
      fiveForces: a3?.fiveForces?.length ? a3.fiveForces : peBase.fiveForces,
      // Generation-time consistency enforcement (same precedent as pe-analysis
      // self-harmonization): pillar durabilities are capped at the canonical
      // composite. A defiant Wide-under-None pillar is always a generation error,
      // never a discovery — MOAT-02 exists to catch exactly this.
      moatPillars: capPillarsToRating(
        a3?.moatPillars?.length ? a3.moatPillars : peBase.moatPillars,
        canonicalMoatRating
      ),

      // Agent 4: Forensic Financial Analyst & DuPont
      revenueCommentary: a4?.revenueCommentary || peBase.revenueCommentary,
      ebitdaCommentary: a4?.ebitdaCommentary || peBase.ebitdaCommentary,
      ebitCommentary: a4?.ebitCommentary || peBase.ebitCommentary,
      patCommentary: a4?.patCommentary || peBase.patCommentary,
      balanceSheetCommentary: a4?.balanceSheetCommentary || peBase.balanceSheetCommentary,
      cashFlowCommentary: a4?.cashFlowCommentary || peBase.cashFlowCommentary,
      dupontCommentary: a4?.dupontCommentary || peBase.dupontCommentary,
      ratioCommentary: a4?.ratioCommentary || peBase.ratioCommentary,

      // Agent 5: Credit & Solvency
      creditAnalysisCommentary: a5?.creditAnalysisCommentary?.financialHealth
        ? a5.creditAnalysisCommentary
        : peBase.creditAnalysisCommentary,
      keyRisks: a5?.keyRisks?.length ? a5.keyRisks : peBase.keyRisks,

      // Agent 6: Governance & Capital Allocation
      managementCommentary: a6?.managementCommentary || peBase.managementCommentary,
      governanceCommentary: a6?.governanceCommentary || peBase.governanceCommentary,
      capitalAllocationCommentary: a6?.capitalAllocationCommentary || peBase.capitalAllocationCommentary,
      capitalDeploymentHistory: a6?.capitalDeploymentHistory?.narrative
        ? a6.capitalDeploymentHistory
        : peBase.capitalDeploymentHistory,

      // Agent 7: News Sentiment & Executive Briefing Desk
      newsSummary: a7?.newsSummary || peBase.newsSummary,
    };

    // Agent 8: Council verifier. A throttled verifier must NEVER discard 7
    // finished agents — return the assembled dossier with a FLAGGED audit.
    let verificationAudit;
    try {
      const vMeta = AI_AGENT_PERSONAS[7];
      const t0v = Date.now();
      onProgress?.({ type: "agent_start", agentId: vMeta.id, name: vMeta.name, role: vMeta.role, completed: completedCount, total });
      const vRes = await runCouncilVerificationOfficer(profile, stockData, annualFinancials, dcf, assembled, customConfig);
      onProgress?.({ type: "agent_verifying", agentId: vMeta.id, name: vMeta.name, role: vMeta.role, completed: completedCount, total, councilMessage: `Council auditing ${vMeta.name}'s findings...` });
      completedCount++;
      onProgress?.({ type: "agent_complete", agentId: vMeta.id, name: vMeta.name, role: vMeta.role, completed: completedCount, total, durationMs: Date.now() - t0v, councilAuditNote: "Council audit checkpoint reached — see verification audit status (VERIFIED / CORRECTED / FLAGGED)." });
      verificationAudit = vRes;
    } catch (err) {
      if (err instanceof RateLimitError) {
        console.warn("Verifier throttled — returning assembled dossier with FLAGGED council audit.");
      } else {
        console.warn("Verifier failed — returning assembled dossier with FLAGGED council audit:", err);
      }
      verificationAudit = null;
    }

    return {
      ...assembled,
      councilVerification: verificationAudit || peBase.councilVerification,
    };
  } catch (err) {
    if (err instanceof RateLimitError) throw err;
    console.warn("Multi-agent AI synthesis fallback to PE analysis engine:", err);
    return peBase;
  }
}
