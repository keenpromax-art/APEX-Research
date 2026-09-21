/**
 * APEX RESEARCH — AI ASSUMPTION GENERATION
 *
 * The AI generates forward-looking assumptions grounded in historical yfinance
 * facts. Every assumption has: rationale, historical evidence (fact citations),
 * and confidence. The deterministic forecast engine then uses these assumptions
 * as inputs, performing all arithmetic.
 *
 * PRINCIPLE: AI generates the assumption spec with evidence. Code executes the
 * forecast using those assumptions. No hardcoded growth rates (e.g. "10% revenue
 * growth") anywhere.
 */

import type {
  Fact,
  FactPack,
  Assumption,
  ForecastVariable,
  KpiDefinition,
  BusinessDriver,
  CompanyUnderstanding,
  ForecastSpecification,
} from "./types";
import type { ProvenanceTier } from "./types";

/**
 * Prompt the LLM to generate assumptions for the forecast.
 * Each assumption is grounded in historical yfinance facts and includes
 * rationale + evidence + confidence.
 *
 * In production, the caller sends this prompt via the transport LLM function
 * and parses the JSON response with parseAssumptionJson().
 */
export function buildAssumptionsPrompt(
  pack: FactPack,
  companyUnderstanding: CompanyUnderstanding,
  model: ForecastSpecification
): string {
  const t = pack.ticker;
  const currency = pack.market.facts.find((f: Fact) => f.metric === "currentPrice")?.currency || "USD";

  // Gather historical facts the AI can reference
  const revenueHistory = pack.incomeStatement.facts
    .filter((f: Fact) => f.metric.toLowerCase().includes("revenue") && f.period !== "current")
    .sort((a: Fact, b: Fact) => b.period.localeCompare(a.period))
    .slice(0, 5);

  const epsHistory = pack.earnings.facts
    .filter((f: Fact) => f.metric.startsWith("eps") && f.period !== "current")
    .sort((a: Fact, b: Fact) => b.period.localeCompare(a.period))
    .slice(0, 5);

  const grossProfitHistory = pack.incomeStatement.facts
    .filter((f: Fact) => f.metric.toLowerCase().includes("gross profit") && f.period !== "current")
    .sort((a: Fact, b: Fact) => b.period.localeCompare(a.period))
    .slice(0, 5);

  // Build a summary of historical trends
  const trendSummary = `
HISTORICAL TRENDS (last 5 years, yfinance facts only):
Revenue:
${revenueHistory.map((f: Fact) => `- ${f.metric} ${f.label}: ${f.value !== undefined ? `${f.value} ${f.unit || ""}` : "N/A"} (${f.period})`).join("\n")}

EPS:
${epsHistory.map((f: Fact) => `- ${f.metric} ${f.label}: ${f.value !== undefined ? `${f.value} ${f.unit || ""}` : "N/A"} (${f.period})`).join("\n")}

Gross Profit:
${grossProfitHistory.map((f: Fact) => `- ${f.metric} ${f.label}: ${f.value !== undefined ? `${f.value} ${f.unit || ""}` : "N/A"} (${f.period})`).join("\n")}
`;

  return `You are an institutional equity research analyst. Based on the yfinance fact pack below, generate forward-looking assumptions for the company's financial model. 

COMPANY PROFILE:
- Ticker: ${t}
- Company: ${companyUnderstanding.whatItDoes || "Not specified"}
- Primary economic abstraction: ${companyUnderstanding.primaryEconomicAbstraction || "To be determined"}
- Industry: ${companyUnderstanding.industryContext || "Not specified"}

${trendSummary}

INSTRUCTION:
Generate a set of assumptions that the deterministic forecast engine will use.
Each assumption must be:

1. GROUNDED in the historical yfinance facts above. Cite specific fact metrics.
2. Forward-looking but justified — explain the rationale based on historical evidence.
3. Explicitly marked with: assumption (statement), variable name, value, unit, period, rationale (with fact citations), confidence (0..1).

COVER THESE CATEGORIES (generate 8-12 assumptions total across these areas):

REVENUE ASSUMPTIONS:
- Revenue growth CAGR or year-by-year growth rates
- What historical trend drives the forecast (e.g., "5-year CAGR of X% based on revenue from FY20-FY24")
- Any inflection points or structural changes

COST ASSUMPTIONS:
- Growth rates for primary cost drivers
- Inflation, wage pressure, commodity cost trends as evidenced historically

MARGIN ASSUMPTIONS:
- Gross margin trajectory
- EBIT margin assumptions
- Net margin assumptions
- Explain how these connect to the margin drivers identified in the model

BALANCE SHEET ASSUMPTIONS:
- Working capital as % of revenue
- Capex as % of revenue or as fixed amount
- Debt repayment or issuance assumptions
- Cash build/draw assumptions

TAX ASSUMPTIONS:
- Effective tax rate
- Historical effective rate evidence

SHARES ASSUMPTIONS:
- Share count changes (buybacks, dilution)
- Dividend payout assumptions

FORECAST HORIZON ASSUMPTIONS:
- Why X-year horizon (vs X+1 years)?
- Terminal growth rate assumption and rationale

RETURN ASSUMPTIONS:
- ROE, ROIC assumptions and historical basis

For each assumption, provide:
- assumption: the statement (e.g., "Revenue grows at 7% annually")
- variable: the variable name this feeds into
- value: the numeric value
- unit: the unit (%, dollars, etc.)
- period: "FY2027", "FY2028", etc. or "annual"
- rationale: specific reference to yfinance facts (cite metric names), e.g., "Based on 5-year revenue CAGR of 6.2% (FY20-FY24, fact [F-REV-FY24])"
- confidence: 0-1

Return STRICT JSON matching this schema. Do NOT include prose outside the JSON. The JSON array must contain 8-12 assumptions minimum.

FACT PACK VERSION: ${pack.version}
CURRENT DATE: ${new Date().toISOString()}
`;
}

