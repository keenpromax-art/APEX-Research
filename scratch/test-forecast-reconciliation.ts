/**
 * APEX RESEARCH — Canonical Forecast Reconciliation Tests (TRACK 1)
 * ------------------------------------------------------------------
 * Verifies the single-pipeline invariants over ONE CanonicalForecast:
 *  1. Healthy builder output reconciles clean (no blockers/material).
 *  2. Margin continuity: MSFT-class cliff (46.8% → 14.8%) BLOCKS;
 *     material gaps flag material; continuous paths pass.
 *  3. Roll-forwards: tampered cash/debt/share closes BLOCK.
 *  4. DCF linkage: matching vectors/outputs pass; parallel
 *     growth/margin vectors BLOCK; scenario identity enforced.
 *  5. Spine verbatim: assertForecastSpineConsumed passes/fails correctly.
 *
 * Run: npx tsx scratch/test-forecast-reconciliation.ts (exit 1 on failure)
 */
import { buildCanonicalForecast, assertForecastSpineConsumed, type CanonicalForecast } from "../src/lib/canonical-forecast";
import { reconcileForecast } from "../src/lib/forecast-reconciliation";

let passes = 0;
let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { passes++; console.log(`  ✅ ${name}`); }
  else { failures++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));

function healthyForecast(): CanonicalForecast {
  const revenue = 100_000_000_000;
  const cash = 20_000_000_000;
  const debt = 30_000_000_000;
  const ar = 8_000_000_000;
  const inv = 4_000_000_000;
  const ap = 6_000_000_000;
  const ppe = 40_000_000_000;
  const assets = 150_000_000_000;
  const liab = 70_000_000_000;
  return buildCanonicalForecast({
    sectorId: "general",
    operatingArchetype: "general_industrial",
    baseRevenue: revenue,
    marginalTaxRate: 0.25,
    wacc: 0.10,
    netDebt: debt - cash,
    sharesOutstanding: 1_000_000_000,
    cagr: 0.08, winsorizedCagr: 0.08, winsorizedLive: 0.08, baseGrowth: 0.08,
    hasLive: false, liveRevGrowth: 0.08, years: 4,
    effectiveMargin: 0.19,
    rawAvgCapexPct: 0.05, rawAvgDeptPct: 0.035,
    trailing: {
      revenue, ebit: revenue * 0.20, ebitMargin: 0.20, netIncome: 12_000_000_000,
      cash, totalDebt: debt, equity: 80_000_000_000,
      totalAssets: assets, totalLiabilities: liab,
      sharesOutstanding: 1_000_000_000,
      receivables: ar, inventory: inv, payables: ap, ppe,
      otherAssets: assets - (cash + ar + inv + ppe),
      otherLiabilities: liab - (debt + ap),
      nwcLevel: 5_000_000_000,
      debtRate: 0.06, cashYield: 0.03, dividendPayout: 0.20,
      yearLabelBase: 2024,
    },
  });
}

function linkageInputs(fc: CanonicalForecast) {
  return {
    forecast: fc,
    dcfAssumptions: {
      revenueGrowthRates: [...fc.revenueGrowthRates],
      ebitMargins: [...fc.ebitMargins],
      avgCapexPct: fc.avgCapexPct, avgDeptPct: fc.avgDeptPct, avgNwcChangePct: fc.avgNwcChangePct,
      wacc: fc.wacc, terminalGrowthRate: fc.terminalGrowthRate,
    },
    dcfOutputs: {
      sumPvFcff: fc.dcf.sumPvFcff,
      enterpriseValue: fc.dcf.enterpriseValue,
      equityValue: fc.dcf.equityValue,
      fairValuePerShare: fc.dcf.fairValuePerShare,
      netDebt: fc.netDebt,
      sharesOutstanding: fc.sharesOutstanding,
    },
    scenarioBaseVector: {
      revenueGrowth: [...fc.scenarioVectors.base.revenueGrowth],
      ebitMargin: [...fc.scenarioVectors.base.ebitMargin],
    },
    enforceDcfLinkage: fc.valuationUse === "fcff",
  };
}

console.log("=======================================================");
console.log("FORECAST RECONCILIATION TESTS (TRACK 1)");
console.log("=======================================================\n");

// ── 1. Healthy forecast reconciles clean ──
console.log("--- 1. healthy builder output ---");
{
  const fc = healthyForecast();
  check("5 projection rows", fc.projections.length === 5, `got ${fc.projections.length}`);
  check("valuationUse is fcff (corporate)", fc.valuationUse === "fcff");
  check("DCF enterprise value positive", fc.dcf.enterpriseValue > 0, String(fc.dcf.enterpriseValue));
  const findings = reconcileForecast(linkageInputs(fc));
  const bad = findings.filter((f) => !f.pass && (f.severity === "blocker" || f.severity === "material"));
  check("zero blocker/material findings", bad.length === 0, bad.map((f) => `${f.rule}@${f.year ?? "-"}:${f.severity}`).join("; "));
  const spine = assertForecastSpineConsumed(fc.projections.map((p) => ({ revenue: p.revenue, ebitMargin: p.ebitMargin, fcff: p.fcff })), fc);
  check("spine verbatim passes", spine.ok, spine.detail);
}

