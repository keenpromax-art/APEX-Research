import type { EvidenceRegistry } from "@/lib/evidence-registry";
import type { CanonicalFactGraph } from "@/lib/canonical-facts";
import type { ResearchReport } from "@/lib/ai-first/types";
import type {
  EvidenceProfile,
  IdentityAssertionStatus,
  IdentityAvailability,
  IdentityEvidenceKind,
  IdentityEvidenceReference,
  IdentityReferenceInput,
  ResearchIdentitySource,
} from "./types";

export interface ResearchIdentityReferenceIndex {
  ticker: string;
  registryTiers: Map<string, { tier: string; source: string }>;
  canonicalIds: Set<string>;
  aiFactIds: Set<string>;
  derivedIds: Set<string>;
  missingCanonicalFields: string[];
}

const CANONICAL_YEAR_FIELDS = [
  "revenue",
  "netIncome",
  "operatingIncome",
  "operatingCashFlow",
  "capitalExpenditures",
  "freeCashFlow",
  "currentAssets",
  "currentLiabilities",
  "netWorkingCapital",
  "totalAssets",
  "totalLiabilities",
  "totalEquity",
  "totalDebt",
  "cash",
  "sharesOutstanding",
  "netInterestIncome",
  "nonInterestIncome",
  "totalRevenue",
  "provisionForCreditLosses",
  "nonInterestExpenses",
  "loans",
  "deposits",
  "grossNPA",
  "netNPA",
  "capitalAdequacyRatio",
  "netInterestMargin",
  "grossWrittenPremium",
  "netEarnedPremium",
  "underwritingResult",
  "combinedRatio",
  "investmentIncome",
  "float",
  "rentalIncome",
  "netOperatingIncome",
  "fundsFromOperations",
  "adjustedFundsFromOperations",
  "occupancyPct",
  "netAssetValue",
  "aumEnding",
  "totalFeeRevenue",
  "operatingMargin",
];

function canonicalId(ticker: string, field: string, period: string): string {
  return `canonical:${ticker.toUpperCase()}:${field}:${period}`;
}

function addCanonicalFacts(index: ResearchIdentityReferenceIndex, facts: CanonicalFactGraph | null): void {
  if (!facts) return;
  const market = facts.market;
  if (market?.price?.value !== null && market.price.confidence !== "none") {
    index.canonicalIds.add(canonicalId(index.ticker, "currentPrice", market.asOf || facts.asOf));
  }
  if (market?.sharesBasic?.value !== null && market.sharesBasic.confidence !== "none") {
    index.canonicalIds.add(canonicalId(index.ticker, "sharesOutstanding", market.asOf || facts.asOf));
  }
  if (market?.marketCap?.value !== null && market.marketCap.confidence !== "none") {
    index.canonicalIds.add(canonicalId(index.ticker, "marketCap", market.asOf || facts.asOf));
  }
  for (const year of facts.years ?? []) {
    const period = year.fiscalPeriod || year.year;
    for (const field of CANONICAL_YEAR_FIELDS) {
      const fact = (year as unknown as Record<string, { value?: number | null; confidence?: string }>)[field];
      if (fact && fact.value !== null && fact.value !== undefined && fact.confidence !== "none") {
        index.canonicalIds.add(canonicalId(index.ticker, field, period));
      }
    }
  }
}

function collectTextIds(text: string, into: Set<string>): void {
  const matches = text.match(/\[[A-Za-z]-.+?\]/g);
  if (!matches) return;
  for (const match of matches.slice(0, 200)) into.add(match);
}

