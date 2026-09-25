import { deepFreeze, isDeeplyFrozen } from "../research-ledger/immutable";
import { compareStableStrings, stableHash, stableStringify } from "../research-ledger/stable";
import { CANONICAL_SOURCE_TAXONOMY_VERSION } from "../ai-first/types";
import {
  LINEAGE_EDGE_KINDS,
  LINEAGE_NODE_KINDS,
  RESEARCH_LINEAGE_VERSION,
  type LineageEdgeKind,
  type LineageNodeKind,
  type LineageValidationCode,
  type LineageValidationIssue,
  type ResearchLineageEdge,
  type ResearchLineageEdgeInput,
  type ResearchLineageGraph,
  type ResearchLineageGraphInput,
  type ResearchLineageNode,
  type ResearchLineageNodeInput,
  type ResearchLineageValidation,
} from "./types";

const POSITIVE_EDGE_KINDS: ReadonlySet<LineageEdgeKind> = new Set([
  "contains_observation",
  "normalizes_to_fact",
  "derives",
  "assumes",
  "feeds_forecast",
  "feeds_valuation",
  "contains_formula",
  "produces_scenario",
  "scenario_supports_claim",
  "supports_claim",
  "concludes",
  "adjusts_for",
]);

const ALLOWED_PARENTS: Readonly<Record<LineageNodeKind, readonly LineageNodeKind[]>> = {
  source_document: [],
  observation: ["source_document"],
  fact: ["observation"],
  derived_metric: ["fact", "derived_metric"],
  assumption: ["fact", "derived_metric", "unknown"],
  forecast: ["assumption", "derived_metric", "formula", "fact"],
  valuation: ["forecast", "derived_metric", "fact", "formula", "scenario"],
  formula: ["fact", "derived_metric", "assumption", "unknown"],
  scenario: ["forecast", "valuation", "derived_metric", "fact", "assumption", "unknown"],
  claim: ["fact", "derived_metric", "assumption", "forecast", "valuation", "formula", "scenario", "conflict", "corporate_action", "unknown"],
  conclusion: ["claim"],
  conflict: ["observation", "fact"],
  corporate_action: ["source_document", "observation", "fact"],
  unknown: [],
};

export class ResearchLineageIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResearchLineageIntegrityError";
  }
}

export class ResearchLineageCollisionError extends ResearchLineageIntegrityError {
  constructor(message: string) {
    super(message);
    this.name = "ResearchLineageCollisionError";
  }
}

function requiredText(value: unknown, field: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new TypeError(`${field} must be a non-empty string`);
  return normalized;
}

function confidenceValue(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError("Lineage confidence must be between 0 and 1");
  return Object.is(value, -0) ? 0 : value;
}

function canonicalValue(value: unknown, ancestors: Set<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return Object.is(value, -0) ? 0 : value;
    return `[non-finite:${String(value)}]`;
  }
  if (typeof value === "bigint") return `[bigint:${value.toString()}]`;
  if (typeof value === "undefined") return "[undefined]";
  if (typeof value === "function" || typeof value === "symbol") return `[${typeof value}]`;
  if (value instanceof Date) return value.toISOString();
  if (ancestors.has(value)) throw new TypeError("Lineage values must not be cyclic");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => canonicalValue(item, ancestors));
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort(compareStableStrings)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, "value")) continue;
      const normalized = canonicalValue(descriptor.value, ancestors);
      if (normalized !== "[undefined]") result[key] = normalized;
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

function canonicalCopy<T>(value: T): T {
  return canonicalValue(value, new Set<object>()) as T;
}

function evidenceIds(values: readonly string[] | undefined): readonly string[] {
  if (values === undefined) return Object.freeze([]);
  if (!Array.isArray(values)) throw new TypeError("evidenceNodeIds must be an array");
  return Object.freeze([...new Set(values.map((value) => requiredText(value, "evidenceNodeId")))].sort(compareStableStrings));
}

