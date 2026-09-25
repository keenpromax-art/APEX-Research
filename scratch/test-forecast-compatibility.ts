import { checkForecastCompatibility } from "../src/lib/ai-first/forecast-compatibility";

const base = {
  profileTicker: "TEST.NS",
  canonicalForecast: { projections: [{ year: 2027 }] },
  assumptionsLedger: { fairValue: 120, targetPrice: 120, upsideDownsidePct: 0.2 },
  canonicalValuation: {},
  researchReport: {
    companyTicker: "TEST.NS",
    reviewPassed: true,
    valuation: { fairValuePerShare: 120, upsidePct: 20 },
    scenarios: [{ name: "base", targetPrice: 120 }],
  },
};
const pass = checkForecastCompatibility(base as never);
if (!pass.compatible) throw new Error(pass.issues.join("; "));
const mismatch = checkForecastCompatibility({ ...base, researchReport: { ...base.researchReport, valuation: { fairValuePerShare: 90, upsidePct: -10 } } } as never);
if (mismatch.compatible) throw new Error("mismatching valuation was accepted");
const failedReview = checkForecastCompatibility({ ...base, researchReport: { ...base.researchReport, reviewPassed: false } } as never);
if (failedReview.compatible) throw new Error("failed review was accepted");
console.log("forecast compatibility tests passed");
