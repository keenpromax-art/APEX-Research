import type { CollisionReport, ResearchDNA, SimilarityScore } from "./types";

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).filter((k) => k !== "debug").sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(",")}}`;
}

function fnv1a(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalizeStructure(text: string, dna: ResearchDNA): string {
  let out = text.toLowerCase();
  out = out.split(dna.ticker.toLowerCase()).join("company");
  const name = dna.cover.title.toLowerCase();
  if (name.length > 3) out = out.split(name).join("company");
  return out.replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function tokens(text: string): string[] {
  return [...new Set(text.split(" ").filter((w) => w.length > 2))];
}

function jaccard(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  const intersection = [...setA].filter((x) => setB.has(x)).length;
  return intersection / new Set([...setA, ...setB]).size;
}

function orderSimilarity(a: string[], b: string[]): number {
  const common = a.filter((id) => b.includes(id));
  if (common.length < 2) return jaccard(a, b);
  const rankB = new Map(b.map((id, position) => [id, position] as const));
  let concordant = 0;
  let discordant = 0;
  for (let i = 0; i < common.length; i++) {
    for (let j = i + 1; j < common.length; j++) {
      const first = rankB.get(common[i]) ?? 0;
      const second = rankB.get(common[j]) ?? 0;
      if (first < second) concordant += 1;
      else if (first > second) discordant += 1;
    }
  }
  return concordant + discordant === 0 ? 1 : concordant / (concordant + discordant);
}

function profileVector(dna: ResearchDNA): number[] {
  const n = dna.narrativeProfile;
  return [
    n.fundamentalIntensity,
    n.valuationIntensity,
    n.forensicIntensity,
    n.strategicIntensity,
    n.eventIntensity,
    n.creditIntensity,
    n.quantitativeDensity,
    n.skepticism,
    n.evidenceRequirement,
    n.scenarioEmphasis,
    n.managementWeight,
    n.archetype === "compounder" ? 1 : 0,
    n.archetype === "growth" ? 1 : 0,
    n.archetype === "forensic" ? 1 : 0,
  ];
}

function profileSimilarity(a: ResearchDNA, b: ResearchDNA): number {
  const va = profileVector(a);
  const vb = profileVector(b);
  const dot = va.reduce((sum, v, i) => sum + v * vb[i], 0);
  const na = Math.sqrt(va.reduce((sum, v) => sum + v * v, 0));
  const normB = Math.sqrt(vb.reduce((sum, v) => sum + v * v, 0));
  if (na === 0 || normB === 0) return 0;
  const cosine = dot / (na * normB);
  const archetypeBonus = a.narrativeProfile.archetype === b.narrativeProfile.archetype ? 0.08 : 0;
  return Math.max(0, Math.min(1, cosine * 0.92 + archetypeBonus));
}

export function fingerprintResearchDNA(dna: ResearchDNA): string {
  const structural = {
    version: dna.version,
    economicType: dna.economicIdentity.type,
    questionType: dna.investorQuestion.type,
    materiality: dna.materiality.assessments.map((a) => `${a.topicId}:${a.tier}:${a.depth}`),
    sections: dna.sections.sections.filter((s) => s.include).map((s) => s.sectionId),
    signatures: dna.signatureAnalyses.map((s) => s.type),
    charts: dna.charts.selected.map((c) => c.id),
    tables: dna.tables.selected.map((t) => t.id),
    narrative: dna.narrativeProfile.archetype,
    visual: dna.visualProfile.archetype,
    cover: dna.visualProfile.coverStructure,
    title: normalizeStructure(dna.cover.title, dna),
  };
  return `rid-${fnv1a(stableStringify(structural))}`;
}

export function compareResearchIdentities(current: ResearchDNA, prior: ResearchDNA): SimilarityScore {
  const currentSections = current.sections.sections.filter((s) => s.include).map((s) => s.sectionId);
  const priorSections = prior.sections.sections.filter((s) => s.include).map((s) => s.sectionId);
  const sectionOrderSimilarity = orderSimilarity(currentSections, priorSections);
  const chartSimilarity = jaccard(current.charts.selected.map((c) => c.id), prior.charts.selected.map((c) => c.id));
  const tableSimilarity = jaccard(current.tables.selected.map((t) => t.id), prior.tables.selected.map((t) => t.id));
  const profile = profileSimilarity(current, prior);
  const titleSimilarity = jaccard(tokens(normalizeStructure(current.cover.title, current)), tokens(normalizeStructure(prior.cover.title, prior)));
  const overall = Math.round(
    (sectionOrderSimilarity * 0.32 + chartSimilarity * 0.22 + tableSimilarity * 0.18 + profile * 0.18 + titleSimilarity * 0.1) * 1000
  ) / 1000;
  return {
    fingerprint: prior.identityId,
    sectionOrderSimilarity: Math.round(sectionOrderSimilarity * 1000) / 1000,
    chartSimilarity: Math.round(chartSimilarity * 1000) / 1000,
    tableSimilarity: Math.round(tableSimilarity * 1000) / 1000,
    profileSimilarity: Math.round(profile * 1000) / 1000,
    titleSimilarity: Math.round(titleSimilarity * 1000) / 1000,
    overall,
  };
}

export function detectCollisions(current: ResearchDNA, priors: ResearchDNA[] = []): CollisionReport {
  const comparisons = priors.filter((p) => p.identityId !== current.identityId && p.ticker !== current.ticker);
  if (comparisons.length === 0) {
    return {
      status: "clear",
      comparisons: 0,
      maximumSimilarity: 0,
      averageSimilarity: 0,
      reasons: ["No comparable prior research identity was supplied."],
      fingerprint: fingerprintResearchDNA(current),
    };
  }
  const scores = comparisons.map((prior) => compareResearchIdentities(current, prior));
  const maximumSimilarity = Math.max(...scores.map((s) => s.overall));
  const averageSimilarity = scores.reduce((sum, s) => sum + s.overall, 0) / scores.length;
  const status = maximumSimilarity >= 0.92 ? "template-collision" : maximumSimilarity >= 0.78 ? "watch" : "clear";
  const reasons: string[] = [];
  const worst = scores.find((s) => s.overall === maximumSimilarity);
  if (status === "template-collision") {
    reasons.push(`Unrelated-company template similarity ${maximumSimilarity} exceeds the 0.92 collision threshold.`);
  } else if (status === "watch") {
    reasons.push(`Cross-company similarity ${maximumSimilarity} is elevated; verify that shared structure is research-driven.`);
  } else {
    reasons.push(`Maximum cross-company similarity ${maximumSimilarity} is below the watch threshold.`);
  }
  if (worst) reasons.push(`Closest prior identity: ${worst.fingerprint}.`);
  return {
    status,
    comparisons: comparisons.length,
    maximumSimilarity: Math.round(maximumSimilarity * 1000) / 1000,
    averageSimilarity: Math.round(averageSimilarity * 1000) / 1000,
    reasons,
    fingerprint: fingerprintResearchDNA(current),
  };
}
