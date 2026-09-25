import { createStableId } from "../research-ledger/stable";
import {
  createCanonicalSourceMetadata,
  type CanonicalSourceMetadata,
  type Fact,
  type FactPack,
  type ResearchReport,
} from "../ai-first/types";
import { buildCanonicalEvidenceRegistry, type CanonicalEvidenceRegistry } from "../research-retrieval/evidence";
import type { ResearchDocument, ResearchDocumentEvidence, ResearchRetrievalResult, ResearchRetrievalSourceType } from "../research-retrieval/types";
import { buildResearchLineageGraph } from "./graph";
import type { ResearchLineageEdgeInput, ResearchLineageNodeInput, ResearchLineageGraph } from "./types";

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function sourceTypeForDocument(sourceType: ResearchRetrievalSourceType): CanonicalSourceMetadata["type"] {
  if (sourceType === "market_data") return "market_data_provider";
  if (sourceType === "secondary_database") return "secondary_database";
  if (sourceType === "unknown") return "unknown";
  if (sourceType === "company_website") return "company_website";
  if (sourceType === "government_regulator") return "government_regulator";
  if (sourceType === "news") return "news";
  if (sourceType === "quarterly_report") return "annual_report";
  return sourceType;
}

function metadataForFact(fact: Fact): CanonicalSourceMetadata {
  if (fact.sourceMetadata) return fact.sourceMetadata;
  return createCanonicalSourceMetadata({ type: "unknown", sourceId: fact.sourceId ?? "unknown" });
}

function metadataForDocument(document: ResearchDocument): CanonicalSourceMetadata {
  return createCanonicalSourceMetadata({
    type: sourceTypeForDocument(document.sourceType),
    sourceId: document.sourceId,
    authority: document.sourceMetadata.authority,
    valueRole: document.sourceMetadata.valueRole,
    confidence: document.sourceMetadata.confidence,
    provider: document.sourceMetadata.provider,
    publisher: document.sourceMetadata.publisher,
    documentId: document.documentId,
    documentTitle: document.title,
    publicationDate: document.publication.publishedAt,
    asOfDate: document.publication.asOfDate,
    locator: document.documentId,
  });
}

function nodeId(kind: string, seed: unknown): string {
  return createStableId(kind.toUpperCase(), seed, "research-lineage/node-id/v1");
}

function addEdge(edges: ResearchLineageEdgeInput[], from: string, to: string, kind: ResearchLineageEdgeInput["kind"], metadata?: Record<string, unknown>): void {
  if (!from || !to) return;
  const duplicate = edges.some((edge) => edge.from === from && edge.to === to && edge.kind === kind);
  if (!duplicate) edges.push({ from, to, kind, ...(metadata ? { metadata } : {}) });
}

function factNodes(input: {
  factPack?: FactPack;
  documents: readonly ResearchDocument[];
  nodes: ResearchLineageNodeInput[];
  edges: ResearchLineageEdgeInput[];
  sourceNodes: Map<string, string>;
}): Map<string, string> {
  const output = new Map<string, string>();
  const pack = input.factPack;
  if (!pack) return output;
  const sections = [
    pack.company,
    pack.market,
    pack.incomeStatement,
    pack.balanceSheet,
    pack.cashFlow,
    pack.shares,
    pack.earnings,
    pack.estimates,
    pack.corporateActions,
    pack.priceHistory,
    pack.holders,
    ...(pack.fundamentalsTimeseries ? [pack.fundamentalsTimeseries] : []),
  ];
  for (const factSection of sections) {
    for (const fact of factSection.facts) {
      if (!fact.factId) continue;
      if (output.has(fact.factId)) continue;
      const metadata = metadataForFact(fact);
      const sourceNodeId = input.sourceNodes.get(metadata.sourceId) ?? input.sourceNodes.get(fact.sourceId ?? "");
      if (!sourceNodeId) continue;
      const observationId = nodeId("OBS", { factId: fact.factId, sourceId: metadata.sourceId });
      const factNodeId = nodeId("FACT", { factId: fact.factId });
      input.nodes.push({
        id: observationId,
        kind: "observation",
        label: `${fact.label} observation`,
        period: fact.period,
        sourceId: metadata.sourceId,
        observationId,
        sourceDocumentId: metadata.documentId,
        ...(fact.asOfDate ? { asOf: fact.asOfDate } : {}),
        value: fact.value ?? fact.textValue,
      });
      input.nodes.push({
        id: factNodeId,
        kind: "fact",
        label: fact.label,
        period: fact.period,
        sourceId: metadata.sourceId,
        factId: fact.factId,
        observationId,
        sourceDocumentId: metadata.documentId,
        ...(fact.asOfDate ? { asOf: fact.asOfDate } : {}),
        value: fact.value ?? fact.textValue,
        confidence: fact.confidence,
        metadata: { rawField: fact.rawField ?? null, restated: fact.restated === true },
      });
      addEdge(input.edges, sourceNodeId, observationId, "contains_observation");
      addEdge(input.edges, observationId, factNodeId, "normalizes_to_fact");
      output.set(fact.factId, factNodeId);
      if (!output.has(fact.metric)) output.set(fact.metric, factNodeId);
      if (!output.has(`F-${fact.metric}`)) output.set(`F-${fact.metric}`, factNodeId);
    }
  }
  return output;
}

