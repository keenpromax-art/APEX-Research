import { createStableId, stableHash } from "@/lib/research-ledger/stable";
import { deepFreeze, isDeeplyFrozen } from "@/lib/research-ledger/immutable";
import type { Fact, FactPack } from "@/lib/ai-first/types";
import type {
  CanonicalEvidenceConflict,
  CanonicalEvidenceItem,
  CanonicalEvidenceRegistry,
  CanonicalEvidenceRestatement,
  CanonicalEvidenceTier,
  ResearchDocument,
  ResearchDocumentEvidence,
  ResearchRetrievalResult,
  ResearchRetrievalSourceType,
} from "./types";

export const CANONICAL_EVIDENCE_REGISTRY_VERSION = "canonical-evidence-registry-v1" as const;

const HIERARCHY: readonly CanonicalEvidenceTier[] = Object.freeze([
  Object.freeze({ rank: 0, tier: "PRIMARY", sourceTypes: Object.freeze(["annual_report", "quarterly_report", "exchange_filing", "regulatory_filing", "government_regulator", "investor_presentation", "earnings_call", "company_website"] as const) }),
  Object.freeze({ rank: 1, tier: "SECONDARY", sourceTypes: Object.freeze(["market_data", "secondary_database"] as const) }),
  Object.freeze({ rank: 2, tier: "TERTIARY", sourceTypes: Object.freeze(["news"] as const) }),
  Object.freeze({ rank: 3, tier: "MODEL_DERIVED", sourceTypes: Object.freeze([] as const) }),
  Object.freeze({ rank: 4, tier: "UNKNOWN", sourceTypes: Object.freeze(["unknown"] as const) }),
]);
const SOURCE_TIER_RANK: Readonly<Record<CanonicalEvidenceTier["tier"], number>> = Object.freeze({ PRIMARY: 0, SECONDARY: 1, TERTIARY: 2, MODEL_DERIVED: 3, UNKNOWN: 4 });

function requiredText(value: unknown, field: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new TypeError(`${field} must be a non-empty string`);
  return normalized;
}

function sourceTypeFromFact(fact: Fact): ResearchRetrievalSourceType {
  const value = String(fact.sourceMetadata?.type ?? fact.source ?? "unknown").toLowerCase();
  if (value === "market_data_provider") return "market_data";
  if (value === "model_derived") return "secondary_database";
  if (value === "secondary_database") return "secondary_database";
  if (value === "annual_report") return "annual_report";
  if (value === "exchange_filing") return "exchange_filing";
  if (value === "regulatory_filing") return "regulatory_filing";
  if (value === "investor_presentation") return "investor_presentation";
  if (value === "earnings_call") return "earnings_call";
  if (value === "government_regulator") return "government_regulator";
  if (value === "company_website") return "company_website";
  if (value === "news") return "news";
  return "unknown";
}

function tierFor(sourceType: ResearchRetrievalSourceType, fact?: Fact): CanonicalEvidenceTier {
  if (fact?.source === "derived") return HIERARCHY[3]!;
  return HIERARCHY.find((entry) => entry.sourceTypes.includes(sourceType)) ?? HIERARCHY[4]!;
}

function authorityForTier(tier: CanonicalEvidenceTier["tier"]): CanonicalEvidenceItem["authority"] {
  return tier === "PRIMARY" ? "primary" : tier === "SECONDARY" ? "secondary" : tier === "TERTIARY" ? "tertiary" : tier === "MODEL_DERIVED" ? "model_derived" : "unknown";
}

function roleForTier(tier: CanonicalEvidenceTier["tier"]): CanonicalEvidenceItem["valueRole"] {
  return tier === "PRIMARY" ? "reported_fact" : tier === "SECONDARY" ? "market_observation" : tier === "TERTIARY" ? "context" : tier === "MODEL_DERIVED" ? "consensus_estimate" : "unknown";
}

function periodOf(item: { period?: string; asOf?: string; fiscalPeriod?: string }): string | undefined {
  return item.period ?? item.fiscalPeriod ?? item.asOf;
}

