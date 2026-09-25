import assert from "node:assert/strict";
import { deepFreeze } from "../src/lib/research-ledger/immutable";
import {
  CANONICAL_SOURCE_DEFAULTS,
  CANONICAL_SOURCE_TAXONOMY_VERSION,
  CANONICAL_SOURCE_TYPES,
  FactPackIntegrityError,
  buildFactPack,
  createCanonicalSourceMetadata,
  hashFactPack,
  selectLatestFact,
  verifyFactPack,
} from "../src/lib/ai-first";
import {
  buildResearchLineageGraph,
  createResearchLineageNode,
  traceMaterialClaim,
  validateResearchLineageGraph,
  verifyResearchLineageGraph,
  type ResearchLineageEdgeInput,
  type ResearchLineageNodeInput,
} from "../src/lib/research-lineage";

const retrievalTimestamp = "2026-09-25T12:00:00.000Z";

function raw(value: number): { raw: number; fmt: string } {
  return { raw: value, fmt: String(value) };
}

function row(period: string, values: Record<string, number>): Record<string, unknown> {
  return {
    endDate: { raw: period, fmt: period },
    maxAge: 1,
    ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, raw(value)])),
  };
}

function payload(rows: Record<string, unknown>[]): Record<string, unknown> {
  return {
    price: {
      longName: "Deterministic Industries",
      currency: "USD",
      regularMarketPrice: raw(50),
      marketCap: raw(5_000),
    },
    financialData: {},
    summaryDetail: {},
    defaultKeyStatistics: { sharesOutstanding: raw(100) },
    incomeStatementHistory: { incomeStatementHistory: rows },
  };
}

const older = row("2023-12-31", { totalRevenue: 100, netIncome: 10 });
const newer = row("2024-12-31", { totalRevenue: 125, netIncome: 15 });
const ascending = buildFactPack(payload([older, newer]), "DET", { retrievalTimestamp });
const reversed = buildFactPack(payload([newer, older]), "DET", { retrievalTimestamp });

let passed = 0;
let failed = 0;

