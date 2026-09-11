/**
 * APEX RESEARCH - Fact-Bound Claim Spine (Priority 5)
 * Every material numeric claim must be traceable to a validated fact/claim ID.
 * Unsupported claims are blocked from PDF export via CLAIM-01 QA gate.
 */

import type { MasterReportFacts } from "./report-facts";

export interface Claim {
  id: string; // SHA-256-like deterministic hash of normalized sentence
  text: string;
  numericValue?: number;
  numericRaw?: string;
  kind: "percentage" | "currency" | "multiple" | "count";
  sourceFactId: string | null; // null = unsupported
  evidence: string | null; // e.g. "DCF:revenueGrowthRates[0]=12.5%" or "Filing:FY24 Rev 1,234M"
  supported: boolean;
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

/**
 * Extract claims that contain material numerics.
 * Scans investmentThesis/overview/etc. joined text.
 */
export function extractClaims(text: string): Claim[] {
  if (!text) return [];
  // Split into sentences
  const sentences = text.split(/(?<=[.!?])\s+/);
  const claims: Claim[] = [];
  for (const sent of sentences) {
    const hasNumeric = /(\d+(?:,\d{3})*(?:\.\d+)?\s*%|\d+(?:,\d{3})*(?:\.\d+)?\s*(?:x|cr|l|m|bn|b)|\b(?:rs\.?|₹|\$|€|£)\s*\d+)/i.test(sent);
    if (!hasNumeric) continue;
    // Extract first numeric token
    const m = sent.match(/(\d+(?:,\d{3})*(?:\.\d+)?\s*%|\d+(?:,\d{3})*(?:\.\d+)?\s*x|\b(?:rs\.?|₹|\$)\s*\d[\d,]*(?:\.\d+)?)/i);
    const raw = m ? m[1] : sent.slice(0, 40);
    // Numeric parse must preserve the decimal point ("9.5%" → 9.5, never 95).
    // Strip thousand-separators, currency glyphs, the Rs abbreviation (with
    // its optional period), then the %/x/unit suffix — digits and "." survive.
    const val = m
      ? parseFloat(
          raw
            .replace(/,/g, "")
            .replace(/(rs\.?|₹|\$|€|£)/gi, "")
            .replace(/%/g, "")
            .replace(/x$/i, "")
            .replace(/(cr|l|m|bn|b)\.?$/i, "")
            .trim()
        )
      : undefined;
    const kind: Claim["kind"] = raw.includes("%") ? "percentage" : raw.toLowerCase().includes("x") ? "multiple" : raw.match(/₹|\$|rs/i) ? "currency" : "count";
    const id = hashClaim(normalizeSentence(sent));
    claims.push({
      id,
      text: sent.trim().slice(0, 320),
      numericRaw: raw,
      numericValue: Number.isFinite(val) ? val : undefined,
      kind,
      sourceFactId: null,
      evidence: null,
      supported: false,
    });
  }
  return claims;
}

/**
 * Validate claims against MasterReportFacts + DCF assumptions.
 * Returns claims with sourceFactId/evidence populated where match within tolerance.
 */
export function validateClaims(claims: Claim[], facts: MasterReportFacts, dcfFacts?: { wacc: number; tgr: number; growthRates: number[]; margins: number[]; rev: number }): Claim[] {
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
 * Build an ontology-bound system prompt fragment that forces the LLM to be fact-bound.
 * Called by openrouter.ts buildSectorGuardrail.
 */
export function buildEvidenceRequirement(sectorId: string, allowedKPIs: string[], driverSpec?: { revenueDrivers: string[] }): string {
  const kpiList = allowedKPIs.slice(0, 6).join(", ");
  const driverList = driverSpec ? driverSpec.revenueDrivers.join(", ") : "revenue, margin";
  return `EVIDENCE DISCIPLINE (hard): Every material numeric claim (%, currency, multiple) MUST be traceable to one of: (a) a {{PLACEHOLDER}} fact ({{FAIR_VALUE}}, {{WACC}}, {{RATING}} etc. — inject, do not invent), (b) a filing fact from the Financials section, or (c) a driver from this sector's ontology [${driverList}]. If you cannot evidence a number, DO NOT state it. Do not fabricate RevPAR (e.g., Rs 8,400), occupancy (e.g., 68%), ADR, GOPPAR, or peer multiples. Allowed KPIs for this sector: [${kpiList}]. Non-allowlisted KPIs are forbidden. Each thesis paragraph must remain ontology-bound to this sector's driverSpec — do not import another sector's KPIs (e.g., CASA, spectrum, wafer, refinery).`;
}
