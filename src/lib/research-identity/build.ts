import { verifyCanonicalSeal } from "@/lib/canonical-facts";
import { getReportBlueprint, resolveReportOutline } from "@/lib/report-types";
import { assessDataAvailability } from "./data-availability";
import { buildDebateMap } from "./debate-map";
import { allocateDepth } from "./depth-allocation";
import { buildEconomicIdentity } from "./economic-identity";
import { buildEventProfile } from "./event-profile";
import { buildEvidenceProfile, indexResearchReferences } from "./evidence-profile";
import { buildInvestorQuestion } from "./investor-question";
import { assessMateriality } from "./materiality";
import { buildNarrativeProfile } from "./narrative-profile";
import { selectSignatureAnalyses } from "./signature-analysis";
import { selectCharts } from "./chart-selection";
import { selectTables } from "./table-selection";
import { buildSectionArchitecture, evaluateReportTypeCompatibility } from "./section-architecture";
import { buildValuationIdentity } from "./valuation-identity";
import { buildVisualProfile } from "./visual-profile";
import { buildCoverSpec } from "./cover";
import { buildPageAllocation } from "./page-allocation";
import { detectCollisions, fingerprintResearchDNA } from "./similarity";
import { RESEARCH_IDENTITY_VERSION, RESEARCH_IDENTITY_MODEL_VERSION } from "./types";
import type { ResearchDNA, ResearchIdentitySource } from "./types";

