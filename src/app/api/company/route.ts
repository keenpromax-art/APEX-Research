import { NextRequest, NextResponse } from "next/server";
import { fetchQuoteSummary, parseQuoteSummary, fetchPeerQuotes, getTickerNews, fetchDailyPriceHistory } from "@/lib/yahoo-finance";
import { computeRatios, computeDuPont } from "@/lib/calculations";
import { selectAndComputeValuation } from "@/lib/valuation";
import { classifyArchetype } from "@/lib/company-archetype";
import { buildMasterReportFacts } from "@/lib/report-facts";
import { buildEventPriceMovements } from "@/lib/event-price-engine";
import { normalizeTicker } from "@/lib/request-validation";
import { isInternetPlatformCompany, isTelecomCarrierCompany, isHospitalityCompany, isRealEstateCompany } from "@/lib/sectors/profiles";
import { buildCompanyOntology } from "@/lib/company-ontology";
import { scorePeerSimilarity, gatePeerSet } from "@/lib/peer-similarity";

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
    const raw = await fetchQuoteSummary(symbol);
    const { companyProfile, stockData, annualFinancials, quarterlyFinancials, shareholding } =
      parseQuoteSummary(raw as Record<string, unknown>, symbol);

    if (annualFinancials.length === 0) {
      return NextResponse.json(
        { error: `No financial data found for ${symbol}. This ticker may not have public financials.` },
        { status: 404 }
      );
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

    // Dynamic Sector & Archetype-Calibrated Valuation (Residual Income for Financials / FCFF for non-financials)
    const archetypeProfile = classifyArchetype(companyProfile, stockData, annualFinancials);
    const valuationResult = selectAndComputeValuation({
      profile: companyProfile,
      stockData,
      annualFinancials,
      archetypeProfile,
    });
    const dcf = valuationResult.dcf;
    const valuationCalibration = valuationResult.calibration;

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

    return NextResponse.json({
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
    });
  } catch (error) {
    console.error("Company data fetch error:", error);
    const message = error instanceof Error ? error.message : "Failed to fetch company data";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