function documentEvidenceNodes(input: {
  documents: readonly ResearchDocument[];
  nodes: ResearchLineageNodeInput[];
  edges: ResearchLineageEdgeInput[];
  sourceNodes: Map<string, string>;
  evidenceRegistry?: CanonicalEvidenceRegistry;
}): Map<string, string> {
  const output = new Map<string, string>();
  for (const document of input.documents) {
    const sourceNodeId = input.sourceNodes.get(document.sourceId) ?? input.sourceNodes.get(document.documentId);
    if (!sourceNodeId) continue;
    for (const entry of document.evidence) {
      const item = input.evidenceRegistry?.items.find((candidate) => candidate.sourceDocumentId === document.documentId && (candidate.metadata?.evidenceId === entry.id || candidate.observationId?.includes(entry.id)));
      const observationId = nodeId("OBS", { documentId: document.documentId, evidenceId: entry.id });
      const factNodeId = nodeId("FACT", { documentId: document.documentId, evidenceId: entry.id });
      input.nodes.push({
        id: observationId,
        kind: "observation",
        label: `${document.title} evidence observation`,
        sourceId: document.sourceId,
        sourceDocumentId: document.documentId,
        documentId: document.documentId,
        observationId,
        value: "value" in entry ? entry.value : "statement" in entry ? entry.statement : entry.text,
        ...(document.publication.asOfDate ? { asOf: document.publication.asOfDate } : {}),
      });
      input.nodes.push({
        id: factNodeId,
        kind: "fact",
        label: "field" in entry ? entry.field : "statement",
        sourceId: document.sourceId,
        sourceDocumentId: document.documentId,
        documentId: document.documentId,
        observationId,
        factId: item?.id,
        value: "value" in entry ? entry.value : "statement" in entry ? entry.statement : entry.text,
        ...(document.publication.asOfDate ? { asOf: document.publication.asOfDate } : {}),
        confidence: document.sourceMetadata.confidence,
        metadata: { evidenceId: entry.id, quarantined: entry.status === "quarantined" },
      });
      addEdge(input.edges, sourceNodeId, observationId, "contains_observation");
      addEdge(input.edges, observationId, factNodeId, "normalizes_to_fact");
      output.set(entry.id, factNodeId);
      if (item?.id) output.set(item.id, factNodeId);
    }
  }
  return output;
}

