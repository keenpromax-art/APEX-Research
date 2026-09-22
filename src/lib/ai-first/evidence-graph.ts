/**
 * APEX RESEARCH — CLAIM → EVIDENCE GRAPH + SOURCE HIERARCHY
 *
 * Every narrative sentence is a CLAIM linked to evidence.
 * Prevents drift: writer cannot invent thesis without evidence chain.
 *
 * Source hierarchy (audit §17):
 * Tier1 filing/regulator/government/exchange
 * Tier2 presentation/earnings call
 * Tier3 broker/industry research
 * Tier4 database (yfinance)
 * Tier5 news/web
 * Tier6 AI inference
 *
 * Rule: Never present Tier6 as Tier1.
 */

export type EvidenceTier = 1 | 2 | 3 | 4 | 5 | 6;

export interface Evidence {
  id: string; // F-001 etc or A-001 model assumption
  tier: EvidenceTier;
  source: string;
  factId?: string; // [F-metric]
  quote?: string;
  period?: string;
}

export interface ClaimNode {
  id: string; // C-042
  claim: string;
  evidenceIds: string[]; // links to Evidence.id
  mechanism: string; // why claim holds
  confidence: number; // 0..1
  counterEvidenceIds: string[];
  status: "SUPPORTED" | "SUPPORTED_WITH_RISK" | "CONTRADICTED" | "INSUFFICIENT_EVIDENCE";
}

export interface EvidenceGraph {
  evidences: Evidence[];
  claims: ClaimNode[];
}

export function tierLabel(t: EvidenceTier): string {
  return ({ 1: "Tier1 filing/regulator", 2: "Tier2 presentation/call", 3: "Tier3 broker/industry", 4: "Tier4 yfinance/database", 5: "Tier5 news/web", 6: "Tier6 AI inference" } as Record<EvidenceTier, string>)[t];
}

export function buildEvidenceTableFromPack(
  evidenceLines: string[],
  assumptionIds: string[] = []
): Evidence[] {
  const out: Evidence[] = [];
  for (const line of evidenceLines) {
    const m = line.match(/\[F-([^\]]+)\]/);
    const id = m ? `F-${m[1]}` : `E-${out.length + 1}`;
    out.push({ id, tier: 4, source: "yfinance", factId: m ? m[0] : undefined, quote: line.slice(0, 200) });
  }
  for (const a of assumptionIds) out.push({ id: a, tier: 6, source: "AI model assumption" });
  // placeholders for filings that yfinance cannot supply — mark as Tier6 until supplied
  return out;
}

export function validateClaimTiers(graph: EvidenceGraph): Array<{ claimId: string; issue: string }> {
  const issues: Array<{ claimId: string; issue: string }> = [];
  const evById = new Map(graph.evidences.map((e) => [e.id, e]));
  for (const c of graph.claims) {
    const tiers = c.evidenceIds.map((id) => evById.get(id)?.tier ?? 6);
    const hasHighTier = tiers.some((t) => t <= 4);
    const allInference = tiers.every((t) => t === 6);
    if (allInference && c.confidence > 0.6) {
      issues.push({ claimId: c.id, issue: `Claim "${c.claim.slice(0, 60)}" confidence ${c.confidence} built only on Tier6 inference — downgrade or add Tier1-4 evidence.` });
    }
    if (!hasHighTier && c.status === "SUPPORTED") {
      issues.push({ claimId: c.id, issue: `SUPPORTED claim without Tier1-4 evidence — mark INSUFFICIENT_EVIDENCE or SUPPORTED_WITH_RISK.` });
    }
  }
  return issues;
}

export function renderEvidenceGraph(graph: EvidenceGraph): string {
  const lines: string[] = ["EVIDENCE GRAPH", `Evidences: ${graph.evidences.length} | Claims: ${graph.claims.length}`, ""];
  for (const e of graph.evidences.slice(0, 40)) lines.push(`- ${e.id} [${tierLabel(e.tier)}] ${e.quote || e.source}`);
  lines.push("");
  for (const c of graph.claims) lines.push(`CLAIM ${c.id} [${c.status} conf ${c.confidence}] ${c.claim} — via ${c.evidenceIds.join(", ")} | mechanism: ${c.mechanism}`);
  return lines.join("\n");
}

export default { buildEvidenceTableFromPack, validateClaimTiers, renderEvidenceGraph };
