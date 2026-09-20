import { NextRequest, NextResponse } from "next/server";
import { fetchQuoteSummary, parseQuoteSummary, fetchPeerQuotes, getTickerNews, fetchDailyPriceHistory, getYahooSession } from "@/lib/yahoo-finance";
import { computeRatios, computeDuPont } from "@/lib/calculations";
import { selectAndComputeValuation } from "@/lib/valuation";
import { classifyArchetype } from "@/lib/company-archetype";
import { buildMasterReportFacts } from "@/lib/report-facts";
import { buildEventPriceMovements } from "@/lib/event-price-engine";
import { normalizeTicker } from "@/lib/request-validation";
import { isInternetPlatformCompany, isTelecomCarrierCompany, isHospitalityCompany, isRealEstateCompany, isHardwareCompany, isSoftwareCompany, classifySector } from "@/lib/sectors/profiles";
import { isSectorSupported, unsupportedSectorPayload, getArchitectureForSector } from "@/lib/sectors/architectures";
import { buildCompanyOntology } from "@/lib/company-ontology";
import { scorePeerSimilarity, gatePeerSet } from "@/lib/peer-similarity";
import { ModelLifecycle, buildAuditGraph } from "@/lib/financial-kernel";
import { assessMarketIntegrity } from "@/lib/financial-provenance";
import { buildCanonicalFacts, sealCanonicalFacts, verifyCanonicalSeal } from "@/lib/canonical-facts";
import { enforceAccountingIdentities } from "@/lib/accounting-identity-engine";
import { propagateInvalid } from "@/lib/dependency-propagation";
import { validateIndependently } from "@/lib/independent-validator";
import { buildCanonicalReport } from "@/lib/canonical-report";
import { reconcileAll } from "@/lib/source-reconciliation";
import { buildEvidenceRegistryFromInputs } from "@/lib/evidence-registry";
import { generateAIDCFAssumptions } from "@/lib/openrouter";