function addAiFacts(index: ResearchIdentityReferenceIndex, report: ResearchReport | null | undefined): void {
  if (!report) return;
  for (const metric of report.keyMetrics ?? []) {
    if (metric.metric) index.aiFactIds.add(`[F-${metric.metric}]`);
  }
  const engine = report.economicEngine;
  const drivers = engine
    ? [
        ...engine.revenueDrivers,
        ...engine.costDrivers,
        ...engine.marginDrivers,
        ...engine.cashDrivers,
        ...engine.balanceSheetDrivers,
        ...engine.capitalDrivers,
        ...engine.returnsDrivers,
      ]
    : [];
  for (const driver of drivers) {
    for (const id of driver.sourceFacts ?? []) {
      if (id) index.aiFactIds.add(id.startsWith("[") ? id : `[F-${id}]`);
    }
  }
  for (const item of report.evidenceMap?.items ?? []) {
    for (const id of item.factIds ?? []) index.aiFactIds.add(id);
  }
  for (const debate of report.debates ?? []) {
    for (const side of [...debate.evidenceFor, ...debate.evidenceAgainst]) {
      for (const id of side.factIds ?? []) index.aiFactIds.add(id);
    }
  }
  const prose = [
    report.companyUnderstanding?.whatItDoes ?? "",
    report.companyUnderstanding?.howItMakesMoney ?? "",
    report.companyUnderstanding?.industryContext ?? "",
    report.thesis?.thesis ?? "",
    report.conclusion ?? "",
  ].join("\n");
  collectTextIds(prose, index.aiFactIds);
}

function addDerivedIds(index: ResearchIdentityReferenceIndex, source: ResearchIdentitySource): void {
  const rc = source.researchCase;
  index.derivedIds.add(`derived:${index.ticker}:research:complexity`);
  index.derivedIds.add(`derived:${index.ticker}:research:peer-gate`);
  index.derivedIds.add(`derived:${index.ticker}:research:ontology`);
  if (rc.assumptionsLedger || rc.valuation) index.derivedIds.add(`derived:${index.ticker}:valuation:anchors`);
  if (rc.valuation?.reverseDCF) index.derivedIds.add(`derived:${index.ticker}:valuation:reverse-dcf`);
  if (rc.valuation?.sotpBreakdown) index.derivedIds.add(`derived:${index.ticker}:valuation:segments`);
  if (source.researchReport?.reverseValuation) index.derivedIds.add(`derived:${index.ticker}:valuation:ai-reverse`);
}

export function indexResearchReferences(source: ResearchIdentitySource): ResearchIdentityReferenceIndex {
  const ticker = source.researchCase.company.ticker || "UNKNOWN";
  const index: ResearchIdentityReferenceIndex = {
    ticker,
    registryTiers: new Map(),
    canonicalIds: new Set(),
    aiFactIds: new Set(),
    derivedIds: new Set(),
    missingCanonicalFields: [...(source.researchCase.dataQuality?.missingCanonicalFields ?? [])],
  };
  const registry: EvidenceRegistry | null = source.researchCase.evidence;
  for (const item of registry?.items ?? []) {
    if (item?.id) index.registryTiers.set(item.id, { tier: item.tier, source: item.source });
  }
  addCanonicalFacts(index, source.researchCase.canonicalFacts);
  addAiFacts(index, source.researchReport);
  addDerivedIds(index, source);
  return index;
}

function referenceConfidence(input: IdentityReferenceInput, status: IdentityAssertionStatus): number {
  if (status !== "supported") return status === "conflicted" ? 0.35 : 0.2;
  if (input.kind === "evidence-registry") {
    const tier = String(input.tier ?? "").toUpperCase();
    if (tier.includes("PRIMARY")) return 0.95;
    if (tier.includes("SECONDARY")) return 0.8;
    if (tier.includes("TERTIARY")) return 0.55;
    return 0.65;
  }
  if (input.kind === "canonical-fact") return 0.85;
  if (input.kind === "derived-calculation") return 0.7;
  if (input.kind === "ai-fact") return 0.5;
  return 0.2;
}