// ── 2. Margin continuity (MSFT-class cliff) ──
console.log("--- 2. margin continuity ---");
{
  const fc = healthyForecast();
  const cliff = clone(fc);
  cliff.continuity = { ...cliff.continuity, trailingEbitMargin: 0.468, forecastY1Margin: 0.148, gapPp: 0.148 - 0.468, disclosedBasis: "test" };
  cliff.projections[0].ebitMargin = 0.148;
  cliff.projections[0].ebit = cliff.projections[0].revenue * 0.148;
  const f1 = reconcileForecast({ ...linkageInputs(cliff), forecast: cliff });
  check("46.8% → 14.8% cliff BLOCKS", f1.some((x) => x.rule === "margin-continuity" && !x.pass && x.severity === "blocker"), JSON.stringify(f1.filter((x) => x.rule === "margin-continuity")));
  const fc2 = healthyForecast();
  const mat = clone(fc2);
  const y1 = mat.continuity.trailingEbitMargin + 0.12;
  mat.continuity = { ...mat.continuity, forecastY1Margin: y1, gapPp: 0.12, disclosedBasis: "test" };
  mat.projections[0].ebitMargin = y1;
  mat.projections[0].ebit = mat.projections[0].revenue * y1;
  const f2 = reconcileForecast({ ...linkageInputs(mat), forecast: mat });
  check("12pp gap flags material (not blocker)", f2.some((x) => x.rule === "margin-continuity" && !x.pass && x.severity === "material"), JSON.stringify(f2.filter((x) => x.rule === "margin-continuity")));
}

// ── 3. Roll-forwards ──
console.log("--- 3. cash / debt / share roll-forwards ---");
{
  const fc = healthyForecast();
  const badCash = clone(fc);
  badCash.projections[2].cash += 2_000_000_000;
  const fCash = reconcileForecast({ ...linkageInputs(badCash), forecast: badCash });
  check("tampered cash BLOCKS", fCash.some((x) => x.rule === "cash-roll-forward" && !x.pass && x.severity === "blocker"));
  const badDebt = clone(fc);
  badDebt.projections[1].totalDebt += 1_000_000_000;
  const fDebt = reconcileForecast({ ...linkageInputs(badDebt), forecast: badDebt });
  check("tampered debt BLOCKS", fDebt.some((x) => x.rule === "debt-roll-forward" && !x.pass && x.severity === "blocker"));
  const badShr = clone(fc);
  badShr.projections[3].shares += 50_000_000;
  const fShr = reconcileForecast({ ...linkageInputs(badShr), forecast: badShr });
  check("drifted share count BLOCKS", fShr.some((x) => x.rule === "share-count-roll-forward" && !x.pass && x.severity === "blocker"));
  const badPpe = clone(fc);
  badPpe.projections[4].ppe += 2_000_000_000;
  const fPpe = reconcileForecast({ ...linkageInputs(badPpe), forecast: badPpe });
  check("tampered PP&E BLOCKS", fPpe.some((x) => x.rule === "ppe-roll-forward" && !x.pass && x.severity === "blocker"));
}

// ── 4. DCF linkage (parallel-model catcher) ──
console.log("--- 4. DCF linkage ---");
{
  const fc = healthyForecast();
  const inp = linkageInputs(fc);
  const ok = reconcileForecast(inp);
  check("matching vectors/outputs pass linkage", !ok.some((x) => x.rule === "dcf-linkage" && !x.pass));
  const parallel = clone(inp);
  parallel.dcfAssumptions = { ...parallel.dcfAssumptions, revenueGrowthRates: parallel.dcfAssumptions.revenueGrowthRates.map((g) => g * 1.5) };
  const fPar = reconcileForecast(parallel);
  check("parallel growth vectors BLOCK", fPar.some((x) => x.rule === "dcf-linkage" && !x.pass && x.severity === "blocker"));
  const badEv = clone(inp);
  badEv.dcfOutputs = { ...badEv.dcfOutputs, enterpriseValue: (badEv.dcfOutputs.enterpriseValue ?? 0) * 1.2 };
  const fEv = reconcileForecast(badEv);
  check("divergent EV BLOCKS", fEv.some((x) => x.rule === "dcf-linkage" && !x.pass && x.severity === "blocker"));
  const badScen = clone(inp);
  badScen.scenarioBaseVector = { revenueGrowth: badScen.scenarioBaseVector!.revenueGrowth.map((g) => g + 0.05), ebitMargin: badScen.scenarioBaseVector!.ebitMargin };
  const fScen = reconcileForecast(badScen);
  check("scenario vector drift BLOCKS", fScen.some((x) => x.rule === "scenario-vector-identity" && !x.pass && x.severity === "blocker"));
}

// ── 5. Spine verbatim negative control ──
console.log("--- 5. spine negative control ---");
{
  const fc = healthyForecast();
  const page = fc.projections.map((p) => ({ revenue: p.revenue, ebitMargin: p.ebitMargin, fcff: p.fcff }));
  page[1].revenue += 10_000_000;
  const r = assertForecastSpineConsumed(page, fc);
  check("tampered page revenue fails spine", !r.ok, r.detail);
}

console.log("\n=======================================================");
console.log(`RESULT: ${passes} passed, ${failures} failed`);
console.log("=======================================================");
process.exit(failures > 0 ? 1 : 0);