function valueOf(item: { value?: number | string; textValue?: string }): number | string | undefined {
  if (typeof item.value === "number" && Number.isFinite(item.value)) return item.value;
  if (typeof item.value === "string" && item.value.trim()) return item.value.trim();
  if (typeof item.textValue === "string" && item.textValue.trim()) return item.textValue.trim();
  return undefined;
}

function factEvidence(fact: Fact): CanonicalEvidenceItem | null {
  const value = valueOf(fact);
  if (value === undefined) return null;
  const sourceType = sourceTypeFromFact(fact);
  const tier = tierFor(sourceType, fact);
  const period = periodOf(fact);
  const id = createStableId("EV", { factId: fact.factId ?? `${fact.ticker}:${fact.metric}:${fact.period}`, field: fact.metric, period: period ?? null }, "research-retrieval/canonical-evidence/v1");
  return {
    id,
    field: requiredText(fact.metric, "fact.metric"),
    value,
    ...(fact.unit ? { unit: fact.unit } : {}),
    ...(fact.currency ? { currency: fact.currency } : {}),
    ...(period ? { period } : {}),
    ...(fact.asOfDate ? { asOf: fact.asOfDate } : {}),
    tier: tier.tier,
    rank: tier.rank,
    sourceId: fact.sourceId ?? fact.sourceMetadata?.sourceId ?? "unknown",
    source: fact.sourceMetadata?.provider ?? fact.sourceId ?? "unknown",
    sourceType,
    authority: authorityForTier(tier.tier),
    valueRole: roleForTier(tier.tier),
    ...(fact.sourceMetadata?.documentId ? { sourceDocumentId: fact.sourceMetadata.documentId } : {}),
    ...(fact.factId ? { factId: fact.factId } : {}),
    observationId: createStableId("OBS", { factId: fact.factId ?? id, sourceId: fact.sourceId ?? "unknown" }, "research-retrieval/observation/v1"),
    ...(fact.sourceMetadata?.locator ? { locator: fact.sourceMetadata.locator } : {}),
    restated: fact.restated === true,
    ...(fact.normalization ? { metadata: { normalization: fact.normalization } } : { metadata: {} }),
  };
}

function evidenceValue(entry: ResearchDocumentEvidence): number | string | undefined {
  if ("value" in entry) return typeof entry.value === "number" && Number.isFinite(entry.value) ? entry.value : typeof entry.value === "string" ? entry.value : undefined;
  if ("statement" in entry) return entry.statement;
  if ("text" in entry) return entry.text;
  return undefined;
}

function documentEvidence(entry: ResearchDocumentEvidence, document: ResearchDocument): CanonicalEvidenceItem | null {
  if (entry.status === "quarantined") return null;
  const value = evidenceValue(entry);
  if (value === undefined || value === "") return null;
  const field = "field" in entry ? entry.field : "statement";
  const sourceType = document.sourceType;
  const tier = tierFor(sourceType);
  const period = "period" in entry ? entry.period : document.publication.asOfDate;
  const id = createStableId("EV", { evidenceId: entry.id, documentId: document.documentId, field, period: period ?? null }, "research-retrieval/canonical-evidence/v1");
  return {
    id,
    field,
    value,
    ...("unit" in entry && entry.unit ? { unit: entry.unit } : {}),
    ...(period ? { period } : {}),
    ...(entry.asOf ?? document.publication.asOfDate ? { asOf: entry.asOf ?? document.publication.asOfDate } : {}),
    tier: tier.tier,
    rank: tier.rank,
    sourceId: document.sourceId,
    source: document.sourceMetadata.provider,
    sourceType,
    authority: authorityForTier(tier.tier),
    valueRole: roleForTier(tier.tier),
    sourceDocumentId: document.documentId,
    observationId: createStableId("OBS", { documentId: document.documentId, evidenceId: entry.id }, "research-retrieval/observation/v1"),
    locator: "spanId" in entry ? entry.spanId : undefined,
    excerpt: (entry as { text?: string; statement?: string }).text ?? (entry as { statement?: string }).statement,
    restated: false,
    metadata: {
      evidenceKind: "numeric" in entry ? "numeric" : "table" in entry ? "table" : "statement",
      quarantined: false,
    },
  };
}