function derivedMetricNodes(input: { factPack?: FactPack | null; factNodes: Map<string, string>; nodes: ResearchLineageNodeInput[]; edges: ResearchLineageEdgeInput[] }): string[] {
  const pack = input.factPack;
  if (!pack) return [];
  const revenueFacts = pack.incomeStatement.facts
    .filter((fact) => /^(?:totalRevenue|operatingRevenue|revenue)$/i.test(fact.metric) && typeof fact.value === "number" && Number.isFinite(fact.value))
    .sort((left, right) => String(left.reportingPeriod ?? left.period).localeCompare(String(right.reportingPeriod ?? right.period)));
  const unique = [...new Map(revenueFacts.map((fact) => [fact.factId ?? `${fact.metric}:${fact.period}`, fact])).values()];
  if (unique.length < 2) return [];
  const previous = unique.at(-2);
  const latest = unique.at(-1);
  if (!previous || !latest || previous.value === undefined || latest.value === undefined || previous.value === 0) return [];
  const value = latest.value / previous.value - 1;
  const id = nodeId("DERIVED", { subject: pack.ticker, metric: "revenueGrowth", from: previous.factId, to: latest.factId });
  input.nodes.push({ id, kind: "derived_metric", label: "Revenue growth", period: latest.reportingPeriod ?? latest.period, value, metadata: { formula: "latestRevenue / priorRevenue - 1", priorFactId: previous.factId ?? null, latestFactId: latest.factId ?? null } });
  for (const fact of [previous, latest]) {
    const parent = input.factNodes.get(fact.factId ?? "");
    if (parent) addEdge(input.edges, parent, id, "derives");
  }
  return [id];
}

function formulaAndAssumptionNodes(input: {
  forecastSpec: Record<string, unknown> | null | undefined;
  valuationSpec: Record<string, unknown> | null | undefined;
  factNodes: Map<string, string>;
  nodes: ResearchLineageNodeInput[];
  edges: ResearchLineageEdgeInput[];
}): { formulaIds: string[]; assumptionIds: string[]; forecastIds: string[]; valuationIds: string[] } {
  const formulaIds: string[] = [];
  const assumptionIds: string[] = [];
  const forecastSpec = input.forecastSpec;
  const formulas = Array.isArray(forecastSpec?.formulas) ? forecastSpec.formulas as Record<string, unknown>[] : [];
  for (const formula of formulas) {
    const formulaId = text(formula.id) || createStableId("FORMULA", formula, "research-lineage/formula/v1");
    const id = nodeId("FORMULA", { formulaId, expression: formula.expression, output: formula.output });
    const sourceFacts = Array.isArray(formula.sourceFacts) ? formula.sourceFacts.map(String) : [];
    const parents = sourceFacts.map((factId) => input.factNodes.get(factId)).filter((value): value is string => Boolean(value));
    for (const parent of parents) addEdge(input.edges, parent, id, "contains_formula");
    if (parents.length === 0) {
      const unknownId = nodeId("UNKNOWN", { formulaId, reason: "formula_source_fact_unavailable" });
      input.nodes.push({ id: unknownId, kind: "unknown", label: `Formula source unavailable: ${formulaId}`, blocker: "FORMULA_SOURCE_FACT_UNAVAILABLE" });
      addEdge(input.edges, unknownId, id, "records_unknown");
    }
    input.nodes.push({ id, kind: "formula", label: text(formula.equation, formulaId), formulaId, value: formula.expression, metadata: { output: formula.output ?? null, variables: formula.variables ?? [] } });
    formulaIds.push(id);
  }
  const assumptions = [
    ...(Array.isArray(forecastSpec?.assumptions) ? forecastSpec.assumptions as Record<string, unknown>[] : []),
    ...(Array.isArray(input.valuationSpec?.assumptions) ? input.valuationSpec.assumptions as Record<string, unknown>[] : []),
  ];
  for (const assumption of assumptions) {
    const assumptionId = text(assumption.id) || createStableId("ASSUMPTION", assumption, "research-lineage/assumption/v1");
    const id = nodeId("ASSUMPTION", { assumptionId, text: assumption.assumption, variable: assumption.variable });
    const factIds = Array.isArray(assumption.factIds) ? assumption.factIds.map(String) : [];
    const evidenceIds = Array.isArray(assumption.evidenceIds) ? assumption.evidenceIds.map(String) : [];
    const parents = [...factIds, ...evidenceIds].map((ref) => input.factNodes.get(ref)).filter((value): value is string => Boolean(value));
    for (const parent of parents) addEdge(input.edges, parent, id, "assumes");
    if (parents.length === 0) {
      const unknownId = nodeId("UNKNOWN", { assumptionId, reason: "assumption_evidence_unavailable" });
      input.nodes.push({ id: unknownId, kind: "unknown", label: `Assumption evidence unavailable: ${assumptionId}`, blocker: "ASSUMPTION_EVIDENCE_UNAVAILABLE" });
      addEdge(input.edges, unknownId, id, "records_unknown");
    }
    input.nodes.push({ id, kind: "assumption", label: text(assumption.assumption, assumptionId), assumptionId, value: assumption.value, ...(text(assumption.period) ? { period: text(assumption.period) } : {}), metadata: { variable: assumption.variable ?? null, rationale: assumption.rationale ?? null, confidence: assumption.confidence ?? null } });
    assumptionIds.push(id);
  }
  return { formulaIds, assumptionIds, forecastIds: [], valuationIds: [] };
}

