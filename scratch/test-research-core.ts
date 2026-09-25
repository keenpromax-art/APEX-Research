import {
  createEvidenceRegistry,
  detectEvidenceConflicts,
  registerEvidence,
  type EvidenceRegistry,
} from "../src/lib/evidence-registry";
import { extractStructuredClaims, type Claim } from "../src/lib/claims";
import { validateClaim, validateClaimSet } from "../src/lib/claim-validator";
import { buildEvidenceGraph, type BuildEvidenceGraphInput } from "../src/lib/evidence-graph";
import type { ResearchCase } from "../src/lib/research-case";

let passes = 0;
let failures = 0;
function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    passes++;
    console.log(`  PASS ${name}`);
  } else {
    failures++;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function registryWithRevenue(): EvidenceRegistry {
  const registry = createEvidenceRegistry("2026-09-25T00:00:00.000Z");
  registerEvidence(registry, {
    id: "EV:PRIMARY:FILING:revenue:FY2026",
    tier: "PRIMARY",
    source: "Annual report",
    sourceType: "annual_report",
    field: "revenue",
    value: 100_000,
    unit: "money",
    currency: "INR",
    scale: "raw",
    periodCovered: "FY2026",
    fiscalPeriod: "2026-03-31",
    periodType: "ACTUAL",
  });
  registerEvidence(registry, {
    id: "EV:MODEL_DERIVED:DCF:wacc",
    tier: "MODEL_DERIVED",
    source: "DCF engine",
    sourceType: "model",
    field: "wacc",
    value: 9.5,
    unit: "pct",
  });
  return registry;
}

console.log("RESEARCH CORE TESTS");

const registry = registryWithRevenue();
registerEvidence(registry, {
  id: "EV:PRIMARY:FILING:revenue:FY2026",
  tier: "SECONDARY",
  source: "Market feed",
  sourceType: "market_data",
  field: "revenue",
  value: 99_000,
  unit: "money",
  currency: "INR",
  scale: "raw",
  periodCovered: "FY2026",
  periodType: "ACTUAL",
});
check("same-id collision is retained in the ledger", (registry.conflicts ?? []).some((conflict) => conflict.reason === "same_id_collision"));

registerEvidence(registry, {
  id: "EV:SECONDARY:FILING:revenue:FY2026",
  tier: "SECONDARY",
  source: "Secondary feed",
  sourceType: "market_data",
  field: "revenue",
  value: 102_000,
  unit: "money",
  currency: "INR",
  scale: "raw",
  periodCovered: "FY2026",
  periodType: "ACTUAL",
});
const conflicts = detectEvidenceConflicts(registry);
const valueConflict = conflicts.find((conflict) => conflict.reason === "value_mismatch");
check("distinct source values produce a conflict", Boolean(valueConflict));
check("primary source resolves the value conflict", valueConflict?.selected.tier === "PRIMARY");
check("source conflict is material", valueConflict?.material === true);

const structured = extractStructuredClaims("Revenue fell -5% while margin was 18.5%; fair value is ₹120.50 in FY2026 and P/E is 22x. European sales were €50m.");
check("all material numeric mentions are extracted", structured.length >= 5, `got ${structured.length}`);
check("negative percentage is preserved", structured.some((claim) => claim.numericValue === -5));
check("currency and scale are normalized", structured.some((claim) => claim.currency === "EUR" && claim.scale === "million"));
check("field and period metadata are captured", structured.some((claim) => claim.field === "fairValue") && structured.some((claim) => claim.period !== undefined));

const supported = validateClaimSet(extractStructuredClaims("Revenue was ₹100,000 in FY2026."), registry);
check("dimension-compatible claim validates", supported.verdicts.length === 1 && supported.verdicts[0].supported);
const wrongCurrency: Claim = {
  id: "wrong-currency",
  text: "Revenue was ₹100,000 in FY2026.",
  kind: "currency",
  numericValue: 100_000,
  numericRaw: "₹100,000",
  field: "revenue",
  unit: "money",
  currency: "USD",
  scale: "raw",
  period: "FY2026",
  sourceFactId: null,
  evidence: null,
  supported: false,
};
check("currency mismatch is not silently accepted", !validateClaim(wrongCurrency, registry).supported);

const researchCase = {
  caseId: "RC-CORE-TEST",
  version: "research-case-v1",
  stock: { currentPrice: 100 },
  assumptionsLedger: null,
  valuation: null,
  evidence: registry,
  researchQuestions: [
    {
      question: "What drives sustainable margin expansion?",
      why: "Margin is valuation-critical.",
      requiredFor: "valuation",
      yfinanceAvailable: false,
      evidenceNeeded: "Annual report and earnings call",
    },
  ],
} as unknown as ResearchCase;
const supportClaims = extractStructuredClaims("WACC is 9.5%.");
const graphInput: BuildEvidenceGraphInput = {
  researchCase,
  sections: [{ id: "valuation-section", title: "Valuation", index: 1, modules: ["valuation"] }] as never,
  builtAt: "2026-09-25T00:00:00.000Z",
  narratives: [
    { originId: "thesis", text: "WACC is 9.5%.", moduleId: "valuation", questionId: "question:1" },
    { originId: "counter", text: "WACC is 9.5% but cost pressure is rising.", moduleId: "valuation", stance: "contradicts", targetClaimId: supportClaims[0]?.id },
  ],
};
const graph = buildEvidenceGraph(graphInput);
check("research questions become graph nodes", graph.questions.length === 1 && graph.nodes.some((node) => node.kind === "question"));
check("questions link to analysis", graph.edges.some((edge) => edge.kind === "question-informs-analysis"));
check("counter-evidence is represented", graph.claims.some((claim) => claim.stance === "contradicts") && graph.nodes.some((node) => node.kind === "counter-evidence"));
check("counter-evidence challenges the target claim", graph.edges.some((edge) => edge.kind === "counter-evidence-challenges-claim"));
check("conflicts are projected into the graph", graph.conflicts.length > 0 && graph.nodes.some((node) => node.kind === "conflict"));
check("graph remains deterministic", JSON.stringify(buildEvidenceGraph(graphInput)) === JSON.stringify(graph));

console.log(`RESULT: ${passes} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