function rankFor(item: CanonicalEvidenceItem): number {
  return item.rank;
}

function compareSelection(left: CanonicalEvidenceItem, right: CanonicalEvidenceItem): number {
  return rankFor(left) - rankFor(right)
    || String(right.asOf ?? "").localeCompare(String(left.asOf ?? ""))
    || String(right.restated).localeCompare(String(left.restated))
    || left.id.localeCompare(right.id);
}

function sameValue(left: CanonicalEvidenceItem, right: CanonicalEvidenceItem): boolean {
  return left.value === right.value && String(left.unit ?? "") === String(right.unit ?? "") && String(left.currency ?? "") === String(right.currency ?? "");
}

function conflictId(left: CanonicalEvidenceItem, right: CanonicalEvidenceItem, reason: CanonicalEvidenceConflict["reason"]): string {
  return createStableId("CONFLICT", { left: left.id, right: right.id, reason }, "research-retrieval/evidence-conflict/v1");
}

function buildConflicts(items: readonly CanonicalEvidenceItem[]): { conflicts: CanonicalEvidenceConflict[]; restatements: CanonicalEvidenceRestatement[] } {
  const groups = new Map<string, CanonicalEvidenceItem[]>();
  for (const item of items) {
    const key = `${item.field}|${String(item.period ?? "")}`;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  const conflicts: CanonicalEvidenceConflict[] = [];
  const restatements: CanonicalEvidenceRestatement[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const ordered = [...group].sort(compareSelection);
    const selected = ordered[0];
    if (!selected) continue;
    for (const candidate of ordered.slice(1)) {
      const sourceRestatement = selected.restated || candidate.restated || selected.sourceId === candidate.sourceId;
      if (sameValue(selected, candidate) && !sourceRestatement) continue;
      const reason: CanonicalEvidenceConflict["reason"] = sourceRestatement ? "source_restatement" : selected.currency !== candidate.currency ? "currency_mismatch" : selected.unit !== candidate.unit ? "unit_mismatch" : "value_mismatch";
      const conflict: CanonicalEvidenceConflict = {
        id: conflictId(selected, candidate, reason),
        field: selected.field,
        period: selected.period ?? null,
        existingId: selected.id,
        incomingId: candidate.id,
        selectedId: selected.id,
        selected,
        reason,
        material: true,
        ...(typeof selected.value === "number" && typeof candidate.value === "number" ? { varianceAbs: Math.abs(selected.value - candidate.value), variancePct: selected.value !== 0 ? Math.abs(selected.value - candidate.value) / Math.abs(selected.value) : null } : {}),
        selectedBy: sourceRestatement ? "restatement_recency" : "source_hierarchy",
        existing: selected,
        incoming: candidate,
      };
      conflicts.push(conflict);
      if (sourceRestatement) {
        const prior = selected.restated ? candidate : selected;
        const restated = selected.restated ? selected : candidate;
        restatements.push({
          id: createStableId("RESTATEMENT", { priorId: prior.id, restatedId: restated.id, field: selected.field, period: selected.period ?? "" }, "research-retrieval/restatement/v1"),
          field: selected.field,
          period: selected.period ?? "unknown",
          priorId: prior.id,
          restatedId: restated.id,
          selectedId: selected.id,
          priorValue: prior.value,
          restatedValue: restated.value,
          reason: "A later observation from the same source or an explicit restatement flag superseded the prior value.",
        });
      }
    }
  }
  return {
    conflicts: conflicts.sort((left, right) => left.id.localeCompare(right.id)),
    restatements: restatements.sort((left, right) => left.id.localeCompare(right.id)),
  };
}

export interface BuildCanonicalEvidenceRegistryInput {
  factPack?: FactPack | null;
  sourceDocuments?: readonly ResearchDocument[];
  sourceDocs?: readonly ResearchDocument[];
  documents?: readonly ResearchDocument[];
  retrieval?: ResearchRetrievalResult | null;
  retrievalResult?: ResearchRetrievalResult | null;
  retrievalEvidence?: readonly ResearchDocumentEvidence[];
  asOf?: string;
  diagnostics?: readonly string[];
}

export function buildCanonicalEvidenceRegistry(input: BuildCanonicalEvidenceRegistryInput): CanonicalEvidenceRegistry {
  const retrieval = input.retrieval ?? input.retrievalResult ?? null;
  const asOf = input.asOf ?? retrieval?.asOf ?? input.factPack?.retrievalTimestamp ?? "unknown";
  const items: CanonicalEvidenceItem[] = [];
  const diagnostics = [...(input.diagnostics ?? [])];
  const factSections = input.factPack ? [
    input.factPack.company,
    input.factPack.market,
    input.factPack.incomeStatement,
    input.factPack.balanceSheet,
    input.factPack.cashFlow,
    input.factPack.shares,
    input.factPack.earnings,
    input.factPack.estimates,
    input.factPack.corporateActions,
    input.factPack.priceHistory,
    input.factPack.holders,
    ...(input.factPack.fundamentalsTimeseries ? [input.factPack.fundamentalsTimeseries] : []),
  ] : [];
  for (const factSection of factSections) {
    for (const fact of factSection.facts) {
      const item = factEvidence(fact);
      if (item) items.push(item);
    }
  }
  const documents = [...(input.sourceDocuments ?? []), ...(input.sourceDocs ?? []), ...(input.documents ?? []), ...(retrieval?.documents ?? [])];
  const documentCandidates = [...documents].sort((left, right) => left.documentId.localeCompare(right.documentId) || left.contentHash.localeCompare(right.contentHash));
  const uniqueDocuments = new Map<string, ResearchDocument>();
  for (const document of documentCandidates) if (!uniqueDocuments.has(document.documentId)) uniqueDocuments.set(document.documentId, document);
  for (const document of uniqueDocuments.values()) {
    if (document.status === "failed" || document.status === "unavailable") diagnostics.push(`DOCUMENT_${document.status.toUpperCase()}:${document.documentId}`);
    for (const entry of document.evidence) {
      const item = documentEvidence(entry, document);
      if (item) items.push(item);
    }
  }
  for (const entry of input.retrievalEvidence ?? []) {
    const document = uniqueDocuments.get(entry.documentId);
    if (!document) {
      diagnostics.push(`EVIDENCE_DOCUMENT_MISSING:${entry.id}`);
      continue;
    }
    const item = documentEvidence(entry, document);
    if (item) items.push(item);
  }
  const byId = new Map<string, CanonicalEvidenceItem>();
  for (const item of items) {
    const existing = byId.get(item.id);
    if (!existing || compareSelection(item, existing) < 0) byId.set(item.id, item);
  }
  const sorted = [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
  const { conflicts, restatements } = buildConflicts(sorted);
  const content = { version: CANONICAL_EVIDENCE_REGISTRY_VERSION, asOf, items: sorted, conflicts, restatements, restatementObservations: restatements, sourceHierarchy: HIERARCHY, hierarchy: HIERARCHY, sourceTierRank: SOURCE_TIER_RANK, sourceTierRanks: SOURCE_TIER_RANK, diagnostics: [...new Set(diagnostics)].sort() };
  return deepFreeze({ ...content, contentHash: stableHash(content, "research-retrieval/canonical-evidence-registry/v1") }) as CanonicalEvidenceRegistry;
}

export interface LegacyEvidenceRegistryLike {
  items?: readonly {
    id: string;
    field: string;
    value: number | string;
    unit?: string;
    currency?: string;
    periodCovered?: string;
    fiscalPeriod?: string;
    asOf?: string;
    tier: "PRIMARY" | "SECONDARY" | "TERTIARY" | "MODEL_DERIVED";
    source?: string;
    sourceType?: string;
    sourceId?: string;
    documentId?: string;
    excerpt?: string;
  }[];
  asOf?: string;
}

export function adaptLegacyEvidenceRegistry(registry: LegacyEvidenceRegistryLike, asOf = registry.asOf ?? "unknown"): CanonicalEvidenceRegistry {
  const items = (registry.items ?? []).map((entry): CanonicalEvidenceItem => {
    const tier = entry.tier === "PRIMARY" ? HIERARCHY[0]! : entry.tier === "SECONDARY" ? HIERARCHY[1]! : entry.tier === "TERTIARY" ? HIERARCHY[2]! : HIERARCHY[3]!;
    return {
      id: entry.id,
      field: entry.field,
      value: entry.value,
      ...(entry.unit ? { unit: entry.unit } : {}),
      ...(entry.currency ? { currency: entry.currency } : {}),
      ...(entry.periodCovered ?? entry.fiscalPeriod ? { period: entry.periodCovered ?? entry.fiscalPeriod } : {}),
      ...(entry.asOf ? { asOf: entry.asOf } : {}),
      tier: tier.tier,
      rank: tier.rank,
      sourceId: entry.sourceId ?? entry.source ?? "legacy",
      source: entry.source ?? entry.sourceId ?? "legacy",
      sourceType: entry.tier === "PRIMARY" ? "regulatory_filing" : entry.tier === "SECONDARY" ? "market_data" : entry.tier === "TERTIARY" ? "news" : "secondary_database",
      authority: authorityForTier(tier.tier),
      valueRole: roleForTier(tier.tier),
      ...(entry.documentId ? { sourceDocumentId: entry.documentId } : {}),
      locator: entry.excerpt,
      restated: false,
      metadata: { adaptedFrom: "legacy-evidence-registry" },
    };
  });
  const { conflicts, restatements } = buildConflicts(items);
  const content = { version: CANONICAL_EVIDENCE_REGISTRY_VERSION, asOf, items: items.sort((left, right) => left.id.localeCompare(right.id)), conflicts, restatements, restatementObservations: restatements, sourceHierarchy: HIERARCHY, hierarchy: HIERARCHY, sourceTierRank: SOURCE_TIER_RANK, sourceTierRanks: SOURCE_TIER_RANK, diagnostics: [] as string[] };
  return deepFreeze({ ...content, contentHash: stableHash(content, "research-retrieval/canonical-evidence-registry/v1") }) as CanonicalEvidenceRegistry;
}

export function verifyCanonicalEvidenceRegistry(value: unknown): value is CanonicalEvidenceRegistry {
  if (!value || typeof value !== "object" || !isDeeplyFrozen(value)) return false;
  const registry = value as CanonicalEvidenceRegistry;
  if (registry.version !== "canonical-evidence-registry-v1" || !/^[a-f0-9]{64}$/.test(registry.contentHash)) return false;
  const { contentHash: _contentHash, ...content } = registry;
  return stableHash(content, "research-retrieval/canonical-evidence-registry/v1") === registry.contentHash;
}

export type { CanonicalEvidenceRegistry } from "./types";
export function detectCanonicalEvidenceConflicts(registry: CanonicalEvidenceRegistry): CanonicalEvidenceConflict[] {
  return buildConflicts(registry.items).conflicts;
}

export function listCanonicalEvidenceRestatements(registry: CanonicalEvidenceRegistry): CanonicalEvidenceRestatement[] {
  return buildConflicts(registry.items).restatements;
}

export function selectCanonicalEvidence(items: readonly CanonicalEvidenceItem[]): CanonicalEvidenceItem | null {
  return [...items].sort(compareSelection)[0] ?? null;
}

export const buildEvidenceRegistry = buildCanonicalEvidenceRegistry;
export const createCanonicalEvidenceRegistry = buildCanonicalEvidenceRegistry;
export const evidenceRegistryFromResearch = buildCanonicalEvidenceRegistry;
export const CANONICAL_EVIDENCE_SOURCE_HIERARCHY = HIERARCHY;
export const CANONICAL_SOURCE_TIER_RANK = SOURCE_TIER_RANK;
export { HIERARCHY as CANONICAL_SOURCE_HIERARCHY };
