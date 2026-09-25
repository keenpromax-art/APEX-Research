import { createSuite, check, report } from "../helpers/assert";
import { makeProviderTransport, runAiFirstResearch } from "../../src/lib/ai-first/pipeline";
import { RateLimitError } from "../../src/lib/ai-providers";
import { FIXED_TIMESTAMP, bankPayload, corporatePayload } from "../helpers/payloads";

const suite = createSuite();

function mockTransport(kind: "bank" | "ads") {
  return async ({ system }: { system: string; user: string }) => {
    const s = system.toLowerCase();
    if (s.includes("research plan")) return JSON.stringify({ questions: [{ question: `Mock ${kind}`, why: "mock", requiredFor: "model", yfinanceAvailable: false, evidenceNeeded: "filing" }], unknowns: ["mock"], requiredResearch: ["report"], epistemicSummary: "KNOWN mock" });
    if (s.includes("valuation specialist")) return JSON.stringify(kind === "bank"
      ? { methodology: "Residual Income", rationale: "bank book value", variablesDrivingValuation: ["nii"], assumptions: [], discountRate: 0.12, discountRateRationale: "mock", terminalAssumptions: { growth: 0.04, rationale: "mock" }, methodsConsidered: [{ method: "Residual Income", verdict: "selected", reason: "book" }] }
      : { methodology: "DCF", rationale: "cash generative", variablesDrivingValuation: ["revenue"], assumptions: [], discountRate: 0.1, discountRateRationale: "mock", terminalAssumptions: { growth: 0.04, rationale: "mock" }, methodsConsidered: [{ method: "DCF", verdict: "selected", reason: "mock" }] });
    if (s.includes("three scenarios")) return JSON.stringify({ scenarios: [{ name: "bear", changedVariables: [] }, { name: "base", changedVariables: [] }, { name: "bull", changedVariables: [] }], generationRationale: "mock", scenarioDriverSummary: "mock" });
    if (s.includes("financial modeling agent")) return JSON.stringify(kind === "bank"
      ? { horizonYears: 5, horizonRationale: "mock", variables: [{ name: "nii", label: "NII", baseValue: 180, unit: "currency", kind: "computed", statementLine: null }], formulas: [], assumptions: [], driverPaths: {} }
      : { horizonYears: 5, horizonRationale: "mock", variables: [{ name: "revenue", label: "Revenue", baseValue: 10000, unit: "currency", kind: "computed", statementLine: null }], formulas: [], assumptions: [], driverPaths: {} });
    if (s.includes("writer role") || s.includes("investment thesis")) return JSON.stringify({ thesis: { thesis: `Mock ${kind} thesis`, bullCase: [], bearCase: [], keyDebate: "", keyInflectionPoints: [], whatMarketMayBeMissing: "", whatCouldInvalidate: [] }, catalysts: [], risks: [], competitiveAnalysis: { competitors: [] }, moat: { hasMoat: false, sources: [], verdict: "mock" } });
    if (s.includes("debates") || s.includes("thesis engine")) return JSON.stringify({ debates: [], centralDebateIndex: 0, thesis: "mock", thesisEvidence: [], thesisCounterEvidence: [], keyUncertainty: "mock", invalidationCondition: "mock", monitoringKpi: "Revenue", confidence: 0.8 });
    return JSON.stringify(kind === "bank"
      ? { whatItDoes: "Commercial bank taking deposits", howItMakesMoney: "Net interest income plus fees", businessSegments: [], economicUnits: ["deposits"], primaryEconomicAbstraction: "net interest income", revenueDrivers: [], costDrivers: [], marginDrivers: [], cashGenerationDrivers: [], balanceSheetDrivers: [], returnsDrivers: [], keyKpis: [{ name: "NIM", rationale: "spread", availability: "modeled", unit: "%" }], metricsToAvoid: [], statementsThatMatterMost: ["balanceSheet"], industryContext: "banking", appropriateValuationMethods: [{ method: "Residual Income", why: "book" }], confidence: { overall: 0.9, dataQuality: "good", reasoning: "mock" } }
      : { whatItDoes: "Internet advertising platform", howItMakesMoney: "Advertising monetization of queries", businessSegments: [], economicUnits: ["queries"], primaryEconomicAbstraction: "advertising monetization", revenueDrivers: [], costDrivers: [], marginDrivers: [], cashGenerationDrivers: [], balanceSheetDrivers: [], returnsDrivers: [], keyKpis: [{ name: "ARPU", rationale: "monetization", availability: "modeled", unit: "currency" }], metricsToAvoid: [], statementsThatMatterMost: ["incomeStatement"], industryContext: "internet", appropriateValuationMethods: [{ method: "DCF", why: "cash" }], confidence: { overall: 0.9, dataQuality: "good", reasoning: "mock" } });
  };
}

