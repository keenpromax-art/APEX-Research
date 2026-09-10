import { NextRequest, NextResponse } from "next/server";
import { fetchQuoteSummary, parseQuoteSummary, fetchPeerQuotes, getTickerNews, fetchDailyPriceHistory } from "@/lib/yahoo-finance";
import { computeRatios, computeDuPont } from "@/lib/calculations";
import { selectAndComputeValuation } from "@/lib/valuation";
import { classifyArchetype } from "@/lib/company-archetype";
import { buildMasterReportFacts } from "@/lib/report-facts";
import { buildEventPriceMovements } from "@/lib/event-price-engine";
import { normalizeTicker } from "@/lib/request-validation";
import { isInternetPlatformCompany, isTelecomCarrierCompany, isHospitalityCompany, isRealEstateCompany, isHardwareCompany, isSoftwareCompany, classifySector } from "@/lib/sectors/profiles";
import { isSectorSupported, unsupportedSectorPayload, getArchitectureForSector } from "@/lib/sectors/architectures";
import { stmtNum } from "@/types/report";
import { buildCompanyOntology } from "@/lib/company-ontology";
import { scorePeerSimilarity, gatePeerSet } from "@/lib/peer-similarity";
import { ModelLifecycle, buildAuditGraph } from "@/lib/financial-kernel";
import { assessMarketIntegrity } from "@/lib/financial-provenance";
import { buildCanonicalFacts, sealCanonicalFacts, verifyCanonicalSeal } from "@/lib/canonical-facts";
import { enforceAccountingIdentities } from "@/lib/accounting-identity-engine";
import { buildCanonicalForecast } from "@/lib/canonical-forecast";
import { propagateInvalid } from "@/lib/dependency-propagation";
import { validateIndependently } from "@/lib/independent-validator";
import { buildCanonicalReport } from "@/lib/canonical-report";
import { reconcileAll } from "@/lib/source-reconciliation";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const symbol = normalizeTicker(request.nextUrl.searchParams.get("symbol"));
  if (!symbol) {
    return NextResponse.json(
      { error: "A valid ticker symbol is required." },
      { status: 400 }
    );
  }

  try {
    // P0 #85: strict model lifecycle — every stage transition is recorded;
    // VERIFIED is appended client-side after QA, so a skipped stage is visible.
    const lifecycle = new ModelLifecycle();
    const raw = await fetchQuoteSummary(symbol);
    const { companyProfile, stockData, annualFinancials, quarterlyFinancials, shareholding } =
      parseQuoteSummary(raw as Record<string, unknown>, symbol);
    lifecycle.advance("FETCHED", "Yahoo quoteSummary + timeseries retrieved");

    if (annualFinancials.length === 0) {
      return NextResponse.json(
        { error: `No financial data found for ${symbol}. This ticker may not have public financials.` },
        { status: 404 }
      );
    }

    // Step 1 — hard sector gate: sectors whose statement architecture (B–E) is
    // not yet implemented return an explicit UNSUPPORTED_SECTOR status instead
    // of a silently mis-modeled Architecture A report. Architecture A sectors
    // pass through untouched. Gate flags live in src/lib/sectors/architectures.ts
    // and flip per-sector only after ticker-verified implementation.
    const gateSector = classifySector(companyProfile.sector, companyProfile.industry, companyProfile.description);
    if (!isSectorSupported(gateSector.id)) {
      return NextResponse.json(unsupportedSectorPayload(gateSector.id), { status: 501 });
    }

    // Fetch verified real-time ticker news strictly validated for the subject company
    const tickerNews = await getTickerNews(symbol, companyProfile.name, 15);

    // Measured event-study sessions: one chart fetch spanning all news windows
    // so event trajectories derive from real closes (null-tolerant fallback).
    // A benchmark index series rides along for market-model abnormal returns.
    let eventPriceLookup: { sessions: { date: string; close: number | null; volume: number | null }[]; marketSessions?: { date: string; close: number | null; volume: number | null }[] | null; marketSymbol?: string } | null = null;
    try {
      const dated = tickerNews
        .filter((n) => n.publishedAt && !isNaN(new Date(n.publishedAt).getTime()))
        .map((n) => new Date(n.publishedAt as string).getTime());
      if (dated.length > 0) {
        const fromSec = (Math.min(...dated) - 70 * 86400000) / 1000;
        const toSec = (Math.max(Date.now(), Math.max(...dated)) + 20 * 86400000) / 1000;
        const upSym = symbol.toUpperCase();
        const marketSymbol = (upSym.endsWith(".NS") || upSym.endsWith(".BO")) ? "^NSEI" : "^GSPC";
        const [sessions, marketSessions] = await Promise.all([
          fetchDailyPriceHistory(symbol, fromSec, toSec),
          fetchDailyPriceHistory(marketSymbol, fromSec, toSec),
        ]);
        if (sessions && sessions.length > 0) {
          eventPriceLookup = {
            sessions,
            marketSessions: marketSessions && marketSessions.length > 0 ? marketSessions : null,
            marketSymbol,
          };
        }
      }
    } catch (priceErr) {
      console.warn("Event price history fetch failed (illustrative fallback):", priceErr);
    }

    // Compute ratios for each year
    const cmp = stockData.currentPrice;
    const ratiosByYear = annualFinancials.map(f => computeRatios(f, cmp));
    const dupontByYear = annualFinancials.map(f => computeDuPont(f));
    lifecycle.advance("NORMALIZED", "statements parsed + ratios/DuPont computed");

    // P0 #1 — Immutable Canonical Financial Fact Layer
    const canonicalFacts = sealCanonicalFacts(buildCanonicalFacts({ profile: companyProfile, stockData, annualFinancials }));
    const sealCheck = verifyCanonicalSeal(canonicalFacts);
    if (!sealCheck.sealed || !sealCheck.hashOk) {
      return NextResponse.json({ error: "Canonical fact seal violation — facts mutated after validation." }, { status: 500 });
    }

    // P0 #2 — Source reconciliation (PRIMARY vs SECONDARY). Currently single-source Yahoo as SECONDARY;
    // when filings fetch is available, PRIMARY facts will populate here. Material diff = INVALID.
    // We cross-check Yahoo timeseries against quote marketCap where both exist as a self-consistency proxy.
    const reconciliation = reconcileAll([
      { field: "revenue", primary: null, secondary: canonicalFacts.years.length > 0 ? { value: canonicalFacts.years[canonicalFacts.years.length-1].revenue.value, source: canonicalFacts.years[canonicalFacts.years.length-1].revenue.source, tier: "SECONDARY", fact: canonicalFacts.years[canonicalFacts.years.length-1].revenue } : null },
      { field: "totalDebt", primary: null, secondary: canonicalFacts.years.length > 0 ? { value: canonicalFacts.years[canonicalFacts.years.length-1].totalDebt.value, source: canonicalFacts.years[canonicalFacts.years.length-1].totalDebt.source, tier: "SECONDARY", fact: canonicalFacts.years[canonicalFacts.years.length-1].totalDebt } : null },
    ]);

    // P0 #3 — Hard Accounting Identity Engine (every year)
    const identityIssues = enforceAccountingIdentities(canonicalFacts);

    // Pre-model integrity screen (P0 #85 VALIDATED stage): share-base and
    // balance-sheet sanity before any valuation math runs.
    const preIntegrity = assessMarketIntegrity({ stockData, annualFinancials });
    lifecycle.advance(
      "VALIDATED",
      preIntegrity.blocked
        ? `integrity BLOCKED: ${preIntegrity.issues.filter((i) => i.severity === "BLOCK").map((i) => i.code).join(",")}`
        : identityIssues.some(i=>i.severity==="FAIL") ? `identity FAIL: ${identityIssues.filter(i=>i.severity==="FAIL").map(i=>i.code).join(",")}` : "integrity screen passed"
    );

    // Dynamic Sector & Archetype-Calibrated Valuation (Residual Income for Financials / FCFF for non-financials)
    const archetypeProfile = classifyArchetype(companyProfile, stockData, annualFinancials);
    const sectorIdForDrivers = (buildCompanyOntology(companyProfile, archetypeProfile as never).sectorId as string) || companyProfile.sector || "general";
    const valuationResult = selectAndComputeValuation({
      profile: companyProfile,
      stockData,
      annualFinancials,
      archetypeProfile,
    });
    const dcf = valuationResult.dcf;
    const valuationCalibration = valuationResult.calibration;

    // P0 #4 — Single Canonical Forecast Model (driver-native, sealed)
    let canonicalForecast: ReturnType<typeof buildCanonicalForecast> | null = null;
    try {
      const latestRev = annualFinancials[annualFinancials.length-1]?.revenue || 0;
      const baseGrowth = (dcf.assumptions?.revenueGrowthRates?.[0] as number) ?? 0.08;
      const effMargin = (dcf.assumptions?.ebitMargins?.[0] as number) ?? 0.15;
      const rawCapex = Math.abs(annualFinancials[annualFinancials.length-1]?.capitalExpenditures || 0) / Math.max(1, latestRev);
      // stmtNum: depreciation exists on corporate rows and as RE depreciation on
      // REIT rows; banks/insurers/fee firms carry none (0, never NaN).
      const lastFin = annualFinancials[annualFinancials.length-1];
      const rawDept = Math.abs(lastFin ? stmtNum(lastFin, "depreciation", stmtNum(lastFin, "depreciationAmortization")) : 0) / Math.max(1, latestRev);
      // PP&E-anchored D&A for the sealed forecast (parity with the DCF path):
      // mean(D&A_t / netPPE_{t-1}), needs ≥2 pairs.
      const routePpePairs: number[] = [];
      for (let pi = 1; pi < annualFinancials.length; pi++) {
        const prevPpe = Number(stmtNum(annualFinancials[pi - 1] as never, "netFixedAssets")) || 0;
        const rRev = Number((annualFinancials[pi] as { revenue?: number }).revenue) || 0;
        if (prevPpe > 0 && rRev > 0) {
          routePpePairs.push(Math.abs(stmtNum(annualFinancials[pi] as never, "depreciation", stmtNum(annualFinancials[pi] as never, "depreciationAmortization"))) / prevPpe);
        }
      }
      const routePpeBase = Number(stmtNum(lastFin as never, "netFixedAssets")) || 0;
      canonicalForecast = buildCanonicalForecast({
        sectorId: sectorIdForDrivers,
        operatingArchetype: archetypeProfile.sector || "general",
        baseRevenue: latestRev,
        marginalTaxRate: 0.25,
        wacc: (dcf.assumptions as any)?.wacc ?? 0.095,
        netDebt: (dcf as any).netDebt ?? 0,
        sharesOutstanding: (dcf as any).sharesOutstanding ?? stockData.sharesOutstanding ?? 1,
        cagr: baseGrowth, winsorizedCagr: baseGrowth, winsorizedLive: baseGrowth, baseGrowth, hasLive: false, liveRevGrowth: baseGrowth, years: annualFinancials.length,
        effectiveMargin: effMargin, rawAvgCapexPct: rawCapex, rawAvgDeptPct: rawDept,
        rawAvgDepOnPpe: routePpePairs.length >= 2 ? routePpePairs.reduce((s, r) => s + r, 0) / routePpePairs.length : 0,
        ppeBase: routePpeBase,
      });
    } catch (e) { console.warn("Canonical forecast build failed:", e); }

    // Fetch peer data — select listed comparable peers matching geography and industry
    let peers: unknown[] = [];
    try {
      const isIndian =
        symbol.toUpperCase().endsWith(".NS") ||
        symbol.toUpperCase().endsWith(".BO") ||
        companyProfile.country === "India";

      const ind = (companyProfile.industry || "").toLowerCase();
      const sec = (companyProfile.sector || "").toLowerCase();
      const sym = symbol.toUpperCase();

      let peerTickers: string[] = [];

      // Shared platform/carrier predicates (same as classifySector, archetype,
      // ledger moat). "Communication Services" MUST NOT imply telecom carriers.
      const isInternetPlatform = isInternetPlatformCompany(
        companyProfile.sector,
        companyProfile.industry,
        companyProfile.description,
        companyProfile.name
      );
      const isCarrier = isTelecomCarrierCompany(
        companyProfile.sector,
        companyProfile.industry,
        companyProfile.description,
        companyProfile.name
      );

      if (isIndian) {
        if (isInternetPlatform) {
          peerTickers = ["ZOMATO.NS", "DELHIVERY.NS", "PBFINTECH.NS", "NYKAA.NS"];
        } else if (
          sym.includes("SWIGGY") ||
          sym.includes("ZOMATO") ||
          ind.includes("food delivery") ||
          ind.includes("quick commerce") ||
          ind.includes("internet retail") ||
          ind.includes("hyperlocal") ||
          (companyProfile.description || "").toLowerCase().includes("food delivery") ||
          (companyProfile.description || "").toLowerCase().includes("instamart") ||
          (companyProfile.description || "").toLowerCase().includes("quick commerce")
        ) {
          peerTickers = ["ZOMATO.NS", "DELHIVERY.NS", "NAUKRI.NS", "JUSTDIAL.NS"];
        } else if (isCarrier || sym.includes("IDEA") || sym.includes("BHARTIARTL") || sym.includes("TATACOMM")) {
          peerTickers = ["BHARTIARTL.NS", "INDUSTOWER.NS", "TATACOMM.NS", "ROUTE.NS"];
        } else if (sym.includes("RELIANCE")) {
          // Energy/conglomerate comparables only — telecom carriers excluded
          // (BHARTIARTL was a cross-sector contamination).
          peerTickers = ["ONGC.NS", "BPCL.NS", "IOC.NS", "NTPC.NS"];
        } else if (ind.includes("rating") || ind.includes("financial data") || ind.includes("exchange") || ind.includes("analytics")) {
          peerTickers = ["ICRA.NS", "CAREERP.NS", "BSE.NS", "MCX.NS"];
        } else if (sym.includes("SPANDANA") || ind.includes("microfinance") || ind.includes("consumer finance") || (companyProfile.description || "").toLowerCase().includes("microfinance")) {
          peerTickers = ["CREDITACC.NS", "FUSION.NS", "SATIN.NS", "ARMANFIN.NS"];
        } else if (isHospitalityCompany(companyProfile.sector, companyProfile.industry, companyProfile.description, companyProfile.name) || ind.includes("lodg") || ind.includes("hotel") || ind.includes("resort") || ind.includes("hospitality")) {
          // Hospitality owner-operator / management peers (Indian)
          peerTickers = ["INDHOTEL.NS", "EIHOTEL.NS", "LEMONTREE.NS", "CHALET.NS"];
        } else if (isRealEstateCompany(companyProfile.sector, companyProfile.industry, companyProfile.description, companyProfile.name) || ind.includes("reit") || ind.includes("real estate") || ind.includes("property")) {
          peerTickers = ["DLF.NS", "GODREJPROP.NS", "OBEROIRLTY.NS", "PRESTIGE.NS"];
        } else if (sec.includes("agri") || ind.includes("agro") || ind.includes("crop") || ind.includes("fertiliz") || ind.includes("pesticide") || (companyProfile.description || "").toLowerCase().includes("crop protection") || (companyProfile.description || "").toLowerCase().includes("agrochemical")) {
          peerTickers = ["PIIND.NS", "UPL.NS", "COROMANDEL.NS", "SUMICHEM.NS", "DHANUKA.NS"];
        } else if (ind.includes("wind") || ind.includes("solar") || ind.includes("renewable") || sym.includes("SUZLON") || (companyProfile.name || "").toLowerCase().includes("suzlon")) {
          peerTickers = ["INOXWIND.NS", "BHEL.NS", "THERMAX.NS", "TATAPOWER.NS"];
        } else if (sec.includes("utilit") || ind.includes("power") || ind.includes("electric") || ind.includes("transmission") || (companyProfile.description || "").toLowerCase().includes("power generation") || (companyProfile.description || "").toLowerCase().includes("electricity")) {
          peerTickers = ["NTPC.NS", "POWERGRID.NS", "TATAPOWER.NS", "ADANIPOWER.NS", "JSWENERGY.NS"];
        } else if (sec.includes("cement") || ind.includes("cement") || ind.includes("building materials") || (companyProfile.description || "").toLowerCase().includes("clinker") || (companyProfile.description || "").toLowerCase().includes("cement")) {
          peerTickers = ["ULTRACEMCO.NS", "AMBUJACEM.NS", "SHREECEM.NS", "ACC.NS", "DALBHARAT.NS"];
        } else if (sec.includes("metal") || ind.includes("steel") || ind.includes("mining") || ind.includes("iron") || ind.includes("aluminum")) {
          peerTickers = ["TATASTEEL.NS", "JSWSTEEL.NS", "HINDALCO.NS", "VEDL.NS", "JINDALSTEL.NS"];
        } else if (sec.includes("chemical") || ind.includes("chemical")) {
          peerTickers = ["SRF.NS", "DEEPAKNTR.NS", "NAVINFLUOR.NS", "AARTIIND.NS", "ATUL.NS"];
        } else if (sec.includes("capital goods") || ind.includes("infrastructure") || ind.includes("engineering") || ind.includes("machinery")) {
          peerTickers = ["LT.NS", "SIEMENS.NS", "ABB.NS", "BHEL.NS", "THERMAX.NS"];
        } else if (isCarrier) {
          peerTickers = ["BHARTIARTL.NS", "IDEA.NS", "TATACOMM.NS", "INDUSTOWER.NS"];
        } else if (ind.includes("asset management") || ind.includes("wealth management") || ind.includes("mutual fund") || sym.includes("HDFCAMC") || sym.includes("NAM-INDIA") || sym.includes("UTIAMC")) {
          peerTickers = ["HDFCAMC.NS", "NAM-INDIA.NS", "UTIAMC.NS", "CAMS.NS"];
        } else if (sec.includes("financial") || ind.includes("bank")) {
          peerTickers = ["HDFCBANK.NS", "ICICIBANK.NS", "KOTAKBANK.NS", "SBIN.NS"];
        } else if (sec.includes("nbfc") || ind.includes("nbfc") || ind.includes("lending")) {
          peerTickers = ["BAJFINANCE.NS", "BAJAJFINSV.NS", "CHOLAFIN.NS", "SHRIRAMFIN.NS"];
        } else if (sec.includes("health") || ind.includes("pharma") || ind.includes("drug")) {
          peerTickers = ["SUNPHARMA.NS", "CIPLA.NS", "DRREDDY.NS", "LUPIN.NS"];
        } else if (isHardwareCompany(companyProfile.sector, companyProfile.industry, companyProfile.description, companyProfile.name) || ind.includes("computer hardware") || ind.includes("electronic components")) {
          // Listed hardware peers are global — never IT-services names.
          peerTickers = ["DELL", "HPQ", "HPE", "LOGI"];
        } else if (sec.includes("tech") || ind.includes("software") || ind.includes("information")) {
          peerTickers = ["TCS.NS", "INFY.NS", "HCLTECH.NS", "WIPRO.NS"];
        } else if (sec.includes("energy") || ind.includes("oil") || ind.includes("petro")) {
          peerTickers = ["RELIANCE.NS", "ONGC.NS", "BPCL.NS", "IOC.NS"];
        } else if (sec.includes("auto") || ind.includes("motor") || ind.includes("vehicle")) {
          peerTickers = ["TATAMOTORS.NS", "MARUTI.NS", "M&M.NS", "BAJAJ-AUTO.NS"];
        } else if (sec.includes("consumer") || ind.includes("food") || ind.includes("beverage")) {
          peerTickers = ["HINDUNILVR.NS", "ITC.NS", "NESTLEIND.NS", "BRITANNIA.NS"];
        } else {
          peerTickers = [];
        }
      } else {
        if (isInternetPlatform) {
          peerTickers = ["GOOGL", "RDDT", "SNAP", "PINS"];
        } else if (
          sym.includes("DASH") ||
          sym.includes("UBER") ||
          sym.includes("GRAB") ||
          ind.includes("delivery") ||
          (companyProfile.description || "").toLowerCase().includes("food delivery") ||
          (companyProfile.description || "").toLowerCase().includes("ride sharing")
        ) {
          peerTickers = ["DASH", "UBER", "LYFT", "GRAB"];
        } else if (isCarrier) {
          peerTickers = ["VZ", "T", "TMUS", "CMCSA"];
        } else if (ind.includes("rating") || ind.includes("financial data") || ind.includes("exchange") || ind.includes("analytics")) {
          peerTickers = ["SPGI", "MCO", "MSCI", "FDS"];
        } else if (
          ind.includes("asset management") ||
          ind.includes("wealth management") ||
          ind.includes("investment management") ||
          sym.includes("BLK") ||
          sym.includes("STT") ||
          sym.includes("TROW") ||
          sym.includes("IVZ")
        ) {
          peerTickers = ["STT", "TROW", "IVZ", "BX", "BAM", "BEN"];
        } else if (sec.includes("financial") || ind.includes("bank")) {
          peerTickers = ["JPM", "BAC", "GS", "MS"];
        } else if (sec.includes("health") || ind.includes("pharma")) {
          peerTickers = ["JNJ", "PFE", "ABBV", "MRK"];
        } else if (isHardwareCompany(companyProfile.sector, companyProfile.industry, companyProfile.description, companyProfile.name) || ind.includes("computer hardware") || ind.includes("electronic components") || ind.includes("computer peripherals") || ind.includes("data storage")) {
          // Hardware peers only — never SaaS/platform names (no MSFT/GOOGL/META here).
          peerTickers = ["DELL", "HPQ", "HPE", "LOGI", "NTAP", "STX"];
        } else if (isSoftwareCompany(companyProfile.sector, companyProfile.industry, companyProfile.description, companyProfile.name) || ind.includes("application software") || ind.includes("systems software")) {
          peerTickers = ["MSFT", "ORCL", "ADBE", "CRM", "INTU", "NOW"];
        } else if (sec.includes("tech") || ind.includes("software")) {
          peerTickers = ["AAPL", "MSFT", "GOOGL", "META"];
        } else if (sec.includes("energy") || ind.includes("oil")) {
          peerTickers = ["XOM", "CVX", "COP", "PSX"];
        } else if (
          ind.includes("auto") ||
          ind.includes("motor") ||
          ind.includes("vehicle") ||
          ["TSLA", "F", "GM", "TM", "HMC", "RIVN", "LCID", "STLA", "NIO", "XPEV", "LI"].includes(sym) ||
          (companyProfile.description || "").toLowerCase().includes("electric vehicle") ||
          (companyProfile.description || "").toLowerCase().includes("automotive")
        ) {
          peerTickers = ["F", "GM", "TM", "RIVN", "STLA", "HMC"];
        } else if (isHospitalityCompany(companyProfile.sector, companyProfile.industry, companyProfile.description, companyProfile.name) || ind.includes("lodg") || ind.includes("hotel") || ind.includes("resort") || ind.includes("hospitality")) {
          peerTickers = ["MAR", "HLT", "H", "IHG", "WH", "CHH"];
        } else if (isRealEstateCompany(companyProfile.sector, companyProfile.industry, companyProfile.description, companyProfile.name) || ind.includes("reit") || ind.includes("real estate") || ind.includes("property")) {
          peerTickers = ["AMT", "PLD", "EQIX", "PSA", "O"];
        } else if (
          ind.includes("apparel") ||
          ind.includes("footwear") ||
          ind.includes("textile") ||
          ind.includes("sportswear") ||
          ind.includes("luxury") ||
          ind.includes("accessories") ||
          sym.includes("NKE") ||
          sym.includes("LULU") ||
          sym.includes("DECK") ||
          sym.includes("CROX")
        ) {
          peerTickers = ["NKE", "LULU", "DECK", "CROX", "SKX", "HBI"];
        } else {
          // No generic catch-all bucket: unrelated industrials (HON/GE/CAT/UPS)
          // contaminated every unclassified report. Empty list suppresses the
          // relative-valuation conclusion instead of fabricating comparables.
          peerTickers = [];
        }
      }

      const filteredPeers = peerTickers.filter(t => t.toUpperCase() !== symbol.toUpperCase()).slice(0, 4);

      if (filteredPeers.length > 0) {
        const peerRaw = await fetchPeerQuotes(filteredPeers);
        // Priority 1+5: hard ontology is the candidate universe authority; similarity engine scores.
        const ontology = buildCompanyOntology(companyProfile, archetypeProfile as never);
        // Prefer ontology competitor universe when curated branch left gaps (general fallback).
        if (peerTickers.length === 0 && ontology.competitors.length > 0) {
          // (candidate pool already fixed above; ontology documents the intended universe for QA)
        }
        peers = peerRaw.map(p => {
          const tickerStr = (p.symbol as string) || "";
          const parseNum = (v: any): number | null => {
            if (v === null || v === undefined || v === "") return null;
            const n = Number(v);
            return isFinite(n) && !isNaN(n) ? n : null;
          };

          const pCap = parseNum(p.marketCap);
          const pCmp = parseNum(p.regularMarketPrice);
          const pPe = parseNum(p.trailingPE);
          const pEvEbitda = parseNum(p.enterpriseToEbitda);
          const pEvSales = parseNum(p.enterpriseToRevenue);
          const pPb = parseNum(p.priceToBook);
          const pRoe = parseNum(p.returnOnEquity);
          const pNetMargin = parseNum(p.profitMargins);
          const pRevGrowth = parseNum(p.revenueGrowth);
          const pDivYield = parseNum(p.dividendYield);
          const pGrossMargin = parseNum(p.grossMargins);
          const pEbitdaMargin = parseNum(p.ebitdaMargins);
          const pOpMargin = parseNum(p.operatingMargins);
          const pDebtToEquity = parseNum(p.debtToEquity);
          const pCurrentRatio = parseNum(p.currentRatio);
          const pBeta = parseNum((p as Record<string, unknown>).beta);

          // Priority 5: business-model similarity engine (operating model + geography +
          // growth + margins + capital intensity + size). Ontology is the authority.
          const qSec = ((p.sector as string) || "").toLowerCase() || null;
          const qInd = ((p.industry as string) || "").toLowerCase() || null;
          let relevanceScore: number | null = null;
          if (qSec || qInd) {
            const breakdown = scorePeerSimilarity({
              profile: companyProfile,
              stockData,
              annualFinancials,
              ontologySectorId: ontology.sectorId,
              ontologyArchetype: ontology.operatingArchetype,
              peer: {
                sector: qSec,
                industry: qInd,
                currency: (p.currency as string) || null,
                marketCap: pCap,
                roe: pRoe,
                netMargin: pNetMargin,
                revenueGrowth: pRevGrowth,
                debtToEquity: pDebtToEquity,
              },
            });
            relevanceScore = breakdown.total;
          }

          return {
            ticker: tickerStr,
            name: (p.longName as string) || (p.shortName as string) || tickerStr,
            // Missing market data stays null (renders N/M) — never invented constants.
            marketCap: pCap,
            cmp: pCmp,
            pe: pPe,
            evToEbitda: pEvEbitda,
            evToSales: pEvSales,
            dividendYield: pDivYield,
            pb: pPb,
            roe: pRoe,
            netMargin: pNetMargin,
            grossMargin: pGrossMargin,
            ebitdaMargin: pEbitdaMargin,
            operatingMargin: pOpMargin,
            debtToEquity: pDebtToEquity,
            currentRatio: pCurrentRatio,
            revenueGrowth: pRevGrowth,
            // Point-in-time peer beta for the median beta engine (P0 #57) —
            // null when undisclosed (single-beta path, limitation disclosed).
            beta: pBeta,
            // Missing peer currency stays null (renders N/M) — never inherit
            // the subject's currency, which stamps wrong FX on foreign peers.
            currency: (p.currency as string) || null,
            sector: qSec,
            industry: qInd,
            relevanceScore,
          };
        }).filter(p => p.ticker && (p.marketCap != null || p.cmp != null || p.pe != null));
        // Priority 5 gate: suppress relative valuation when similarity is insufficient.
        const gate = gatePeerSet(peers as never);
        if (gate.suppress) {
          console.warn(`Peer similarity gate suppressed relative valuation for ${symbol}: ${gate.reason}`);
          peers = [];
        }
      }
    } catch (peerError) {
      console.warn("Peer fetch failed:", peerError);
    }

    const masterReportFacts = buildMasterReportFacts({
      stockData,
      profile: companyProfile,
      annualFinancials,
      ratiosByYear,
      dupontByYear,
      dcf,
      peers: peers as any[],
    });

    // P0 #7 — Dependency-aware propagation (debt→netDebt→EV→equity→fairValue)
    const depState = propagateInvalid({
      netDebt: identityIssues.some(i=>i.code==="BS-IDENTITY"&&i.severity==="FAIL") ? { valid:false, confidence:"UNKNOWN", blockedBy:[] as never, reason:"BS identity FAIL" } : undefined,
      tax: canonicalFacts.years.some(y=>y.incomeTaxExpense.value===null) ? { valid:true, confidence:"LOW", blockedBy:[], reason:"tax uncertain" } : undefined,
    });

    // P0 #8 — Independent recalculation (separate code path)
    // Financial-institution path covers architectures B (bank/nbfc) and C
    // (insurance): residual-income valuation, FCF≈CFO informational only.
    const gateArch = getArchitectureForSector(gateSector.id).arch;
    const isFinArch = gateArch === "B" || gateArch === "C";
    const independentReport = validateIndependently({
      facts: canonicalFacts,
      isFinancialInstitution: isFinArch || (buildCompanyOntology(companyProfile, archetypeProfile as never).sectorId === "bank") || companyProfile.sector?.toLowerCase().includes("bank") || companyProfile.industry?.toLowerCase().includes("insurance") || false,
      // IndependentInputs.archetype expects the FinancialArchetype ("DISTRESSED" /
      // "EARLY_PLATFORM_GROWTH" for risk spreads) — NOT the GICS operating sector.
      // Passing .sector here zeroed the distress spread in re-solution while the model
      // applied +200bps, false-failing IND-04 for every distressed company.
      archetype: archetypeProfile.archetype,
      beta: stockData.beta as number | undefined,
      country: companyProfile.country,
      dcf: { enterpriseValue: (dcf as any).enterpriseValue, sumPvFcff: (dcf as any).sumPvFcff, pvTerminalValue: (dcf as any).pvTerminalValue, equityValue: (dcf as any).equityValue, netDebt: (dcf as any).netDebt, financeReceivablesOffset: (dcf as any).financeReceivablesOffset, intrinsicValue: (dcf as any).intrinsicValue, fairValuePerShare: (dcf as any).intrinsicValue, sharesOutstanding: (dcf as any).sharesOutstanding ?? stockData.sharesOutstanding ?? 1, currentMarketPrice: stockData.currentPrice, assumptions: dcf.assumptions as any },
      ledger: { fairValue: (masterReportFacts as any).valuation?.fairValue ?? dcf.intrinsicValue, targetPrice: (masterReportFacts as any).valuation?.fairValue ?? dcf.intrinsicValue, currentPrice: stockData.currentPrice, enterpriseValue: (dcf as any).enterpriseValue, equityValue: (dcf as any).equityValue, netDebt: (dcf as any).netDebt, sharesOutstanding: (dcf as any).sharesOutstanding, wacc: (dcf.assumptions as any)?.wacc, rating: (masterReportFacts as any).rating ?? "HOLD" },
    });

    // P0 #10 — CanonicalReport (single approved object, sealed)
    let canonicalReport: ReturnType<typeof buildCanonicalReport> | null = null;
    try {
      const auditGraph = canonicalForecast ? buildAuditGraph([]) : { modelVersion:"apex-financial-model-v1", nodes:[], edges:[] };
      canonicalReport = buildCanonicalReport({
        ticker: symbol,
        companyName: companyProfile.name,
        currency: canonicalFacts.currency,
        asOf: canonicalFacts.asOf,
        modelVersion: "apex-financial-model-v1",
        facts: canonicalFacts,
        forecast: canonicalForecast ?? { driverEquation:"not built", basis:{}, modelVersion:"apex-financial-model-v1", revenueGrowthRates:[], ebitMargins:[], terminalGrowthRate:0.04, avgCapexPct:0.04, avgDeptPct:0.035, avgNwcChangePct:0.02, projections:[], terminal:{fcffT:0,wacc:0.095,g:0.04,terminalValue:0,pvTerminalValue:0,capped:false,spreadOk:true}, wacc:0.095, netDebt:0, sharesOutstanding:1 },
        valuation: { enterpriseValue: (dcf as any).enterpriseValue ?? 0, equityValue: (dcf as any).equityValue ?? 0, fairValuePerShare: (dcf as any).intrinsicValue ?? 0, netDebt: (dcf as any).netDebt ?? 0, wacc: (dcf.assumptions as any)?.wacc ?? 0.095, terminalGrowth: (dcf.assumptions as any)?.terminalGrowthRate ?? 0.04 },
        market: { price: stockData.currentPrice, sharesBasic: canonicalFacts.market.sharesBasic.value, sharesDiluted: canonicalFacts.market.sharesDiluted.value, marketCap: stockData.marketCap },
        ratios: Object.fromEntries(ratiosByYear.map(r=>[r.year, r.roe])),
        auditGraph,
        claims: [],
      });
    } catch (e) { console.warn("CanonicalReport build failed:", e); }

    lifecycle.advance("MODELED", `valuation ${valuationResult.selectedModel} + ledger + facts built`);

    return NextResponse.json({
      pipeline: lifecycle.history_(),
      profile: companyProfile,
      stockData,
      annualFinancials,
      quarterlyFinancials,
      ratiosByYear,
      dupontByYear,
      dcf,
      shareholding,
      peers,
      news: tickerNews,
      eventPriceMovements: buildEventPriceMovements(tickerNews, stockData, companyProfile, eventPriceLookup),
      masterReportFacts,
      calibration: valuationCalibration,
      canonicalFacts,
      canonicalForecast,
      canonicalReport,
      reconciliation,
      identityIssues,
      dependencyState: depState,
      independentReport,
    });
  } catch (error) {
    console.error("Company data fetch error:", error);
    const message = error instanceof Error ? error.message : "Failed to fetch company data";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