function numericClaims(report: ResearchReport | null | undefined): Array<{ id: string; label: string; kind: "thesis" | "valuation" | "catalyst" | "risk" | "conclusion"; value?: string; material: boolean; parentIds: string[] }> {
  const output: Array<{ id: string; label: string; kind: "thesis" | "valuation" | "catalyst" | "risk" | "conclusion"; value?: string; material: boolean; parentIds: string[] }> = [];
  const numeric = /\d|%|x|per share|price|target|revenue|margin|growth|valuation|cash|debt|shares/i;
  const add = (kind: "thesis" | "valuation" | "catalyst" | "risk" | "conclusion", value: unknown, parentIds: string[] = []): void => {
    const label = text(value);
    if (!label) return;
    output.push({ id: nodeId("CLAIM", { kind, label }), label, kind, material: kind !== "thesis" || numeric.test(label), parentIds });
  };
  add("thesis", report?.thesis?.thesis);
  if (report?.valuation) add("valuation", `${report.valuation.methodology}: ${report.valuation.fairValuePerShare ?? "unavailable"}`);
  for (const catalyst of report?.catalysts ?? []) add("catalyst", catalyst.catalyst, [...(catalyst.traceability?.factIds ?? [])]);
  for (const risk of report?.risks ?? []) add("risk", risk.risk, [...(risk.traceability?.factIds ?? [])]);
  add("conclusion", report?.conclusion);
  return output;
}

export interface BuildCanonicalResearchLineageInput {
  subjectId: string;
  factPack?: FactPack | null;
  sourceDocuments?: readonly ResearchDocument[];
  retrieval?: ResearchRetrievalResult | null;
  evidenceRegistry?: CanonicalEvidenceRegistry;
  forecastSpec?: Record<string, unknown> | null;
  valuationSpec?: Record<string, unknown> | null;
  executedForecast?: Record<string, unknown> | null;
  valuationMatrix?: Record<string, unknown> | null;
  report?: ResearchReport | null;
  claims?: readonly { id?: string; text: string; material?: boolean; kind?: "thesis" | "valuation" | "catalyst" | "risk" | "conclusion"; evidenceIds?: readonly string[] }[];
  researchPlan?: { unknowns?: readonly string[] } | null;
  extraBlockers?: readonly string[];
}