async function main(): Promise<void> {
  const mechanical = await runAiFirstResearch("SBIN.NS", bankPayload(), { retrievalTimestamp: FIXED_TIMESTAMP });
  check(suite, "mechanical run produces report", mechanical.report.companyTicker === "SBIN.NS");
  check(suite, "mechanical run is marked non-ai", mechanical.aiUsed === false);
  check(suite, "mechanical forecast has five years", mechanical.report.forecast.incomeStatement.length === 5);
  check(suite, "mechanical scenarios are bear base bull", mechanical.report.scenarios.length === 3);
  check(suite, "blocked forecast publishes no sensitivity", mechanical.report.sensitivity.length === 0);

  const bank = await runAiFirstResearch("SBIN.NS", bankPayload(), { transport: mockTransport("bank") as never, retrievalTimestamp: FIXED_TIMESTAMP });
  const ads = await runAiFirstResearch("GOOG", corporatePayload(), { transport: mockTransport("ads") as never, retrievalTimestamp: FIXED_TIMESTAMP });
  check(suite, "bank abstraction is net interest income", /net interest income/i.test(bank.understanding.primaryEconomicAbstraction));
  check(suite, "ads abstraction is advertising monetization", /advertising monetization/i.test(ads.understanding.primaryEconomicAbstraction));
  check(suite, "abstractions differ across companies", bank.understanding.primaryEconomicAbstraction !== ads.understanding.primaryEconomicAbstraction);
  check(suite, "bank report avoids platform concepts", !/advertiser bidding|custom silicon/.test(JSON.stringify(bank.report).toLowerCase()));

  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = (async () => {
    providerCalls += 1;
    if (providerCalls === 1) return new Response(JSON.stringify({ error: { message: "Rate limit reached" } }), { status: 429, headers: { "retry-after": "0" } });
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const transport = makeProviderTransport({ provider: "groq", apiKey: "test-key", model: "test-model" } as never);
    const content = await transport({ system: "s", user: "u" });
    check(suite, "provider transport retries a 429 once", providerCalls === 2 && content === '{"ok":true}');
  } finally {
    globalThis.fetch = originalFetch;
  }
  let exhaustedCalls = 0;
  globalThis.fetch = (async () => {
    exhaustedCalls += 1;
    return new Response(JSON.stringify({ error: { message: "org_secret_123" } }), { status: 429, headers: { "retry-after": "0" } });
  }) as typeof fetch;
  try {
    const transport = makeProviderTransport({ provider: "groq", apiKey: "test-key", model: "test-model" } as never);
    await transport({ system: "s", user: "u" });
    check(suite, "exhausted provider throttle throws", false);
  } catch (error) {
    check(suite, "exhausted provider throttle throws", error instanceof RateLimitError && error.statusCode === 429);
    check(suite, "provider error body is not leaked", error instanceof Error && !error.message.includes("org_secret_123"));
  } finally {
    globalThis.fetch = originalFetch;
  }
  const throttled = async () => { throw new RateLimitError("groq", 429, "AI provider groq is rate limited (HTTP 429). Wait for quota reset, then resume.", "rate_limited"); };
  await runAiFirstResearch("GOOG", corporatePayload(), { transport: throttled as never, retrievalTimestamp: FIXED_TIMESTAMP }).then(
    () => check(suite, "pipeline pauses instead of failing on throttle", false),
    (error) => check(suite, "pipeline pauses instead of failing on throttle", error instanceof RateLimitError && error.statusCode === 429),
  );

  report(suite, "ai/ai-first");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
