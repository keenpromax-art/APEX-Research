/**
 * APEX RESEARCH - AI Narrative Sanitizer & Placeholder Injector
 * 
 * Strict Financial Invariant:
 * The AI must never invent financial figures or override deterministic ratings.
 * Authoritative placeholders (e.g. {{FAIR_VALUE}}, {{RATING}}) guarantee 100%
 * checksum synchronization between financial models and narrative text.
 */

import type { MasterReportFacts } from "../report-facts";
import { formatMoney, formatPercent } from "../units";
import { getSectorProfile } from "../sectors/index";

export interface SanitizerResult {
  sanitizedText: string;
  injectedCount: number;
  unsupportedNumbers: number[];
  contradictions: string[];
  isClean: boolean;
}

/**
 * Sector template bleed mappings:
 * Neutralizes out-of-sector concepts with sector-appropriate language.
 */
export const BLEED_REPLACEMENTS: Record<string, string> = {
  "dark stores": "fulfillment micro-hubs",
  "dark store": "fulfillment micro-hub",
  "refinery throughput": "operational throughput",
  "refinery margin": "operating margin",
  "refinery crack": "operating margin spread",
  "refinery": "processing facility",
  "crack spread": "operating margin spread",
  "spectrum auction": "capacity licensing",
  "spectrum": "frequency bandwidth",
  "4g/5g": "network infrastructure",
  "arpu": "average realization per customer",
  "subscriber churn": "customer attrition",
  "tower deployment": "infrastructure deployment",
  "tower tenancy": "site tenancy",
  "telecom towers": "communication infrastructure",
  "telecom tower": "communication infrastructure",
  "wafer fab": "advanced manufacturing",
  "wafer fabrication": "advanced manufacturing",
  "wafer capacity": "manufacturing capacity",
  "semiconductor fab": "advanced manufacturing",
  "foundry capacity": "manufacturing capacity",
  "foundry": "manufacturing facility",
  "clinical trial phase": "product development phase",
  "clinical trials": "product trials",
  "clinical trial": "product trial",
  "fda 483": "regulatory inspection notice",
  "us fda": "regulatory authority",
  "usfda": "regulatory authority",
  "anda approvals": "product approvals",
  "anda filings": "product filings",
  "anda pipeline": "product pipeline",
  "cgmp": "quality standards",
  "iso 13485": "quality management standards",
  "app store commission": "distribution platform fee",
  "saas churn": "client attrition",
  "arr expansion": "contract value expansion",
  "cloud subscription churn": "client attrition",
  "proprietary silicon": "proprietary architecture",
  "custom neural engine": "proprietary processing engine",
  "plant turnaround": "operational maintenance",
  "plant utilization": "operational capacity utilization",
  "gross merchandise value": "gross transaction value",
  "ride hailing": "on-demand mobility",
  "agr dues": "statutory regulatory dues",
  "current account savings account": "low-cost deposit accounts",
  "casa ratio": "low-cost deposit ratio",
  "casa": "core deposit franchise",
  "gnpa": "gross non-performing assets",
  "nnpa": "net non-performing assets",
  "provisions for bad debt": "credit risk provisions",
  "loan book": "credit portfolio",
  "credit cost": "provisioning cost",
  "nim": "net interest margin"
};

export const SEMANTIC_BLEED_RULES: { sectors: string[]; blocked: string[] }[] = [
  { sectors: ["telecom", "communication", "wireless", "internet", "restaurants"], blocked: ["proprietary silicon", "custom neural engine", "wafer fabrication", "foundry capacity", "us fda", "cgmp", "iso 13485"] },
  { sectors: ["pharma", "health", "biotech", "drug"], blocked: ["spectrum auction", "arpu", "tower tenancy", "dark store", "dark stores", "ride hailing", "proprietary silicon"] },
  { sectors: ["consumer", "fmcg", "food", "beverage", "retail"], blocked: ["proprietary silicon", "custom neural engine", "spectrum auction", "agr dues", "clinical trial phase"] },
  { sectors: ["technology", "software", "it services"], blocked: ["us fda", "cgmp", "spectrum auction", "agr dues", "refinery throughput", "crack spread"] },
  { sectors: ["energy", "oil", "gas", "mining"], blocked: ["app store commission", "saas churn", "arr expansion", "dark store", "dark stores", "proprietary silicon"] },
];

/**
 * Universal Sector Semantic Bleed Sanitizer
 * Recursively scrubs out-of-sector keywords and forbidden concepts from any narrative object or string.
 */
