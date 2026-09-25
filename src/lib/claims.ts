/**
 * APEX RESEARCH - Fact-Bound Claim Spine (Priority 5)
 * Every material numeric claim must be traceable to a validated fact/claim ID.
 * Unsupported claims are blocked from PDF export via CLAIM-01 QA gate.
 */

import type { MasterReportFacts } from "./report-facts";
import type { AnnualFinancials } from "@/types/report";

export type ClaimPeriodType = "ACTUAL" | "ESTIMATE" | "FORECAST" | "CURRENT" | "UNKNOWN";

export interface Claim {
  id: string;
  text: string;
  numericValue?: number;
  numericRaw?: string;
  kind: "percentage" | "currency" | "multiple" | "count";
  sourceFactId: string | null;
  evidence: string | null;
  supported: boolean;
  field?: string;
  unit?: string;
  currency?: string;
  scale?: string;
  period?: string;
  periodType?: ClaimPeriodType;
}

export interface StructuredClaim extends Claim {
  sentenceIndex: number;
  numericIndex: number;
}

// Simple deterministic hash (FNV-1a 32-bit hex, avoids crypto dependency)
function hashClaim(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `claim_${(h >>> 0).toString(16).padStart(8, "0")}`;
}

function normalizeSentence(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 240);
}

const NUMERIC_CLAIM_RE = /(?<![\w])[-+]?\s*(?:(?:₹|rs\.?|inr|usd|eur|gbp|\$|€|£)\s*)?(?:\d[\d,]*(?:\.\d+)?|\.\d+)\s*(?:%|x|bn|billion|mn|million|m|cr|crore|l|lakh|k|thousand)?/gi;

function normalizeScale(raw: string | undefined): string {
  const value = String(raw ?? "").toLowerCase();
  if (value === "bn" || value === "billion") return "billion";
  if (value === "mn" || value === "m" || value === "million") return "million";
  if (value === "cr" || value === "crore") return "crore";
  if (value === "l" || value === "lakh") return "lakh";
  if (value === "k" || value === "thousand") return "thousand";
  return "raw";
}

function currencyFromToken(raw: string): string | undefined {
  const token = raw.toLowerCase();
  if (token.includes("₹") || /\brs\.?\b/.test(token) || token.includes("inr")) return "INR";
  if (token.includes("$") || token.includes("usd")) return "USD";
  if (token.includes("€") || token.includes("eur")) return "EUR";
  if (token.includes("£") || token.includes("gbp")) return "GBP";
  return undefined;
}

function periodFromText(text: string): { period?: string; periodType?: ClaimPeriodType } {
  const match = text.match(/\b(?:Q[1-4]\s*)?FY\s*\d{2,4}\b|\b(?:19|20)\d{2}[AE]?\b|\bTTM\b|\b(?:current|last quarter|next quarter|annual|quarterly)\b/i);
  if (!match) return {};
  const raw = match[0].trim();
  const upper = raw.toUpperCase();
  if (upper === "TTM") return { period: upper, periodType: "CURRENT" };
  if (/CURRENT|QUARTER|ANNUAL/.test(upper)) return { period: upper.replace(/\s+/g, " "), periodType: "CURRENT" };
  const periodType: ClaimPeriodType = /E$/.test(upper) ? "ESTIMATE" : /A$/.test(upper) ? "ACTUAL" : "UNKNOWN";
  return { period: upper.replace(/\s+/g, " "), periodType };
}

