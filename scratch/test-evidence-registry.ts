/**
 * APEX RESEARCH — Evidence Registry + Claim Validator Tests (TRACK 3)
 * ----------------------------------------------------------------------
 *  1. Registry: ID convention, tier hierarchy (PRIMARY wins), get/list.
 *  2. matchNumeric: percentage / currency tolerances + tier preference.
 *  3. coverageScore: required-field accounting.
 *  4. buildEvidenceRegistryFromInputs: evidence IDs present with right tiers.
 *  5. Claim validator: supported→info, fabricated material→BLOCKER,
 *     multiples→warn, multi-claim coverage + set-level BLOCKER.
 *  6. Gate integration: claim blockers → publication BLOCKED.
 *  7. End-to-end: extractClaims → validateClaimSet against registry.
 *
 * Run: npx tsx scratch/test-evidence-registry.ts (exit 1 on failure)
 */
import {
  createEvidenceRegistry, registerEvidence, getEvidence, listEvidenceByTier,
  matchNumericEvidence, coverageScore, buildEvidenceRegistryFromInputs,
} from "../src/lib/evidence-registry";
import { validateClaim, validateClaimSet } from "../src/lib/claim-validator";
import { extractClaims, type Claim } from "../src/lib/claims";
import { evaluatePublicationGate, toGateFindings } from "../src/lib/publication-gate";