function fnv1a(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function financialSnapshot(source: ResearchIdentitySource): string {
  const rc = source.researchCase;
  const snapshot = {
    ticker: rc.company.ticker,
    rows: (rc.historicalFinancials ?? []).map((r) => ({ ...r })),
    ledgerFairValue: rc.assumptionsLedger?.fairValue ?? null,
    valuationFairValue: rc.valuation?.fairValuePerShare ?? (rc.valuation as unknown as { fairValue?: number } | null)?.fairValue ?? null,
    rating: rc.assumptionsLedger?.rating ?? null,
  };
  return JSON.stringify(snapshot);
}

function canonicalHash(source: ResearchIdentitySource): string | null {
  const facts = source.researchCase.canonicalFacts;
  if (!facts) return null;
  try {
    const seal = verifyCanonicalSeal(facts);
    return seal.actual ?? null;
  } catch {
    return null;
  }
}

/**
 * buildResearchIdentity — deterministic ResearchCase → ResearchDNA.
 * AI proposals (source.proposal) are advisory only: every asserted evidence
 * id is re-validated against the deterministic reference index, unsupported
 * adjustments are dropped, and canonical financial objects are never mutated.
 * Fails closed: missing data yields explicit unavailable/insufficient states.
 */
export function buildResearchIdentity(source: ResearchIdentitySource): ResearchDNA {
  const snapshotBefore = financialSnapshot(source);
  const sealBefore = source.researchCase.canonicalFacts ? verifyCanonicalSeal(source.researchCase.canonicalFacts) : null;
  const hashBefore = canonicalHash(source);

  const index = indexResearchReferences(source);
  const availability = assessDataAvailability(source, index);
  const economic = buildEconomicIdentity(source, index);
  const question = buildInvestorQuestion(source, index, economic);
  const materialityBase = assessMateriality(source, index, economic, question);
  const debates = buildDebateMap(source, index);
  const valuation = buildValuationIdentity(source, index, economic, materialityBase, debates);
  const evidence = buildEvidenceProfile(source, index);
  const events = buildEventProfile(source, index);
  const signatures = selectSignatureAnalyses(source, index, economic, materialityBase, availability);
  const materiality = allocateDepth({
    materiality: materialityBase,
    complexity: source.researchCase.complexity,
    signatures,
    reportDepth: source.depth,
  });
  const charts = selectCharts(source, index, economic, materiality, signatures, availability);
  const tables = selectTables(source, index, economic, materiality, signatures, availability);
  const narrative = buildNarrativeProfile(source, index, economic, materiality, question, signatures, debates);
  const visual = buildVisualProfile(source, index, economic, materiality, narrative, question, valuation, signatures, charts.selected.length, tables.selected.length);
  const compatibility = evaluateReportTypeCompatibility(source, economic);

  const blueprint = getReportBlueprint(source.reportTypeId);
  const outline = blueprint
    ? resolveReportOutline(blueprint, {
        depth: source.depth,
        researchReport: source.researchReport ?? null,
        hasResearchDebates: Boolean(source.researchReport?.debates?.length),
        researchCaseHasResearch: Boolean(source.researchReport),
      })
    : { blueprintId: source.reportTypeId, depth: source.depth, toc: [], sections: [], moduleIds: [] as never[] };

  const sections = buildSectionArchitecture({
    source,
    index,
    economic,
    materiality,
    question,
    signatures,
    charts,
    tables,
    outline: outline.sections,
    compatibility,
  });

  const chartCounts = new Map<string, number>(charts.selected.map((c) => [c.sectionId ?? "", 0]));
  for (const c of charts.selected) {
    const key = c.sectionId ?? "";
    chartCounts.set(key, (chartCounts.get(key) ?? 0) + 1);
  }
  const tableCounts = new Map<string, number>(tables.selected.map((t) => [t.sectionId ?? "", 0]));
  for (const t of tables.selected) {
    const key = t.sectionId ?? "";
    tableCounts.set(key, (tableCounts.get(key) ?? 0) + 1);
  }
  const pageAllocation = buildPageAllocation({ materiality, sections, signatures, chartCounts, tableCounts });
  const cover = buildCoverSpec({
    source,
    index,
    economic,
    question,
    materiality,
    valuation,
    signatures,
    coverStructure: visual.coverStructure,
  });

  const ticker = source.researchCase.company.ticker || "UNKNOWN";
  const createdAt = source.createdAt ?? new Date().toISOString();
  const identityId = `rid-${fnv1a(`${ticker}|${source.reportTypeId}|${source.depth}|${source.researchCase.caseId}|${hashBefore ?? snapshotBefore.length}`)}`;

  const partial: ResearchDNA = {
    version: RESEARCH_IDENTITY_VERSION,
    identityId,
    caseId: source.researchCase.caseId,
    ticker,
    reportTypeId: source.reportTypeId,
    depth: source.depth,
    asOf: createdAt,
    proposalUsed: Boolean(source.proposal),
    economicIdentity: economic,
    investorQuestion: question,
    materiality,
    valuationIdentity: valuation,
    evidenceProfile: evidence,
    eventProfile: events,
    debates,
    narrativeProfile: narrative,
    visualProfile: visual,
    signatureAnalyses: signatures,
    sections,
    charts,
    tables,
    pageAllocation,
    cover,
    compatibility,
    collision: { status: "clear", comparisons: 0, maximumSimilarity: 0, averageSimilarity: 0, reasons: [], fingerprint: "" },
    canonicalIntegrity: {
      canonicalSealValidBefore: sealBefore ? sealBefore.sealed && sealBefore.hashOk : false,
      canonicalSealValidAfter: false,
      canonicalHashBefore: hashBefore,
      canonicalHashAfter: null,
      financialSnapshotBefore: snapshotBefore,
      financialSnapshotAfter: "",
      unchanged: false,
    },
    debug: {
      summary: "",
      economicIdentity: "",
      investorQuestion: "",
      materiality: "",
      signatureAnalyses: [],
      includedSections: [],
      suppressedSections: [],
      selectedCharts: [],
      selectedTables: [],
      narrativeProfile: "",
      visualProfile: "",
      pageAllocation: "",
      similarity: "",
      collision: "",
      fingerprint: "",
    },
  };

  const collision = detectCollisions(partial, source.priorIdentities ?? []);
  partial.collision = collision;

  const snapshotAfter = financialSnapshot(source);
  const sealAfter = source.researchCase.canonicalFacts ? verifyCanonicalSeal(source.researchCase.canonicalFacts) : null;
  partial.canonicalIntegrity = {
    canonicalSealValidBefore: sealBefore ? sealBefore.sealed && sealBefore.hashOk : false,
    canonicalSealValidAfter: sealAfter ? sealAfter.sealed && sealAfter.hashOk : false,
    canonicalHashBefore: hashBefore,
    canonicalHashAfter: canonicalHash(source),
    financialSnapshotBefore: snapshotBefore,
    financialSnapshotAfter: snapshotAfter,
    unchanged: snapshotBefore === snapshotAfter,
  };

  const fingerprint = fingerprintResearchDNA(partial);
  partial.debug = {
    summary: `${ticker} researched as ${economic.type} (${question.type}); ${materiality.coreTopics.length} core topic(s), ${signatures.length} signature(s), ${charts.selected.length} chart(s), ${tables.selected.length} table(s).`,
    economicIdentity: `${economic.type} (confidence ${economic.confidence})`,
    investorQuestion: question.question ?? "explicitly unavailable",
    materiality: `core: ${materiality.coreTopics.join(", ") || "none"}; suppressed: ${materiality.suppressedTopics.join(", ") || "none"}; avg ${materiality.averageScore}`,
    signatureAnalyses: signatures.map((s) => `${s.type}: ${s.title}`),
    includedSections: sections.included.map((s) => `${s.order}. ${s.title} (d${s.depth})`),
    suppressedSections: sections.suppressed.map((s) => s.title),
    selectedCharts: charts.selected.map((c) => c.id),
    selectedTables: tables.selected.map((t) => t.id),
    narrativeProfile: narrative.archetype,
    visualProfile: `${visual.archetype} / ${visual.coverStructure} / ${visual.density}`,
    pageAllocation: `${pageAllocation.totalUnits} units ≈ ${pageAllocation.estimatedPages} pages (emergent, no cap)`,
    similarity: `max ${collision.maximumSimilarity} avg ${collision.averageSimilarity}`,
    collision: collision.status,
    fingerprint,
  };

  return partial;
}

/** Serializable research-identity artifact (no functions, no class instances). */
export function serializeResearchIdentity(identity: ResearchDNA): string {
  return JSON.stringify(identity, null, 2);
}

export { RESEARCH_IDENTITY_VERSION, RESEARCH_IDENTITY_MODEL_VERSION };