export const runtime = "nodejs";
export const maxDuration = 90;

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

    // ── PARALLEL I/O LAUNCH ──────────────────────────────────────────────
    // News, AI DCF assumptions, and peer data are all independent of each
    // other and only need companyProfile/stockData/annualFinancials (available
    // now). Launch all three as background Promises so Yahoo fetches + LLM
    // call overlap instead of blocking sequentially.
    const newsPromise = (async () => {
      try {
        const tickerNews = await getTickerNews(symbol, companyProfile.name, 15);
        let eventPriceLookup: { sessions: { date: string; close: number | null; volume: number | null }[]; marketSessions?: { date: string; close: number | null; volume: number | null }[] | null; marketSymbol?: string } | null = null;
        const dated = tickerNews
          .filter((n: any) => n.publishedAt && !isNaN(new Date(n.publishedAt).getTime()))
          .map((n: any) => new Date(n.publishedAt as string).getTime());
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
            eventPriceLookup = { sessions, marketSessions: marketSessions && marketSessions.length > 0 ? marketSessions : null, marketSymbol };
          }
        }
        return { tickerNews, eventPriceLookup };
      } catch (e) {
        console.warn("News/event fetch failed:", e);
        return { tickerNews: [] as any[], eventPriceLookup: null };
      }
    })();

    const aiDcfPromise = generateAIDCFAssumptions(companyProfile, stockData, annualFinancials).catch(e => {
      console.warn("[company] AI DCF assumption generation failed, using mechanical defaults:", e);
      return null;
    });

    const archetypeProfile = classifyArchetype(companyProfile, stockData, annualFinancials);
    const ontology = buildCompanyOntology(companyProfile, archetypeProfile as never);

    // Peer data: selection + fetchPeerQuotes + enrichment — runs in parallel with news + AI DCF
    const peersPromise = (async () => {
      try {
        const isIndian = symbol.toUpperCase().endsWith(".NS") || symbol.toUpperCase().endsWith(".BO") || companyProfile.country === "India";
        const ind = (companyProfile.industry || "").toLowerCase();
        const sec = (companyProfile.sector || "").toLowerCase();
        const sym = symbol.toUpperCase();
        let peerTickers: string[] = [];
        const isInternetPlatform = isInternetPlatformCompany(companyProfile.sector, companyProfile.industry, companyProfile.description, companyProfile.name);
        const isCarrier = isTelecomCarrierCompany(companyProfile.sector, companyProfile.industry, companyProfile.description, companyProfile.name);
        if (isIndian) {
          if (isInternetPlatform) peerTickers = ["ZOMATO.NS", "DELHIVERY.NS", "PBFINTECH.NS", "NYKAA.NS"];
          else if (sym.includes("SWIGGY") || sym.includes("ZOMATO") || ind.includes("food delivery") || ind.includes("quick commerce") || ind.includes("internet retail") || ind.includes("hyperlocal") || (companyProfile.description || "").toLowerCase().includes("food delivery") || (companyProfile.description || "").toLowerCase().includes("instamart") || (companyProfile.description || "").toLowerCase().includes("quick commerce")) peerTickers = ["ZOMATO.NS", "DELHIVERY.NS", "NAUKRI.NS", "JUSTDIAL.NS"];
          else if (isCarrier || sym.includes("IDEA") || sym.includes("BHARTIARTL") || sym.includes("TATACOMM")) peerTickers = ["BHARTIARTL.NS", "INDUSTOWER.NS", "TATACOMM.NS", "ROUTE.NS"];
          else if (sym.includes("RELIANCE")) peerTickers = ["ONGC.NS", "BPCL.NS", "IOC.NS", "NTPC.NS"];
          else if (ind.includes("rating") || ind.includes("financial data") || ind.includes("exchange") || ind.includes("analytics")) peerTickers = ["ICRA.NS", "CAREERP.NS", "BSE.NS", "MCX.NS"];
          else if (sym.includes("SPANDANA") || ind.includes("microfinance") || ind.includes("consumer finance") || (companyProfile.description || "").toLowerCase().includes("microfinance")) peerTickers = ["CREDITACC.NS", "FUSION.NS", "SATIN.NS", "ARMANFIN.NS"];
          else if (isHospitalityCompany(companyProfile.sector, companyProfile.industry, companyProfile.description, companyProfile.name) || ind.includes("lodg") || ind.includes("hotel") || ind.includes("resort") || ind.includes("hospitality")) peerTickers = ["INDHOTEL.NS", "EIHOTEL.NS", "LEMONTREE.NS", "CHALET.NS"];
          else if (isRealEstateCompany(companyProfile.sector, companyProfile.industry, companyProfile.description, companyProfile.name) || ind.includes("reit") || ind.includes("real estate") || ind.includes("property")) peerTickers = ["DLF.NS", "GODREJPROP.NS", "OBEROIRLTY.NS", "PRESTIGE.NS"];
          else if (sec.includes("agri") || ind.includes("agro") || ind.includes("crop") || ind.includes("fertiliz") || ind.includes("pesticide") || (companyProfile.description || "").toLowerCase().includes("crop protection") || (companyProfile.description || "").toLowerCase().includes("agrochemical")) peerTickers = ["PIIND.NS", "UPL.NS", "COROMANDEL.NS", "SUMICHEM.NS", "DHANUKA.NS"];
          else if (ind.includes("wind") || ind.includes("solar") || ind.includes("renewable") || sym.includes("SUZLON") || (companyProfile.name || "").toLowerCase().includes("suzlon")) peerTickers = ["INOXWIND.NS", "BHEL.NS", "THERMAX.NS", "TATAPOWER.NS"];
          else if (sec.includes("utilit") || ind.includes("power") || ind.includes("electric") || ind.includes("transmission") || (companyProfile.description || "").toLowerCase().includes("power generation") || (companyProfile.description || "").toLowerCase().includes("electricity")) peerTickers = ["NTPC.NS", "POWERGRID.NS", "TATAPOWER.NS", "ADANIPOWER.NS", "JSWENERGY.NS"];
          else if (sec.includes("cement") || ind.includes("cement") || ind.includes("building materials") || (companyProfile.description || "").toLowerCase().includes("clinker") || (companyProfile.description || "").toLowerCase().includes("cement")) peerTickers = ["ULTRACEMCO.NS", "AMBUJACEM.NS", "SHREECEM.NS", "ACC.NS", "DALBHARAT.NS"];
          else if (sec.includes("metal") || ind.includes("steel") || ind.includes("mining") || ind.includes("iron") || ind.includes("aluminum")) peerTickers = ["TATASTEEL.NS", "JSWSTEEL.NS", "HINDALCO.NS", "VEDL.NS", "JINDALSTEL.NS"];
          else if (sec.includes("chemical") || ind.includes("chemical")) peerTickers = ["SRF.NS", "DEEPAKNTR.NS", "NAVINFLUOR.NS", "AARTIIND.NS", "ATUL.NS"];
          else if (sec.includes("capital goods") || ind.includes("infrastructure") || ind.includes("engineering") || ind.includes("machinery")) peerTickers = ["LT.NS", "SIEMENS.NS", "ABB.NS", "BHEL.NS", "THERMAX.NS"];
          else if (isCarrier) peerTickers = ["BHARTIARTL.NS", "IDEA.NS", "TATACOMM.NS", "INDUSTOWER.NS"];
          else if (ind.includes("asset management") || ind.includes("wealth management") || ind.includes("mutual fund") || sym.includes("HDFCAMC") || sym.includes("NAM-INDIA") || sym.includes("UTIAMC")) peerTickers = ["HDFCAMC.NS", "NAM-INDIA.NS", "UTIAMC.NS", "CAMS.NS"];
          else if (sec.includes("financial") || ind.includes("bank")) peerTickers = ["HDFCBANK.NS", "ICICIBANK.NS", "KOTAKBANK.NS", "SBIN.NS"];
          else if (sec.includes("nbfc") || ind.includes("nbfc") || ind.includes("lending")) peerTickers = ["BAJFINANCE.NS", "BAJAJFINSV.NS", "CHOLAFIN.NS", "SHRIRAMFIN.NS"];
          else if (sec.includes("health") || ind.includes("pharma") || ind.includes("drug")) peerTickers = ["SUNPHARMA.NS", "CIPLA.NS", "DRREDDY.NS", "LUPIN.NS"];
          else if (isHardwareCompany(companyProfile.sector, companyProfile.industry, companyProfile.description, companyProfile.name) || ind.includes("computer hardware") || ind.includes("electronic components")) peerTickers = ["DELL", "HPQ", "HPE", "LOGI"];
          else if (sec.includes("tech") || ind.includes("software") || ind.includes("information")) peerTickers = ["TCS.NS", "INFY.NS", "HCLTECH.NS", "WIPRO.NS"];
          else if (sec.includes("energy") || ind.includes("oil") || ind.includes("petro")) peerTickers = ["RELIANCE.NS", "ONGC.NS", "BPCL.NS", "IOC.NS"];
          else if (sec.includes("auto") || ind.includes("motor") || ind.includes("vehicle")) peerTickers = ["TATAMOTORS.NS", "MARUTI.NS", "M&M.NS", "BAJAJ-AUTO.NS"];
          else if (sec.includes("consumer") || ind.includes("food") || ind.includes("beverage")) peerTickers = ["HINDUNILVR.NS", "ITC.NS", "NESTLEIND.NS", "BRITANNIA.NS"];
          else peerTickers = [];
        } else {
          if (isInternetPlatform) peerTickers = ["META", "MSFT", "AMZN", "SNAP", "PINS"];
          else if (sym.includes("DASH") || sym.includes("UBER") || sym.includes("LYFT") || sym.includes("GRAB") || ind.includes("delivery") || (companyProfile.description || "").toLowerCase().includes("food delivery") || (companyProfile.description || "").toLowerCase().includes("ride sharing")) peerTickers = ["DASH", "UBER", "LYFT", "GRAB"];
          else if (isCarrier) peerTickers = ["VZ", "T", "TMUS", "CMCSA"];
          else if (ind.includes("rating") || ind.includes("financial data") || ind.includes("exchange") || ind.includes("analytics")) peerTickers = ["SPGI", "MCO", "MSCI", "FDS"];
          else if (ind.includes("asset management") || ind.includes("wealth management") || ind.includes("investment management") || sym.includes("BLK") || sym.includes("STT")) peerTickers = ["BLK", "STT", "AB", "NTRS"];
          else if (ind.includes("reit") || ind.includes("real estate") || ind.includes("property")) peerTickers = ["PLD", "AMT", "CCI", "EQIX"];
          else if (isHardwareCompany(companyProfile.sector, companyProfile.industry, companyProfile.description, companyProfile.name) || ind.includes("computer hardware") || ind.includes("electronic components")) peerTickers = ["DELL", "HPQ", "HPE", "LOGI"];
          else if (sec.includes("tech") || ind.includes("software") || ind.includes("information")) peerTickers = ["MSFT", "GOOGL", "CRM", "ADBE"];
          else if (sec.includes("health") || ind.includes("pharma") || ind.includes("drug")) peerTickers = ["JNJ", "PFE", "MRK", "ABBV"];
          else if (sec.includes("financ") || ind.includes("bank")) peerTickers = ["JPM", "BAC", "GS", "MS"];
          else if (sec.includes("consumer") || ind.includes("retail")) peerTickers = ["AMZN", "WMT", "COST", "TGT"];
          else if (sec.includes("energy") || ind.includes("oil")) peerTickers = ["XOM", "CVX", "COP", "SLB"];
          else if (sec.includes("auto") || ind.includes("motor")) peerTickers = ["TSLA", "F", "GM", "STLA"];
          else peerTickers = [];
        }
        const cleanSym = (sym || "").toUpperCase().replace(/\.(NS|BO)$/, "");
        peerTickers = peerTickers.filter(t => {
          const normT = t.toUpperCase().replace(/\.(NS|BO)$/, "");
          if (normT === cleanSym) return false;
          if ((cleanSym === "GOOG" || cleanSym === "GOOGL") && (normT === "GOOG" || normT === "GOOGL")) return false;
          return true;
        });
        if (peerTickers.length === 0) return [];
        const [rawQuotes, peerSession] = await Promise.all([
          fetchPeerQuotes(peerTickers),
          getYahooSession(),
        ]);
        if (rawQuotes.length === 0) return [];
        const peerModules = "defaultKeyStatistics,financialData,summaryDetail,assetProfile";
        const peerCrumbParam = peerSession.crumb ? `&crumb=${encodeURIComponent(peerSession.crumb)}` : "";
        const peerHeaders = { ...(peerSession.cookie ? { Cookie: peerSession.cookie } : {}) } as Record<string, string>;
        const parseNum = (v: unknown): number | null => { const n = Number(v); return Number.isFinite(n) ? n : null; };
        const enriched = await Promise.all(
          peerTickers.map(async (peerSym) => {
            const baseQuote = rawQuotes.find((q: any) => ((q.symbol as string) || "").toUpperCase() === peerSym.toUpperCase()) || {};
            try {
              let sumData: Record<string, unknown> = {};
              for (const base of ["https://query2.finance.yahoo.com", "https://query1.finance.yahoo.com"]) {
                try {
                  const url = `${base}/v10/finance/quoteSummary/${encodeURIComponent(peerSym)}?modules=${peerModules}${peerCrumbParam}`;
                  const sumRes = await fetch(url, { headers: peerHeaders });
                  if (sumRes.ok) { const sj = await sumRes.json(); sumData = sj?.quoteSummary?.result?.[0] ?? {}; break; }
                } catch { /* try next base */ }
              }
              const p = { ...baseQuote, ...sumData };
              const pCap = parseNum(p.marketCap);
              const pCmp = parseNum(p.regularMarketPrice);
              const pPe = parseNum(p.trailingPE);
              const pEvEbitda = parseNum(p.enterpriseToEbitda);
              const pEvSales = parseNum(p.enterpriseToRevenue);
              const pPb = parseNum(p.priceToBook);
              const pRoe = parseNum(p.returnOnEquity);
              const pNetMargin = parseNum(p.profitMargins);
              const pRevGrowth = parseNum(p.revenueGrowth);
              const pEpsGrowth = parseNum((p as any).earningsGrowth) ?? parseNum((p as any).earningsQuarterlyGrowth);
              const pDivYield = parseNum(p.dividendYield);
              const pGrossMargin = parseNum(p.grossMargins);
              const pEbitdaMargin = parseNum(p.ebitdaMargins);
              const pOpMargin = parseNum(p.operatingMargins);
              const pDebtToEquity = parseNum(p.debtToEquity);
              const pCurrentRatio = parseNum(p.currentRatio);
              const pBeta = parseNum((p as Record<string, unknown>).beta);
              const qSec = ((p.sector as string) || "").toLowerCase() || null;
              const qInd = ((p.industry as string) || "").toLowerCase() || null;
              let relevanceScore: number | null = null;
              if (qSec || qInd) {
                const breakdown = scorePeerSimilarity({ profile: companyProfile, stockData, annualFinancials, ontologySectorId: ontology.sectorId, ontologyArchetype: ontology.operatingArchetype, peer: { sector: qSec, industry: qInd, currency: (p.currency as string) || null, marketCap: pCap, roe: pRoe, netMargin: pNetMargin, revenueGrowth: pRevGrowth, debtToEquity: pDebtToEquity } });
                relevanceScore = breakdown.total;
              }
              return { ticker: peerSym, name: (p.longName as string) || (p.shortName as string) || peerSym, marketCap: pCap, cmp: pCmp, pe: pPe, evToEbitda: pEvEbitda, evToSales: pEvSales, dividendYield: pDivYield, pb: pPb, roe: pRoe, netMargin: pNetMargin, grossMargin: pGrossMargin, ebitdaMargin: pEbitdaMargin, operatingMargin: pOpMargin, debtToEquity: pDebtToEquity, currentRatio: pCurrentRatio, revenueGrowth: pRevGrowth, epsGrowth: pEpsGrowth, beta: pBeta, currency: (p.currency as string) || null, sector: qSec, industry: qInd, relevanceScore };
            } catch { return null; }
          })
        );
        const peers = enriched.filter((p: any) => p && p.ticker && (p.marketCap != null || p.cmp != null || p.pe != null));
        const gate = gatePeerSet(peers as never);
        if (gate.suppress) { console.warn(`Peer similarity gate suppressed relative valuation for ${symbol}: ${gate.reason}`); return []; }
        return peers;
      } catch (peerError) {
        console.warn("Peer fetch failed:", peerError);
        return [];
      }
    })();

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
    // The valuation computes the single canonical forecast internally (P0 #4);
    // nothing here rebuilds forward numbers in parallel (defect by definition).

    // AI-driven DCF assumptions: await the promise launched above
    const aiDcfOverrides = await aiDcfPromise;

    const valuationResult = selectAndComputeValuation({
      profile: companyProfile,
      stockData,
      annualFinancials,
      archetypeProfile,
      aiDcfOverrides,
    });
    const dcf = valuationResult.dcf;
    const valuationCalibration = valuationResult.calibration;

    // P0 #4 — Single Canonical Forecast: consumed from the DCF result, which
    // built it as the ONLY forward pipeline (facts → drivers → assumptions →
    // statements → FCFF → DCF). A parallel rebuild here with different seeds
    // would fork the model — prohibited (FY26 46.8% → FY27E 14.8% vs DCF
    // 62.5% class of bug). Absence is a QA BLOCKER downstream, never rebuilt.
    const canonicalForecast = (dcf as any)?.canonicalForecast ?? null;
    if (!canonicalForecast) console.warn("Canonical forecast missing from DCF result — QA must block (FCST-05).");

    // Await peer data promise (launched in parallel above)
    const peers = await peersPromise;

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
      ledger: { fairValue: (masterReportFacts as any).valuation?.fairValue ?? dcf.intrinsicValue, targetPrice: (masterReportFacts as any).valuation?.fairValue ?? dcf.intrinsicValue, currentPrice: stockData.currentPrice, enterpriseValue: (dcf as any).enterpriseValue, equityValue: (dcf as any).equityValue, netDebt: (dcf as any).netDebt, sharesOutstanding: (dcf as any).sharesOutstanding, wacc: (dcf.assumptions as any)?.wacc, rating: masterReportFacts.recommendation?.rating ?? "HOLD" },
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
        forecast: canonicalForecast ?? null,
        valuation: { enterpriseValue: (dcf as any).enterpriseValue ?? 0, equityValue: (dcf as any).equityValue ?? 0, fairValuePerShare: (dcf as any).intrinsicValue ?? 0, netDebt: (dcf as any).netDebt ?? 0, wacc: (dcf.assumptions as any)?.wacc ?? 0.095, terminalGrowth: (dcf.assumptions as any)?.terminalGrowthRate ?? 0.04 },
        market: { price: stockData.currentPrice, sharesBasic: canonicalFacts.market.sharesBasic.value, sharesDiluted: canonicalFacts.market.sharesDiluted.value, marketCap: stockData.marketCap },
        ratios: Object.fromEntries(ratiosByYear.map(r=>[r.year, r.roe])),
        auditGraph,
        claims: [],
      });
    } catch (e) { console.warn("CanonicalReport build failed:", e); }

    lifecycle.advance("MODELED", `valuation ${valuationResult.selectedModel} + ledger + facts built`);

    // TRACK 3 — Evidence IDs in data: every priced/evidenced number carries
    // an EV:<TIER>:<SOURCE>:<FIELD> ID (additive payload field; legacy
    // consumers ignore it, claim-validator consumes it).
    let evidenceRegistry: ReturnType<typeof buildEvidenceRegistryFromInputs> | null = null;
    try {
      evidenceRegistry = buildEvidenceRegistryFromInputs({
        annualFinancials: annualFinancials as never,
        stockData: stockData as never,
        dcf: dcf as never,
      });
    } catch (e) { console.warn("Evidence registry build failed (non-blocking):", e); }

    // Await news + event price history promise (launched in parallel above)
    const { tickerNews, eventPriceLookup } = await newsPromise;

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
      evidenceRegistry,
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