export function makeEvidenceReference(
  input: IdentityReferenceInput,
  index: ResearchIdentityReferenceIndex
): IdentityEvidenceReference {
  const id = input.id.trim();
  let status: IdentityAssertionStatus = "insufficient_evidence";
  let kind: IdentityEvidenceKind = input.kind ?? "insufficient-evidence";
  let tier: IdentityEvidenceReference["tier"] = input.tier as IdentityEvidenceReference["tier"];
  let source = input.source;
  if (index.registryTiers.has(id)) {
    status = "supported";
    kind = "evidence-registry";
    const hit = index.registryTiers.get(id);
    tier = (tier ?? hit?.tier) as IdentityEvidenceReference["tier"];
    source = source ?? hit?.source;
  } else if (index.canonicalIds.has(id)) {
    status = "supported";
    kind = "canonical-fact";
    source = source ?? "Canonical fact graph";
  } else if (index.derivedIds.has(id)) {
    status = "supported";
    kind = "derived-calculation";
    source = source ?? "Deterministic research derivation";
  } else if ((input.kind === "ai-fact" || id.startsWith("[F-")) && index.aiFactIds.has(id)) {
    status = "supported";
    kind = "ai-fact";
    source = source ?? "AI research evidence";
  }
  return {
    id,
    kind,
    status,
    tier,
    source,
    path: input.path,
    confidence: referenceConfidence({ ...input, kind, tier }, status),
  };
}

export function makeEvidenceReferences(
  inputs: IdentityReferenceInput[],
  index: ResearchIdentityReferenceIndex,
  limit = 12
): IdentityEvidenceReference[] {
  const out: IdentityEvidenceReference[] = [];
  const seen = new Set<string>();
  for (const input of inputs) {
    if (!input?.id || out.length >= limit) continue;
    const key = `${input.kind ?? "auto"}:${input.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(makeEvidenceReference(input, index));
  }
  return out;
}

export function supportedReferences(references: IdentityEvidenceReference[]): IdentityEvidenceReference[] {
  return references.filter((r) => r.status === "supported");
}

export function referenceCoverage(references: IdentityEvidenceReference[]): number {
  if (references.length === 0) return 0;
  return supportedReferences(references).length / references.length;
}

export function buildEvidenceProfile(
  source: ResearchIdentitySource,
  index: ResearchIdentityReferenceIndex
): EvidenceProfile {
  const registryItems = source.researchCase.evidence?.items ?? [];
  let primaryItems = 0;
  let secondaryItems = 0;
  let tertiaryItems = 0;
  let modelDerivedItems = 0;
  for (const item of registryItems) {
    if (item.tier === "PRIMARY") primaryItems += 1;
    else if (item.tier === "SECONDARY") secondaryItems += 1;
    else if (item.tier === "TERTIARY") tertiaryItems += 1;
    else modelDerivedItems += 1;
  }
  const aiFactItems = index.aiFactIds.size;
  const missingFields = [...new Set(index.missingCanonicalFields)].slice(0, 40);
  const unknownCount = source.researchCase.unknowns?.length ?? 0;
  const canonicalAvailable = index.canonicalIds.size > 0;
  const registryAvailable = registryItems.length > 0;
  const coverageScore = Math.max(
    0,
    Math.min(
      1,
      registryItems.length / 24 + index.canonicalIds.size / 80 + aiFactItems / 80 - missingFields.length / 80
    )
  );
  const confidence = Math.max(
    0,
    Math.min(1, primaryItems / 8 + secondaryItems / 24 + (canonicalAvailable ? 0.35 : 0) + (aiFactItems > 0 ? 0.15 : 0))
  );
  let status: IdentityAvailability = "unavailable";
  if (registryAvailable && canonicalAvailable) status = "available";
  else if (registryAvailable || canonicalAvailable || aiFactItems > 0) status = "insufficient";
  return {
    status,
    registryItems: registryItems.length,
    aiFactItems,
    primaryItems,
    secondaryItems,
    tertiaryItems,
    modelDerivedItems,
    missingFields,
    unknownCount,
    coverageScore: Math.round(coverageScore * 1000) / 1000,
    confidence: Math.round(confidence * 1000) / 1000,
  };
}