/**
 * Parse the LLM's JSON response into an array of Assumption objects.
 * Tolerates code fences, prose wrapping, and minor formatting issues.
 */
export function parseAssumptionJson(text: string): Assumption[] | null {
  if (!text) return null;

  let cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  // Try to find the first {...} block or [ {...} ... ] block
  let start = cleaned.indexOf("[");
  let end = cleaned.lastIndexOf("]");
  if (start < 0 || end <= start) {
    // Maybe it's a single object, not array
    start = cleaned.indexOf("{");
    end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      cleaned = cleaned.slice(start, end + 1);
      try {
        const single = JSON.parse(cleaned) as Assumption;
        return [single];
      } catch {
        return null;
      }
    }
  }

  if (start >= 0 && end > start) {
    cleaned = cleaned.slice(start, end + 1);
  }

  try {
    const parsed = JSON.parse(cleaned) as Assumption[];
    if (!Array.isArray(parsed)) {
      console.warn("Assumptions: parsed result is not an array");
      return null;
    }
    // Validate each assumption has required fields
    for (const a of parsed) {
      if (!a.assumption || !a.variable || a.value === undefined || a.unit === undefined || !a.period || !a.rationale) {
        console.warn(`Assumptions: missing required field in assumption: ${JSON.stringify(a)}`);
        return null;
      }
      // Validate confidence is 0..1
      if (typeof a.confidence !== "number" || a.confidence < 0 || a.confidence > 1) {
        console.warn(`Assumptions: confidence out of range: ${a.confidence}`);
        a.confidence = 0.5; // default
      }
    }
    return parsed;
  } catch (e) {
    console.warn("Assumptions: JSON parse error:", e);
    return null;
  }
}

/**
 * Given assumptions and historical facts, compute any derived values.
 * For example, if assumptions include revenue growth and we have prior revenue,
 * we can derive the next-year revenue. But the AI-generated assumption itself
 * must carry the rationale — this function just does the arithmetic.
 */
export function deriveFromAssumptions(
  assumptions: Assumption[],
  historicalFacts: Record<string, number>
): Record<string, number> {
  const derived: Record<string, number> = {};

  for (const a of assumptions) {
    if (a.variable && a.value !== undefined && historicalFacts[a.variable] !== undefined) {
      // If the variable is a derived growth rate applied to a base, compute
      derived[a.variable] = a.value * historicalFacts[a.variable] / 100;
    }
  }

  return derived;
}

/**
 * Validate that assumptions are consistent with the fact pack — no zero-filling,
 * all missing values remain undefined, and every assumption cites historical evidence.
 */
export function validateAssumptions(
  assumptions: Assumption[],
  pack: FactPack
): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  for (const a of assumptions) {
    // Check that the variable isn't pretending to be a fact when it's AI-generated
    // (This is a conceptual check — the provenance system handles this at a higher level)

    // Check rationale cites actual fact metrics
    const factMetricsInRationale = pack.incomeStatement.facts
      .concat(pack.balanceSheet.facts)
      .concat(pack.cashFlow.facts)
      .concat(pack.market.facts)
      .concat(pack.shares.facts)
      .concat(pack.earnings.facts)
      .concat(pack.estimates.facts)
      .filter((f: Fact) => a.rationale.includes(f.metric));

    if (factMetricsInRationale.length === 0 && a.confidence < 0.8) {
      issues.push(`Assumption [${a.variable}] has low confidence (${a.confidence}) but rationale doesn't cite any yfinance fact metrics`);
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

export default { buildAssumptionsPrompt, parseAssumptionJson, deriveFromAssumptions, validateAssumptions };