export function buildCanonicalResearchLineage(input: BuildCanonicalResearchLineageInput): ResearchLineageGraph {
  const subjectId = text(input.subjectId, "unknown").toUpperCase();
  const documents = [...(input.sourceDocuments ?? []), ...(input.retrieval?.documents ?? [])];
  const documentCandidates = [...documents].sort((left, right) => left.documentId.localeCompare(right.documentId) || left.contentHash.localeCompare(right.contentHash));
  const uniqueDocuments = [...new Map(documentCandidates.map((document) => [document.documentId, document])).values()].sort((left, right) => left.documentId.localeCompare(right.documentId));
  const evidenceRegistry = input.evidenceRegistry ?? buildCanonicalEvidenceRegistry({ factPack: input.factPack, sourceDocuments: uniqueDocuments, retrieval: input.retrieval, asOf: input.retrieval?.asOf });
  const nodes: ResearchLineageNodeInput[] = [];
  const edges: ResearchLineageEdgeInput[] = [];
  const sourceNodes = new Map<string, string>();
  const sourceMetadata = input.factPack?.market.facts[0]?.sourceMetadata ?? input.factPack?.company.facts[0]?.sourceMetadata;
  if (sourceMetadata) {
    const id = nodeId("SOURCE", { sourceId: sourceMetadata.sourceId, documentId: sourceMetadata.documentId ?? null });
    sourceNodes.set(sourceMetadata.sourceId, id);
    nodes.push({ id, kind: "source_document", label: sourceMetadata.documentTitle ?? sourceMetadata.sourceId, sourceId: sourceMetadata.sourceId, source: sourceMetadata, documentId: sourceMetadata.documentId, asOf: sourceMetadata.asOfDate });
  }
  for (const document of uniqueDocuments) {
    const id = nodeId("SOURCE", { documentId: document.documentId, sourceId: document.sourceId });
    sourceNodes.set(document.sourceId, id);
    sourceNodes.set(document.documentId, id);
    nodes.push({ id, kind: "source_document", label: document.title, sourceId: document.sourceId, source: metadataForDocument(document), documentId: document.documentId, sourceDocumentId: document.documentId, asOf: document.publication.asOfDate });
  }
  if (sourceNodes.size === 0) {
    const metadata = createCanonicalSourceMetadata({ type: "unknown", sourceId: "unknown" });
    const id = nodeId("SOURCE", { sourceId: metadata.sourceId });
    sourceNodes.set(metadata.sourceId, id);
    nodes.push({ id, kind: "source_document", label: "Unavailable source", sourceId: metadata.sourceId, source: metadata });
  }
  const facts = factNodes({ factPack: input.factPack ?? undefined, documents: uniqueDocuments, nodes, edges, sourceNodes });
  const documentFacts = documentEvidenceNodes({ documents: uniqueDocuments, nodes, edges, sourceNodes, evidenceRegistry });
  for (const [id, node] of documentFacts) facts.set(id, node);
  const derivedMetricIds = derivedMetricNodes({ factPack: input.factPack, factNodes: facts, nodes, edges });
  if (derivedMetricIds.length === 0) {
    const id = nodeId("DERIVED", { subjectId, reason: "derived_metric_unavailable" });
    const unknownId = nodeId("UNKNOWN", { subjectId, reason: "derived_metric_unavailable" });
    nodes.push({ id: unknownId, kind: "unknown", label: "Derived metric unavailable", blocker: "DERIVED_METRIC_UNAVAILABLE" });
    nodes.push({ id, kind: "derived_metric", label: "Derived metric unavailable", metadata: { unavailable: true } });
    addEdge(edges, unknownId, id, "records_unknown");
    derivedMetricIds.push(id);
  }
  for (const id of derivedMetricIds) facts.set(id, id);
  const model = formulaAndAssumptionNodes({ forecastSpec: input.forecastSpec, valuationSpec: input.valuationSpec, factNodes: facts, nodes, edges });
  if (model.formulaIds.length === 0) {
    const id = nodeId("FORMULA", { subjectId, reason: "formula_unavailable" });
    const unknownId = nodeId("UNKNOWN", { subjectId, reason: "formula_unavailable" });
    nodes.push({ id: unknownId, kind: "unknown", label: "Formula unavailable", blocker: "FORMULA_UNAVAILABLE" });
    nodes.push({ id, kind: "formula", label: "Formula unavailable", formulaId: id, metadata: { unavailable: true } });
    addEdge(edges, unknownId, id, "records_unknown");
    model.formulaIds.push(id);
  }
  if (model.assumptionIds.length === 0) {
    const id = nodeId("ASSUMPTION", { subjectId, reason: "assumption_unavailable" });
    const unknownId = nodeId("UNKNOWN", { subjectId, reason: "assumption_unavailable" });
    nodes.push({ id: unknownId, kind: "unknown", label: "Assumption unavailable", blocker: "ASSUMPTION_UNAVAILABLE" });
    nodes.push({ id, kind: "assumption", label: "Assumption unavailable", assumptionId: id, metadata: { unavailable: true } });
    addEdge(edges, unknownId, id, "records_unknown");
    model.assumptionIds.push(id);
  }
  const forecastNodes: string[] = [];
  const forecastId = text(input.forecastSpec?.forecastId, createStableId("FORECAST", { subjectId, modelId: input.forecastSpec?.modelId ?? null }, "research-lineage/forecast/v1"));
  const forecastValue = input.executedForecast?.incomeStatement ?? input.executedForecast?.status ?? null;
  const forecastNodeId = nodeId("FORECAST", { subjectId, forecastId, value: forecastValue });
  nodes.push({ id: forecastNodeId, kind: "forecast", label: `Forecast ${forecastId}`, forecastId, value: forecastValue, metadata: { status: input.executedForecast?.status ?? null } });
  for (const parent of [...model.assumptionIds, ...model.formulaIds]) addEdge(edges, parent, forecastNodeId, "feeds_forecast");
  if (model.assumptionIds.length === 0 && model.formulaIds.length === 0) {
    const unknownId = nodeId("UNKNOWN", { forecastId, reason: "forecast_inputs_unavailable" });
    nodes.push({ id: unknownId, kind: "unknown", label: "Forecast inputs unavailable", blocker: "FORECAST_INPUTS_UNAVAILABLE" });
    addEdge(edges, unknownId, forecastNodeId, "records_unknown");
  }
  forecastNodes.push(forecastNodeId);
  const valuationId = text(input.valuationSpec?.specId, createStableId("VALUATION", { subjectId, forecastId }, "research-lineage/valuation/v1"));
  const valuationNodeId = nodeId("VALUATION", { valuationId, subjectId });
  nodes.push({ id: valuationNodeId, kind: "valuation", label: `Valuation ${valuationId}`, valuationId, value: input.valuationMatrix?.primaryValuationId ?? valuationId, metadata: { status: input.valuationMatrix?.status ?? null, primaryMethod: input.valuationMatrix?.primaryMethod ?? null } });
  for (const parent of forecastNodes) addEdge(edges, parent, valuationNodeId, "feeds_valuation");
  const scenarioNodes: string[] = [];
  const scenarios = Array.isArray(input.report?.scenarios) ? input.report.scenarios : [];
  for (const scenario of scenarios) {
    const scenarioId = text(scenario.id, createStableId("SCENARIO", { subjectId, name: scenario.name }, "research-lineage/scenario/v1"));
    const id = nodeId("SCENARIO", { scenarioId, subjectId });
    nodes.push({ id, kind: "scenario", label: `${scenario.name} scenario`, scenarioId, value: scenario.targetPrice, metadata: { status: scenario.status ?? null, probability: scenario.probability ?? null } });
    addEdge(edges, forecastNodeId, id, "produces_scenario");
    addEdge(edges, valuationNodeId, id, "produces_scenario");
    scenarioNodes.push(id);
  }
  if (scenarioNodes.length === 0) {
    const id = nodeId("SCENARIO", { subjectId, reason: "scenarios_unavailable" });
    const unknownId = nodeId("UNKNOWN", { subjectId, reason: "scenarios_unavailable" });
    nodes.push({ id: unknownId, kind: "unknown", label: "Scenarios unavailable", blocker: "SCENARIOS_UNAVAILABLE" });
    nodes.push({ id, kind: "scenario", label: "Scenarios unavailable", scenarioId: id, metadata: { unavailable: true } });
    addEdge(edges, unknownId, id, "records_unknown");
    scenarioNodes.push(id);
  }
  const claimInputs = [
    ...numericClaims(input.report),
    ...(input.claims ?? []).map((claim) => ({
      id: nodeId("CLAIM", { supplied: claim.id ?? claim.text, text: claim.text }),
      label: claim.text,
      kind: claim.kind ?? "thesis",
      material: claim.material ?? true,
      parentIds: [...(claim.evidenceIds ?? [])],
    })),
  ];
  const claimIds: string[] = [];
  for (const claim of claimInputs) {
    const id = claim.id;
    const resolvedParents = claim.parentIds.map((parent) => facts.get(parent) ?? parent).filter((parent) => Boolean(parent));
    const parents = resolvedParents.length > 0 ? resolvedParents : claim.kind === "valuation" ? [valuationNodeId] : claim.kind === "catalyst" || claim.kind === "risk" ? [forecastNodeId] : [];
    for (const parent of parents) addEdge(edges, parent, id, claim.kind === "catalyst" || claim.kind === "risk" ? "scenario_supports_claim" : "supports_claim");
    const evidenceNodeIds = parents.filter((parent) => facts.has(parent) || parent === valuationNodeId || parent === forecastNodeId);
    nodes.push({ id, kind: "claim", label: claim.label, claimId: id, material: claim.material, evidenceNodeIds, metadata: { claimType: claim.kind } });
    claimIds.push(id);
    if (claim.material && !hasTraceableAncestor(id, nodes, edges)) {
      const claimNode = nodes.find((node) => node.id === id);
      if (claimNode) claimNode.blocker = "MATERIAL_CLAIM_SOURCE_PATH_UNAVAILABLE";
      const blockerId = nodeId("UNKNOWN", { claimId: id, reason: "material_claim_source_path_unavailable" });
      nodes.push({ id: blockerId, kind: "unknown", label: `Material claim blocker: ${claim.label}`, blocker: "MATERIAL_CLAIM_SOURCE_PATH_UNAVAILABLE", metadata: { claimId: id } });
      addEdge(edges, blockerId, id, "blocks_claim");
    }
  }
  const conclusionId = nodeId("CONCLUSION", { subjectId, conclusion: input.report?.conclusion ?? null });
  nodes.push({ id: conclusionId, kind: "conclusion", label: text(input.report?.conclusion, "Investment conclusion"), conclusionId, value: input.report?.valuation?.fairValuePerShare, metadata: { rating: input.report?.valuation?.status ?? null } });
  for (const claimId of claimIds) addEdge(edges, claimId, conclusionId, "concludes");
  for (const unknown of input.researchPlan?.unknowns ?? []) {
    const id = nodeId("UNKNOWN", { subjectId, unknown });
    nodes.push({ id, kind: "unknown", label: unknown, blocker: "RESEARCH_UNKNOWN" });
  }
  for (const conflict of evidenceRegistry.conflicts) {
    const id = nodeId("CONFLICT", { conflictId: conflict.id });
    nodes.push({ id, kind: "conflict", label: `${conflict.field} conflict`, value: { selected: conflict.selectedId, incoming: conflict.incomingId }, metadata: { conflictId: conflict.id, restatement: conflict.reason === "source_restatement" } });
    const selectedItem = evidenceRegistry.items.find((item) => item.id === conflict.selectedId);
    const selected = facts.get(conflict.selectedId) ?? (selectedItem?.factId ? facts.get(selectedItem.factId) : undefined);
    if (selected) addEdge(edges, selected, id, "conflicts_with");
  }
  for (const action of input.factPack?.corporateActions.facts ?? []) {
    if (!action.factId) continue;
    const id = nodeId("ACTION", { factId: action.factId, label: action.label });
    nodes.push({ id, kind: "corporate_action", label: action.label, factId: action.factId, value: action.value ?? action.textValue, period: action.period });
    const factNode = facts.get(action.factId);
    if (factNode) addEdge(edges, factNode, id, "adjusts_for");
  }
  const extraBlockerIds: string[] = [];
  for (const blocker of input.extraBlockers ?? []) {
    const id = nodeId("UNKNOWN", { subjectId, blocker });
    nodes.push({ id, kind: "unknown", label: blocker, blocker });
    extraBlockerIds.push(id);
  }
  for (const blockerId of extraBlockerIds) {
    for (const claimId of claimIds) addEdge(edges, blockerId, claimId, "blocks_claim");
  }
  return buildResearchLineageGraph({ subjectId, nodes, edges });
}

function hasTraceableAncestor(claimId: string, nodes: readonly ResearchLineageNodeInput[], edges: readonly ResearchLineageEdgeInput[]): boolean {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const queue = [claimId];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    if (current.startsWith("FACT-")) return true;
    for (const edge of edges) if (edge.to === current && byId.has(edge.from) && edge.kind !== "blocks_claim") queue.push(edge.from);
  }
  return false;
}

export const buildResearchLineage = buildCanonicalResearchLineage;
export const buildCanonicalLineageGraph = buildCanonicalResearchLineage;
export const buildResearchLineageGraphFromResearch = buildCanonicalResearchLineage;
export const buildResearchLineageFromResearch = buildCanonicalResearchLineage;
export const attachResearchLineage = buildCanonicalResearchLineage;
export type { ResearchDocumentEvidence };