function check(name: string, assertion: () => void): void {
  try {
    assertion();
    passed += 1;
    console.log(`  PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

check("canonical source taxonomy is versioned and complete", () => {
  assert.equal(CANONICAL_SOURCE_TAXONOMY_VERSION, "canonical-source-taxonomy-v1");
  assert.equal(CANONICAL_SOURCE_TYPES.length, 12);
  assert.equal(CANONICAL_SOURCE_TYPES.includes("ai" as never), false);
  assert.notEqual(CANONICAL_SOURCE_DEFAULTS.regulatory_filing.authority, CANONICAL_SOURCE_DEFAULTS.regulatory_filing.valueRole);
  assert.equal(typeof CANONICAL_SOURCE_DEFAULTS.regulatory_filing.confidence, "number");
  assert.equal(createCanonicalSourceMetadata({ type: "model_derived", sourceId: "model:test" }).authority, "model_derived");
});

check("period-specific fact IDs and reversed Yahoo rows are stable", () => {
  const firstRevenue = ascending.incomeStatement.facts.find((fact) => fact.metric === "totalRevenue" && fact.period === "2024-12-31");
  const secondRevenue = ascending.incomeStatement.facts.find((fact) => fact.metric === "totalRevenue" && fact.period === "2023-12-31");
  assert.ok(firstRevenue?.factId);
  assert.ok(secondRevenue?.factId);
  assert.notEqual(firstRevenue.factId, secondRevenue.factId);
  assert.equal(ascending.contentHash, reversed.contentHash);
  assert.deepEqual(ascending.incomeStatement.facts.map((fact) => fact.factId), reversed.incomeStatement.facts.map((fact) => fact.factId));
  assert.equal(selectLatestFact(ascending, "totalRevenue")?.period, "2024-12-31");
});

check("facts carry source, period, flags, raw field, normalization, and confidence", () => {
  const fact = ascending.incomeStatement.facts.find((candidate) => candidate.metric === "totalRevenue");
  assert.ok(fact);
  assert.equal(fact.source, "yfinance");
  assert.equal(fact.sourceMetadata?.type, "market_data_provider");
  assert.equal(fact.sourceMetadata?.authority, "secondary");
  assert.equal(fact.sourceMetadata?.valueRole, "market_observation");
  assert.equal(fact.asOfDate, "2024-12-31");
  assert.equal(fact.fiscalPeriod, "2024-12-31");
  assert.equal(fact.reportingPeriod, "2024-12-31");
  assert.equal(fact.estimated, false);
  assert.equal(fact.restated, false);
  assert.equal(fact.rawField, "totalRevenue");
  assert.equal(fact.normalization?.version, "fact-normalization-v1");
  assert.equal(fact.currencyConversion?.applied, false);
  assert.equal(fact.shareBasisConversion?.applied, false);
  assert.equal(fact.confidence, 0.7);
});

check("exact duplicates collapse and missing values never become zero", () => {
  const missingRow = row("2024-12-31", { totalRevenue: 125, netIncome: Number.NaN });
  const duplicatePack = buildFactPack(payload([missingRow, { ...missingRow }]), "DET", { retrievalTimestamp });
  const revenues = duplicatePack.incomeStatement.facts.filter((fact) => fact.metric === "totalRevenue");
  const missing = duplicatePack.incomeStatement.facts.find((fact) => fact.metric === "netIncome");
  assert.equal(revenues.length, 1);
  assert.equal(missing?.value, undefined);
  assert.equal(missing?.confidence, 0);
  const empty = buildFactPack({}, "EMPTY", { retrievalTimestamp });
  assert.equal(empty.incomeStatement.facts.length, 0);
  assert.equal(verifyFactPack(empty), true);
});

check("conflicting duplicate facts fail closed", () => {
  const conflict = row("2024-12-31", { totalRevenue: 125 });
  const conflicting = row("2024-12-31", { totalRevenue: 126 });
  assert.throws(() => buildFactPack(payload([conflict, conflicting]), "DET", { retrievalTimestamp }), FactPackIntegrityError);
});

check("fact packs are deeply frozen, isolated, content-addressed, and verifiable", () => {
  const input = payload([older, newer]);
  const pack = buildFactPack(input, "DET", { retrievalTimestamp });
  assert.equal(verifyFactPack(pack), true);
  assert.equal(pack.factPackId, `FACTPACK-${pack.contentHash?.toUpperCase()}`);
  assert.equal(Object.isFrozen(pack), true);
  assert.equal(Object.isFrozen(pack.incomeStatement.facts), true);
  assert.equal(Object.isFrozen(pack.incomeStatement.facts[0]), true);
  assert.equal(Object.isFrozen(pack.incomeStatement.raw), true);
  assert.equal(Object.isFrozen(input.incomeStatementHistory), false);
  const tampered = JSON.parse(JSON.stringify(pack)) as Record<string, unknown>;
  tampered.ticker = "FORGED";
  assert.notEqual(hashFactPack(tampered), pack.contentHash);
  assert.equal(verifyFactPack(deepFreeze(tampered)), false);
});

const sourceMetadata = createCanonicalSourceMetadata({
  type: "regulatory_filing",
  sourceId: "regulatory-filing:test-2024",
  authority: "primary",
  valueRole: "reported_fact",
  confidence: 0.98,
  publisher: "Test Regulator",
});

const lineageNodes: ResearchLineageNodeInput[] = [
  { id: "source", kind: "source_document", label: "Annual filing", sourceId: sourceMetadata.sourceId, source: sourceMetadata },
  { id: "observation", kind: "observation", label: "Revenue table", period: "FY2024" },
  { id: "fact", kind: "fact", label: "Revenue", value: 125, period: "FY2024", sourceId: sourceMetadata.sourceId, factId: "FACT-REVENUE" },
  { id: "derived", kind: "derived_metric", label: "Revenue growth", value: 0.25, period: "FY2024" },
  { id: "assumption", kind: "assumption", label: "Forecast growth", value: 0.1, period: "FY2025" },
  { id: "forecast", kind: "forecast", label: "Revenue forecast", value: 137.5, period: "FY2025" },
  { id: "valuation", kind: "valuation", label: "Equity value", value: 1000, period: "FY2025" },
  { id: "claim", kind: "claim", label: "Revenue growth supports value", material: true, evidenceNodeIds: ["fact", "valuation"] },
  { id: "conclusion", kind: "conclusion", label: "Investment conclusion" },
  { id: "conflict", kind: "conflict", label: "Restatement conflict" },
  { id: "action", kind: "corporate_action", label: "Stock split" },
  { id: "unknown", kind: "unknown", label: "Undisclosed segment value" },
];

const lineageEdges: ResearchLineageEdgeInput[] = [
  { from: "source", to: "observation", kind: "contains_observation" },
  { from: "observation", to: "fact", kind: "normalizes_to_fact" },
  { from: "fact", to: "derived", kind: "derives" },
  { from: "fact", to: "assumption", kind: "assumes" },
  { from: "assumption", to: "forecast", kind: "feeds_forecast" },
  { from: "forecast", to: "valuation", kind: "feeds_valuation" },
  { from: "valuation", to: "claim", kind: "supports_claim" },
  { from: "claim", to: "conclusion", kind: "concludes" },
  { from: "observation", to: "conflict", kind: "adjusts_for" },
  { from: "conflict", to: "claim", kind: "supports_claim" },
  { from: "source", to: "action", kind: "adjusts_for" },
  { from: "action", to: "claim", kind: "supports_claim" },
  { from: "unknown", to: "assumption", kind: "records_unknown" },
];

check("unified lineage graph is closed, deterministic, hashed, and immutable", () => {
  const graph = buildResearchLineageGraph({ subjectId: "DET", nodes: lineageNodes, edges: lineageEdges });
  const reordered = buildResearchLineageGraph({ subjectId: "DET", nodes: [...lineageNodes].reverse(), edges: [...lineageEdges].reverse() });
  const validation = validateResearchLineageGraph(graph);
  assert.equal(validation.valid, true, JSON.stringify(validation.issues));
  assert.equal(validation.closed, true, JSON.stringify(validation.issues));
  assert.equal(validation.materialClaimsTraceable, true, JSON.stringify(validation.issues));
  assert.equal(verifyResearchLineageGraph(graph), true, JSON.stringify(validation.issues));
  assert.equal(graph.contentHash, reordered.contentHash);
  assert.deepEqual(traceMaterialClaim(graph, "claim"), ["source", "observation", "fact", "assumption", "forecast", "valuation", "claim"]);
  assert.equal(Object.isFrozen(graph), true);
  assert.equal(Object.isFrozen(graph.nodes[0]), true);
  assert.equal(new Set(graph.nodes.map((node) => node.kind)).size, 12);
  assert.equal(createResearchLineageNode(lineageNodes[0]!).contentHash, createResearchLineageNode(lineageNodes[0]!).contentHash);
});

check("forged evidence and dangling edge references cannot validate", () => {
  const forgedNodes = lineageNodes.map((node) => node.id === "claim" ? { ...node, evidenceNodeIds: ["fabricated-fact"] } : node);
  const forged = buildResearchLineageGraph({
    subjectId: "DET",
    nodes: forgedNodes,
    edges: [...lineageEdges, { from: "valuation", to: "missing-node", kind: "supports_claim" }],
  });
  const validation = validateResearchLineageGraph(forged);
  assert.equal(verifyResearchLineageGraph(forged), true);
  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((entry) => entry.code === "FORGED_EVIDENCE_REFERENCE"), true);
  assert.equal(validation.issues.some((entry) => entry.code === "DANGLING_EDGE_REFERENCE"), true);
  assert.equal(traceMaterialClaim(forged, "claim"), null);
});

check("material claims without source lineage fail validation", () => {
  const graph = buildResearchLineageGraph({
    subjectId: "DET",
    nodes: [
      { id: "claim", kind: "claim", label: "Unsupported valuation claim", material: true },
      { id: "conclusion", kind: "conclusion", label: "Unsupported conclusion" },
    ],
    edges: [{ from: "claim", to: "conclusion", kind: "concludes" }],
  });
  const validation = validateResearchLineageGraph(graph);
  assert.equal(validation.valid, false);
  assert.equal(validation.closed, false);
  assert.equal(validation.materialClaimsTraceable, false);
  assert.equal(validation.issues.some((entry) => entry.code === "MISSING_MATERIAL_CLAIM_LINEAGE"), true);
});

console.log(`RESULT: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