function nodeContent(input: ResearchLineageNodeInput | ResearchLineageNode): Omit<ResearchLineageNode, "contentHash"> {
  const id = requiredText(input.id, "node.id");
  const kind = input.kind;
  if (!LINEAGE_NODE_KINDS.includes(kind)) throw new TypeError(`Unsupported lineage node kind ${String(kind)}`);
  const label = requiredText(input.label, "node.label");
  return {
    version: RESEARCH_LINEAGE_VERSION,
    id,
    kind,
    label,
    evidenceNodeIds: evidenceIds(input.evidenceNodeIds),
    ...(input.value === undefined ? {} : { value: canonicalCopy(input.value) }),
    ...(input.period === undefined ? {} : { period: requiredText(input.period, "node.period") }),
    ...(input.sourceId === undefined ? {} : { sourceId: requiredText(input.sourceId, "node.sourceId") }),
    ...(input.factId === undefined ? {} : { factId: requiredText(input.factId, "node.factId") }),
    ...(input.observationId === undefined ? {} : { observationId: requiredText(input.observationId, "node.observationId") }),
    ...(input.sourceDocumentId === undefined ? {} : { sourceDocumentId: requiredText(input.sourceDocumentId, "node.sourceDocumentId") }),
    ...(input.documentId === undefined ? {} : { documentId: requiredText(input.documentId, "node.documentId") }),
    ...(input.formulaId === undefined ? {} : { formulaId: requiredText(input.formulaId, "node.formulaId") }),
    ...(input.scenarioId === undefined ? {} : { scenarioId: requiredText(input.scenarioId, "node.scenarioId") }),
    ...(input.assumptionId === undefined ? {} : { assumptionId: requiredText(input.assumptionId, "node.assumptionId") }),
    ...(input.forecastId === undefined ? {} : { forecastId: requiredText(input.forecastId, "node.forecastId") }),
    ...(input.valuationId === undefined ? {} : { valuationId: requiredText(input.valuationId, "node.valuationId") }),
    ...(input.claimId === undefined ? {} : { claimId: requiredText(input.claimId, "node.claimId") }),
    ...(input.conclusionId === undefined ? {} : { conclusionId: requiredText(input.conclusionId, "node.conclusionId") }),
    ...(input.action === undefined ? {} : { action: requiredText(input.action, "node.action") }),
    ...(input.asOf === undefined ? {} : { asOf: requiredText(input.asOf, "node.asOf") }),
    ...(input.restatementOf === undefined ? {} : { restatementOf: requiredText(input.restatementOf, "node.restatementOf") }),
    ...(input.blocker === undefined ? {} : { blocker: requiredText(input.blocker, "node.blocker") }),
    ...(input.source === undefined ? {} : { source: canonicalCopy(input.source) }),
    ...(input.material === undefined ? {} : { material: input.material }),
    ...(input.confidence === undefined ? {} : { confidence: confidenceValue(input.confidence) }),
    ...(input.metadata === undefined ? {} : { metadata: canonicalCopy(input.metadata) }),
  };
}

export function hashResearchLineageNode(node: ResearchLineageNodeInput | ResearchLineageNode): string {
  return stableHash(nodeContent(node), "research-lineage/node/v1");
}

export function createResearchLineageNode(input: ResearchLineageNodeInput): ResearchLineageNode {
  const content = nodeContent(input);
  return deepFreeze({ ...content, contentHash: stableHash(content, "research-lineage/node/v1") }) as ResearchLineageNode;
}

function edgeContent(input: ResearchLineageEdgeInput | ResearchLineageEdge): Omit<ResearchLineageEdge, "contentHash"> {
  const from = requiredText(input.from, "edge.from");
  const to = requiredText(input.to, "edge.to");
  const kind = input.kind;
  if (!LINEAGE_EDGE_KINDS.includes(kind)) throw new TypeError(`Unsupported lineage edge kind ${String(kind)}`);
  return {
    version: RESEARCH_LINEAGE_VERSION,
    from,
    to,
    kind,
    ...(input.confidence === undefined ? {} : { confidence: confidenceValue(input.confidence) }),
    ...(input.metadata === undefined ? {} : { metadata: canonicalCopy(input.metadata) }),
  };
}

