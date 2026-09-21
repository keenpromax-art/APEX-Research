/**
 * APEX RESEARCH — Company-Specific Semantic Profiles
 * ---------------------------------------------------
 * Sector packs cannot express conglomerate/holding-company semantics: a
 * `general`-sector company (e.g. Reliance) must not inherit internet-platform
 * or semiconductor vocabulary, but the `general` pack is deliberately thin.
 * These per-company profiles close that gap with explicit forbidden-concept
 * lists. Matches are ticker/name anchored (never sector-inferred), so a
 * genuine platform company can never trip another company's profile.
 *
 * Consumers:
 *  - report-qa.ts SEM-COMP-01 (FAIL/BLOCK on any hit — TEMPLATE CONTAMINATION)
 *  - openrouter.ts buildSectorGuardrail (same list injected into prompts)
 *  - ai-first/quality-review.ts industryAnalyzer (shared vocabulary)
 */

/** Internet-platform + semiconductor vocabulary — foreign to conglomerates. */
export const PLATFORM_SILICON_FORBIDDEN = [
  "advertiser bidding",
  "search index",
  "custom silicon",
  "two-sided network",
  "two sided network",
  "hyperscale",
  "hyperscale data",
  "data-centre moat",
  "data center moat",
  "data centre moat",
  "ad impressions",
  "price per ad",
  "cost per click",
  "traffic acquisition",
  "daily active users",
  "monthly active users",
  "app store commission",
  "take rate",
  "gross merchandise value",
  "search monetization",
  "foundation model moat",
  "gpu cluster",
  "tpu",
  "saas churn",
  "arr expansion",
  "cloud subscription churn",
];

export interface CompanySemanticProfile {
  /** Stable key, e.g. "RELIANCE". */
  companyKey: string;
  /** Ticker spellings that select this profile (case-insensitive, suffix-agnostic). */
  matchTickers: string[];
  /** Name fragments that select this profile (case-insensitive substring). */
  matchNames: string[];
  /** Concepts that must never appear in this company's narrative. */
  extraForbiddenConcepts: string[];
  /** Why the profile exists (auditable rationale). */
  rationale: string;
}

const PROFILES: CompanySemanticProfile[] = [
  {
    companyKey: "RELIANCE",
    matchTickers: ["RELIANCE.NS", "RELIANCE.BO", "RIL", "RELIANCE"],
    matchNames: ["reliance industries"],
    extraForbiddenConcepts: PLATFORM_SILICON_FORBIDDEN,
    rationale:
      "Oil-to-telecom/retail conglomerate valued on O2C + Jio + Retail + E&P segments. " +
      "Internet-platform ad-tech and semiconductor-fab vocabulary (advertiser bidding, " +
      "search index, custom silicon, two-sided network, hyperscale moat) proves template " +
      "contamination from the internet-platform sector.",
  },
];

function normalizeTicker(t: string): string {
  return (t || "").toUpperCase().replace(/\.(NS|BO)$/, "");
}

/**
 * Return the company-specific semantic profile for a ticker/name, or null
 * when no profile claims the company. Never throws, never guesses.
 */
export function getCompanySemanticProfile(profile: {
  ticker?: string;
  symbol?: string;
  name?: string;
}): CompanySemanticProfile | null {
  const tick = normalizeTicker(profile.ticker || profile.symbol || "");
  const name = (profile.name || "").toLowerCase();
  for (const p of PROFILES) {
    if (p.matchTickers.some((m) => normalizeTicker(m) === tick)) return p;
    if (name && p.matchNames.some((m) => name.includes(m))) return p;
  }
  return null;
}
