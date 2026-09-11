/**
 * APEX RESEARCH — Research Integrity Layer Tests (TRACK 2)
 * ----------------------------------------------------------
 *  1. Severity taxonomy: ordering + BLOCKER conversions (QA / validator /
 *     identities / independent → canonical).
 *  2. ResearchIntegrityScore math + grades + gate pass/fail.
 *  3. PublicationGate: READY / READY_WITH_WARNINGS / BLOCKED across all
 *     sources (QA, RECON, LABEL, DISC).
 *  4. Discontinuity rules DISC-01..04 (revenue jump BLOCKS, margin cliff /
 *     receivables / rev-cash MATERIAL, clean history passes).
 *  5. Labeling invariants INV-01..05 (financial↔vectors-only, corporate↔fcff,
 *     model-tag match, sector-lens match, shape/use match).
 *  6. MSFT / Delhivery regression pins (sector, forbidden vocab, labeling).
 *
 * Run: npx tsx scratch/test-research-integrity.ts (exit 1 on failure)
 */
import {
  compareSeverity, maxSeverity, qaStatusToSeverity, validatorSeverityToResearch,
  identitySeverityToResearch, independentSeverityToResearch, researchToQACheckStatus,
  type ResearchSeverity,
} from "../src/lib/severity";
import { scoreFromBreakdown, scoreFromSeverities, scoreFromQAChecks } from "../src/lib/research-integrity-score";
import {
  checkHistoricalDiscontinuities, evaluatePublicationGate, toGateFindings,
} from "../src/lib/publication-gate";
import {
  checkValuationLabeling, checkSectorLensLabeling, checkForecastLabeling,
} from "../src/lib/labeling-invariants";
import { buildResearchOperatingModel } from "../src/lib/research-model/operating-model";
import { validateReport as validateModelReport } from "../src/lib/research-model/model-validator";