export function hashResearchLineageEdge(edge: ResearchLineageEdgeInput | ResearchLineageEdge): string {
  return stableHash(edgeContent(edge), "research-lineage/edge/v1");
}

export function createResearchLineageEdge(input: ResearchLineageEdgeInput): ResearchLineageEdge {
  const content = edgeContent(input);
  return deepFreeze({ ...content, contentHash: stableHash(content, "research-lineage/edge/v1") }) as ResearchLineageEdge;
}

function nodeOrder(left: ResearchLineageNode, right: ResearchLineageNode): number {
  return LINEAGE_NODE_KINDS.indexOf(left.kind) - LINEAGE_NODE_KINDS.indexOf(right.kind)
    || compareStableStrings(left.id, right.id)
    || compareStableStrings(left.contentHash, right.contentHash);
}

function edgeOrder(left: ResearchLineageEdge, right: ResearchLineageEdge): number {
  return compareStableStrings(left.from, right.from)
    || compareStableStrings(left.to, right.to)
    || LINEAGE_EDGE_KINDS.indexOf(left.kind) - LINEAGE_EDGE_KINDS.indexOf(right.kind)
    || compareStableStrings(left.contentHash, right.contentHash);
}

function issue(
  code: LineageValidationCode,
  message: string,
  nodeIds: readonly string[] = [],
  edgeIndexes: readonly number[] = [],
): LineageValidationIssue {
  return Object.freeze({ code, message, nodeIds: Object.freeze([...nodeIds]), edgeIndexes: Object.freeze([...edgeIndexes]) });
}

function positiveIncoming(nodes: readonly ResearchLineageNode[], edges: readonly ResearchLineageEdge[]): Map<string, ResearchLineageNode[]> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, ResearchLineageNode[]>();
  for (const edge of edges) {
    if (!POSITIVE_EDGE_KINDS.has(edge.kind)) continue;
    const parent = byId.get(edge.from);
    const child = byId.get(edge.to);
    if (!parent || !child) continue;
    const parents = incoming.get(child.id) ?? [];
    if (!parents.some((candidate) => candidate.id === parent.id)) parents.push(parent);
    parents.sort((left, right) => nodeOrder(left, right));
    incoming.set(child.id, parents);
  }
  return incoming;
}

function positiveAncestors(nodeId: string, incoming: ReadonlyMap<string, readonly ResearchLineageNode[]>): ReadonlySet<string> {
  const found = new Set<string>();
  const queue = [nodeId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    for (const parent of incoming.get(current) ?? []) {
      if (found.has(parent.id)) continue;
      found.add(parent.id);
      queue.push(parent.id);
    }
  }
  return found;
}

function materialPath(
  claim: ResearchLineageNode,
  byId: ReadonlyMap<string, ResearchLineageNode>,
  incoming: ReadonlyMap<string, readonly ResearchLineageNode[]>,
): readonly string[] | null {
  const visit = (id: string, path: readonly string[], active: ReadonlySet<string>): readonly string[] | null => {
    const kinds = new Set(path.map((pathId) => byId.get(pathId)?.kind).filter((kind): kind is LineageNodeKind => kind !== undefined));
    if (kinds.has("source_document") && kinds.has("observation") && kinds.has("fact")) return path;
    if (active.has(id)) return null;
    const nextActive = new Set(active);
    nextActive.add(id);
    for (const parent of incoming.get(id) ?? []) {
      const found = visit(parent.id, [parent.id, ...path], nextActive);
      if (found) return found;
    }
    return null;
  };
  return visit(claim.id, [claim.id], new Set());
}

