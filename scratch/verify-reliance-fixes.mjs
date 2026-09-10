import { createRequire } from "module";
import { computeDCF } from "../src/lib/calculations.ts";
import { computeDriverForecast } from "../src/lib/driver-models.ts";
import { buildCanonicalForecast } from "../src/lib/canonical-forecast.ts";
import { classifyArchetype } from "../src/lib/company-archetype.ts";
import { classifySector } from "../src/lib/sectors/profiles.ts";

const require = createRequire(import.meta.url);
const d = require("./reliance_data.json");
const A = d.annualFinancials;

let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("PASS:", name); }
  else { fail++; console.log("FAIL:", name, extra); }
};

// 0. Archetype / sector routing for Reliance
const arch = classifyArchetype(d.profile, d.stockData, A);
const sp = classifySector(d.profile.sector, d.profile.industry, d.profile.description);
console.log("Reliance sector:", d.profile.sector, "| industry:", d.profile.industry);
console.log("=> sectorProfile:", sp.id, "| archetype:", arch.sector, "/", arch.archetype);
check("Reliance archetype is energy_petrochem", arch.sector === "energy_petrochem", "got " + arch.sector);

// 1. EBITDA taxonomy: reported == EBIT + D&A exactly (validator's new anchor)
for (const f of A) {
  check(`${f.year} reported EBITDA == EBIT+D&A`, f.ebitda === f.ebit + f.depreciation,
    `rep=${f.ebitda} ebit+dep=${f.ebit + f.depreciation}`);
}

// 2. Debt split: short + long + leases == total (validator's new anchor)
for (const f of A) {
  const sum = (f.shortTermDebt || 0) + (f.longTermDebt || 0) + (f.capitalLeaseObligations || 0);
  check(`${f.year} std+ltd+leases == totalDebt`, sum === f.totalDebt, `sum=${sum} tot=${f.totalDebt}`);
}

// 3. Full DCF on Reliance data
const dcf = computeDCF(A, d.stockData, { id: sp.id }, arch, "India");
const p0 = dcf.projections[0];
check("forecast EBITDA == EBIT+D&A (exact by construction)", p0.ebitda === p0.ebit + p0.depreciation);
check("PP&E roll-forward engaged (ppe present)", typeof p0.ppe === "number" && p0.ppe > 0, "ppe=" + p0.ppe);
const capexPct = p0.capex / p0.revenue;
check("capex intensity ~12% (not clamped to 8%)", capexPct > 0.115 && capexPct < 0.125, (capexPct * 100).toFixed(2) + "%");
check("continuity guard fired", (dcf.diagnostics || []).some((x) => x.includes("Continuity guard ACTIVE")), JSON.stringify(dcf.diagnostics));
check("yr1 growth <13% (spike trimmed, was 16.9%)", p0.revenueGrowth < 0.13, (p0.revenueGrowth * 100).toFixed(2) + "%");
check("driver equation names segment mix", (dcf.assumptions?.revenueGrowthPath ? true : true) && /O2C|Jio|Retail/.test(dcf.assumptionBasis?.revenueGrowth || ""), (dcf.assumptionBasis?.revenueGrowth || "").slice(0, 80));
check("assumptionInputs carry continuityCap", dcf.assumptionInputs?.continuityCap !== undefined, JSON.stringify(Object.keys(dcf.assumptionInputs || {})));
const depRateMatch = /PP&E-anchored at ([0-9.]+)%/.exec(dcf.assumptionBasis?.capex || "");
check("D&A PP&E-anchored ~7.0% (opening-stock basis)", depRateMatch !== null && parseFloat(depRateMatch[1]) > 6.5 && parseFloat(depRateMatch[1]) < 7.5, depRateMatch?.[1]);
check("netDebt basis discloses leases", /lease/i.test(dcf.assumptionBasis?.netDebt || ""), (dcf.assumptionBasis?.netDebt || "").slice(0, 100));

// 4. Sealed canonical forecast parity (route-style inputs)
const rev0 = A[A.length - 1].revenue;
const pairs = [];
for (let i = 1; i < A.length; i++) {
  const prevPpe = A[i - 1].netFixedAssets || 0;
  if (prevPpe > 0) pairs.push(Math.abs(A[i].depreciation) / prevPpe);
}
const cf = buildCanonicalForecast({
  sectorId: sp.id, operatingArchetype: arch.sector, baseRevenue: rev0,
  marginalTaxRate: 0.25, wacc: 0.095, netDebt: 0, sharesOutstanding: 1,
  cagr: 0.064, winsorizedCagr: 0.064, winsorizedLive: 0.064, baseGrowth: 0.064,
  hasLive: false, liveRevGrowth: 0.064, years: A.length, effectiveMargin: 0.20,
  rawAvgCapexPct: 0.148, rawAvgDeptPct: 0.053,
  rawAvgDepOnPpe: pairs.reduce((s, r) => s + r, 0) / pairs.length,
  ppeBase: A[A.length - 1].netFixedAssets,
});
const c0 = cf.projections[0];
check("canonical ebitda == ebit+dep", c0.ebitda === c0.ebit + c0.depreciation);
check("canonical ppe present", typeof c0.ppe === "number" && c0.ppe > 0);
check("canonical 1.1x D&A floor parity", Math.abs(c0.capex - c0.revenue * Math.max(cf.avgCapexPct, cf.avgDeptPct * 1.1)) < 1);

// 5. Driver unit: generic industrial still generic (no energy bleed)
const g = computeDriverForecast({
  sectorId: "general", operatingArchetype: "general_industrial",
  inputs: { cagr: 0.1, winsorizedCagr: 0.1, winsorizedLive: 0.1, baseGrowth: 0.1, hasLive: false, liveRevGrowth: 0.1, years: 4, effectiveMargin: 0.15, rawAvgCapexPct: 0.05, rawAvgDeptPct: 0.04 },
});
check("generic driver equation unchanged", g.driverEquation.includes("consolidated; segment split undisclosed") && !/O2C/.test(g.driverEquation));

console.log(`\nverify-reliance-fixes: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
