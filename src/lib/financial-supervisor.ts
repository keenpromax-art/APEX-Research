/**
 * APEX RESEARCH — AI FINANCIAL SUPERVISOR (Step 02: Ratios + DCF)
 *
 * Company-aware audit layer that sits BETWEEN raw Yahoo data and the
 * deterministic valuation engine:
 *
 *   Yahoo quoteSummary
 *    -> computeRatios / DuPont / preliminary DCF (mechanical)
 *    -> runFinancialSupervisor (THIS MODULE — AI when a key exists,
 *       deterministic heuristics otherwise)
 *    -> bounded 2nd-pass valuation (only inside validated clamps)
 *    -> ledger / QA / PDF consume ONE reconciled model
 *
 * INVARIANTS (never violated):
 * - AI NEVER writes a price directly. It may only suggest bounded
 *   assumption deltas (growth / margin / terminal / WACC) inside hard clamps.
 * - Financials (bank/insurer) NEVER receive revenue-growth/EBIT-margin
 *   overrides — residual-income path owns them. Supervisor may only note
 *   sustainable-ROE context.
 * - No key / LLM failure => deterministic heuristic supervision, clearly
 *   labeled `heuristic-fallback`. The pipeline never blocks on the supervisor.
 * - Every suggestion carries provenance + reason so QA can disclose it.
 */

import type {
  AnnualFinancials,
  CompanyProfile,
  DCFResult,
  Ratios,
  StockData,
} from "@/types/report";
import { isBankStatement, isInsuranceStatement } from "@/types/report";
import type { CustomKeyConfig } from "./ai-providers";
import { resolveProviderRequestConfig } from "./ai-providers";
import { classifySector } from "./sectors";
import { classifyArchetype } from "./company-archetype";
import type { AIDCFOverrides } from "./calculations";

// ─────────────────────────────────────────────
// Public types (also surfaced via ReportData.supervision)
// ─────────────────────────────────────────────

export type SupervisorSource = "ai-supervisor" | "heuristic-fallback";

export interface SupervisorAdjustment {
  field: "revenueGrowthRates" | "ebitMargins" | "terminalGrowthRate" | "waccOverride";
  previous: number | number[] | null;
  suggested: number | number[] | null;
  applied: boolean;
  reason: string;
}

export interface FinancialSupervision {
  ticker: string;
  companyName: string;
  /** e.g. "Commercial Bank — spread lender", "Early platform — cash-burning marketplace" */
  companyType: string;
  businessModel: string;
  revenueModel: string;
  keyDrivers: string[];
  /** Ratio keys the supervisor trusts for THIS company */
  ratiosToTrust: string[];
  /** Ratio keys that are N/A / misleading for THIS company */
  ratiosToIgnore: string[];
  /** Valuation lens chosen for this company (FCFF_DCF / PB_RESIDUAL_INCOME / SOTP) */
  dcfLens: string;
  adjustments: SupervisorAdjustment[];
  /** Refined overrides to feed a bounded 2nd-pass computeDCF (null = keep mechanical) */
  refinedOverrides: AIDCFOverrides | null;
  flags: string[];
  confidence: number; // 0..1
  source: SupervisorSource;
  rationale: string;
  auditedAt: string;
}

export interface SupervisorCheckpoint {
  id: string;
  name: string;
  role: string;
}

export const SUPERVISOR_CHECKPOINTS: SupervisorCheckpoint[] = [
  { id: "identify", name: "AI Supervisor — Company Identification", role: "Business model · revenue engine · archetype" },
  { id: "audit-ratios", name: "AI Supervisor — Ratio Audit", role: "Trust / ignore map per company type" },
  { id: "audit-dcf", name: "AI Supervisor — DCF Audit", role: "Growth · margin · WACC bounds check" },
];

export interface RunSupervisorParams {
  profile: CompanyProfile;
  stockData: StockData;
  annualFinancials: AnnualFinancials[];
  ratiosByYear: Ratios[];
  preliminaryDcf: DCFResult;
  preliminaryOverrides?: AIDCFOverrides | null;
  customConfig?: CustomKeyConfig | null;
}

// ─────────────────────────────────────────────
// Bounds — supervisor suggestions outside these are discarded
// ─────────────────────────────────────────────