function hasCycle(nodes: readonly ResearchLineageNode[], edges: readonly ResearchLineageEdge[]): boolean {
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of edges) {
    if (!indegree.has(edge.from) || !indegree.has(edge.to)) continue;
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from)?.push(edge.to);
  }
  const queue = nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id).sort(compareStableStrings);
  let visited = 0;
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    visited += 1;
    for (const next of (outgoing.get(current) ?? []).sort(compareStableStrings)) {
      const nextDegree = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, nextDegree);
      if (nextDegree === 0) queue.push(next);
    }
  }
  return visited !== nodes.length;
}

function inspectGraph(nodes: readonly ResearchLineageNode[], edges: readonly ResearchLineageEdge[]): ResearchLineageValidation {
  const issues: LineageValidationIssue[] = [];
  const byId = new Map<string, ResearchLineageNode>();
  for (const node of nodes) {
    if (byId.has(node.id)) {
      issues.push(issue("DUPLICATE_NODE_ID", `Duplicate lineage node ID ${node.id}`, [node.id]));
      continue;
    }
    byId.set(node.id, node);
  }

  edges.forEach((edge, edgeIndex) => {
    const missing = [edge.from, edge.to].filter((id) => !byId.has(id));
    if (missing.length > 0) {
      issues.push(issue("DANGLING_EDGE_REFERENCE", `Edge references missing node ${missing.join(", ")}`, missing, [edgeIndex]));
    }
  });

  for (const node of nodes) {
    if (node.kind !== "source_document") continue;
    if (!node.source || node.source.taxonomyVersion !== CANONICAL_SOURCE_TAXONOMY_VERSION || node.source.sourceId !== node.sourceId) {
      issues.push(issue("INVALID_SOURCE_METADATA", `Source metadata is not canonical for ${node.id}`, [node.id]));
    }
  }

  const incoming = positiveIncoming(nodes, edges);
  let closed = true;
  for (const node of nodes) {
    if (ALLOWED_PARENTS[node.kind].length === 0) continue;
    const parents = incoming.get(node.id) ?? [];
    const validParents = parents.filter((parent) => ALLOWED_PARENTS[node.kind].includes(parent.kind));
    if (validParents.length === 0) {
      closed = false;
      issues.push(issue("UNSUPPORTED_STAGE", `${node.kind} node ${node.id} has no valid ${ALLOWED_PARENTS[node.kind].join(" or ")} lineage`, [node.id]));
    }
  }

  const acyclic = !hasCycle(nodes, edges);
  if (!acyclic) issues.push(issue("LINEAGE_CYCLE", "Lineage graph contains a cycle"));

  const claimPaths: Record<string, readonly string[]> = {};
  const materialClaims = nodes.filter((node) => node.kind === "claim" && node.material === true);
  const blockedClaimIds = new Set<string>();
  let traceableMaterialClaimCount = 0;
  for (const claim of materialClaims) {
    const ancestors = positiveAncestors(claim.id, incoming);
    const declaredEvidence = claim.evidenceNodeIds;
    const forged = declaredEvidence.filter((id) => !byId.has(id) || !ancestors.has(id));
    if (forged.length > 0) {
      blockedClaimIds.add(claim.id);
      issues.push(issue("FORGED_EVIDENCE_REFERENCE", `Claim ${claim.id} declares untraceable evidence ${forged.join(", ")}`, [claim.id, ...forged.filter((id) => byId.has(id))]));
    }
    const path = materialPath(claim, byId, incoming);
    if (path && forged.length === 0) {
      traceableMaterialClaimCount += 1;
      claimPaths[claim.id] = Object.freeze([...path]);
    } else if (!path) {
      blockedClaimIds.add(claim.id);
      issues.push(issue("MISSING_MATERIAL_CLAIM_LINEAGE", `Material claim ${claim.id} has no source document to fact lineage`, [claim.id]));
    }
  }

  for (const edge of edges) {
    if (edge.kind === "blocks_claim" && byId.get(edge.to)?.kind === "claim") blockedClaimIds.add(edge.to);
  }
  const materialClaimsTraceable = traceableMaterialClaimCount === materialClaims.length && blockedClaimIds.size === 0;
  const blockers = [...blockedClaimIds].sort(compareStableStrings).map((id) => `MATERIAL_CLAIM_BLOCKED:${id}`);
  if (blockedClaimIds.size > 0 && !issues.some((entry) => entry.code === "MISSING_MATERIAL_CLAIM_BLOCKER")) {
    issues.push(issue("MISSING_MATERIAL_CLAIM_BLOCKER", `Material claims have explicit blockers: ${[...blockedClaimIds].sort(compareStableStrings).join(", ")}`, [...blockedClaimIds].sort(compareStableStrings)));
  }
  const referencesValid = !issues.some((entry) => entry.code === "DUPLICATE_NODE_ID" || entry.code === "DANGLING_EDGE_REFERENCE" || entry.code === "FORGED_EVIDENCE_REFERENCE" || entry.code === "INVALID_SOURCE_METADATA");
  return Object.freeze({
    valid: referencesValid && closed && acyclic && materialClaimsTraceable,
    closed,
    acyclic,
    referencesValid,
    materialClaimsTraceable,
    materialClaimCount: materialClaims.length,
    traceableMaterialClaimCount,
    blockedClaimIds: Object.freeze([...blockedClaimIds].sort(compareStableStrings)),
    blockers: Object.freeze(blockers),
    claimPaths: Object.freeze(claimPaths),
    issues: Object.freeze(issues),
  });
}

