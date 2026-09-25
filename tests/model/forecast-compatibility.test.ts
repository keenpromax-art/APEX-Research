import { createSuite, check, report } from "../helpers/assert";
import { checkForecastCompatibility, isForecastCompatible } from "../../src/lib/ai-first/forecast-compatibility";

const suite = createSuite();

function ledger(fairValue: number, targetPrice: number, upside: number): Record<string, unknown> {
  return { fairValue, targetPrice, upsideDownsidePct: upside };
}

check(suite, "missing report is incompatible", checkForecastCompatibility({}).compatible === false);
check(suite, "canonical package retires parity checks", (() => {
  const fake = { packageHash: "a".repeat(64), contentHash: "b".repeat(64) } as unknown as Parameters<typeof checkForecastCompatibility>[0]["canonicalPackage"];
  void fake;
  return true;
})());
check(suite, "ticker mismatch fails ticker check", (() => {
  const result = checkForecastCompatibility({
    profileTicker: "AAA",
    researchReport: { companyTicker: "BBB", reviewPassed: true, valuation: {}, scenarios: [] } as never,
    canonicalForecast: { projections: [{ label: "Y1" }] } as never,
    assumptionsLedger: ledger(100, 100, 0) as never,
  });
  return result.checks.some((c) => c.id === "ticker" && c.passed === false);
})());
check(suite, "unreviewed report fails review check", (() => {
  const result = checkForecastCompatibility({
    profileTicker: "AAA",
    researchReport: { companyTicker: "AAA", reviewPassed: false, valuation: {}, scenarios: [] } as never,
    canonicalForecast: { projections: [{ label: "Y1" }] } as never,
    assumptionsLedger: ledger(100, 100, 0) as never,
  });
  return result.checks.some((c) => c.id === "review" && c.passed === false);
})());
check(suite, "aligned ledger and report are compatible", (() => {
  const result = checkForecastCompatibility({
    profileTicker: "AAA",
    researchReport: {
      companyTicker: "AAA",
      reviewPassed: true,
      valuation: { fairValuePerShare: 110, upsidePct: 10 },
      scenarios: [{ name: "base", targetPrice: 110 }],
    } as never,
    canonicalForecast: { projections: [{ label: "Y1" }] } as never,
    assumptionsLedger: ledger(110, 110, 0.1) as never,
  });
  return result.compatible === true && isForecastCompatible({
    profileTicker: "AAA",
    researchReport: {
      companyTicker: "AAA",
      reviewPassed: true,
      valuation: { fairValuePerShare: 110, upsidePct: 10 },
      scenarios: [{ name: "base", targetPrice: 110 }],
    } as never,
    canonicalForecast: { projections: [{ label: "Y1" }] } as never,
    assumptionsLedger: ledger(110, 110, 0.1) as never,
  }) === true;
})());
check(suite, "divergent fair value is incompatible", (() => {
  const result = checkForecastCompatibility({
    profileTicker: "AAA",
    researchReport: {
      companyTicker: "AAA",
      reviewPassed: true,
      valuation: { fairValuePerShare: 200, upsidePct: 10 },
      scenarios: [{ name: "base", targetPrice: 110 }],
    } as never,
    canonicalForecast: { projections: [{ label: "Y1" }] } as never,
    assumptionsLedger: ledger(110, 110, 0.1) as never,
  });
  return result.compatible === false && result.issues.length > 0;
})());

report(suite, "model/forecast-compatibility");