let passes = 0;
let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { passes++; console.log(`  ✅ ${name}`); }
  else { failures++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const PROFILE = (p: Record<string, unknown>) => ({
  ticker: "TEST", name: "Test Co", sector: "", industry: "", currency: "USD",
  exchange: "N/A", country: "USA", description: "", ...p,
});
const MSFT = PROFILE({
  ticker: "MSFT", name: "Microsoft Corporation", sector: "Technology",
  industry: "Software - Infrastructure",
  description: "Microsoft develops cloud computing through Azure, productivity software through Microsoft 365, and personal computing through Windows.",
});
const DELHIVERY = PROFILE({
  ticker: "DELHIVERY.NS", name: "Delhivery Limited", sector: "Industrials",
  industry: "Integrated Freight & Logistics", currency: "INR", exchange: "NSE", country: "India",
  description: "Delhivery provides express parcel, part-truckload and supply chain services across India.",
});

console.log("=======================================================");
console.log("RESEARCH INTEGRITY LAYER TESTS (TRACK 2)");
console.log("=======================================================\n");

// ── 1. Severity taxonomy ──
console.log("--- 1. severity taxonomy + conversions ---");
{
  const order: ResearchSeverity[] = ["info", "warn", "material", "blocker"];
  check("rank ordering info<warn<material<blocker",
    compareSeverity("info", "warn") < 0 && compareSeverity("warn", "material") < 0 && compareSeverity("material", "blocker") < 0);
  check("maxSeverity picks blocker", maxSeverity(["warn", "info", "blocker", "material"]) === "blocker");
  check("maxSeverity empty → info", maxSeverity([]) === "info");
  void order;
  check("QA FAIL→blocker", qaStatusToSeverity("FAIL") === "blocker");
  check("QA WARN→warn", qaStatusToSeverity("WARN") === "warn");
  check("QA PASS→info", qaStatusToSeverity("PASS") === "info");
  check("validator CRITICAL_BLOCK→blocker", validatorSeverityToResearch("CRITICAL_BLOCK") === "blocker");
  check("validator WARNING→warn", validatorSeverityToResearch("WARNING") === "warn");
  check("identity FATAL→blocker", identitySeverityToResearch("FATAL") === "blocker");
  check("identity FLAG→warn", identitySeverityToResearch("FLAG") === "warn");
  check("independent FAIL→blocker", independentSeverityToResearch("FAIL") === "blocker");
  check("blocker→FAIL, material→WARN, warn→WARN, info→PASS",
    researchToQACheckStatus("blocker") === "FAIL" && researchToQACheckStatus("material") === "WARN" &&
    researchToQACheckStatus("warn") === "WARN" && researchToQACheckStatus("info") === "PASS");
}

// ── 2. Integrity score ──
console.log("--- 2. integrity score ---");
{
  check("clean = 100/A", scoreFromBreakdown({ blockers: 0, materials: 0, warns: 0, infos: 2 }).score === 100);
  check("1 blocker = 75", scoreFromBreakdown({ blockers: 1, materials: 0, warns: 0, infos: 0 }).score === 75);
  check("1 material = 90", scoreFromBreakdown({ blockers: 0, materials: 1, warns: 0, infos: 0 }).score === 90);
  check("1 warn = 95", scoreFromBreakdown({ blockers: 0, materials: 0, warns: 1, infos: 0 }).score === 95);
  check("floors at 0", scoreFromBreakdown({ blockers: 9, materials: 0, warns: 0, infos: 0 }).score === 0);
  check("blocker fails gate", !scoreFromBreakdown({ blockers: 1, materials: 0, warns: 0, infos: 0 }).passesGate);
  check("material-only passes gate", scoreFromBreakdown({ blockers: 0, materials: 2, warns: 1, infos: 0 }).passesGate);
  check("QA FAIL scores as blocker", scoreFromQAChecks([{ status: "FAIL" }]).breakdown.blockers === 1);
  check("severities aggregate", scoreFromSeverities(["blocker", "material", "warn", "info"]).score === 100 - 25 - 10 - 5);
}

// ── 3. Publication gate decisions ──
console.log("--- 3. publication gate ---");
{
  check("empty → READY", evaluatePublicationGate([]).decision === "READY");
  const warnOnly = evaluatePublicationGate(toGateFindings.qa([{ id: "MARGIN-01", status: "WARN", details: "step" }]));
  check("QA WARN → READY_WITH_WARNINGS", warnOnly.decision === "READY_WITH_WARNINGS");
  const failGate = evaluatePublicationGate(toGateFindings.qa([{ id: "XREF-01", status: "FAIL", details: "bridge" }]));
  check("QA FAIL → BLOCKED", failGate.decision === "BLOCKED" && failGate.blockers.length === 1);
  const reconBlock = evaluatePublicationGate(toGateFindings.recon([{ rule: "cash-roll-forward", pass: false, severity: "blocker", detail: "cash" }]));
  check("RECON blocker → BLOCKED", reconBlock.decision === "BLOCKED");
  const reconMat = evaluatePublicationGate(toGateFindings.recon([{ rule: "margin-continuity", pass: false, severity: "material", detail: "gap" }]));
  check("RECON material → READY_WITH_WARNINGS", reconMat.decision === "READY_WITH_WARNINGS");
  const labelBlock = evaluatePublicationGate(toGateFindings.label([{ invariant: "INV-01", pass: false, severity: "blocker", detail: "fcff on bank" }]));
  check("LABEL blocker → BLOCKED", labelBlock.decision === "BLOCKED");
  const mixed = evaluatePublicationGate([
    ...toGateFindings.qa([{ id: "A", status: "WARN", details: "w" }]),
    ...toGateFindings.recon([{ rule: "funding-liquidity", pass: false, severity: "material", detail: "gap" }]),
  ]);
  check("material+warn → READY_WITH_WARNINGS", mixed.decision === "READY_WITH_WARNINGS" && mixed.score.score === 100 - 10 - 5);
}

// ── 4. Discontinuity rules ──
console.log("--- 4. discontinuity rules ---");
{
  const row = (year: string, revenue: number, extra: Record<string, number> = {}) => ({
    year, revenue, netIncome: revenue * 0.1, operatingCashFlow: revenue * 0.12,
    netReceivables: revenue * 0.08, totalAssets: revenue * 1.4, grossMargin: 0.42, ...extra,
  });
  const clean = [row("FY2022", 100), row("FY2023", 112), row("FY2024", 125)];
  check("clean history → no findings", checkHistoricalDiscontinuities(clean).length === 0);
  const jump = [row("FY2022", 100), row("FY2023", 900)];
  const fJump = checkHistoricalDiscontinuities(jump);
  check("revenue +800% → DISC-01 blocker", fJump.some((f) => f.code === "DISC-01" && f.severity === "blocker")); 
  check("DISC-01 feeds gate BLOCKED",
    evaluatePublicationGate(toGateFindings.disc(fJump)).decision === "BLOCKED");
  const cliff = [row("FY2022", 100, { grossMargin: 0.45 }), row("FY2023", 110, { grossMargin: 0.25 })];
  const fCliff = checkHistoricalDiscontinuities(cliff);
  check("gross-margin 20pp collapse → DISC-02 material", fCliff.some((f) => f.code === "DISC-02" && f.severity === "material"));
  const recv = [row("FY2022", 100, {}), row("FY2023", 105, {})].map((r, i) =>
    i === 1 ? { ...r, netReceivables: 100 * 0.08 * 2.2 } : r);
  const fRecv = checkHistoricalDiscontinuities(recv);
  check("receivables surge → DISC-03 material", fRecv.some((f) => f.code === "DISC-03" && f.severity === "material"));
  const div = [
    row("FY2022", 100, { operatingCashFlow: 12 }),
    row("FY2023", 130, { operatingCashFlow: 12 * 0.6 }),
  ];
  const fDiv = checkHistoricalDiscontinuities(div);
  check("revenue/cash divergence → DISC-04 material", fDiv.some((f) => f.code === "DISC-04" && f.severity === "material"));
}

// ── 5. Labeling invariants ──
console.log("--- 5. labeling invariants ---");
{
  const finOk = checkValuationLabeling({ isFinancialInstitution: true, valuationUse: "vectors-only", statementShape: "financial", hasProjections: false, modelTag: "PB_RESIDUAL_INCOME" });
  check("financial + vectors-only + no projections passes", finOk.every((f) => f.pass));
  const finBad = checkValuationLabeling({ isFinancialInstitution: true, valuationUse: "fcff", statementShape: "corporate", hasProjections: true, modelTag: "FCFF_DCF" });
  check("financial + fcff BLOCKS (INV-01)", finBad.some((f) => !f.pass && f.severity === "blocker"));
  const corpOk = checkValuationLabeling({ isFinancialInstitution: false, valuationUse: "fcff", statementShape: "corporate", hasProjections: true, modelTag: "FCFF_DCF" });
  check("corporate + fcff + projections passes", corpOk.every((f) => f.pass));
  const corpBad = checkValuationLabeling({ isFinancialInstitution: false, valuationUse: "vectors-only", statementShape: "financial", hasProjections: false, modelTag: "PB_RESIDUAL_INCOME" });
  check("corporate + vectors-only BLOCKS (INV-02)", corpBad.some((f) => !f.pass && f.severity === "blocker"));
  check("hardware + ARR lens BLOCKS", checkSectorLensLabeling({ sectorId: "technology-hardware", valuationLens: "FCFF_DCF (ARR×NRR) + EV/Sales" }).some((f) => !f.pass));
  check("software + units lens BLOCKS", checkSectorLensLabeling({ sectorId: "technology-software", valuationLens: "FCFF_DCF (units×ASP) + EV/EBITDA" }).some((f) => !f.pass));
  check("software + ARR lens passes", checkSectorLensLabeling({ sectorId: "technology-software", valuationLens: "FCFF_DCF (ARR×NRR) + EV/Sales" }).every((f) => f.pass));
  check("shape/use mismatch BLOCKS", checkForecastLabeling({ statementShape: "corporate", valuationUse: "vectors-only" }).some((f) => !f.pass));
  check("shape/use match passes", checkForecastLabeling({ statementShape: "corporate", valuationUse: "fcff" }).every((f) => f.pass));
}

// ── 6. MSFT / Delhivery regression ──
console.log("--- 6. MSFT / Delhivery regression ---");
{
  const mMsft = buildResearchOperatingModel({ profile: MSFT as never });
  const mDel = buildResearchOperatingModel({ profile: DELHIVERY as never });
  check("MSFT → technology-software", mMsft.sector === "technology-software", `got ${mMsft.sector}`);
  check("Delhivery → internet-retail", mDel.sector === "internet-retail", `got ${mDel.sector}`);
  const msClean = "Subscription ARR expanded with strong net revenue retention; large-deal TCV conversion supports multi-year visibility.";
  const msDirty = "Growth came from offshore delivery pyramid optimization with billable utilization gains.";
  check("MSFT clean software narrative passes", validateModelReport(mMsft, { thesis: msClean }).pass);
  check("MSFT pyramid narrative BLOCKS", !validateModelReport(mMsft, { thesis: msDirty }).pass);
  const msLabel = [
    ...checkValuationLabeling({ isFinancialInstitution: mMsft.isFinancialInstitution, valuationUse: "fcff", statementShape: "corporate", hasProjections: true, modelTag: "FCFF_DCF" }),
    ...checkSectorLensLabeling({ sectorId: mMsft.sector, valuationLens: "FCFF_DCF (ARR×NRR) + EV/Sales" }),
  ];
  check("MSFT labeling (fcff + ARR lens) passes", msLabel.every((f) => f.pass));
  check("MSFT hardware lens BLOCKS", checkSectorLensLabeling({ sectorId: mMsft.sector, valuationLens: "FCFF_DCF (units×ASP×mix) + EV/EBITDA" }).some((f) => !f.pass));
  const delClean = "Order volume grew across the express parcel network with stable average order value (AOV) and improving take rate on fulfillment.";
  const delDirty = "Commodity feedstock procurement and upstream crude exposure drove plant turnaround costs.";
  check("Delhivery clean logistics narrative passes", validateModelReport(mDel, { thesis: delClean }).pass);
  check("Delhivery commodity narrative BLOCKS", !validateModelReport(mDel, { thesis: delDirty }).pass);
  const delLabel = checkValuationLabeling({ isFinancialInstitution: mDel.isFinancialInstitution, valuationUse: "fcff", statementShape: "corporate", hasProjections: true, modelTag: "FCFF_DCF" });
  check("Delhivery labeling (corporate/fcff) passes", delLabel.every((f) => f.pass));
}

console.log("\n=======================================================");
console.log(`RESULT: ${passes} passed, ${failures} failed`);
console.log("=======================================================");
process.exit(failures > 0 ? 1 : 0);