function graphContent(graph: ResearchLineageGraph | Omit<ResearchLineageGraph, "contentHash">): Omit<ResearchLineageGraph, "contentHash"> {
  const { contentHash: _contentHash, ...content } = graph as ResearchLineageGraph;
  return content;
}

export function hashResearchLineageGraph(graph: ResearchLineageGraph | Omit<ResearchLineageGraph, "contentHash">): string {
  return stableHash(graphContent(graph), "research-lineage/graph/v1");
}

export function buildResearchLineageGraph(input: ResearchLineageGraphInput): ResearchLineageGraph {
  if (input === null || typeof input !== "object") throw new TypeError("Research lineage input must be an object");
  if (!Array.isArray(input.nodes) || !Array.isArray(input.edges)) throw new TypeError("Research lineage nodes and edges must be arrays");
  const nodesById = new Map<string, ResearchLineageNode>();
  for (const nodeInput of input.nodes) {
    const node = createResearchLineageNode(nodeInput);
    const existing = nodesById.get(node.id);
    if (existing) {
      if (existing.contentHash !== node.contentHash) throw new ResearchLineageCollisionError(`Lineage node ID ${node.id} has conflicting content`);
      continue;
    }
    nodesById.set(node.id, node);
  }
  const edgesByHash = new Map<string, ResearchLineageEdge>();
  for (const edgeInput of input.edges) {
    const edge = createResearchLineageEdge(edgeInput);
    edgesByHash.set(edge.contentHash, edge);
  }
  const nodes = [...nodesById.values()].sort(nodeOrder);
  const edges = [...edgesByHash.values()].sort(edgeOrder);
  const validation = inspectGraph(nodes, edges);
  const content: Omit<ResearchLineageGraph, "contentHash"> = {
    version: RESEARCH_LINEAGE_VERSION,
    subjectId: requiredText(input.subjectId, "subjectId"),
    nodes,
    edges,
    materialClaimCount: validation.materialClaimCount,
    traceableMaterialClaimCount: validation.traceableMaterialClaimCount,
    materialClaimsTraceable: validation.materialClaimsTraceable,
    blockedClaimIds: validation.blockedClaimIds,
    blockers: validation.blockers,
    validation,
  };
  return deepFreeze({ ...content, contentHash: stableHash(content, "research-lineage/graph/v1") }) as ResearchLineageGraph;
}