function inferClaimField(text: string, raw?: string, position = 0): string | undefined {
  const value = text.toLowerCase();
  const before = text.slice(Math.max(0, position - 48), position).toLowerCase();
  const fields: Array<[RegExp, string]> = [
    [/\bterminal\s+growth\b|\btgr\b/, "terminalGrowth"],
    [/\bwacc\b|weighted\s+average\s+cost/, "wacc"],
    [/\bfair\s+value\b|\bintrinsic\s+value\b|\btarget\s+price\b/, "fairValue"],
    [/\bcurrent\s+price\b|\bmarket\s+price\b|\bcmp\b/, "currentPrice"],
    [/\b(?:revenue|sales|top[- ]line|turnover)\s+growth\b/, "revenueGrowth"],
    [/\brevenue\b|\bsales\b|\btop[- ]line\b|\bturnover\b/, "revenue"],
    [/\bebitda\b/, "ebitda"],
    [/\bebit\s+margin\b|\boperating\s+margin\b|\bmargin\b/, "ebitMargin"],
    [/\bnet\s+income\b|\bnet\s+profit\b|\bearnings\b/, "netIncome"],
    [/\bfree\s+cash\s+flow\b|\bfcf\b/, "freeCashFlow"],
    [/\boccupancy\b/, "occupancy"],
    [/\brevpar\b/, "revpar"],
    [/\bpe\b|\bprice\s+to\s+earnings\b/, "pe"],
    [/\bshares\s+outstanding\b/, "sharesOutstanding"],
  ];
  const beforeMatches = fields
    .map(([pattern, field]) => ({ field, index: before.search(pattern) }))
    .filter((candidate) => candidate.index >= 0)
    .sort((a, b) => b.index - a.index);
  if (beforeMatches.length > 0) return beforeMatches[0].field;
  return fields.find(([pattern]) => pattern.test(value))?.[1];
}

function numericKind(raw: string, currency: string | undefined): Claim["kind"] {
  if (raw.includes("%")) return "percentage";
  if (/\d\s*x$/i.test(raw) || /\b(?:multiple|turns?)\b/i.test(raw)) return "multiple";
  if (currency) return "currency";
  return "count";
}