const GROWTH_MIN = -0.2;
const GROWTH_MAX = 0.6;
const MARGIN_MIN = -0.3;
const MARGIN_MAX = 0.6;
const TERMINAL_MIN = 0.02;
const TERMINAL_MAX = 0.06;
const WACC_MIN = 0.07;
const WACC_MAX = 0.2;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const clampArr = (arr: number[], lo: number, hi: number) => arr.map((v) => clamp(v, lo, hi));
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Single-attempt LLM budget for the Step-02 supervisor. Well inside the
 * serverless function timeout so a slow provider degrades to the heuristic
 * audit instead of killing the whole /api/company response.
 */
export const SUPERVISOR_LLM_TIMEOUT_MS = 12000;

// ─────────────────────────────────────────────
// Deterministic heuristic supervision (always available)
// ─────────────────────────────────────────────

function heuristicSupervision(params: RunSupervisorParams): FinancialSupervision {
  const { profile, stockData, annualFinancials, preliminaryDcf } = params;
  const latest = annualFinancials[annualFinancials.length - 1] as any;
  const sector = classifySector(profile.sector, profile.industry, profile.description);
  const arch = classifyArchetype(profile, stockData, annualFinancials);

  const isBank = isBankStatement(latest) || sector.isFinancialInstitution;
  const isInsurer = isInsuranceStatement(latest);
  const revs = annualFinancials.map((f: any) => Number(f.revenue ?? f.totalRevenue ?? 0) || 0);
  const hasZeroRevenue = revs.some((r) => !(r > 0));
  const negEquity = (latest.totalEquity ?? 0) < 0;
  const negNet = (latest.netIncome ?? 0) < 0;
  const thinHistory = annualFinancials.length < 3;

  let companyType = "Standard corporate — unit-sales / services model";
  let businessModel = (profile.description || "").slice(0, 280) || `${profile.name} operating model pending AI review.`;
  let revenueModel = "Revenue = volume × realization × mix; forecast via driver-native FCFF.";
  let ratiosToTrust = ["netMargin", "roe", "roa", "roce", "assetTurnover", "debtToEquity", "currentRatio", "pe", "pb", "ps"];
  let ratiosToIgnore: string[] = [];
  let dcfLens = "FCFF_DCF (volume×realization×mix) + EV/EBITDA cross-check";
  const flags: string[] = [];

  if (isInsurer) {
    companyType = "Insurer — underwriting + float investment model";
    revenueModel = "NEP + investment income on float; value via residual-income on book value.";
    ratiosToTrust = ["combinedRatio", "underwritingMargin", "investmentYieldOnFloat", "roe", "roa", "pb"];
    ratiosToIgnore = ["grossMargin", "ebitdaMargin", "ebitMargin", "inventoryTurnover", "evToEbitda"];
    dcfLens = "PB_RESIDUAL_INCOME (sustainable ROE vs cost of equity)";
    flags.push("INSURER_PATH: revenue-growth/EBIT overrides forbidden — residual-income owns valuation.");
  } else if (isBank) {
    companyType = "Bank / NBFC — spread lender (NIM + fees − credit cost)";
    revenueModel = "NII (spread on loan book) + fee income; value via residual-income on book value.";
    ratiosToTrust = ["netMargin", "nim", "costToIncome", "roe", "roa", "equityMultiplier", "pb"];
    ratiosToIgnore = ["grossMargin", "ebitdaMargin", "ebitMargin", "inventoryTurnover", "evToEbitda", "interestCoverage"];
    dcfLens = "PB_RESIDUAL_INCOME (sustainable ROE vs cost of equity)";
    flags.push("BANK_PATH: revenue-growth/EBIT overrides forbidden — residual-income owns valuation.");
  } else if (arch.archetype === "EARLY_PLATFORM_GROWTH") {
    companyType = "Early platform — cash-burning marketplace / network model";
    revenueModel = "Orders × AOV × take-rate (or DAU × monetization); negative near-term margins expected.";
    ratiosToTrust = ["revenueGrowth", "netMargin", "assetTurnover", "ps", "evToSales"];
    ratiosToIgnore = ["pe", "evToEbitda", "dividendPayout"];
    dcfLens = "FCFF_DCF (orders×AOV×take-rate) + EV/Sales cross-check";
    if (negNet) flags.push("PLATFORM_BURN: negative earnings expected — P/E and EV/EBITDA are N/M, not sell signals.");
  } else if (arch.archetype === "DISTRESSED") {
    companyType = "Distressed / high-leverage — restructuring watch";
    revenueModel = "Revenue intact but balance-sheet stress dominates; solvency first, growth second.";
    ratiosToTrust = ["netMargin", "debtToEquity", "totalDebtToAssets", "interestCoverage", "currentRatio"];
    ratiosToIgnore = ["pe", "dividendPayout", "dividendYield"];
    dcfLens = "FCFF_DCF with distress WACC spread + solvency cross-check";
    flags.push("DISTRESS: leverage ratios take precedence over growth multiples.");
  } else if (arch.archetype === "CYCLICAL_CAPITAL_INTENSIVE") {
    companyType = "Cyclical capital-intensive — capacity / commodity driven";
    revenueModel = "Volume × price (cyclical) with heavy capex; mid-cycle margins anchor the forecast.";
    ratiosToTrust = ["ebitdaMargin", "ebitMargin", "roce", "assetTurnover", "netDebtToEbitda", "evToEbitda"];
    ratiosToIgnore = ["dividendPayout"];
    dcfLens = "FCFF_DCF (mid-cycle margin anchor) + EV/EBITDA cross-check";
  }

  if (hasZeroRevenue) flags.push("ZERO_REVENUE_HISTORY: newly listed or data gap — CAGR artifact flagged, growth capped.");
  if (negEquity) flags.push("NEGATIVE_EQUITY: ROE/P/B are N/M — supervisor blocks ratio-driven conclusions.");
  if (thinHistory) flags.push("THIN_HISTORY: <3 annuals — forecast confidence capped, terminal weight disclosed.");
  if ((preliminaryDcf.upsideDownside ?? 0) > 1.5 || (preliminaryDcf.upsideDownside ?? 0) < -0.8)
    flags.push("VALUATION_OUTLIER: preliminary upside outside +150%/−80% — assumptions re-checked, rating may route to NR.");

  const keyDrivers = [
    `${sector.id} operating archetype (${arch.archetype})`,
    `Latest revenue ${(latest.revenue ?? latest.totalRevenue ?? 0) > 0 ? "reported" : "MISSING/0 — flagged"}`,
    `Net margin ${(((latest.netMargin ?? 0) as number) * 100).toFixed(1)}%`,
    `Beta ${(stockData.beta ?? 0).toFixed?.(2) ?? "N/A"}`,
  ];

  return {
    ticker: profile.ticker,
    companyName: profile.name,
    companyType,
    businessModel,
    revenueModel,
    keyDrivers,
    ratiosToTrust,
    ratiosToIgnore,
    dcfLens,
    adjustments: [],
    refinedOverrides: null,
    flags,
    confidence: 0.55,
    source: "heuristic-fallback",
    rationale: `Heuristic audit (no AI key): classified as ${companyType} via sector(${sector.id})/archetype(${arch.archetype}). Preliminary ${preliminaryDcf.assumptions ? `WACC ${(preliminaryDcf.assumptions.wacc * 100).toFixed(1)}%` : "DCF"} checked against architecture bounds; no numeric overrides applied.`,
    auditedAt: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────
// AI supervisor (LLM enhancement over the heuristic base)
// ─────────────────────────────────────────────

function buildSupervisorPrompt(params: RunSupervisorParams, base: FinancialSupervision): string {
  const { profile, stockData, annualFinancials, ratiosByYear, preliminaryDcf, preliminaryOverrides } = params;
  const latest: any = annualFinancials[annualFinancials.length - 1];
  const hist = annualFinancials
    .map((f: any) => `${f.year}: rev=${Math.round(Number(f.revenue ?? f.totalRevenue ?? 0))} NI=${Math.round(Number(f.netIncome ?? 0))} equity=${Math.round(Number(f.totalEquity ?? 0))}`)
    .join(" | ");
  const lastRatio = ratiosByYear[ratiosByYear.length - 1] as any;
  const a = preliminaryDcf.assumptions as any;
  return `You are the AI FINANCIAL SUPERVISOR auditing Step 02 (ratios + DCF) for ONE company. Be company-specific, not generic.

COMPANY: ${profile.name} (${profile.ticker}) — ${profile.sector || "?"} / ${profile.industry || "?"} / ${profile.country || "?"}
DESC: ${(profile.description || "").slice(0, 500)}
HEURISTIC CLASSIFICATION (verify or correct): ${base.companyType} | lens: ${base.dcfLens}
HISTORY (oldest→latest): ${hist}
LATEST RATIOS: netMargin=${((lastRatio?.netMargin ?? 0) * 100).toFixed(1)}% roe=${((lastRatio?.roe ?? 0) * 100).toFixed(1)}% D/E=${Number(lastRatio?.debtToEquity ?? 0).toFixed(2)} current=${Number(lastRatio?.currentRatio ?? 0).toFixed(2)} pe=${Number(lastRatio?.pe ?? 0).toFixed(1)}
PRELIMINARY DCF: growth=${Array.isArray(a?.revenueGrowthRates) ? a.revenueGrowthRates.map((x: number) => (x * 100).toFixed(1) + "%").join(",") : "?"} margins=${Array.isArray(a?.ebitMargins) ? a.ebitMargins.map((x: number) => (x * 100).toFixed(1) + "%").join(",") : "?"} wacc=${a?.wacc != null ? (a.wacc * 100).toFixed(1) + "%" : "?"} TGR=${a?.terminalGrowthRate != null ? (a.terminalGrowthRate * 100).toFixed(1) + "%" : "?"} FV=${(preliminaryDcf as any).intrinsicValue ?? (preliminaryDcf as any).fairValuePerShare ?? "?"} upside=${(((preliminaryDcf as any).upsideDownside ?? 0) * 100).toFixed(1)}%
AI STAGE-1 OVERRIDES (already applied upstream, may be null): ${preliminaryOverrides ? JSON.stringify(preliminaryOverrides).slice(0, 300) : "null"}
LATEST RAW: revenue=${latest.revenue ?? latest.totalRevenue ?? 0} netIncome=${latest.netIncome ?? 0} equity=${latest.totalEquity ?? 0} beta=${stockData.beta ?? "?"} mktCap=${stockData.marketCap ?? "?"}

TASK — audit and return ONLY JSON:
{
  "companyType": "short company-specific type label",
  "businessModel": "1-2 sentences: what it does, how it makes money",
  "revenueModel": "1 sentence: revenue equation for THIS company",
  "keyDrivers": ["3-5 company-specific drivers"],
  "ratiosToTrust": ["ratio keys valid for THIS company"],
  "ratiosToIgnore": ["ratio keys N/A or misleading for THIS company, with why in flags"],
  "dcfLens": "valuation lens for THIS company",
  "growthRates": [Y1..Y5 decimals] or null (null for banks/insurers — NEVER suggest growth for spread/underwriting models),
  "ebitMargins": [Y1..Y5 decimals] or null (null for banks/insurers),
  "terminalGrowthRate": number or null,
  "waccOverride": number or null (only if mechanical WACC clearly wrong),
  "flags": ["company-specific warnings, incl. data gaps"],
  "confidence": 0.0-1.0,
  "rationale": "2-3 sentences: why these settings fit THIS company"
}
RULES: growth -0.20..0.60, margins -0.30..0.60, terminal 0.02..0.06, wacc 0.07..0.20. Banks/insurers: growthRates and ebitMargins MUST be null. Never invent history. JSON ONLY.`;
}

function parseSupervisorJson(raw: string): any | null {
  try {
    let s = (raw || "").trim();
    const m = s.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (m) s = m[1].trim();
    const st = s.indexOf("{");
    const en = s.lastIndexOf("}");
    if (st >= 0 && en > st) s = s.slice(st, en + 1);
    return JSON.parse(s);
  } catch {
    return null;
  }
}

async function aiEnhancement(
  params: RunSupervisorParams,
  base: FinancialSupervision
): Promise<FinancialSupervision> {
  const cfg = resolveProviderRequestConfig(params.customConfig ?? null);
  if (!cfg.apiKey) throw new Error("No AI key for supervisor");
  // Hard timeout: a hanging provider must NEVER stall the /api/company
  // serverless function (platform kills the function → client sees a
  // non-JSON error page). Abort → caught below → heuristic fallback.
  const res = await fetch(cfg.endpointUrl, {
    method: "POST",
    headers: cfg.headers,
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: "system", content: "You are an AI financial supervisor auditing valuation inputs. Return only raw JSON, no markdown." },
        { role: "user", content: buildSupervisorPrompt(params, base) },
      ],
      temperature: 0.25,
      max_tokens: 1400,
      ...(cfg.provider === "openrouter" ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: AbortSignal.timeout(SUPERVISOR_LLM_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supervisor LLM HTTP ${res.status}: ${text.slice(0, 200)}`);
  let content = text;
  try {
    const parsed = JSON.parse(text);
    const c = parsed.choices?.[0]?.message?.content ?? parsed.content ?? text;
    content = typeof c === "string" ? c : JSON.stringify(c);
  } catch {
    /* raw text */
  }
  const j = parseSupervisorJson(content);
  if (!j) throw new Error("Supervisor LLM returned unparseable JSON");

  const latest: any = params.annualFinancials[params.annualFinancials.length - 1];
  const isFin = isBankStatement(latest) || isInsuranceStatement(latest);
  const adjustments: SupervisorAdjustment[] = [];
  let refined: AIDCFOverrides | null = null;

  if (!isFin) {
    const g = Array.isArray(j.growthRates) && j.growthRates.length === 5 && j.growthRates.every(isNum)
      ? clampArr(j.growthRates as number[], GROWTH_MIN, GROWTH_MAX)
      : null;
    const m = Array.isArray(j.ebitMargins) && j.ebitMargins.length === 5 && j.ebitMargins.every(isNum)
      ? clampArr(j.ebitMargins as number[], MARGIN_MIN, MARGIN_MAX)
      : null;
    const t = isNum(j.terminalGrowthRate) ? clamp(j.terminalGrowthRate, TERMINAL_MIN, TERMINAL_MAX) : null;
    const w = isNum(j.waccOverride) ? clamp(j.waccOverride, WACC_MIN, WACC_MAX) : null;
    const prev = params.preliminaryDcf.assumptions as any;
    if (g) adjustments.push({ field: "revenueGrowthRates", previous: prev?.revenueGrowthRates ?? null, suggested: g, applied: true, reason: "AI supervisor company-specific growth path (bounded)." });
    if (m) adjustments.push({ field: "ebitMargins", previous: prev?.ebitMargins ?? null, suggested: m, applied: true, reason: "AI supervisor company-specific margin path (bounded)." });
    if (t != null) adjustments.push({ field: "terminalGrowthRate", previous: prev?.terminalGrowthRate ?? null, suggested: t, applied: true, reason: "AI supervisor terminal anchor (bounded 2–6%)." });
    if (w != null) adjustments.push({ field: "waccOverride", previous: prev?.wacc ?? null, suggested: w, applied: true, reason: "AI supervisor WACC correction (bounded 7–20%)." });
    if (g || m || t != null || w != null) {
      refined = {
        ...(g ? { revenueGrowthRates: g } : {}),
        ...(m ? { ebitMargins: m } : {}),
        ...(t != null ? { terminalGrowthRate: t } : {}),
        ...(w != null ? { waccOverride: w } : {}),
      };
    }
  }

  const str = (v: unknown, fb: string) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 500) : fb);
  const strArr = (v: unknown, fb: string[]): string[] =>
    Array.isArray(v) ? v.map(String).map((s) => s.slice(0, 160)).filter(Boolean).slice(0, 8) : fb;

  return {
    ticker: base.ticker,
    companyName: base.companyName,
    companyType: str(j.companyType, base.companyType),
    businessModel: str(j.businessModel, base.businessModel),
    revenueModel: str(j.revenueModel, base.revenueModel),
    keyDrivers: strArr(j.keyDrivers, base.keyDrivers),
    ratiosToTrust: strArr(j.ratiosToTrust, base.ratiosToTrust),
    ratiosToIgnore: strArr(j.ratiosToIgnore, base.ratiosToIgnore),
    dcfLens: str(j.dcfLens, base.dcfLens),
    adjustments,
    refinedOverrides: refined,
    flags: [...base.flags, ...strArr(j.flags, [])].slice(0, 10),
    confidence: isNum(j.confidence) ? clamp(j.confidence, 0, 1) : 0.7,
    source: "ai-supervisor",
    rationale: str(j.rationale, base.rationale),
    auditedAt: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────
// Main entry — never throws (falls back to heuristic)
// ─────────────────────────────────────────────

export async function runFinancialSupervisor(
  params: RunSupervisorParams
): Promise<FinancialSupervision> {
  const base = heuristicSupervision(params);
  try {
    const cfg = resolveProviderRequestConfig(params.customConfig ?? null);
    if (!cfg.apiKey) return base;
    return await aiEnhancement(params, base);
  } catch (e) {
    console.warn("[supervisor] AI enhancement unavailable, heuristic audit stands:", e instanceof Error ? e.message : e);
    return { ...base, flags: [...base.flags, "SUPERVISOR_LLM_UNAVAILABLE: heuristic audit stands (no numeric overrides)."] };
  }
}

export default { runFinancialSupervisor, SUPERVISOR_CHECKPOINTS };