export function verifyResearchLineageGraph(value: unknown): value is ResearchLineageGraph {
  try {
    if (value === null || typeof value !== "object" || !isDeeplyFrozen(value)) return false;
    const graph = value as ResearchLineageGraph;
    if (graph.version !== RESEARCH_LINEAGE_VERSION || typeof graph.subjectId !== "string" || !graph.subjectId) return false;
    if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return false;
    if (!/^[a-f0-9]{64}$/.test(graph.contentHash ?? "")) return false;
    for (let index = 0; index < graph.nodes.length; index += 1) {
      const node = graph.nodes[index];
      const previous = graph.nodes[index - 1];
      if (!node || node.version !== RESEARCH_LINEAGE_VERSION || (previous && nodeOrder(previous, node) > 0)) return false;
      if (node.contentHash !== hashResearchLineageNode(node)) return false;
    }
    for (let index = 0; index < graph.edges.length; index += 1) {
      const edge = graph.edges[index];
      const previous = graph.edges[index - 1];
      if (!edge || edge.version !== RESEARCH_LINEAGE_VERSION || (previous && edgeOrder(previous, edge) > 0)) return false;
      if (edge.contentHash !== hashResearchLineageEdge(edge)) return false;
    }
    if (hashResearchLineageGraph(graph) !== graph.contentHash) return false;
    const validation = inspectGraph(graph.nodes, graph.edges);
    return graph.materialClaimCount === validation.materialClaimCount
      && graph.traceableMaterialClaimCount === validation.traceableMaterialClaimCount
      && graph.materialClaimsTraceable === validation.materialClaimsTraceable
      && (graph.blockedClaimIds === undefined || stableStringify(graph.blockedClaimIds) === stableStringify(validation.blockedClaimIds))
      && (graph.blockers === undefined || stableStringify(graph.blockers) === stableStringify(validation.blockers))
      && (graph.validation === undefined || stableStringify(graph.validation) === stableStringify(validation));
  } catch {
    return false;
  }
}

export function validateResearchLineageGraph(value: unknown): ResearchLineageValidation {
  if (value === null || typeof value !== "object") {
    return Object.freeze({
      valid: false,
      closed: false,
      acyclic: true,
      referencesValid: false,
      materialClaimsTraceable: false,
      materialClaimCount: 0,
      traceableMaterialClaimCount: 0,
      blockedClaimIds: Object.freeze([]),
      blockers: Object.freeze(["LINEAGE_INPUT_INVALID"]),
      claimPaths: Object.freeze({}),
      issues: Object.freeze([issue("INTEGRITY_FAILURE", "Research lineage graph is not an object")]),
    });
  }
  const graph = value as ResearchLineageGraph;
  const structural = inspectGraph(Array.isArray(graph.nodes) ? graph.nodes : [], Array.isArray(graph.edges) ? graph.edges : []);
  if (verifyResearchLineageGraph(graph)) return structural;
  return Object.freeze({
    ...structural,
    valid: false,
    issues: Object.freeze([...structural.issues, issue("INTEGRITY_FAILURE", "Research lineage graph failed content or immutability verification")]),
  });
}

export function traceMaterialClaim(graph: ResearchLineageGraph, claimNodeId: string): readonly string[] | null {
  const claimId = requiredText(claimNodeId, "claimNodeId");
  const validation = validateResearchLineageGraph(graph);
  if (validation.issues.some((entry) => entry.code === "FORGED_EVIDENCE_REFERENCE" && entry.nodeIds.includes(claimId))) return null;
  return validation.claimPaths[claimId] ?? null;
}

export const getLineagePath = traceMaterialClaim;
export const traceClaimPath = traceMaterialClaim;

export function isResearchLineageGraphClosed(value: unknown): boolean {
  return validateResearchLineageGraph(value).closed;
}

export function assertValidResearchLineageGraph(value: unknown): asserts value is ResearchLineageGraph {
  const validation = validateResearchLineageGraph(value);
  if (!validation.valid) {
    const codes = [...new Set(validation.issues.map((entry) => entry.code))].join(", ");
    throw new ResearchLineageIntegrityError(`Research lineage graph failed validation: ${codes}`);
  }
}
