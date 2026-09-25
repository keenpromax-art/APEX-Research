import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { discoverEconomicPeers, buildSubjectPeerProfile, PEER_SET_ROLES, type PeerProfileInput } from "../src/lib/peer-discovery";
import { buildFactPack } from "../src/lib/ai-first/fact-pack";
import { runCanonicalResearch } from "../src/lib/research-package/pipeline";
import { assessResearchQuality } from "../src/lib/research-package/quality";
import { verifyCanonicalResearchPackage } from "../src/lib/research-package/hash";

const retrievalTimestamp = "2026-09-25T12:00:00.000Z";

let passed = 0;
let failed = 0;

function check(name: string, assertion: () => void | Promise<void>): void {
  try {
    const result = assertion();
    if (result instanceof Promise) {
      throw new TypeError("use checkAsync for async assertions");
    }
    passed += 1;
    console.log(`  PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function checkAsync(name: string, assertion: () => Promise<void>): Promise<void> {
  try {
    await assertion();
    passed += 1;
    console.log(`  PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const subject: PeerProfileInput = {
  id: "SUBJ",
  label: "Subject Industrial Analytics",
  economicSegments: ["industrial analytics hardware", "recurring software subscriptions"],
  revenueEngines: ["unit shipments", "subscription renewals"],
  operatingKpis: ["ARR", "gross margin"],
  primaryEconomicAbstraction: "revenue",
  sector: "Industrials",
  industry: "Specialty Industrial Machinery",
  geography: "US",
  currency: "USD",
  grossMargin: 0.41,
  operatingMargin: 0.22,
  netMargin: 0.16,
  revenueGrowth: 0.11,
  capexIntensity: 0.06,
  workingCapitalIntensity: 0.09,
  leverage: 0.35,
  returnOnEquity: 0.19,
  returnOnAssets: 0.11,
  marketCap: 6_200,
  multiples: { pe: 22, evEbitda: 14, evSales: 3.1, priceToBook: 4.1 },
  competitiveRelationships: ["CLOSEPEER"],
  evidenceIds: ["EV-SUBJECT-PROFILE"],
  sourceTiers: ["primary", "secondary"],
  sourceQuotes: ["annual_report:FY2025", "market_data:quote"],
};

const closePeer: PeerProfileInput = {
  id: "CLOSEPEER",
  label: "Close Peer Machinery",
  economicSegments: ["industrial analytics hardware", "recurring software subscriptions"],
  revenueEngines: ["unit shipments", "subscription renewals"],
  operatingKpis: ["ARR", "gross margin"],
  sector: "Industrials",
  industry: "Specialty Industrial Machinery",
  geography: "US",
  currency: "USD",
  grossMargin: 0.4,
  operatingMargin: 0.21,
  netMargin: 0.15,
  revenueGrowth: 0.1,
  capexIntensity: 0.065,
  workingCapitalIntensity: 0.095,
  leverage: 0.38,
  returnOnEquity: 0.18,
  returnOnAssets: 0.1,
  marketCap: 5_400,
  multiples: { pe: 21, evEbitda: 13.5, evSales: 3, priceToBook: 3.8 },
  evidenceIds: ["EV-CLOSEPEER"],
  sourceTiers: ["primary"],
  sourceQuotes: ["annual_report:FY2025"],
};

const broadPeer: PeerProfileInput = {
  id: "BROADPEER",
  label: "Broad Peer Machinery",
  economicSegments: ["industrial machinery", "aftermarket parts"],
  revenueEngines: ["unit shipments"],
  operatingKpis: ["book-to-bill"],
  sector: "Industrials",
  industry: "Farm and Heavy Construction Machinery",
  geography: "DE",
  currency: "EUR",
  grossMargin: 0.26,
  operatingMargin: 0.1,
  netMargin: 0.06,
  revenueGrowth: 0.04,
  capexIntensity: 0.08,
  workingCapitalIntensity: 0.2,
  leverage: 1.4,
  returnOnEquity: 0.11,
  returnOnAssets: 0.04,
  marketCap: 18_000,
  multiples: { pe: 14, evEbitda: 8, evSales: 1.1, priceToBook: 1.4 },
  evidenceIds: ["EV-BROADPEER"],
  sourceTiers: ["secondary"],
  sourceQuotes: ["market_data:quote"],
};

const bankContaminant: PeerProfileInput = {
  id: "BANKCO",
  label: "Regional Bank",
  economicSegments: ["retail deposits", "commercial lending", "net interest income"],
  revenueEngines: ["deposit spreads", "loan origination fees"],
  operatingKpis: ["net interest margin", "cost-to-income"],
  sector: "Financial Services",
  industry: "Banks - Diversified",
  geography: "US",
  currency: "USD",
  grossMargin: 0,
  operatingMargin: 0,
  netMargin: 0.28,
  revenueGrowth: 0.02,
  capexIntensity: 0.01,
  workingCapitalIntensity: 0,
  leverage: 0,
  returnOnEquity: 0.11,
  returnOnAssets: 0.01,
  marketCap: 22_000,
  multiples: { pe: 11, evEbitda: 0, evSales: 0, priceToBook: 1.1 },
  evidenceIds: ["EV-BANK"],
  sourceTiers: ["secondary"],
  sourceQuotes: ["market_data:quote"],
};

const emptyCandidate: PeerProfileInput = { id: "NODATA", label: "No Disclosed Economics" };

async function main(): Promise<void> {
  await checkAsync("no provider and no universe yields an explicit unavailable status", async () => {
    const result = await discoverEconomicPeers({ subjectId: "SUBJ", subject, generatedAt: retrievalTimestamp });
    assert.equal(result.status, "unavailable");
    assert.equal(result.providerStatus, "unavailable");
    assert.equal(result.candidateCount, 0);
    assert.ok(result.reason.includes("no candidate universe provider is configured"));
    for (const role of PEER_SET_ROLES) {
      assert.equal(result.peerSets[role].status, "insufficient");
      assert.equal(result.peerSets[role].matches.length, 0);
    }
    assert.equal(result.contentHash.length, 64);
  });

  await checkAsync("a failing provider is unavailable rather than fabricated", async () => {
    const result = await discoverEconomicPeers({
      subjectId: "SUBJ",
      subject,
      generatedAt: retrievalTimestamp,
      provider: { id: "flaky", list: () => { throw new Error("provider offline"); } },
    });
    assert.equal(result.status, "unavailable");
    assert.equal(result.providerId, "flaky");
    assert.ok(result.diagnostics.some((entry) => entry.startsWith("PEER_PROVIDER_FAILED")));
  });

  await checkAsync("an empty catalogue is unavailable, not an empty peer set", async () => {
    const result = await discoverEconomicPeers({
      subjectId: "SUBJ",
      subject,
      generatedAt: retrievalTimestamp,
      provider: { id: "empty-catalogue", list: () => [] },
    });
    assert.equal(result.status, "unavailable");
    assert.ok(result.diagnostics.includes("PEER_PROVIDER_RETURNED_EMPTY_CATALOGUE"));
  });

  await checkAsync("operating, valuation, competitive and benchmark sets are produced separately", async () => {
    const result = await discoverEconomicPeers({
      subjectId: "SUBJ",
      subject,
      universe: [closePeer, broadPeer, bankContaminant, emptyCandidate],
      generatedAt: retrievalTimestamp,
      minimumSetSize: 1,
    });
    assert.equal(result.status, "ready");
    assert.equal(result.candidateCount, 4);
    assert.equal(result.scoredCount, 3);
    const operating = result.peerSets.operating;
    assert.equal(operating.status, "ready");
    assert.ok(operating.matches.some((match) => match.peerId === "CLOSEPEER"));
    assert.equal(operating.matches.some((match) => match.peerId === "BANKCO"), false, "a bank must never enter an industrial operating peer set");
    assert.equal(operating.matches.some((match) => match.peerId === "NODATA"), false);
    assert.equal(result.peerSets.valuation.status, "ready");
    assert.equal(result.peerSets.competitive.status, "ready");
    assert.equal(result.peerSets.benchmark.status, "ready");
    for (const role of PEER_SET_ROLES) {
      for (const match of result.peerSets[role].matches) {
        assert.equal(match.role, role);
        assert.ok(match.similarity >= 0 && match.similarity <= 100);
        assert.ok(match.explanations.length > 0, `${role} match must explain itself`);
        assert.ok(match.comparableWeight > 0);
      }
    }
  });

  await checkAsync("scoring is dimension-weighted, evidenced and excludes unmeasurable dimensions", async () => {
    const result = await discoverEconomicPeers({
      subjectId: "SUBJ",
      subject,
      universe: [closePeer],
      generatedAt: retrievalTimestamp,
      minimumSetSize: 1,
    });
    const match = result.peerSets.operating.matches[0];
    assert.ok(match);
    assert.equal(match.peerId, "CLOSEPEER");
    assert.equal(match.dimensions.length, 10);
    const segment = match.dimensions.find((entry) => entry.key === "economicSegment");
    assert.equal(segment?.comparable, true);
    assert.equal(segment?.score, 1);
    assert.ok(segment?.explanation.includes("identical"));
    assert.equal(match.validation.status, "validated");
    assert.equal(match.validation.evidenceIdCount, 1);
    assert.deepEqual(match.evidenceIds, ["EV-CLOSEPEER", "EV-SUBJECT-PROFILE"]);
    const scored = match.dimensions.filter((entry) => entry.comparable);
    assert.equal(scored.reduce((total, entry) => total + entry.weight, 0), match.comparableWeight);
  });

  await checkAsync("a candidate with no economics is rejected rather than treated as a peer", async () => {
    const result = await discoverEconomicPeers({
      subjectId: "SUBJ",
      subject,
      universe: [emptyCandidate],
      generatedAt: retrievalTimestamp,
    });
    assert.equal(result.status, "insufficient");
    for (const role of PEER_SET_ROLES) {
      assert.equal(result.peerSets[role].matches.length, 0);
      const exclusion = result.peerSets[role].exclusions.find((entry) => entry.peerId === "NODATA");
      assert.ok(exclusion, `${role} must disclose why the candidate was dropped`);
      assert.ok(["failed-candidate-validation", "insufficient-comparable-dimensions"].includes(exclusion.reason));
    }
  });

  await checkAsync("contaminated candidates cannot be promoted by a shared ticker list", async () => {
    const result = await discoverEconomicPeers({
      subjectId: "SUBJ",
      subject,
      universe: [bankContaminant],
      generatedAt: retrievalTimestamp,
      minimumSetSize: 1,
      minimumSimilarity: 0.1,
    });
    for (const role of ["operating", "valuation", "competitive"] as const) {
      assert.equal(result.peerSets[role].matches.some((match) => match.peerId === "BANKCO"), false, `${role} set must not contain a bank peer for an industrial subject`);
    }
    const contamination = (["operating", "valuation", "competitive"] as const)
      .flatMap((role) => result.peerSets[role].exclusions)
      .filter((entry) => entry.peerId === "BANKCO")
      .map((entry) => entry.reason);
    assert.ok(contamination.includes("no-economic-segment-overlap"), "the contamination guard must be recorded explicitly");
    assert.equal(result.peerSets.benchmark.matches.some((match) => match.peerId === "BANKCO"), false, "a benchmark must still be a same-sector or same-market-scale reference");
    const benchmarkExclusion = result.peerSets.benchmark.exclusions.find((entry) => entry.peerId === "BANKCO");
    assert.equal(benchmarkExclusion?.reason, "not-a-broad-reference");
    const withBroad = await discoverEconomicPeers({
      subjectId: "SUBJ",
      subject,
      universe: [broadPeer],
      generatedAt: retrievalTimestamp,
      minimumSetSize: 1,
      minimumSimilarity: 0.1,
    });
    assert.equal(withBroad.peerSets.benchmark.matches.some((match) => match.peerId === "BROADPEER"), true, "a same-sector candidate is a legitimate benchmark reference");
  });

  await checkAsync("validation through source metadata and quotes is required when demanded", async () => {
    const unquoted = { ...closePeer, sourceQuotes: [], evidenceIds: [] };
    const permissive = await discoverEconomicPeers({ subjectId: "SUBJ", subject, universe: [unquoted], generatedAt: retrievalTimestamp, minimumSetSize: 1 });
    const permissiveMatch = permissive.peerSets.operating.matches.find((match) => match.peerId === "CLOSEPEER");
    assert.equal(permissiveMatch?.validation.status, "unverified");
    const strict = await discoverEconomicPeers({ subjectId: "SUBJ", subject, universe: [unquoted], generatedAt: retrievalTimestamp, minimumSetSize: 1, requireValidation: true });
    assert.equal(strict.peerSets.operating.matches.length, 0);
    assert.equal(strict.status, "insufficient");
    const rejection = strict.peerSets.operating.exclusions.find((entry) => entry.peerId === "CLOSEPEER");
    assert.equal(rejection?.reason, "failed-candidate-validation");
  });

  await checkAsync("peer discovery is deterministic and frozen", async () => {
    const first = await discoverEconomicPeers({ subjectId: "SUBJ", subject, universe: [closePeer, broadPeer, bankContaminant], generatedAt: retrievalTimestamp, minimumSetSize: 1 });
    const second = await discoverEconomicPeers({ subjectId: "SUBJ", subject, universe: [broadPeer, bankContaminant, closePeer], generatedAt: retrievalTimestamp, minimumSetSize: 1 });
    assert.equal(first.contentHash, second.contentHash, "candidate order must not change the result");
    assert.equal(Object.isFrozen(first), true);
    assert.equal(Object.isFrozen(first.peerSets.operating), true);
    assert.equal(Object.isFrozen(first.peerSets.operating.matches[0]), true);
  });

  await checkAsync("the subject profile is derived from the fact pack, not from a curated list", async () => {
    const pack = buildFactPack({
      assetProfile: { longBusinessSummary: "Industrial analytics", sector: "Industrials", industry: "Specialty Industrial Machinery", country: "US" },
      price: { longName: "ANLS", shortName: "ANLS", currency: "USD", regularMarketPrice: { raw: 120, fmt: "120" }, marketCap: { raw: 6_200, fmt: "6200" } },
      summaryDetail: { trailingPE: { raw: 22, fmt: "22" }, priceToBook: { raw: 4.1, fmt: "4.1" } },
      financialData: { financialCurrency: "USD" },
      defaultKeyStatistics: { sharesOutstanding: { raw: 52.8, fmt: "52.8" } },
      incomeStatementHistory: { incomeStatementHistory: [
        { endDate: { raw: "2023-12-31", fmt: "2023-12-31" }, totalRevenue: { raw: 1780, fmt: "1780" }, operatingIncome: { raw: 430, fmt: "430" }, netIncome: { raw: 300, fmt: "300" }, grossProfit: { raw: 730, fmt: "730" } },
        { endDate: { raw: "2024-12-31", fmt: "2024-12-31" }, totalRevenue: { raw: 1900, fmt: "1900" }, operatingIncome: { raw: 470, fmt: "470" }, netIncome: { raw: 330, fmt: "330" }, grossProfit: { raw: 780, fmt: "780" } },
      ] },
      balanceSheetHistory: { balanceSheetHistory: [
        { endDate: { raw: "2024-12-31", fmt: "2024-12-31" }, totalAssets: { raw: 2900, fmt: "2900" }, totalEquity: { raw: 1500, fmt: "1500" }, totalDebt: { raw: 500, fmt: "500" }, cash: { raw: 300, fmt: "300" } },
      ] },
      cashflowStatementHistory: { cashflowStatementHistory: [
        { endDate: { raw: "2024-12-31", fmt: "2024-12-31" }, totalCashFromOperatingActivities: { raw: 360, fmt: "360" }, capitalExpenditures: { raw: -114, fmt: "-114" } },
      ] },
      earningsTrend: { trend: [] },
      majorHoldersBreakdown: {},
    }, "ANLS", { retrievalTimestamp });
    const profile = buildSubjectPeerProfile({ factPack: pack, understanding: null, evidenceIds: ["EV-X"], competitiveSeedNames: ["CLOSEPEER"] });
    assert.equal(profile.id, "ANLS");
    assert.equal(profile.geography, "US");
    assert.equal(profile.sector, "Industrials");
    assert.equal(profile.marketCap, 6_200);
    assert.ok((profile.revenueGrowth ?? 0) > 0);
    assert.ok((profile.operatingMargin ?? 0) > 0);
    assert.ok((profile.capexIntensity ?? 0) > 0);
    assert.ok((profile.leverage ?? 0) > 0);
    assert.deepEqual(profile.competitiveRelationships, ["closepeer"]);
    assert.ok(profile.comparableDimensions >= 6);
    assert.equal(profile.status, "complete");
  });

  check("no active canonical peer module embeds a ticker list", () => {
    const root = path.join(process.cwd(), "src", "lib", "peer-discovery");
    const files = fs.readdirSync(root).filter((name) => name.endsWith(".ts"));
    assert.ok(files.length > 0);
    const tickerLiteral = /["'][A-Z]{2,6}\.(NS|BO|L|HK|T|DE|PA|LON|AX|TSE|TO|AS|SW|MI|BIT|STO)["']/;
    for (const name of files) {
      const source = fs.readFileSync(path.join(root, name), "utf8");
      assert.equal(tickerLiteral.test(source), false, `${name} must not embed an exchange ticker literal`);
      assert.equal(/\bconst\s+PEER_TICKERS\b/.test(source), false, `${name} must not define a peer ticker list`);
    }
  });

  await checkAsync("package determinism holds with the analytics artifacts attached", async () => {
    const payload = () => ({
      assetProfile: { longBusinessSummary: "Determinism Industries", sector: "Industrials", industry: "Specialty Industrial Machinery", country: "US" },
      price: { longName: "DETM", shortName: "DETM", currency: "USD", regularMarketPrice: { raw: 100, fmt: "100" }, marketCap: { raw: 10_000, fmt: "10000" } },
      summaryDetail: {},
      financialData: { financialCurrency: "USD" },
      defaultKeyStatistics: { sharesOutstanding: { raw: 100, fmt: "100" } },
      incomeStatementHistory: { incomeStatementHistory: [
        { endDate: { raw: "2023-12-31", fmt: "2023-12-31" }, totalRevenue: { raw: 1000, fmt: "1000" }, operatingIncome: { raw: 150, fmt: "150" }, netIncome: { raw: 100, fmt: "100" }, grossProfit: { raw: 380, fmt: "380" }, pretaxIncome: { raw: 120, fmt: "120" }, incomeTaxExpense: { raw: 20, fmt: "20" }, dilutedEPS: { raw: 2, fmt: "2" }, dilutedAverageShares: { raw: 50, fmt: "50" } },
        { endDate: { raw: "2024-12-31", fmt: "2024-12-31" }, totalRevenue: { raw: 1250, fmt: "1250" }, operatingIncome: { raw: 190, fmt: "190" }, netIncome: { raw: 130, fmt: "130" }, grossProfit: { raw: 480, fmt: "480" }, pretaxIncome: { raw: 155, fmt: "155" }, incomeTaxExpense: { raw: 25, fmt: "25" }, dilutedEPS: { raw: 2.6, fmt: "2.6" }, dilutedAverageShares: { raw: 50, fmt: "50" } },
      ] },
      balanceSheetHistory: { balanceSheetHistory: [
        { endDate: { raw: "2024-12-31", fmt: "2024-12-31" }, totalAssets: { raw: 2000, fmt: "2000" }, totalEquity: { raw: 1000, fmt: "1000" }, totalDebt: { raw: 200, fmt: "200" }, cash: { raw: 100, fmt: "100" }, totalCurrentAssets: { raw: 500, fmt: "500" }, totalCurrentLiabilities: { raw: 300, fmt: "300" }, accountsReceivable: { raw: 100, fmt: "100" }, inventory: { raw: 50, fmt: "50" }, accountsPayable: { raw: 80, fmt: "80" } },
      ] },
      cashflowStatementHistory: { cashflowStatementHistory: [
        { endDate: { raw: "2024-12-31", fmt: "2024-12-31" }, totalCashFromOperatingActivities: { raw: 150, fmt: "150" }, capitalExpenditures: { raw: -25, fmt: "-25" }, dividendsPaid: { raw: -20, fmt: "-20" } },
      ] },
      earningsTrend: { trend: [] },
      majorHoldersBreakdown: {},
    });
    let fetches = 0;
    const options = { sourceContextOptions: { fetchSnapshot: async () => { fetches += 1; return payload(); } }, retrievalTimestamp: retrievalTimestamp, dataCutoff: "2026-09-25" };
    const first = await runCanonicalResearch("DETM", options);
    const second = await runCanonicalResearch("DETM", options);
    assert.equal(fetches, 2, "one source fetch per run, no extra live source fetch for analytics");
    assert.equal(verifyCanonicalResearchPackage(first.package), true);
    assert.equal(first.package.packageHash, second.package.packageHash, "the package must hash identically across runs");
    assert.equal(first.package.peerDiscovery?.status, "unavailable", "no peer provider is configured by default");
    assert.ok(first.package.normalizedHistory);
    assert.ok(first.package.earningsQuality);
    assert.ok(first.package.capitalAllocationLedger);
    assert.equal(first.package.managementCredibility?.status, "UNVERIFIED");
    assert.equal(first.package.guidanceReconciliation?.status, "unverified");
    assert.ok(first.package.confidenceDecomposition);
    assert.equal(first.package.researchReport.peerDiscovery?.contentHash, first.package.peerDiscovery?.contentHash);
    assert.equal(first.package.researchReport.normalizedHistory?.contentHash, first.package.normalizedHistory?.contentHash);
    assert.equal(first.package.researchReport.confidenceDecomposition?.contentHash, first.package.confidenceDecomposition?.contentHash);
    assert.equal(first.package.versions.analytics, "research-analytics-v1");
    assert.equal(first.package.versions.confidence, "research-confidence-decomposition-v1");
  });

  check("peer and history gaps warn rather than block unless a material claim depends on them", () => {
    const base = {
      factPackVerified: true,
      currencyBlocked: false,
      currentPriceAvailable: true,
      forecastReady: true,
      valuationReady: true,
      modelValid: true,
      reviewPassed: true,
    };
    const warned = assessResearchQuality({ ...base, peerDiscoveryStatus: "unavailable", peerSetsReady: 0, historyStatus: "ready", historyMetricsReady: 18 });
    const analytics = warned.checks.find((check) => check.id === "research-analytics");
    assert.equal(analytics?.status, "warn");
    assert.equal(analytics?.blocking, false);
    assert.equal(warned.canPublish, true);
    assert.ok(warned.warnings.some((warning) => warning.includes("Economic peer discovery is unavailable")));
    const unsupported = assessResearchQuality({
      ...base,
      peerDiscoveryStatus: "unavailable",
      historyStatus: "insufficient",
      historyMetricsReady: 3,
      historyClaimsDepending: ["Trend continuity across 5Y and 10Y windows."],
      historyClaimsUnsupported: ["Trend continuity across 5Y and 10Y windows."],
    });
    const blocked = unsupported.checks.find((check) => check.id === "research-analytics");
    assert.equal(blocked?.status, "fail");
    assert.equal(blocked?.blocking, true);
    assert.equal(unsupported.canPublish, false);
    const ready = assessResearchQuality({ ...base, peerDiscoveryStatus: "ready", peerSetsReady: 4, historyStatus: "ready", historyMetricsReady: 18 });
    assert.equal(ready.checks.find((check) => check.id === "research-analytics")?.status, "pass");
  });

  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

void main();