let passes = 0;
let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { passes++; console.log(`  ✅ ${name}`); }
  else { failures++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const claim = (id: string, text: string, kind: Claim["kind"], numericValue: number, numericRaw: string): Claim => ({
  id, text, kind, numericValue, numericRaw, sourceFactId: null, evidence: null, supported: false,
});

console.log("=======================================================");
console.log("EVIDENCE REGISTRY + CLAIM VALIDATOR TESTS (TRACK 3)");
console.log("=======================================================\n");

// ── 1. Registry hierarchy ──
console.log("--- 1. registry + source hierarchy ---");
{
  const reg = createEvidenceRegistry("2026-01-01T00:00:00.000Z");
  check("version pinned", reg.version === "evidence-registry-v1");
  registerEvidence(reg, { id: "EV:SECONDARY:YAHOO:revenue:FY24", tier: "SECONDARY", source: "Yahoo", field: "revenue", value: 1000, unit: "money" });
  const r1 = registerEvidence(reg, { id: "EV:SECONDARY:YAHOO:revenue:FY24", tier: "MODEL_DERIVED", source: "Model", field: "revenue", value: 1001, unit: "money" });
  check("higher tier kept on collision (SECONDARY wins)", !r1.replaced && (getEvidence(reg, "EV:SECONDARY:YAHOO:revenue:FY24")?.value === 1000));
  const r2 = registerEvidence(reg, { id: "EV:PRIMARY:FILING:revenue:FY24", tier: "PRIMARY", source: "10-K", field: "revenue", value: 1002, unit: "money" });
  check("PRIMARY registers alongside (distinct ID)", !r2.replaced && reg.items.length === 2);
  const reg2 = createEvidenceRegistry();
  registerEvidence(reg2, { id: "EV:X", tier: "MODEL_DERIVED", source: "M", field: "wacc", value: 9.5, unit: "pct" });
  const up = registerEvidence(reg2, { id: "EV:X", tier: "PRIMARY", source: "Filing", field: "wacc", value: 9.4, unit: "pct" });
  check("PRIMARY replaces MODEL_DERIVED on same ID", up.replaced && getEvidence(reg2, "EV:X")?.tier === "PRIMARY");
  check("listByTier filters", listEvidenceByTier(reg, "SECONDARY").length === 1 && listEvidenceByTier(reg, "PRIMARY").length === 1);
}

// ── 2. matchNumeric ──
console.log("--- 2. numeric matching + tier preference ---");
{
  const reg = createEvidenceRegistry();
  registerEvidence(reg, { id: "EV:MODEL_DERIVED:DCF:wacc", tier: "MODEL_DERIVED", source: "DCF", field: "wacc", value: 9.5, unit: "pct" });
  check("percentage within 0.85pp matches", matchNumericEvidence(reg, 9.9, { kind: "percentage" })?.id === "EV:MODEL_DERIVED:DCF:wacc");
  check("percentage far outside misses", matchNumericEvidence(reg, 67.3, { kind: "percentage" }) === null);
  registerEvidence(reg, { id: "EV:SECONDARY:YAHOO:revenue:FY24", tier: "SECONDARY", source: "Yahoo", field: "revenue", value: 1_000_000, unit: "money" });
  check("currency within 2% matches", matchNumericEvidence(reg, 1_015_000, { kind: "currency" })?.tier === "SECONDARY");
  check("currency far outside misses", matchNumericEvidence(reg, 5_000_000, { kind: "currency" }) === null);
  // Tier preference: same value at PRIMARY and MODEL_DERIVED → PRIMARY wins.
  registerEvidence(reg, { id: "EV:PRIMARY:FILING:revenue:FY24", tier: "PRIMARY", source: "10-K", field: "revenue", value: 1_000_400, unit: "money" });
  check("PRIMARY preferred over SECONDARY on dual match", matchNumericEvidence(reg, 1_000_200, { kind: "currency" })?.tier === "PRIMARY");
}

// ── 3. coverageScore ──
console.log("--- 3. coverage scoring ---");
{
  const reg = createEvidenceRegistry();
  registerEvidence(reg, { id: "EV:SECONDARY:YAHOO:revenue:FY24", tier: "SECONDARY", source: "Y", field: "revenue", value: 1, unit: "money" });
  const cov = coverageScore(reg, ["revenue", "wacc", "fairValue"]);
  check("1/3 covered, 2 missing", cov.covered === 1 && cov.total === 3 && cov.missing.length === 2);
  check("score is fraction", Math.abs(cov.score - 1 / 3) < 1e-9);
}

// ── 4. buildEvidenceRegistryFromInputs ──
console.log("--- 4. evidence IDs in data ---");
{
  const reg = buildEvidenceRegistryFromInputs({
    annualFinancials: [{ year: "FY2024", revenue: 500_000_000_000, netIncome: 50_000_000_000 }],
    stockData: { currentPrice: 1000, sharesOutstanding: 1_000_000_000, marketCap: 1_000_000_000_000 },
    dcf: { assumptions: { wacc: 0.095, terminalGrowthRate: 0.04, revenueGrowthRates: [0.12, 0.10], ebitMargins: [0.20, 0.21] }, intrinsicValue: 1200 },
  });
  const ids = new Set(reg.items.map((e) => e.id));
  check("price ID present", ids.has("EV:SECONDARY:YAHOO:price:CMP"));
  check("shares ID present", ids.has("EV:SECONDARY:YAHOO:shares:OUTSTANDING"));
  check("revenue ID present", ids.has("EV:SECONDARY:YAHOO:revenue:FY2024"));
  check("wacc ID present", ids.has("EV:MODEL_DERIVED:DCF:wacc"));
  check("growth vector IDs present", ids.has("EV:MODEL_DERIVED:DCF:revenueGrowth:Y1") && ids.has("EV:MODEL_DERIVED:DCF:revenueGrowth:Y2"));
  check("fairValue ID present", ids.has("EV:MODEL_DERIVED:DCF:fairValue"));
  check("price tier SECONDARY", getEvidence(reg, "EV:SECONDARY:YAHOO:price:CMP")?.tier === "SECONDARY");
  check("wacc tier MODEL_DERIVED", getEvidence(reg, "EV:MODEL_DERIVED:DCF:wacc")?.tier === "MODEL_DERIVED");
  check("wacc stored on 0-100 scale", getEvidence(reg, "EV:MODEL_DERIVED:DCF:wacc")?.value === 9.5);
}

// ── 5. Claim validator ──
console.log("--- 5. claim validator (multi-claim, tiers, BLOCKER) ---");
{
  const reg = buildEvidenceRegistryFromInputs({
    annualFinancials: [{ year: "FY2024", revenue: 500_000_000_000, netIncome: 50_000_000_000 }],
    stockData: { currentPrice: 1000, sharesOutstanding: 1_000_000_000, marketCap: 1_000_000_000_000 },
    dcf: { assumptions: { wacc: 0.095, terminalGrowthRate: 0.04, revenueGrowthRates: [0.12], ebitMargins: [0.20] }, intrinsicValue: 1200 },
  });
  const vWacc = validateClaim(claim("c1", "WACC is 9.5%.", "percentage", 9.5, "9.5%"), reg);
  check("supported wacc → info/pass with evidence ID", vWacc.supported && vWacc.severity === "info" && vWacc.evidenceId === "EV:MODEL_DERIVED:DCF:wacc");
  const vFab = validateClaim(claim("c2", "Occupancy reached 67.3%.", "percentage", 67.3, "67.3%"), reg);
  check("fabricated 67.3% → BLOCKER", !vFab.supported && vFab.severity === "blocker" && vFab.evidenceId === null);
  const vMult = validateClaim(claim("c3", "Trades at 35x earnings.", "multiple", 35, "35x"), reg);
  check("unsupported multiple → warn (not blocker)", !vMult.supported && vMult.severity === "warn");
  const set = validateClaimSet([
    claim("c1", "WACC is 9.5%.", "percentage", 9.5, "9.5%"),
    claim("c2", "Growth is 12%.", "percentage", 12, "12%"),
    claim("c3", "Occupancy reached 67.3%.", "percentage", 67.3, "67.3%"),
  ], reg);
  check("2/3 supported, coverage 0.667", set.supported === 2 && set.total === 3 && Math.abs(set.coverage - 2 / 3) < 1e-9);
  check("1 blocker in set", set.blockers.length === 1 && !set.setBlocker);
  const fabSet = validateClaimSet([
    claim("f1", "RevPAR Rs 8,400.", "currency", 8400, "Rs 8,400"),
    claim("f2", "Occupancy 67.3%.", "percentage", 67.3, "67.3%"),
    claim("f3", "ADR grew 41.7%.", "percentage", 41.7, "41.7%"),
  ], reg);
  check("3 fabricated material → set-level BLOCKER", fabSet.setBlocker && fabSet.blockers.length === 3);
  const empty = validateClaimSet([], reg);
  check("empty set coverage 1, no blockers", empty.coverage === 1 && empty.blockers.length === 0 && !empty.setBlocker);
}

// ── 6. Gate integration ──
console.log("--- 6. gate integration ---");
{
  const gateBlock = evaluatePublicationGate([
    { source: "RECON", code: "cash-roll-forward", severity: "blocker", detail: "cash" },
    ...[{ claimId: "c2", text: "t", kind: "percentage" as const, supported: false, tier: null, evidenceId: null, severity: "blocker" as const, detail: "fabricated" }].map((v) => ({
      source: "QA" as const, code: "CLAIM", severity: v.severity, detail: v.detail,
    })),
  ]);
  check("claim + recon blockers → BLOCKED", gateBlock.decision === "BLOCKED" && gateBlock.blockers.length === 2);
  void toGateFindings;
}

// ── 7. End-to-end extract → validate ──
console.log("--- 7. extractClaims end-to-end ---");
{
  const reg = buildEvidenceRegistryFromInputs({
    annualFinancials: [{ year: "FY2024", revenue: 500_000_000_000, netIncome: 50_000_000_000 }],
    stockData: { currentPrice: 1000, sharesOutstanding: 1_000_000_000, marketCap: 1_000_000_000_000 },
    dcf: { assumptions: { wacc: 0.095, terminalGrowthRate: 0.04, revenueGrowthRates: [0.12], ebitMargins: [0.20] }, intrinsicValue: 1200 },
  });
  const claims = extractClaims("WACC stands at 9.5% with terminal growth of 4.0%. Occupancy hit 67.3% last quarter.");
  check("extracts ≥2 numeric claims", claims.length >= 2, `got ${claims.length}`);
  const res = validateClaimSet(claims, reg);
  check("model numbers supported, occupancy blocker present",
    res.verdicts.some((v) => v.supported) && res.verdicts.some((v) => !v.supported && v.severity === "blocker"));
}

console.log("\n=======================================================");
console.log(`RESULT: ${passes} passed, ${failures} failed`);
console.log("=======================================================");
process.exit(failures > 0 ? 1 : 0);
