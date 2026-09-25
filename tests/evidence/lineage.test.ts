import { createSuite, check, report } from "../helpers/assert";
import { buildFactPack, verifyFactPack } from "../../src/lib/ai-first/fact-pack";
import { buildResearchLineageGraph, validateResearchLineageGraph, verifyResearchLineageGraph, traceMaterialClaim } from "../../src/lib/research-lineage";
import { createCanonicalSourceMetadata } from "../../src/lib/ai-first/types";
import { FIXED_TIMESTAMP, statementRow } from "../helpers/payloads";

const suite = createSuite();

const pack = buildFactPack({
  price: { currency: "USD", regularMarketPrice: { raw: 100 } },
  defaultKeyStatistics: { sharesOutstanding: { raw: 10 } },
  incomeStatementHistory: { incomeStatementHistory: [statementRow("2024-12-31", { totalRevenue: 1000, netIncome: 100 })] },
}, "LIN", { retrievalTimestamp: FIXED_TIMESTAMP });

check(suite, "fact pack verifies", verifyFactPack(pack) === true);
check(suite, "canonical source metadata carries authority", createCanonicalSourceMetadata({ type: "model_derived", sourceId: "model:test" }).authority === "model_derived");

const nodes = [
  { id: "source", kind: "source_document", label: "Annual filing", sourceId: "regulatory-filing:test-2024", source: createCanonicalSourceMetadata({ type: "regulatory_filing", sourceId: "regulatory-filing:test-2024" }) },
  { id: "observation", kind: "observation", label: "Revenue table", period: "FY2024" },
  { id: "fact", kind: "fact", label: "Revenue", value: 125, period: "FY2024", sourceId: "regulatory-filing:test-2024", factId: "FACT-REVENUE" },
  { id: "derived", kind: "derived_metric", label: "Revenue growth", value: 0.25, period: "FY2024" },
  { id: "assumption", kind: "assumption", label: "Forecast growth", value: 0.1, period: "FY2025" },
  { id: "forecast", kind: "forecast", label: "Revenue forecast", value: 137.5, period: "FY2025" },
  { id: "valuation", kind: "valuation", label: "Equity value", value: 1000, period: "FY2025" },
  { id: "claim", kind: "claim", label: "Revenue supports value", material: true, evidenceNodeIds: ["fact", "valuation"] },
  { id: "conclusion", kind: "conclusion", label: "Conclusion" },
] as unknown as Parameters<typeof buildResearchLineageGraph>[0]["nodes"];

const edges = [
  { from: "source", to: "observation", kind: "contains_observation" },
  { from: "observation", to: "fact", kind: "normalizes_to_fact" },
  { from: "fact", to: "derived", kind: "derives" },
  { from: "fact", to: "assumption", kind: "assumes" },
  { from: "assumption", to: "forecast", kind: "feeds_forecast" },
  { from: "forecast", to: "valuation", kind: "feeds_valuation" },
  { from: "valuation", to: "claim", kind: "supports_claim" },
  { from: "claim", to: "conclusion", kind: "concludes" },
] as unknown as Parameters<typeof buildResearchLineageGraph>[0]["edges"];

check(suite, "lineage graph validates closed", (() => {
  const graph = buildResearchLineageGraph({ subjectId: "LIN", nodes, edges });
  const validation = validateResearchLineageGraph(graph);
  return validation.valid === true && validation.closed === true && verifyResearchLineageGraph(graph) === true;
})());
check(suite, "material claim traces to source", (() => {
  const graph = buildResearchLineageGraph({ subjectId: "LIN", nodes, edges });
  const path = traceMaterialClaim(graph, "claim");
  return Array.isArray(path) && path[0] === "source" && path[path.length - 1] === "claim";
})());
check(suite, "forged evidence reference fails", (() => {
  const forged = buildResearchLineageGraph({
    subjectId: "LIN",
    nodes: [{ id: "claim", kind: "claim", label: "forged", material: true, evidenceNodeIds: ["missing"] }] as unknown as Parameters<typeof buildResearchLineageGraph>[0]["nodes"],
    edges: [],
  });
  return validateResearchLineageGraph(forged).issues.some((i) => i.code === "FORGED_EVIDENCE_REFERENCE");
})());
check(suite, "unsupported claim without lineage fails", (() => {
  const graph = buildResearchLineageGraph({
    subjectId: "LIN",
    nodes: [
      { id: "claim", kind: "claim", label: "Unsupported", material: true },
      { id: "conclusion", kind: "conclusion", label: "Conclusion" },
    ] as unknown as Parameters<typeof buildResearchLineageGraph>[0]["nodes"],
    edges: [{ from: "claim", to: "conclusion", kind: "concludes" }] as unknown as Parameters<typeof buildResearchLineageGraph>[0]["edges"],
  });
  const validation = validateResearchLineageGraph(graph);
  return validation.valid === false && validation.materialClaimsTraceable === false;
})());

report(suite, "evidence/lineage");
