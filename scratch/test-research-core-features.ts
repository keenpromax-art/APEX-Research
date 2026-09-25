import { buildExpectationsGap, buildRiskValueMap, buildThesisTree } from "../src/lib/research-core";
import { createEvidenceRegistry, registerEvidence } from "../src/lib/evidence-registry";

const registry = createEvidenceRegistry("2026-09-25T00:00:00.000Z");
registerEvidence(registry, { id: "EV:PRIMARY:model:growth:FY2027", tier: "PRIMARY", source: "Model", field: "revenueGrowth", value: 12, unit: "pct", periodCovered: "FY2027" });
const thesis = {
  thesis: "Revenue growth is 12% in FY2027.",
  bullCase: ["Growth accelerates."],
  bearCase: ["Growth slows."],
  keyDebate: "Can growth persist?",
  keyInflectionPoints: [],
  whatMarketMayBeMissing: "Margin durability.",
  whatCouldInvalidate: ["Growth falls below 8%."],
};
const tree = buildThesisTree(thesis, registry);
if (tree.root.status !== "supported") throw new Error(`root status ${tree.root.status}`);
if (tree.unresolved.length === 0) throw new Error("expected unresolved qualitative branches");
const gap = buildExpectationsGap({ reverseValuation: { variable: "revenueCagr", requiredValue: 0.1, interpretation: "Market expects 10%." }, baselineReconciliation: { rows: [{ metric: "Revenue growth", modelValue: 0.12 }] } as never });
if (gap.status !== "quantified" || Math.abs((gap.gap ?? 0) - 0.02) > 1e-9) throw new Error("expectations gap failed");
const risks = buildRiskValueMap({ risks: [{ risk: "Margin", mechanism: "m", affectedKpi: "margin", financialConsequence: "f", valuationConsequence: "v", monitoringIndicator: "m" }], scenarios: [{ name: "bear", changedVariables: [], targetPrice: 80, targetProvenance: "forecast" }], currentPrice: 100 });
if (Math.abs((risks[0].downsideToBearPct ?? 0) + 0.2) > 1e-9) throw new Error("risk value map failed");
console.log("research core feature tests passed");
