import {
  hashReportArtifactV1,
  isReportArtifactV1,
  projectReportArtifactV1,
  sealReportArtifactV1,
  serializeReportArtifactV1,
  validateReportArtifactV1,
  verifyReportArtifactV1,
} from "../src/lib/report-artifact";

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean): void {
  if (condition) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL ${name}`);
  }
}

const artifact = projectReportArtifactV1({
  ticker: "ACME",
  companyName: "Acme Industries",
  asOf: "2026-09-25",
  currency: "usd",
  valuation: {
    method: "FCFF_DCF",
    wacc: 0.1,
    terminalGrowthRate: 0.03,
    enterpriseValue: 1000,
    equityValue: 900,
    fairValuePerShare: 45,
  },
  recommendation: {
    rating: "BUY",
    currentPrice: 40,
    targetPrice: 45,
    upsideDownside: 0.125,
  },
  ignoredFunction: () => 1,
  ignoredUndefined: undefined,
  ignoredNaN: Number.NaN,
} as any);

const reordered: any = {
  recommendation: artifact.recommendation,
  currency: artifact.currency,
  valuation: artifact.valuation,
  asOf: artifact.asOf,
  companyName: artifact.companyName,
  ticker: artifact.ticker,
  version: artifact.version,
};

check("projection is valid", isReportArtifactV1(artifact));
check("projection drops non-public input fields", !("ignoredFunction" in artifact) && !("ignoredUndefined" in artifact) && !("ignoredNaN" in artifact));
check("serialization is key-order independent", serializeReportArtifactV1(artifact) === serializeReportArtifactV1(reordered));
check("hash is stable", hashReportArtifactV1(artifact) === hashReportArtifactV1(reordered));
check("hash changes with content", hashReportArtifactV1(artifact) !== hashReportArtifactV1({ ...artifact, ticker: "OTHER" }));
check("sealed artifact verifies", (() => {
  const sealed = sealReportArtifactV1(artifact);
  return sealed.hash === hashReportArtifactV1(sealed.artifact) && verifyReportArtifactV1(sealed.artifact, sealed.hash);
})());

const functionArtifact: any = { ...artifact, hidden: () => 1 };
const nanArtifact: any = { ...artifact, valuation: { ...artifact.valuation, wacc: Number.NaN } };
const undefinedArtifact: any = { ...artifact, recommendation: { ...artifact.recommendation, targetPrice: undefined } };
check("validator rejects functions", !validateReportArtifactV1(functionArtifact).valid);
check("validator rejects NaN", !validateReportArtifactV1(nanArtifact).valid);
check("validator rejects undefined", !validateReportArtifactV1(undefinedArtifact).valid);
check("validator rejects public-field drift", !validateReportArtifactV1({ ...artifact, unexpected: true }).valid);

console.log(`RESULTS: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
