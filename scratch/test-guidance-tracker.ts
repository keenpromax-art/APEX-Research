import { compareGuidance, createGuidanceObservation, guidanceCoverage } from "../src/lib/research-ledger";

const observation = createGuidanceObservation({ id: "G1", companyId: "TEST.NS", metric: "revenueGrowth", period: "FY2027", low: 0.10, high: 0.15, unit: "pct", source: "Annual report", issuedAt: "2026-09-01T00:00:00.000Z" });
const comparisons = compareGuidance([observation], [{ metric: "revenueGrowth", period: "FY2027", value: 0.12, unit: "pct" }]);
if (comparisons.length !== 1 || comparisons[0].status !== "within-range") throw new Error("range comparison failed");
if (guidanceCoverage(comparisons).score !== 1) throw new Error("coverage failed");
console.log("guidance tracker tests passed");