export function extractStructuredClaims(text: string): StructuredClaim[] {
  if (!text) return [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  const claims: StructuredClaim[] = [];
  for (let sentenceIndex = 0; sentenceIndex < sentences.length; sentenceIndex++) {
    const sentence = sentences[sentenceIndex];
    const matches = sentence.matchAll(NUMERIC_CLAIM_RE);
    let numericIndex = 0;
    for (const match of matches) {
      const raw = match[0].trim();
      const lower = raw.toLowerCase();
      const suffix = lower.match(/(%|x|bn|billion|mn|million|m|cr|crore|l|lakh|k|thousand)$/i)?.[1];
      const currency = currencyFromToken(raw);
      const hasScale = Boolean(suffix && !["%", "x"].includes(suffix.toLowerCase()));
      const hasCountContext = /\b(?:employees|units|shares|customers|orders|beds|seats|vehicles|workers|staff)\b/i.test(sentence);
      if (!currency && !suffix && !hasCountContext) continue;
      const numericToken = raw.replace(/,/g, "").replace(/[^\d.+-]/g, "");
      const numericValue = Number.parseFloat(numericToken);
      if (!Number.isFinite(numericValue)) continue;
      const period = periodFromText(sentence);
      const kind = numericKind(raw, currency);
      claims.push({
        id: hashClaim(`${normalizeSentence(sentence)}|${raw}|${numericIndex}`),
        text: sentence.trim().slice(0, 320),
        numericRaw: raw,
        numericValue,
        kind,
        field: inferClaimField(sentence, raw, match.index ?? 0),
        unit: kind === "percentage" ? "pct" : kind === "multiple" ? "multiple" : kind === "currency" ? "money" : hasScale ? "count" : undefined,
        currency,
        scale: hasScale ? normalizeScale(suffix) : "raw",
        period: period.period,
        periodType: period.periodType,
        sourceFactId: null,
        evidence: null,
        supported: false,
        sentenceIndex,
        numericIndex,
      });
      numericIndex++;
    }
  }
  return claims;
}

export function extractClaims(text: string): Claim[] {
  const firstBySentence = new Set<number>();
  return extractStructuredClaims(text).filter((claim) => {
    if (firstBySentence.has(claim.sentenceIndex)) return false;
    firstBySentence.add(claim.sentenceIndex);
    return true;
  });
}

/**
 * Validate claims against MasterReportFacts + DCF assumptions.
 * Returns claims with sourceFactId/evidence populated where match within tolerance.
 */
/**
 * @deprecated Use claim-validator.ts:validateClaimSet() instead.
 * This function uses a flat allowlist; the unified validator uses the
 * EvidenceRegistry with tier-aware matching, temporal grounding, and
 * directional consistency checks.
 */
export function validateClaims(claims: Claim[], facts: MasterReportFacts, dcfFacts?: { wacc: number; tgr: number; growthRates: number[]; margins: number[]; rev: number }): Claim[] {
  console.warn("[DEPRECATED] claims.ts:validateClaims() called — migrate to claim-validator.ts:validateClaimSet()");
  const allowlist: { id: string; value: number; evidence: string }[] = [];
  if (dcfFacts) {
    dcfFacts.growthRates.forEach((v, i) => allowlist.push({ id: `DCF:revenueGrowthRates[${i}]=${(v * 100).toFixed(1)}%`, value: v * 100, evidence: `DCF revenueGrowthRates[${i}]` }));
    dcfFacts.margins.forEach((v, i) => allowlist.push({ id: `DCF:ebitMargins[${i}]=${(v * 100).toFixed(1)}%`, value: v * 100, evidence: `DCF ebitMargins[${i}]` }));
    allowlist.push({ id: `DCF:wacc=${(dcfFacts.wacc * 100).toFixed(1)}%`, value: dcfFacts.wacc * 100, evidence: "DCF wacc" });
    allowlist.push({ id: `DCF:tgr=${(dcfFacts.tgr * 100).toFixed(1)}%`, value: dcfFacts.tgr * 100, evidence: "DCF terminalGrowth" });
    allowlist.push({ id: `DCF:rev=${dcfFacts.rev}`, value: dcfFacts.rev, evidence: "Filing revenue" });
  }
  if (facts) {
    const upsideRaw: any = (facts.valuation as any).upside;
    const upsideVal = typeof upsideRaw === "object" && upsideRaw !== null ? (upsideRaw.value ?? upsideRaw) : Number(upsideRaw || 0);
    const upside = (Number.isFinite(upsideVal) ? upsideVal : 0) * 100;
    allowlist.push({ id: `FACT:upside=${upside.toFixed(1)}%`, value: upside, evidence: "Valuation upside" });
    const fvRaw: any = (facts.valuation as any).fairValue;
    const fv = typeof fvRaw === "object" && fvRaw !== null ? (fvRaw.value ?? fvRaw) : Number(fvRaw || 0);
    allowlist.push({ id: `FACT:fv=${fv}`, value: Number.isFinite(fv) ? fv : 0, evidence: "DCF fairValue" });
    const cmpRaw: any = (facts.market as any).currentPrice;
    const cmp = typeof cmpRaw === "object" && cmpRaw !== null ? (cmpRaw.value ?? cmpRaw) : Number(cmpRaw || 0);
    allowlist.push({ id: `FACT:cmp=${cmp}`, value: Number.isFinite(cmp) ? cmp : 0, evidence: "Market CMP" });
  }

  const validated: Claim[] = claims.map(c => {
    if (c.kind === "percentage" && c.numericValue !== undefined) {
      const pct = c.numericValue; // already as e.g. 12.5 for "12.5%"
      for (const a of allowlist) {
        // Only compare percentage allowlist entries (values < 100% typically)
        if (a.value < 200 && Math.abs(a.value - pct) < 0.85) {
          return { ...c, sourceFactId: a.id, evidence: a.evidence, supported: true };
        }
      }
      // Hospitality RevPAR driver: occupancy 68% etc is not in DCF allowlist (driver model gap) — mark unsupported but warn-level
      return { ...c, supported: false };
    }
    if (c.kind === "currency" && c.numericValue !== undefined) {
      for (const a of allowlist) {
        if (Math.abs(a.value - c.numericValue!) / Math.max(1, Math.abs(a.value)) < 0.02) {
          return { ...c, sourceFactId: a.id, evidence: a.evidence, supported: true };
        }
      }
      return { ...c, supported: false };
    }
    // Multiples and counts: require exact fact match within 5%
    return { ...c, supported: false };
  });

  return validated;
}

/**
 * Validate narrative growth-rate claims against actual historical financials.
 * Extracts growth-rate claims from narrative text, computes actual revenue CAGR
 * from annualFinancials, and flags claims where the narrative growth rate
 * differs from actual by more than 10 percentage points.
 */
export function validateGrowthClaims(
  narrativeText: string,
  annualFinancials: AnnualFinancials[]
): { claim: Claim; actualCAGR: number; divergence: number; flagged: boolean }[] {
  const results: { claim: Claim; actualCAGR: number; divergence: number; flagged: boolean }[] = [];
  if (!narrativeText || !annualFinancials || annualFinancials.length < 2) return results;

  // Compute actual revenue CAGR from annualFinancials
  const revenues = annualFinancials
    .map((f) => f.revenue)
    .filter((r): r is number => typeof r === "number" && r > 0);
  if (revenues.length < 2) return results;

  const firstRev = revenues[0];
  const lastRev = revenues[revenues.length - 1];
  const n = revenues.length - 1;
  const actualCAGR = Math.pow(lastRev / firstRev, 1 / n) - 1;
  const actualCAGRPercent = actualCAGR * 100;

  // Extract growth-rate claims from narrative: look for sentences containing
  // growth-related keywords and a percentage
  const growthPatterns = [
    /(?:revenue|sales|top[- ]line|turnover)\s+(?:grew|grew\s+by|increased|grew\s+at|expanded)\s+(\d+(?:\.\d+)?)\s*%/gi,
    /revenue\s+(?:CAGR|compound\s+annual\s+growth)\s+of\s+(\d+(?:\.\d+)?)\s*%/gi,
    /(?:revenue|sales)\s+growth\s+of\s+(\d+(?:\.\d+)?)\s*%/gi,
    /revenue\s+(?:grew|increased)\s+(\d+(?:\.\d+)?)\s*%\s*(?:year[- ]over[- ]year|annually|per\s+year)/gi,
    /revenue\s+at\s+a\s+cagr\s+of\s+(\d+(?:\.\d+)?)\s*%/gi,
  ];

  const claims = extractStructuredClaims(narrativeText);
  for (const claim of claims) {
    if (claim.kind !== "percentage" || claim.numericValue === undefined) continue;
    // Check if the claim sentence relates to growth
    const sentLower = claim.text.toLowerCase();
    const isGrowthClaim = growthPatterns.some((re) => re.test(sentLower));
    if (!isGrowthClaim) continue;

    const divergence = Math.abs(claim.numericValue - actualCAGRPercent);
    const flagged = divergence > 10;
    results.push({
      claim,
      actualCAGR: actualCAGRPercent,
      divergence,
      flagged,
    });
  }

  return results;
}

/**
 * Build an ontology-bound system prompt fragment that forces the LLM to be fact-bound.
 * Called by openrouter.ts buildSectorGuardrail.
 */
export function buildEvidenceRequirement(sectorId: string, allowedKPIs: string[], driverSpec?: { revenueDrivers: string[] }): string {
  const kpiList = allowedKPIs.slice(0, 6).join(", ");
  const driverList = driverSpec ? driverSpec.revenueDrivers.join(", ") : "revenue, margin";
  return `EVIDENCE DISCIPLINE (hard): Every material numeric claim (%, currency, multiple) MUST be traceable to one of: (a) a {{PLACEHOLDER}} fact ({{FAIR_VALUE}}, {{WACC}}, {{RATING}} etc. — inject, do not invent), (b) a filing fact from the Financials section, or (c) a driver from this sector's ontology [${driverList}]. If you cannot evidence a number, DO NOT state it. Do not fabricate RevPAR (e.g., Rs 8,400), occupancy (e.g., 68%), ADR, GOPPAR, or peer multiples. Allowed KPIs for this sector: [${kpiList}]. Non-allowlisted KPIs are forbidden. Each thesis paragraph must remain ontology-bound to this sector's driverSpec — do not import another sector's KPIs (e.g., CASA, spectrum, wafer, refinery). CASH-FLOW DISCIPLINE: if trailing or forecast free cash flow is negative, do NOT claim operating cash comfortably funds growth capex — state the actual funding source (cash balance, debt, asset sales) or omit the claim; a funding claim beside negative model FCF fails audit.`;
}