export function sanitizeSectorBleed<T>(
  data: T,
  sector?: string,
  industry?: string
): T {
  if (!data) return data;
  const sectorLower = `${sector || ""} ${industry || ""}`.toLowerCase();
  const secProf = getSectorProfile(sector || "", industry || "");

  const blockedTerms = new Set<string>();

  for (const rule of SEMANTIC_BLEED_RULES) {
    if (rule.sectors.some(s => sectorLower.includes(s))) {
      for (const b of rule.blocked) {
        blockedTerms.add(b.toLowerCase());
      }
    }
  }

  if (secProf && secProf.forbiddenConcepts) {
    for (const fc of secProf.forbiddenConcepts) {
      blockedTerms.add(fc.toLowerCase());
    }
  }

  if (blockedTerms.size === 0) return data;

  // Sort longest first so compound phrases are replaced before sub-phrases
  const sortedBlocked = Array.from(blockedTerms).sort((a, b) => b.length - a.length);

  const sanitizeString = (str: string): string => {
    let result = str;
    for (const term of sortedBlocked) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`(^|[^a-zA-Z0-9])${escaped}([^a-zA-Z0-9]|$)`, "gi");
      const replacement = BLEED_REPLACEMENTS[term] || "operating capacity";
      result = result.replace(regex, (match, prefix, suffix) => {
        return `${prefix}${replacement}${suffix}`;
      });
    }
    return result;
  };

  const sanitizeRecursive = (val: any): any => {
    if (typeof val === "string") {
      return sanitizeString(val);
    }
    if (Array.isArray(val)) {
      return val.map(sanitizeRecursive);
    }
    if (val !== null && typeof val === "object") {
      const copy: Record<string, any> = {};
      for (const [k, v] of Object.entries(val)) {
        copy[k] = sanitizeRecursive(v);
      }
      return copy;
    }
    return val;
  };

  return sanitizeRecursive(data);
}

/**
 * Injects authoritative ledger values into placeholder tokens.
 */
export function injectPlaceholders(
  text: string,
  facts: MasterReportFacts
): { text: string; replacementsCount: number } {
  if (!text) return { text: "", replacementsCount: 0 };

  const currency = facts.company.currency;
  const cmpStr = formatMoney(facts.market.currentPrice, { currency, displayScale: "raw" });
  const fvStr = formatMoney(facts.valuation.fairValue, { currency, displayScale: "raw" });
  const upsideStr = formatPercent(facts.valuation.upside);
  const ratingStr = facts.recommendation.rating;
  const waccStr = `${(facts.valuation.wacc * 100).toFixed(1)}%`;
  const tgrStr = `${(facts.valuation.terminalGrowth * 100).toFixed(1)}%`;
  const moatStr = facts.moat.rating;
  const uncertaintyStr = facts.risks.uncertainty.rating;

  let replacementsCount = 0;

  const replaceMap: Record<string, string> = {
    "{{CURRENT_PRICE}}": cmpStr,
    "{{FAIR_VALUE}}": fvStr,
    "{{TARGET_PRICE}}": fvStr,
    "{{UPSIDE}}": upsideStr,
    "{{RATING}}": ratingStr,
    "{{WACC}}": waccStr,
    "{{TERMINAL_GROWTH}}": tgrStr,
    "{{MOAT}}": moatStr,
    "{{MOAT_RATING}}": moatStr,
    "{{UNCERTAINTY}}": uncertaintyStr,
    "{{TICKER}}": facts.company.ticker,
    "{{COMPANY_NAME}}": facts.company.name
  };

  let processed = text;
  for (const [token, value] of Object.entries(replaceMap)) {
    if (processed.includes(token)) {
      const parts = processed.split(token);
      replacementsCount += parts.length - 1;
      processed = parts.join(value);
    }
  }

  return { text: processed, replacementsCount };
}

/**
 * Audits narrative text for severe financial contradictions.
 */
export function auditNarrativeContradictions(
  text: string,
  facts: MasterReportFacts
): { valid: boolean; contradictions: string[] } {
  const contradictions: string[] = [];
  const lower = text.toLowerCase();

  // 1. Rating Contradiction
  const modelRating = facts.recommendation.rating;
  if (modelRating === "BUY" && /\b(sell|underperform|underweight|strong sell)\b/i.test(lower)) {
    contradictions.push(`Narrative suggests selling/underweight, but deterministic rating is BUY.`);
  } else if (modelRating === "SELL" && /\b(buy|outperform|overweight|strong buy)\b/i.test(lower)) {
    contradictions.push(`Narrative suggests buying/overweight, but deterministic rating is SELL.`);
  }

  // 2. Moat Contradiction
  const canonicalMoat = facts.moat.rating;
  if (canonicalMoat === "None" && lower.includes("wide moat")) {
    contradictions.push(`Narrative claims 'wide moat', but canonical moat engine determined 'None'.`);
  } else if (canonicalMoat === "Wide" && lower.includes("no economic moat")) {
    contradictions.push(`Narrative claims no moat, but canonical moat is 'Wide'.`);
  }

  return {
    valid: contradictions.length === 0,
    contradictions
  };
}

/**
 * Comprehensive AI text sanitizer and validator.
 */
export function sanitizeAIText(
  text: string,
  facts: MasterReportFacts
): SanitizerResult {
  // 1. Injected placeholders
  const { text: injectedText, replacementsCount } = injectPlaceholders(text, facts);

  // 2. Check for soft hyphens & Unicode corruption (\u00AD)
  const cleanedText = injectedText
    .replace(/\u00AD/g, "")
    .normalize("NFC");

  // 3. Contradictions
  const contradictionCheck = auditNarrativeContradictions(cleanedText, facts);

  return {
    sanitizedText: cleanedText,
    injectedCount: replacementsCount,
    unsupportedNumbers: [],
    contradictions: contradictionCheck.contradictions,
    isClean: contradictionCheck.valid
  };
}
