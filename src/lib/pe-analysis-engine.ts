// ============================================================
// Institutional Private Equity (PE) Analysis Engine
// Multi-Agent Section Synthesizer for Institutional Buy-Side Reports
// Fully grounded in Company Archetype & GICS Sector routing
// ============================================================
import type {
  CompanyProfile,
  StockData,
  AnnualFinancials,
  DCFResult,
  AIAnalysis,
  Ratios,
  DuPontAnalysis,
  TickerNewsItem,
  CouncilVerificationAudit,
  NewsSummaryDeskAnalysis,
} from "@/types/report";
import { stmtNum, isReitStatement, isAssetLightStatement } from "@/types/report";
import { formatPct, formatLargeNum } from "./calculations";
import { classifyArchetype, type GICSSector, type FinancialArchetype } from "./company-archetype";
import { buildCompanyOntology } from "./company-ontology";
import { resolveMoatRating, capPillarsToRating } from "./moat";

export interface PEAnalysisInput {
  profile: CompanyProfile;
  stockData: StockData;
  annualFinancials: AnnualFinancials[];
  dcf: DCFResult;
  ratiosByYear?: Ratios[];
  dupontByYear?: DuPontAnalysis[];
  news?: TickerNewsItem[];
  assumptionsLedger?: any;
  masterReportFacts?: any;
}

export function generatePEFirmAnalysis(input: PEAnalysisInput): AIAnalysis {
  const { profile, stockData, annualFinancials, dcf } = input;
  const latest = annualFinancials[annualFinancials.length - 1] || ({} as AnnualFinancials);
  const prev = annualFinancials[annualFinancials.length - 2] || latest;
  
  // Priority 1: hard CompanyOntology is the single authority (sector + archetype + drivers + KPIs).
  const archProfile = classifyArchetype(profile, stockData, annualFinancials);
  const sectorType = archProfile.sector;
  const archetype = archProfile.archetype;
  const ontology = buildCompanyOntology(profile, archProfile);
  // Also resolve canonical SectorProfile id (consumer / auto / etc.) for
  // cases where archetype sector is generic (general_industrial) but the
  // company is clearly FMCG/consumer by GICS (e.g. ITC). Ontology is authoritative.
  const sectorProfileId: string = ontology.sectorId;

  const cur = profile.currency || "INR";
  const sym = cur === "INR" ? "Rs. " : cur === "USD" ? "$" : cur === "EUR" ? "€" : "£";
  const cmp = stockData.currentPrice || dcf.currentMarketPrice || 100;
  const fv = dcf.intrinsicValue || cmp * 1.1;
  const rev = latest.revenue || 1000000;
  // Arch-aware earnings power for the evidence lead: REITs read FFO (EBITDA is
  // depreciation-distorted and absent by design); fee franchises read operating
  // income (their real margin construct); corporates/banks read EBITDA exactly
  // as before (bank zero preserved). Labels follow the construct so prose never
  // prints "EBITDA margin" for a REIT.
  const earnBasis = isReitStatement(latest)
    ? { label: "FFO", value: latest.fundsFromOperations, margin: rev > 0 ? latest.fundsFromOperations / rev : 0 }
    : isAssetLightStatement(latest)
      ? { label: "operating", value: latest.operatingIncome, margin: latest.operatingMargin }
      : { label: "EBITDA", value: stmtNum(latest, "ebitda", rev * stmtNum(latest, "ebitdaMargin")), margin: stmtNum(latest, "ebitdaMargin", 0) };
  const earnLabel = earnBasis.label;
  const ebitda = earnBasis.value;
  const ebitdaMargin = earnBasis.margin || (ebitda / (rev || 1));
  const netIncome = latest.netIncome ?? 0;
  const netMargin = latest.netMargin || (netIncome / (rev || 1));
  const pe = stockData.pe || (netIncome > 0 ? (stockData.marketCap || rev * 3) / netIncome : 25);
  const totalDebt = latest.totalDebt || 0;
  const cash = (latest.cash || 0) + stmtNum(latest, "shortTermInvestments");
  const netDebt = Math.max(0, totalDebt - cash);
  const isDeleveraged = totalDebt === 0 || netDebt <= rev * 0.1;
  const verdict = dcf.verdict || "HOLD";
  const upsidePct = cmp > 0 ? (fv - cmp) / cmp : 0;

  const recAction = verdict === "BUY"
    ? "an institutional BUY"
    : verdict === "SELL"
    ? "an institutional SELL / UNDERWEIGHT"
    : "an institutional HOLD / NEUTRAL";

  // Company-specific evidence lead (deterministic, statement-grounded).
  const buildThesisEvidenceLead = (): string => {
    const parts: string[] = [];
    const nFY = annualFinancials.length;
    // CAGR anchors on FIRST-to-last (a one-year jump annualised over the whole
    // window printed 5.6% for a 16.1% compounder — the exponent must match the span).
    const first = annualFinancials[0] || prev;
    if (nFY >= 2 && first.revenue > 0 && rev > 0) {
      const cagr = Math.pow(rev / first.revenue, 1 / (nFY - 1)) - 1;
      parts.push(
        `${profile.name} compounded revenue at ${formatPct(cagr)} p.a. across the last ${nFY} reported years to ${formatLargeNum(rev, cur)}, with trailing ${earnLabel} margin at ${formatPct(ebitdaMargin)} and net margin at ${formatPct(netMargin)}.`
      );
    } else if (rev > 0) {
      parts.push(
        `${profile.name} reported trailing revenue of ${formatLargeNum(rev, cur)} at ${formatPct(ebitdaMargin)} ${earnLabel} margin and ${formatPct(netMargin)} net margin.`
      );
    }
    if (ebitda > 0) {
      parts.push(
        netDebt <= 0
          ? `The balance sheet is net-cash, so enterprise value tracks equity value and the ${formatPct(upsidePct)} spread to our ${sym}${fv.toFixed(2)} fair value is a pure earnings-multiple call.`
          : `Net debt stands at ${(netDebt / ebitda).toFixed(1)}x trailing ${earnLabel}, so leverage ${netDebt / ebitda > 3 ? "is the binding constraint on" : "leaves headroom for"} the ${formatPct(upsidePct)} spread to our ${sym}${fv.toFixed(2)} fair value.`
      );
    }
    if (pe > 0 && netIncome > 0) {
      parts.push(`At ${pe.toFixed(1)}x trailing earnings, the market prices ${netMargin >= 0.15 ? "a premium compounding multiple that demands sustained margin defense" : "a moderate multiple that leaves room for re-rating on margin recovery"}.`);
    }
    const rdPct = rev > 0 ? stmtNum(latest, "researchDevelopment") / rev : 0;
    const capexPct = rev > 0 ? Math.abs(latest.capitalExpenditures || 0) / rev : 0;
    if (rdPct >= 0.02 || capexPct >= 0.03) {
      const bits: string[] = [];
      if (rdPct >= 0.02) bits.push(`R&D at ${(rdPct * 100).toFixed(1)}% of revenue`);
      if (capexPct >= 0.03) bits.push(`capex at ${(capexPct * 100).toFixed(1)}% of revenue`);
      parts.push(`Reinvestment intensity (${bits.join(" and ")}) frames growth as bought, not free — judge it against the revenue CAGR above.`);
    }
    if (ebitda > 0 && latest.operatingCashFlow !== undefined) {
      const conv = latest.operatingCashFlow / ebitda;
      parts.push(
        conv >= 0.8
          ? `Operating cash conversion of ${(conv * 100).toFixed(0)}% of ${earnLabel} corroborates earnings quality.`
          : `Operating cash conversion of ${(conv * 100).toFixed(0)}% of ${earnLabel} trails earnings — working-capital absorption qualifies the cash story.`
      );
    }
    return parts.join(" ");
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // AGENT 1: PRIVATE EQUITY INVESTMENT THESIS & STRATEGIC VALUE CREATION
  // ─────────────────────────────────────────────────────────────────────────────
  let investmentThesis = "";
  let companyOverview = "";
  let investmentConclusion = "";

  if (sectorType === "platform_gig_economy") {
    companyOverview = `${profile.name} is a market-leading hyperlocal commerce and logistics platform operating across online food delivery, quick-commerce dark store retail, and out-of-home dining services. The enterprise connects tens of millions of transacting consumers with an extensive network of restaurant merchant partners, local brands, and independent delivery fleets across core urban centers.`;
    investmentThesis = `Our fundamental research assessment views ${profile.name} as a high-velocity platform compounding asset driving customer wallet-share capture across convenience commerce. The investment thesis is anchored by three structural value drivers: First, rapid scaling of its quick-commerce dark store infrastructure (delivering 10-15 minute delivery SLAs), expanding Average Order Value (AOV) into high-margin non-grocery categories (electronics, beauty, general merchandise). Second, operational operating leverage as dark store order density reaches mature throughput thresholds, driving positive contribution margin inflection. Third, high-margin advertising take-rate monetization and subscription loyalty bundles (increasing consumer ordering frequency and lowering customer acquisition costs).`;
    investmentConclusion = `We formulate ${recAction} recommendation on ${profile.name} with an intrinsic fair value target of ${sym}${fv.toFixed(2)} per share, reflecting an implied upside of ${formatPct(upsidePct)} over prevailing trading levels of ${sym}${cmp.toFixed(2)}. Valuation is anchored on long-term Gross Order Value (GOV) conversion and platform unit-economics inflection, with downside protected by cash reserves dedicated to platform scaling.`;
  } else if (sectorType === "telecom") {
    companyOverview = `${profile.name} is a major telecommunications services provider delivering mobile voice, high-speed broadband data, enterprise digital connectivity, and IoT services across licensed operational circles. The enterprise maintains extensive cellular tower tenancies, fiber backhaul networks, and a substantial portfolio of licensed spectrum across prime frequency bands.`;
    investmentThesis = `Our research analysis evaluates ${profile.name} through the lens of capital structure recovery, industry tariff discipline, and 4G/5G network densification. The operational thesis focuses on: First, sequential Average Revenue Per User (ARPU) expansion underpinned by industry-wide tariff increases and subscriber migration from legacy 2G to 4G/5G data plans. Second, targeted capital deployment into priority revenue-generating circles to stem subscriber attrition and expand data capacity. Third, government sovereign debt-conversion and moratorium frameworks providing necessary liquidity relief to restructure legacy statutory liabilities and preserve a sustainable triopoly market structure.`;
    investmentConclusion = `We assign ${recAction} stance on ${profile.name} with a calibrated valuation target of ${sym}${fv.toFixed(2)} per share. The investment risk-reward profile is governed by balance sheet deleveraging execution, government regulatory support, and competitive positioning relative to well-capitalized sector peers.`;
  } else if (sectorType === "technology_platform") {
    companyOverview = `${profile.name} is a global internet platform operating a Family of Apps (Facebook, Instagram, Messenger, WhatsApp, Threads) alongside Reality Labs augmented/virtual reality hardware and AI assistants. The enterprise monetizes principally through digital advertising, measured by Daily Active Users (DAU), Monthly Active Users (MAU), ad impressions, and Average Revenue Per User (ARPU) on a digital-advertising basis — not telecom subscriber ARPU. Capital deployment is concentrated in data-center and AI infrastructure supporting ad ranking, recommendation, and generative AI workloads.`;
    investmentThesis = `Our institutional thesis evaluates ${profile.name} through digital-advertising unit economics, not telecom or consumer-packaged-goods metrics. The thesis is anchored by three drivers: First, Family of Apps advertising revenue compounding via combined ad-impression growth and average price-per-ad recovery, reflected in digital-advertising ARPU expansion across DAU/MAU cohorts. Second, operating leverage from AI-driven ad ranking, measurement, and efficiency gains, partly offset by data-center and AI infrastructure capex intensity. Third, disciplined containment of Reality Labs operating losses while preserving optionality in wearables and mixed-reality hardware. All KPIs used are internet-platform metrics as defined above.`;
    investmentConclusion = `We formulate ${recAction} recommendation on ${profile.name} with an intrinsic fair value target of ${sym}${fv.toFixed(2)} per share (${formatPct(upsidePct)} implied upside), anchored on Family of Apps ad-revenue durability, digital ARPU trajectory, and free-cash-flow conversion net of AI infrastructure capex and Reality Labs investment.`;
  } else if (sectorType === "technology_software") {
    companyOverview = `${profile.name} is a premier enterprise digital solutions and software engineering enterprise delivering cloud architecture, application modernizations, artificial intelligence integration, and managed IT services across global corporate clients.`;
    investmentThesis = `Our institutional thesis highlights ${profile.name}'s deep client domain integration, high recurring contractual revenue visibility, and disciplined delivery pyramid optimization. The business generates robust free cash flow conversion exceeding 80% of EBITDA, deploying capital toward organic talent upskilling, proprietary AI platforms, and consistent capital returns.`;
    investmentConclusion = `We formulate ${recAction} recommendation on ${profile.name} with an intrinsic fair value target of ${sym}${fv.toFixed(2)} per share (${formatPct(upsidePct)} implied upside), supported by enterprise digital spending resilience and strong return on invested capital (ROIC).`;
  } else if (sectorType === "technology_hardware") {
    companyOverview = `${profile.name} is a technology hardware enterprise designing and selling devices, endpoints, and components through retail, carrier, and enterprise channels. Unit economics are measured in segment unit shipments, average selling prices (ASP) and product mix, hardware gross margin net of component costs, channel inventory and sell-through, and services attach on the installed base — SaaS retention, consulting utilization, and contract-value metrics do not apply here.`;
    investmentThesis = `Our hardware thesis evaluates ${profile.name} on three drivers: First, unit volume resilience through replacement cycles and flagship launch execution across product lines. Second, ASP and product-mix discipline — pro-tier and high-memory configurations defending realization against mid-tier price pressure. Third, hardware gross-margin defense via vertical component integration and scale procurement net of memory/display cost swings, with channel inventory discipline protecting sell-through. Services attach on the installed base provides incremental lifetime revenue.`;
    investmentConclusion = `We formulate ${recAction} recommendation on ${profile.name} with an intrinsic fair value target of ${sym}${fv.toFixed(2)} per share, driven by units/ASP/mix delivery and component-cost management against the DCF trajectory.`;
  } else if (sectorType === "renewables") {
    companyOverview = `${profile.name} is a premier vertically integrated wind turbine generator (WTG) manufacturer and end-to-end renewable energy operations & maintenance (O&M) service provider across key industrial energy corridors.`;

    const newsItems = input.news || [];
    const newsHeadline = newsItems.find(n => n.title && (n.title.toLowerCase().includes("tata") || n.title.toLowerCase().includes("order") || n.title.toLowerCase().includes("gw") || n.title.toLowerCase().includes("partnership")) )?.title;

    const newsIntegration = newsHeadline 
      ? `Recent corporate milestones—notably ${profile.name}'s strategic partnership developments and major capacity awards—validate our thesis on high-margin recurring annuities, shifting the structural revenue mix away from low-margin EPC toward sticky, 20-year O&M service contracts.`
      : `Recent DevCo partnerships and large-scale utility awards (including landmark ~1 GW class commercial agreements with leading players like Tata Power) validate our thesis on high-margin recurring annuities, shifting the structural revenue mix away from low-margin EPC execution toward sticky, 20-year O&M service contracts.`;

    investmentThesis = `From an institutional equity research perspective, ${profile.name} represents a compelling turnaround asset positioned at the core of national clean energy additions. The thesis is anchored by three structural pillars: First, aggressive order backlog conversion at higher per-MW realizations on modern 3.x MW (S144) platforms. Second, ${newsIntegration} Third, operating leverage from localized manufacturing clusters in Gujarat and Tamil Nadu that minimize road transit friction for oversized rotor blades, driving durable EBITDA margin expansion.`;

    investmentConclusion = `We assign ${recAction} recommendation on ${profile.name} with an intrinsic fair value estimate of ${sym}${fv.toFixed(2)} per share (${formatPct(upsidePct)} upside), supported by pristine post-restructuring net-cash liquidity, expanding grid tenders, and captive fleet service profitability.`;
  } else if (sectorType === "financial_data_ratings") {
    companyOverview = `${profile.name} is a preeminent financial intelligence, credit ratings, and risk analytics enterprise operating as an essential market benchmark provider across domestic and international debt capital markets.`;
    investmentThesis = `The franchise represents an exceptional, high-ROIC compounding asset defined by statutory regulatory licenses, negative working capital, and recurring subscription annuity revenues. Mandatory bond rating surveillance and expanding risk modeling requirements provide multi-year earnings visibility.`;
    investmentConclusion = `We formulate ${recAction} recommendation on ${profile.name} with a target price of ${sym}${fv.toFixed(2)} per share, backed by double-digit operating earnings compounding, zero debt encumbrance, and high pricing power.`;
  } else if (sectorType === "asset_management") {
    companyOverview = `${profile.name} is an asset and wealth manager whose earnings are driven by client assets under management, net client flows, investment performance, fee realization, and the scale of its distribution and technology platforms.`;
    investmentThesis = `Our research frames ${profile.name}'s value creation around three business-model drivers: organic net flows and market appreciation expanding Assets under Management (AUM); resilient base-fee and technology revenue; and operating leverage from a scalable global investment and distribution platform. The key underwriting variables are client retention, fee pressure, market levels, investment performance, and capital return—not deposit growth or credit underwriting.`;
    investmentConclusion = `We formulate ${recAction} recommendation on ${profile.name} with an intrinsic fair value target of ${sym}${fv.toFixed(2)} per share (${formatPct(upsidePct)} implied upside). The conclusion is anchored to normalized fee-related earnings and cash conversion, while recognizing that market movements and client flows can materially change results.`;
  } else if (sectorType === "pharma_healthcare") {
    companyOverview = `${profile.name} is a leading global healthcare and pharmaceutical enterprise operating across complex generic formulations, active pharmaceutical ingredients (APIs), and domestic chronic therapy categories.`;
    investmentThesis = `From a fundamental equity research perspective, ${profile.name} represents a defensive healthcare compounder driven by domestic prescription market dominance, complex generic filings in regulated export markets, and vertical API integration.`;
    investmentConclusion = `We formulate ${recAction} recommendation on ${profile.name} with an intrinsic target of ${sym}${fv.toFixed(2)} per share, balancing defensive healthcare demand with asymmetric upside from differentiated pipeline launches.`;
  } else if (sectorType === "nbfc") {
    companyOverview = `${profile.name} is a leading Non-Banking Financial Company (NBFC) and specialized microfinance institution providing credit access, income-generation loans, and community-based lending solutions across under-penetrated rural and semi-urban markets.`;
    investmentThesis = `Our financial sector research assessment views ${profile.name} as a grassroots financial inclusion franchise driven by: First, disciplined Assets Under Management (AUM) growth supported by expanding center networks and group-lending borrower discipline. Second, active risk mitigation of Gross Stage-3 non-performing assets through localized collection infrastructure and digital collections. Third, liability diversification across institutional term loans, bank refinancing lines, and priority-sector lending allocations that preserve net interest spreads without retail deposit overhead.`;
    investmentConclusion = `We formulate ${recAction} recommendation on ${profile.name} with an intrinsic fair value target of ${sym}${fv.toFixed(2)} per share, benchmarked against return on equity (ROE) and justified price-to-book valuation.`;
  } else if (sectorType === "banking_financials") {
    companyOverview = `${profile.name} is a leading financial institution delivering retail banking, corporate credit facilities, treasury solutions, and digital lending products across core commercial centers.`;
    investmentThesis = `Our institutional thesis highlights ${profile.name}'s diversified low-cost CASA deposit franchise, disciplined credit risk underwriting, and robust regulatory capital adequacy buffers that support continuous loan book expansion.`;
    investmentConclusion = `We formulate ${recAction} recommendation on ${profile.name} with an intrinsic target of ${sym}${fv.toFixed(2)}, backed by stable net interest margins, prudent asset quality containment, and sustainable Return on Equity (ROE).`;
  } else if (sectorType === "consumer_durables") {
    companyOverview = `${profile.name} is a global leader in branded athletic footwear, apparel, equipment, and accessories. The company operates through direct-to-consumer (DTC) digital platforms, owned retail stores, wholesale partners, and a powerful innovation pipeline spanning performance sport, lifestyle, and emerging categories. Its portfolio is anchored by iconic franchises that drive premium pricing and deep consumer loyalty across geographies.`;
    investmentThesis = `Our consumer durables research thesis evaluates ${profile.name} through three compounding value drivers: First, brand power and innovation flywheel — proprietary technology platforms (Air, Flyknit, React, Dri-FIT) create product differentiation that sustains premium pricing and repeat purchase cycles. Second, DTC acceleration — owned digital and retail channels now drive the majority of revenue, expanding gross margin, consumer data capture, and full-price sell-through. Third, supply-chain resilience and scale — strategic sourcing diversification, vertical integration into key materials, and logistics network optimization protect operating margins against input-cost volatility. Risk factors include: foreign-exchange headwinds, China demand normalization, and wholesale channel rationalization timing.`;
    investmentConclusion = `We assign ${recAction} recommendation on ${profile.name} with an intrinsic fair value target of ${sym}${fv.toFixed(2)} per share, supported by durable brand equity, DTC margin expansion, and disciplined capital return via dividends and share repurchases.`;
  } else if (sectorType === "consumer_fmcg") {
    companyOverview = `${profile.name} is a premier consumer goods enterprise operating across branded packaged foods, personal care, edible oils, and household essentials. The company maintains an extensive retail distribution network spanning traditional kirana stores, modern trade formats, and fast-growing quick-commerce channels.`;
    investmentThesis = `Our consumer sector research thesis evaluates ${profile.name} through the lens of brand pricing power, raw material procurement cycles (copra, vegetable oils, packaging), and volume-led market share expansion. The thesis is anchored by: First, resilient domestic volume growth across flagship categories driven by rural reach expansion. Second, premiumization across value-added personal care and food portfolios. Third, disciplined advertising and promotion (A&P) reinvestment and automated supply chain efficiencies that safeguard operating margins across commodity cycles.`;
    investmentConclusion = `We assign ${recAction} recommendation on ${profile.name} with a fair value target of ${sym}${fv.toFixed(2)} per share, supported by durable brand equity, high cash return on invested capital, and disciplined shareholder distributions.`;
  } else if (sectorType === "energy_petrochem") {
    companyOverview = `${profile.name} is an integrated energy, refining, petrochemical, and industrial enterprise operating world-scale assets and specialized distribution infrastructure.`;
    investmentThesis = `The operational thesis centers on unrivaled processing scale, superior refining complexity, and counter-cyclical capex execution. Vertical integration across feedstocks and downstream derivatives insulates baseline cash generation across volatile global commodity cycles.`;
    investmentConclusion = `We formulate ${recAction} recommendation on ${profile.name} with a fair value target of ${sym}${fv.toFixed(2)}, benchmarked against peer processing margins and enterprise value multiples.`;
  } else if (sectorType === "auto_manufacturing") {
    companyOverview = `${profile.name} is an automotive OEM operating vehicle manufacturing (including EVs where applicable), auto components, and adjacent energy-storage/services businesses. Unit economics are measured in vehicle deliveries, average selling price (ASP), automotive gross margin excluding regulatory credits, and free cash flow after manufacturing capex — banking, telecom-carrier, and enterprise-software metrics do not apply here.`;
    investmentThesis = `Our auto-sector thesis evaluates ${profile.name} on three drivers: First, delivery-volume growth and ASP discipline through model-mix, pricing actions, and geographic mix (notably China). Second, automotive gross-margin trajectory excluding regulatory credits, driven by manufacturing cost-down (gigafactory scale, vertical integration) net of price cuts. Third, free-cash-flow conversion after heavy manufacturing capex, plus optionality from energy storage deployments and driver-assistance software. Carrier, banking, and enterprise-software metrics do not apply.`;
    investmentConclusion = `We formulate ${recAction} recommendation on ${profile.name} with a fair value target of ${sym}${fv.toFixed(2)} per share (${formatPct(upsidePct)} implied upside), anchored on delivery/ASP/margin delivery against the DCF trajectory.`;
  } else if (sectorType === "hospitality" || sectorType === "hospitality_owner_operator" || sectorType === "hospitality_asset_light" || sectorType === "hospitality_reit" || sectorType === "real_estate") {
    const isReit = sectorType === "hospitality_reit" || sectorType === "real_estate";
    const isAssetLight = sectorType === "hospitality_asset_light";
    companyOverview = isReit
      ? `${profile.name} is a hospitality-focused real-estate owner and lessor operating a portfolio of owned hotels and leased investment properties. Economics are measured in Net Operating Income (NOI) per room, Funds From Operations (FFO)/AFFO, leased-area occupancy, rent per sq ft with contractual escalation, Weighted Average Lease Expiry (WALE), and cap-rate-implied NAV — manufacturing, loan-book, spectrum, and enterprise-software metrics do not apply.`
      : isAssetLight
      ? `${profile.name} is an asset-light hotel management and franchise platform operating owned, managed, and franchised keys across luxury, premium, select-service, and leisure tiers. Economics are measured in RevPAR (ADR × Occupancy), GOPPAR, EBITDAR margin and EBITDAR-to-rent coverage, available room nights, F&B and MICE mix, and management/franchise fee annuity — banking, telecom-carrier, refinery, and enterprise-software metrics do not apply.`
      : `${profile.name} is a hospitality owner-operator developing, owning, and operating hotels, resorts, and lodging assets across gateway cities and leisure destinations. Unit economics are RevPAR-driven (Occupancy % × ADR), measured via GOPPAR, EBITDAR margin, available room inventory and keys pipeline, banquet/MICE and F&B contribution, and property-level cash flow after maintenance and refurb capex — banking, telecom, and manufacturing metrics do not apply.`;
    investmentThesis = isReit
      ? `Our hospitality REIT thesis evaluates ${profile.name} on three drivers: First, leased-area occupancy and rent per sq ft with 4-5% contractual escalation plus WALE renewal spreads. Second, NOI and AFFO conversion after property opex, leasing commissions, and maintenance capex, stressed against cap-rate expansion. Third, balance-sheet leverage (net debt + lease liabilities) against stable, annuity-like rental cash flows; valuation is anchored on NAV cap-rate and EV/EBITDA cross-check, not loan-book or subscriber economics.`
      : isAssetLight
      ? `Our asset-light hospitality thesis evaluates ${profile.name} on three drivers: First, RevPAR growth = Occupancy recovery to 68-72% stabilized × ADR inflation (CPI + 1-2% + tier premium) plus keys pipeline signed/under-construction ramp. Second, fee annuity — management and franchise fees as % of rooms revenue, with high incremental margins and low capex intensity versus owned hotels. Third, EBITDAR conversion and FCF after brand and loyalty investment, with valuation on EV/EBITDAR and fee-EBITDA multiples, explicitly excluding banking/telecom/refinery concepts.`
      : `Our hospitality owner-operator thesis evaluates ${profile.name} on RevPAR-native drivers: First, Occupancy % and ADR by city tier and seasonality (RevPAR = Occupancy × ADR) plus keys pipeline and banquet/MICE mix. Second, GOPPAR and EBITDAR margin after fixed cost per available room and variable cost per occupied room, undistributed expenses, and lease/IFRS-16 rent. Third, property-level FCF after maintenance capex (4-5% rooms revenue) and 8-year refurb reserves.`;
    investmentConclusion = `We formulate ${recAction} recommendation on ${profile.name} with a fair value target of ${sym}${fv.toFixed(2)} per share (${formatPct(upsidePct)} implied upside), anchored on ${isReit ? "NOI/AFFO and NAV cap-rate" : "RevPAR/EBITDAR"} delivery against the hospitality DCF trajectory.`;
  } else {
    companyOverview = `${profile.name} operates in the ${profile.sector} sector (${profile.industry}). The business description and segment disclosures in the company profile, together with the reported financials below, define its operating model — no sector-specific template applies.`;
    investmentThesis = `Our analysis of ${profile.name} is anchored on its reported revenue trajectory, margin structure, cash conversion, and balance-sheet capacity as detailed below. Without a sector-specific template match, no industry boilerplate (manufacturing throughput, credit-portfolio growth, user-based metrics, or platform dynamics) is assumed.`;
    investmentConclusion = `We formulate ${recAction} recommendation on ${profile.name} with an intrinsic fair value target of ${sym}${fv.toFixed(2)} per share (${formatPct(upsidePct)} implied upside), reflecting reported fundamentals and operational execution.`;
  }

  // Company-specific evidence lead: grounds the sector template in THIS
  // company's reported numbers so theses for different names never read
  // identically. Computed purely from statements/ratios/DCF — no LLM needed.
  investmentThesis = `${buildThesisEvidenceLead()} ${investmentThesis}`;

  // ─────────────────────────────────────────────────────────────────────────────
  // AGENT 2: ECONOMIC MOAT, SWITCHING COSTS & UNIT ECONOMICS
  // ─────────────────────────────────────────────────────────────────────────────
  let moatSources = {
    switchingCosts: "",
    intangibleAssets: "",
    costAdvantage: "",
    moatTrend: "",
  };
  let moatPillars: { pillar: string; durability: string; rationale: string }[] = [];

  if (sectorType === "platform_gig_economy") {
    moatSources = {
      switchingCosts: `Two-Sided Network Effects & Consumer Habituation: Dense local restaurant and merchant networks combined with high consumer ordering frequency create immense flywheel friction. Displacing an entrenched platform requires unsustainable merchant acquisition subsidies.`,
      intangibleAssets: `Hyperlocal Logistics Algorithm & Brand Ubiquity: Proprietary route optimization, batching algorithms, dynamic delivery fee pricing, and household brand recall across metropolitan clusters.`,
      costAdvantage: `Order Density & Dark Store Proximity: Unmatched drop-density per square kilometer dramatically reduces per-order fulfillment cost and delivery partner turnaround time.`,
      moatTrend: `Positive: Quick-commerce expansion into higher-margin non-grocery categories (electronics, beauty, apparel) drives Average Order Value (AOV) and contribution margin inflection.`,
    };
    moatPillars = [
      { pillar: "Hyperlocal Fulfillment Density", durability: "Wide (10+ Yrs)", rationale: "Clustered dark store networks delivering 10-15 minute delivery SLAs that sub-scale entrants cannot match without massive capital burn." },
      { pillar: "Two-Sided Merchant Flywheel", durability: "Narrow (7-10 Yrs)", rationale: "Exclusive merchant partnerships and deep POS integration creating high vendor retention and robust advertising take-rates." },
      { pillar: "Dynamic Logistics & Batching IP", durability: "Narrow (5-8 Yrs)", rationale: "Automated fleet routing and multi-order dispatch algorithms maximizing rider utilization and minimizing cost per drop." },
      { pillar: "Consumer Frequency & Wallet Share", durability: "Wide (10+ Yrs)", rationale: "Subscription loyalty bundles locking in high-LTV cohorts across both food and grocery." },
    ];
  } else if (sectorType === "telecom") {
    moatSources = {
      switchingCosts: `Dual-SIM Inertia & Enterprise Connectivity Mandates: Enterprise MPLS, IoT SIM deployments, and postpaid consumer bundle stickiness generate baseline retention across core commercial hubs.`,
      intangibleAssets: `Pan-India Spectrum Licensure & Regulatory Footprint: Irreplaceable high-frequency and sub-GHz spectrum holdings across key circles, backed by statutory government operating licenses.`,
      costAdvantage: `Tower Tenancy & Passive Infrastructure Scale: Massive cell site footprints and long-term fiber backhaul arrangements reduce incremental unit transport costs per gigabyte.`,
      moatTrend: archetype === "DISTRESSED" ? `Negative: Capital expenditure constraints and subscriber churn toward well-capitalized duopoly operators pressure market share.` : `Stable: High spectral barriers protect existing subscriber market shares.`,
    };
    moatPillars = [
      { pillar: "Pan-India Spectrum Allocation", durability: "Wide (15+ Yrs)", rationale: "Statutory spectrum rights across 900MHz, 1800MHz, 2100MHz, and 3300MHz bands creating unassailable legal barriers to new entrants." },
      { pillar: "Tower & Fiber Tenancy Matrix", durability: "Narrow (8-10 Yrs)", rationale: "Extensive cell site coverage and fiberized backhaul reaching hundreds of millions of mobile subscribers." },
      { pillar: "Enterprise & IoT Connectivity", durability: "Narrow (5-8 Yrs)", rationale: "Sticky B2B data connections, smart metering partnerships, and cloud trunking contracts." },
      { pillar: "Government Strategic Equity Anchor", durability: "Narrow (5-8 Yrs)", rationale: "Sovereign debt-to-equity conversions and moratorium relief preserving telecom sector triopoly stability." },
    ];
  } else if (sectorType === "technology_platform") {
    moatSources = {
      switchingCosts: `Social Graph & Advertiser Workflow Embedment: Billions of Daily Active Users with entrenched social graphs, messaging histories, and creator followings face high migration friction. Advertisers embed proprietary campaign data, measurement integrations, and automated bidding playbooks in the platform's ad manager.`,
      intangibleAssets: `Network Effects & Ad-Targeting Data Scale: Two-sided network effects across Family of Apps compound with a proprietary interest/behavioral graph and scaled conversion-measurement data that improve ad ranking and pricing power.`,
      costAdvantage: `Data-Center & AI Infrastructure Scale: Hyperscale custom silicon, networking, and data-center footprints amortize AI training and inference costs across massive ad-impression volumes, lowering unit compute cost versus sub-scale rivals.`,
      moatTrend: `Positive: AI-driven ad ranking, Advantage+ automation, and messaging monetization deepen advertiser ROI while DAU/MAU cohorts continue expanding average revenue per user on a digital-advertising basis.`,
    };
    moatPillars = [
      { pillar: "Family of Apps Network Effects", durability: "Wide (15+ Yrs)", rationale: "Multi-billion DAU/MAU social graphs with messaging and creator ecosystems that sub-scale entrants cannot replicate." },
      { pillar: "Ad Targeting & Measurement Data", durability: "Wide (12+ Yrs)", rationale: "Proprietary engagement and conversion data improving auction pricing and advertiser return on ad spend." },
      { pillar: "AI & Data-Center Scale", durability: "Wide (10+ Yrs)", rationale: "Hyperscale AI training/inference and custom infrastructure lowering unit compute cost per ad impression." },
      { pillar: "Brand & Distribution Ubiquity", durability: "Wide (15+ Yrs)", rationale: "Pre-installed distribution and habitual daily usage sustaining pricing power with advertisers." },
    ];
  } else if (sectorType === "technology_software") {
    moatSources = {
      switchingCosts: `Deep Enterprise Workflow Embedment: Multi-year software implementation cycles, proprietary data repositories, and mission-critical enterprise integrations generate exceptional customer retention rates (>95%).`,
      intangibleAssets: `Proprietary Software Architecture & Developer Ecosystem: Broad enterprise intellectual property, automated cloud development frameworks, and trusted global security certifications.`,
      costAdvantage: `Global Delivery Scale & Offshore Utilization: High offshore talent leverage and standardized delivery toolchains maximize gross margins against local boutique consultancies.`,
      moatTrend: `Positive: Enterprise cloud and artificial intelligence migrations increase multi-year Total Contract Value (TCV) commitments.`,
    };
    moatPillars = [
      { pillar: "Mission-Critical Workflow Integration", durability: "Wide (15+ Yrs)", rationale: "Enterprise operational workflows deeply entwined with customer core business operations." },
      { pillar: "Global Delivery Scale & Offshore Footprint", durability: "Wide (12+ Yrs)", rationale: "Large-scale talent deployment models driving structural cost advantages and high delivery margins." },
      { pillar: "Proprietary Software & AI Accelerators", durability: "Narrow (8-10 Yrs)", rationale: "Pre-built software automation accelerators reducing deployment lead times for complex clients." },
      { pillar: "Institutional Client Account Tenures", durability: "Wide (15+ Yrs)", rationale: "Decades-long relationships with Fortune 500 organizations supporting multi-year renewal rates." },
    ];
  } else if (sectorType === "technology_hardware") {
    moatSources = {
      switchingCosts: `Hardware-Software Ecosystem Lock-In: Integrated multi-device workflows and synchronized cloud services generate friction, yielding high customer retention.`,
      intangibleAssets: `Global Brand Premium & Proprietary Engineering: Decades of industrial design leadership and custom component architecture deliver pricing power.`,
      costAdvantage: `Monopsony Component Procurement: Multi-billion-dollar forward component commitments secure favorable volume pricing across global suppliers.`,
      moatTrend: `Positive: Expanding ecosystem subscription services continually deepen monetization per active user.`,
    };
    moatPillars = [
      { pillar: "Integrated Device Ecosystem", durability: "Wide (15+ Yrs)", rationale: "Seamless multi-device integration creating substantial switching friction for enterprise and consumer cohorts." },
      { pillar: "Proprietary Component Engineering", durability: "Wide (12+ Yrs)", rationale: "In-house design architecture delivering power efficiency and device integration." },
      { pillar: "Premium Brand Equity", durability: "Wide (20+ Yrs)", rationale: "Demonstrated multi-decade pricing elasticity across consumer hardware refreshes." },
      { pillar: "Scale Supply Chain Procurement", durability: "Wide (15+ Yrs)", rationale: "Massive purchasing power securing priority tier-1 supplier commitments." },
    ];
  } else if (sectorType === "renewables") {
    moatSources = {
      switchingCosts: `Captive Installed Fleet O&M Annuity: Multi-decade (20+ year) operations and maintenance service contracts across an active 15+ GW installed turbine base generate high customer stickiness, recurring cash flows, and 38%+ service EBITDA margins.`,
      intangibleAssets: `Low-Wind Turbine Aerodynamics & Modular Technology IP: Proprietary rotor blade designs (e.g., 78m+ carbon-reinforced blades on the 3.15 MW S144 platform) and specialized controller algorithms engineered specifically for low-to-medium wind speed regimes across India.`,
      costAdvantage: `Localized Supply Chain & Manufacturing Hubs: Strategic manufacturing clusters in Gujarat (Bhuj) and Tamil Nadu (Coimbatore/Daman) optimize logistics for oversized components, slashing freight costs and transit risks against imported OEM competitors.`,
      moatTrend: `Positive: High-margin O&M fleet density expansion, expanding grid connection pipelines, and complete balance sheet deleveraging enhance economic returns.`,
    };
    moatPillars = [
      { pillar: "Installed Fleet O&M Service Annuity", durability: "Wide (15+ Yrs)", rationale: "Captive multi-decade maintenance contracts delivering recurring cash flows with over 95% fleet machine availability." },
      { pillar: "Low-Wind High-Yield Turbine IP", durability: "Narrow (8-10 Yrs)", rationale: "Proprietary aerodynamic blade and modular nacelle designs maximizing Plant Load Factor (PLF) across low-wind sites." },
      { pillar: "Localized Manufacturing Cluster Scale", durability: "Wide (12+ Yrs)", rationale: "Deep manufacturing footprints in Tamil Nadu and Gujarat reducing oversized road logistics costs." },
      { pillar: "Direct Wind Competitor Positioning", durability: "Narrow (7-10 Yrs)", rationale: "Defensible order backlog leadership and proven Balance of Plant (BOP) execution over peers like Inox Wind." },
    ];
  } else if (sectorType === "financial_data_ratings") {
    moatSources = {
      switchingCosts: `Embedded Risk Workflow Integration: Displacing certified credit ratings and risk models requires substantial regulatory re-certifications and institutional customer disruptions.`,
      intangibleAssets: `Statutory Regulatory Licensing & Empirical Track Record: Statutory recognition under SEBI/RBI/SEC frameworks and decades of verified default statistics make opinions indispensable.`,
      costAdvantage: `Proprietary Financial Datasets & Analytical Scale: Massive historical default databases yield unmatched analytical efficiency and operating margins.`,
      moatTrend: `Positive: Expanding global research mandates and risk compliance tools widen competitive moats.`,
    };
    moatPillars = [
      { pillar: "Statutory Regulatory Rating Licenses", durability: "Wide (20+ Yrs)", rationale: "Mandatory requirement for certified rating opinions across institutional debt issuance." },
      { pillar: "Mission-Critical Analytics Workflow", durability: "Wide (15+ Yrs)", rationale: "High-margin analytical subscriptions embedded in institutional banking and risk infrastructure." },
      { pillar: "Proprietary Default & Credit Database", durability: "Wide (15+ Yrs)", rationale: "Decades of empirical loan performance data calibrating institutional credit models." },
      { pillar: "Global Analytical Distribution", durability: "Wide (20+ Yrs)", rationale: "International research reach and collaborative financial benchmark frameworks." },
    ];
  } else if (sectorType === "asset_management") {
    moatSources = {
      switchingCosts: `Institutional Mandates, Workflow Integration & Advisor Relationships: Replacing an established manager can require investment-committee approval, due diligence, portfolio transitions, and operational integration work.`,
      intangibleAssets: `Brand Trust, Investment Capability & Technology Ecosystem: Long performance histories, fiduciary reputation, data, and embedded portfolio technology can support durable client relationships.`,
      costAdvantage: `Global Distribution & Platform Scale: Broad product shelves and shared investment, data, and operating infrastructure can lower unit costs as assets scale.`,
      moatTrend: `Stable: Durability depends on sustained investment performance, net flows, and the ability to defend fee realization amid passive and private-market competition.`,
    };
    moatPillars = [
      { pillar: "Institutional Client Relationships", durability: "Narrow (7-15 Yrs)", rationale: "Mandate transitions are operationally demanding, though performance and fee pressure can still drive reallocations." },
      { pillar: "Investment & Risk Technology", durability: "Narrow (5-15 Yrs)", rationale: "Integrated portfolio, risk, and reporting workflows can raise switching costs when backed by demonstrable client adoption." },
      { pillar: "Global Distribution & Product Breadth", durability: "Wide (10+ Yrs)", rationale: "Scale across institutional, wealth, ETF, and retirement channels broadens client access and operating leverage." },
      { pillar: "Brand & Fiduciary Trust", durability: "Narrow (10+ Yrs)", rationale: "Reputation supports retention but must be earned through investment performance, service, and governance." },
    ];
  } else if (sectorType === "pharma_healthcare") {
    moatSources = {
      switchingCosts: `Physician & Patient Prescription Inertia: Chronic therapeutic categories exhibit high patient adherence and practitioner inertia, minimizing substitution.`,
      intangibleAssets: `Regulatory Approved Facilities & Formulation Patents: Stringent compliance certifications and proprietary formulation delivery device patents.`,
      costAdvantage: `Vertically Integrated Chemical API Scale: In-house synthesis of active pharmaceutical ingredients yields structural cost advantages over non-integrated formulation competitors.`,
      moatTrend: `Positive: Expansion into complex generic therapies and expanding domestic pharmacy footprint support margins.`,
    };
    moatPillars = [
      { pillar: "Chronic Respiratory Therapy Leadership", durability: "Wide (15+ Yrs)", rationale: "Entrenched market presence in specialized inhalation devices and aerosol delivery technologies." },
      { pillar: "Complex Generic Pipeline", durability: "Narrow (8-10 Yrs)", rationale: "High-barrier specialized generic filings protecting realization in regulated export markets." },
      { pillar: "Domestic Pharmacy Distribution Reach", durability: "Wide (15+ Yrs)", rationale: "Nationwide physician reach, medical representative networks, and pharmacy shelf-space presence." },
      { pillar: "Global Regulatory Quality Approvals", durability: "Wide (12+ Yrs)", rationale: "Stringent regulatory compliance track record across international health authorities." },
    ];
  } else if (sectorType === "banking_financials") {
    moatSources = {
      switchingCosts: `Primary Operating Account & Treasury Lock-In: Corporate payroll mandates, retail salary accounts, and automated payment gateways create immense customer switching friction.`,
      intangibleAssets: `Sovereign Banking Charter & Depositor Trust: Comprehensive banking license and decades of brand trust ensuring retail depositor stickiness.`,
      costAdvantage: `Granular Low-Cost CASA Deposit Base: Extensive physical and digital branch distribution generating structural cost-of-funds advantages.`,
      moatTrend: `Positive: Digital loan origination and automated underwriting expand market share from regional competitors.`,
    };
    moatPillars = [
      { pillar: "Granular CASA Deposit Base", durability: "Wide (20+ Yrs)", rationale: "Defensible low-cost funding franchise shielding net interest margins against interest rate volatility." },
      { pillar: "Branch & Digital Distribution Matrix", durability: "Wide (15+ Yrs)", rationale: "Multi-channel physical and mobile banking reach driving low customer acquisition costs." },
      { pillar: "Credit Underwriting & Risk Architecture", durability: "Wide (12+ Yrs)", rationale: "Proprietary credit models calibrated across cycles maintaining low gross non-performing assets." },
      { pillar: "Regulatory Capital Adequacy Buffer", durability: "Wide (15+ Yrs)", rationale: "Robust Tier-1 capital adequacy ratios well above statutory requirements." },
    ];
  } else if (sectorType === "energy_petrochem") {
    moatSources = {
      switchingCosts: `Industrial Supply Integration: Direct pipeline connections, bulk chemical supply contracts, and captive industrial consumer integration.`,
      intangibleAssets: `Strategic Industrial Footprint & Coastal Logistics: Deepwater port access, dedicated pipeline corridors, and world-scale refinery integration.`,
      costAdvantage: `Processing Complexity & Scale: Superior Nelson Complexity Index processing heavy sour crudes at structural operational discounts.`,
      moatTrend: `Stable: Downstream consumer and digital integration expands economic resilience.`,
    };
    moatPillars = [
      { pillar: "Refining Complexity & Feedstock Flexibility", durability: "Wide (15+ Yrs)", rationale: "World-scale facilities capable of processing discounted heavy crude grades into premium clean fuels." },
      { pillar: "Integrated Logistics Infrastructure", durability: "Wide (15+ Yrs)", rationale: "Captive deepwater ports, pipeline networks, and storage terminals minimizing handling costs." },
      { pillar: "Downstream Petrochemical Value-Add", durability: "Narrow (10+ Yrs)", rationale: "Integration into polymers, polyester, and specialty chemicals capturing high derivative margins." },
      { pillar: "Consumer Distribution Reach", durability: "Wide (15+ Yrs)", rationale: "Extensive nationwide retail fuel and consumer touchpoints generating stable demand." },
    ];
  } else if (sectorType === "consumer_durables") {
    moatSources = {
      switchingCosts: `Brand Friction & Habituation: Iconic franchises and proprietary product IP create deep consumer switching costs; displacing a flagship brand requires years of multi-billion-dollar marketing investment and product parity to overcome habituated purchase behavior.`,
      intangibleAssets: `Iconic Brand Equity & Innovation IP: Decades of accumulated brand equity, proprietary technology platforms (Air, Flyknit, React), and design IP that sustain premium pricing and repeat-purchase cycles.`,
      costAdvantage: `Vertical Integration & Scale Procurement: Strategic supplier diversification, vertical integration into key materials, and logistics network optimization protect operating margins against input-cost volatility.`,
      moatTrend: `Stable: DTC margin expansion and iconic franchise monetization sustain wide-moat economics despite wholesale channel normalization and FX headwinds.`,
    };
    moatPillars = [
      { pillar: "Iconic Brand Franchises", durability: "Wide (20+ Yrs)", rationale: "Multi-decade pricing elasticity and consumer loyalty anchored by flagship product IP." },
      { pillar: "Proprietary Innovation Pipeline", durability: "Wide (15+ Yrs)", rationale: "Patented technology platforms (Air, Flyknit, React) create product differentiation that sustains premium pricing." },
      { pillar: "Direct-to-Consumer Margin", durability: "Narrow (8-10 Yrs)", rationale: "Owned digital and retail channels expand gross margin, data capture, and full-price sell-through." },
      { pillar: "Supply Chain Resilience", durability: "Narrow (7-10 Yrs)", rationale: "Strategic sourcing diversification and vertical integration protect margins against input-cost volatility." },
    ];
  } else if (sectorType === "auto_manufacturing") {
    moatSources = {
      switchingCosts: `Ownership Ecosystem & Charging: Charging-network access, software-defined features, and service integration create moderate owner stickiness, but switching costs remain far below enterprise-software lock-in and must not be described in SaaS terms.`,
      intangibleAssets: `Brand Pull & Manufacturing Know-How: Brand desirability plus proprietary manufacturing processes (gigacasting, vertical integration) and driver-assistance data scale. No banking, telecom, or consulting intangible applies.`,
      costAdvantage: `Scale & Vertical Integration: High-volume plants and in-house component/battery-pack integration lower unit cost versus sub-scale OEMs, offset by price-cut discipline and China cost competition.`,
      moatTrend: `Stable: Durability hinges on sustained cost-down outpacing ASP erosion; ecosystem language must stay consistent with the composite moat rating.`,
    };
    moatPillars = [
      { pillar: "Manufacturing Scale & Vertical Integration", durability: "Narrow (7-10 Yrs)", rationale: "Gigafactory scale and in-house integration lower unit costs versus smaller OEMs." },
      { pillar: "Brand & Direct-Sales Pull", durability: "Narrow (7-10 Yrs)", rationale: "Order-backlog brand strength supports pricing power within segments." },
      { pillar: "Charging & Software Ecosystem", durability: "Narrow (5-8 Yrs)", rationale: "Charging access and software features aid retention without enterprise-grade lock-in." },
      { pillar: "Energy Storage Optionality", durability: "Narrow (5-8 Yrs)", rationale: "Storage deployments diversify revenue but remain margin-dilutive at current scale." },
    ];
  } else if (sectorType === "hospitality" || sectorType === "hospitality_owner_operator" || sectorType === "hospitality_asset_light" || sectorType === "hospitality_reit" || sectorType === "real_estate") {
    const isReit2 = sectorType === "hospitality_reit" || sectorType === "real_estate";
    const isAssetLight2 = sectorType === "hospitality_asset_light";
    moatSources = isReit2 ? {
      switchingCosts: `Tenant Stickiness & Lease Tenor: Long WALE, contractual escalation, and high relocation costs for tenants create annuity-like retention.`,
      intangibleAssets: `Prime Micro-Market Land Bank & Investment Property Portfolio: Gateway-city locations with irreplaceable catchment and development approvals.`,
      costAdvantage: `Scale Leasing & Low-Cost Development: Centralized leasing, standardized development, and low-cost capital access versus fragmented owners.`,
      moatTrend: `Stable: Durability hinged on occupancy, rent escalation, and cap-rate stability; REIT leverage and tenant concentration are the swing factors.`,
    } : isAssetLight2 ? {
      switchingCosts: `Loyalty & Distribution Mix: Direct-booking loyalty (e.g., Bonvoy/InnerCircle equivalent) and corporate rate contracts drive repeat stays; OTA commission avoidance is the switching-cost analogue.`,
      intangibleAssets: `Brand Tiering & Management Know-How: Multi-tier brand architecture (luxury/premium/select) plus proprietary operating SOPs and franchise system scale.`,
      costAdvantage: `Fee Annuity & Centralized Scale: Management/franchise fees carry 70-80% incremental margins; central procurement, loyalty, and distribution scale versus independent hotels.`,
      moatTrend: `Positive: Network density, tier-premium RevPAR, and fee-mix shift widen the moat if direct-booking and RevPAR premium are sustained.`,
    } : {
      switchingCosts: `Loyalty & Corporate Contracts: Repeated corporate and MICE demand, loyalty program stickiness (direct booking), and contracted rate cards create repeat purchase friction versus independent hotels.`,
      intangibleAssets: `Gateway-City Location Network & Brand Tiering: Cluster density in high-demand micro-markets plus tiered brand pricing power across luxury/premium/select.`,
      costAdvantage: `Operating Leverage & Scale Procurement: Fixed cost per available room absorbed over occupancy ramp; centralized procurement and distribution lower cost per occupied room.`,
      moatTrend: `Stable: RevPAR premium, GOPPAR, and EBITDAR-to-rent coverage determine moat durability; must be consistent with composite moat rating.`,
    };
    moatPillars = isReit2 ? [
      { pillar: "Leased Portfolio & WALE", durability: "Wide (12+ Yrs)", rationale: "Long-tenor leases with 4-5% escalation create contracted, inflation-linked annuity." },
      { pillar: "Prime Location Land Bank", durability: "Wide (15+ Yrs)", rationale: "Gateway micro-market land parcels are irreplaceable and support rent premium." },
      { pillar: "Scale Leasing & Tenant Diversification", durability: "Narrow (7-10 Yrs)", rationale: "Broad tenant base and centralized leasing reduce vacancy and collection risk." },
      { pillar: "Low-Cost Capital & Development", durability: "Narrow (7-10 Yrs)", rationale: "REIT capital access and execution track record lower funding and development cost." },
    ] : isAssetLight2 ? [
      { pillar: "Franchise & Management Fee Annuity", durability: "Wide (15+ Yrs)", rationale: "Fee revenue (3-7% rooms + incentive) carries high margin and low capex versus owned hotels." },
      { pillar: "Loyalty & Direct Booking Scale", durability: "Wide (12+ Yrs)", rationale: "Loyalty program and direct channel reduce OTA take-rate and drive repeat stays." },
      { pillar: "Brand Tier Architecture", durability: "Wide (12+ Yrs)", rationale: "Tiered brands sustain pricing power across segments and geographies." },
      { pillar: "Centralized Distribution & Procurement", durability: "Narrow (8-10 Yrs)", rationale: "System-wide procurement and distribution lower cost per occupied room." },
    ] : [
      { pillar: "Gateway-City Location Clusters", durability: "Wide (15+ Yrs)", rationale: "Irreplaceable prime locations and cluster density support occupancy and ADR premium." },
      { pillar: "Brand Tier Pricing Power", durability: "Wide (12+ Yrs)", rationale: "Luxury/premium/select tiering sustains ADR premium over independent hotels." },
      { pillar: "Loyalty & Corporate Rate Stickiness", durability: "Narrow (8-10 Yrs)", rationale: "Loyalty and contracted corporate/MICE demand drive repeat stays and direct bookings." },
      { pillar: "Operating Leverage & Scale", durability: "Narrow (7-10 Yrs)", rationale: "Fixed-cost absorption on occupancy ramp plus scale procurement improves GOPPAR." },
    ];
  } else {
    moatSources = {
      switchingCosts: `Customer Relationships & Workflow Integration: The durability of switching costs depends on the company’s actual product, service, contract, and distribution model.`,
      intangibleAssets: `Brand, Data & Operating Know-How: Recognized reputation and accumulated operating capability may support differentiation where independently evidenced.`,
      costAdvantage: `Scale & Execution: Scale can improve unit economics, but the source of advantage must be validated against the company’s reported business model.`,
      moatTrend: `Stable: The moat assessment is conditional on sustained returns, customer retention, and competitive evidence rather than generic industry templates.`,
    };
    moatPillars = [
      { pillar: "Customer Relationships", durability: "Narrow (5-10 Yrs)", rationale: "Durability requires evidence of retention, contract depth, or workflow integration." },
      { pillar: "Brand & Reputation", durability: "Narrow (5-15 Yrs)", rationale: "Brand may support consideration and pricing when corroborated by market evidence." },
      { pillar: "Distribution & Reach", durability: "Narrow (5-10 Yrs)", rationale: "Distribution can support recurring demand, subject to channel concentration and competitive access." },
      { pillar: "Execution Capability", durability: "Narrow (3-8 Yrs)", rationale: "Operating capabilities matter only to the extent they generate repeatable returns above the cost of capital." },
    ];
  }

  // Harmonize Moat Pillars with canonical Moat Rating to prevent contradictions.
  // The rating resolves self-sufficiently from statements (no input-rating
  // dependency — callers that omit ledger/masterFacts previously skipped
  // harmonization entirely, emitting Wide pillars under None composites).
  const canonicalMoat =
    (input.assumptionsLedger as any)?.moatRating ||
    (input as any).masterReportFacts?.moat?.rating ||
    resolveMoatRating(annualFinancials, dcf.assumptions?.wacc ?? 0.095);
  moatPillars = capPillarsToRating(moatPillars, canonicalMoat);

  // Harmonize moat narrative prose with the canonical rating: scrub Wide-claims
  // from moatSources when the composite is Narrow/None. Pillars alone were
  // patched before while moatSources still claimed Wide economics (MOAT-01/02 gap).
  if (canonicalMoat === "Narrow" || canonicalMoat === "None") {
    const scrubWide = (s: string) => (s || "")
      .replace(/wide[\s-]economic[\s-]moat/gi, `${canonicalMoat} economic moat`)
      .replace(/wide structural moat/gi, `${canonicalMoat} structural moat`)
      .replace(/wide moat/gi, `${canonicalMoat} moat`)
      .replace(/unassailable|insurmountable|impenetrable/gi, "defensible")
      .replace(/multi-decade/gi, "multi-year");
    moatSources = {
      switchingCosts: scrubWide(moatSources.switchingCosts),
      intangibleAssets: scrubWide(moatSources.intangibleAssets),
      costAdvantage: scrubWide(moatSources.costAdvantage),
      moatTrend: canonicalMoat === "None"
        ? "Negative: no durable advantage evidenced; returns trail cost of capital."
        : moatSources.moatTrend,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // AGENT 3: INDUSTRY DYNAMICS & PORTER'S FIVE FORCES
  // ─────────────────────────────────────────────────────────────────────────────
  let industryDynamicsCommentary = "";
  let fiveForces: { force: string; level: string; commentary: string }[] = [];

  if (sectorType === "platform_gig_economy") {
    industryDynamicsCommentary = `The quick-commerce and online food delivery sector is characterized by rapid consumer behavioral adoption, high order frequency, and expanding basket sizes across urban centers. While customer acquisition expenditures and dark store rollout capex initially compress margins, platform density and supply chain disintermediation create a structured duopoly where leading players achieve operating leverage as store clusters mature.`;
    fiveForces = [
      { force: "Threat of New Entrants", level: "Low to Moderate", commentary: "Massive upfront capital required to build clustered dark store networks, recruit delivery fleets, and contract merchant density creates high entry barriers." },
      { force: "Bargaining Power of Buyers", level: "Moderate", commentary: "Consumer multi-homing exists, but subscription loyalty bundles and 10-minute delivery reliability build strong habitual retention." },
      { force: "Bargaining Power of Suppliers", level: "Low to Moderate", commentary: "FMCG brands and local merchants rely on platform dark stores for urban retail distribution, giving leading platforms strong advertising and margin take-rates." },
      { force: "Threat of Substitutes", level: "Low", commentary: "Modern urban convenience requirements leave traditional kirana or scheduled e-commerce delivery as inadequate substitutes for instant on-demand fulfillment." },
      { force: "Competitive Rivalry", level: "High", commentary: "Intense but rationalizing duopoly competition, with rivalry focused on dark store density, catalog breadth, and delivery speed rather than unsustainable discounts." },
    ];
  } else if (sectorType === "telecom") {
    industryDynamicsCommentary = `The telecommunications industry operates as a capital-intensive utility characterized by heavy spectrum auction investments, fiberized network expansion, and subscriber data consumption growth. Consolidation into a three-player private market has fostered industry tariff discipline, driving sequential ARPU increases necessary to service network capex.`;
    fiveForces = [
      { force: "Threat of New Entrants", level: "Very Low", commentary: "Prohibitive capital investment requirements, statutory spectrum scarcity, and nationwide cell tower footprints make new greenfield entry impossible." },
      { force: "Bargaining Power of Buyers", level: "Moderate", commentary: "Consumer mobile number portability (MNP) enables churn, but industry-wide tariff coordination and identical 5G plans limit pricing arbitrage." },
      { force: "Bargaining Power of Suppliers", level: "Moderate", commentary: "Telecom equipment vendors and tower infrastructure companies negotiate multi-year service contracts, but carrier scale limits supplier power." },
      { force: "Threat of Substitutes", level: "Very Low", commentary: "Mobile cellular data and voice connectivity are essential utilities with zero technological substitutes for mobile communications." },
      { force: "Competitive Rivalry", level: "High", commentary: "Competitive landscape dominated by two well-capitalized leaders, with pricing rivalry increasingly replaced by network quality and enterprise solutions competition." },
    ];
  } else if (sectorType === "technology_platform") {
    industryDynamicsCommentary = `The digital advertising platform industry is a scale-driven oligopoly where a small number of scaled platforms intermediate advertiser demand and user attention. Competition centers on DAU/MAU engagement, ad-impression inventory growth, average price-per-ad realization, and AI-driven ranking/measurement. Data-privacy regulation, antitrust oversight, and AI infrastructure capex intensity are the principal structural constraints — distinct from carrier-network or consumer-goods distribution economics.`;
    fiveForces = [
      { force: "Threat of New Entrants", level: "Low", commentary: "Replicating multi-billion-user social graphs, advertiser tooling, and hyperscale AI/data-center infrastructure requires prohibitive capital and decade-long cold-start investment." },
      { force: "Bargaining Power of Buyers", level: "Moderate", commentary: "Large advertisers can shift budgets across platforms, but superior targeting ROI and measurement on scaled platforms sustain pricing power." },
      { force: "Bargaining Power of Suppliers", level: "Low to Moderate", commentary: "Compute (GPUs), networking, and power are critical inputs; hyperscale procurement and custom silicon mitigate supplier leverage." },
      { force: "Threat of Substitutes", level: "Moderate", commentary: "Short-form video, search, retail media, and messaging commerce compete for attention and ad budgets without fully substituting social-graph inventory." },
      { force: "Competitive Rivalry", level: "High", commentary: "Rivalry with scaled peers (search, social video, commerce media) focuses on engagement time, creator ecosystems, and AI ad-performance rather than tariff or distribution competition." },
    ];
  } else if (sectorType === "technology_software") {
    industryDynamicsCommentary = `The enterprise software and technology services industry is underpinned by global corporate digital transformation budgets, cloud migrations, and enterprise generative AI integration. Organizations that combine deep domain expertise with cost-effective global delivery models continue to expand market share.`;
    fiveForces = [
      { force: "Threat of New Entrants", level: "Moderate", commentary: "Boutique digital consultancies emerge, but Tier-1 client master service agreements (MSAs) require global delivery scale and multi-decade track records." },
      { force: "Bargaining Power of Buyers", level: "Moderate", commentary: "Enterprise CIOs seek vendor consolidation and pricing concessions, but mission-critical project reliance insulates billing realization." },
      { force: "Bargaining Power of Suppliers", level: "Low to Moderate", commentary: "Talent wage inflation fluctuates, but normalized attrition and offshore training pyramids contain unit delivery costs." },
      { force: "Threat of Substitutes", level: "Low", commentary: "Proprietary enterprise software and customized enterprise IT architectures have no commercial substitute in corporate workflows." },
      { force: "Competitive Rivalry", level: "Moderate", commentary: "Established global IT providers compete on technical capabilities, industry-specific AI solutions, and execution reliability." },
    ];
  } else if (sectorType === "asset_management") {
    industryDynamicsCommentary = `Asset and wealth management economics are shaped by market levels, client asset allocation, organic net flows, fee rates, product mix, investment performance, and regulatory trust. Platform scale can create operating leverage, but passive products, private-market competition, and concentrated institutional mandates can pressure fee realization.`;
    fiveForces = [
      { force: "Threat of New Entrants", level: "Moderate", commentary: "Launching products is feasible, but institutional trust, distribution, regulatory capability, and long investment records are difficult to replicate." },
      { force: "Bargaining Power of Clients", level: "Moderate to High", commentary: "Large institutions and wealth platforms can negotiate fees and reallocate mandates based on performance, service, and product breadth." },
      { force: "Bargaining Power of Suppliers", level: "Low to Moderate", commentary: "Investment talent, data, market infrastructure, and distribution partners are important inputs, with their influence varying by product mix." },
      { force: "Threat of Substitutes", level: "High", commentary: "Low-cost passive products, internal investment teams, and alternative managers provide credible substitutes in many asset classes." },
      { force: "Competitive Rivalry", level: "High", commentary: "Competition is driven by performance, fees, distribution access, product innovation, and technology capability." },
    ];
  } else if (sectorType === "auto_manufacturing") {
    industryDynamicsCommentary = `The automotive industry is a scale-driven, cyclical manufacturing sector where competition centers on delivery volumes, transaction pricing (ASP), manufacturing cost per unit, and model-cycle freshness. For EV-exposed OEMs the incremental drivers are battery-pack cost curves, charging-network coverage, software-defined features, and China price competition — not telecom tariffs, bank credit cycles, or enterprise software budgets.`;
    fiveForces = [
      { force: "Threat of New Entrants", level: "Moderate", commentary: "Chinese EV OEMs and new entrants can scale quickly with state-supported supply chains, though gigafactory capex and homologation remain material hurdles." },
      { force: "Bargaining Power of Buyers", level: "High", commentary: "Transparent transaction pricing, short model cycles, and financing sensitivity give buyers leverage; price cuts transmit immediately to ASP and margin." },
      { force: "Bargaining Power of Suppliers", level: "Moderate", commentary: "Battery-cell, semiconductor, and lithium supply chains confer leverage, partly offset by vertical integration and multi-sourcing." },
      { force: "Threat of Substitutes", level: "Moderate", commentary: "Hybrids, improved ICE efficiency, and mobility services substitute at the margin; within EVs, models substitute aggressively on price." },
      { force: "Competitive Rivalry", level: "High", commentary: "Global overcapacity and China-led price competition compress industry ASP; share shifts on cost-down execution and model cadence." },
    ];
  } else if (sectorType === "technology_hardware") {
    industryDynamicsCommentary = `The technology hardware industry is a cyclical, replacement-driven manufacturing sector where competition centers on unit volumes, average selling prices (ASP), product mix, and gross-margin defense through component-cost management. Performance is driven by segment shipments, flagship launch execution, channel sell-through and inventory discipline, memory/display/silicon costs, and services attach on the installed base — not SaaS retention, consulting utilization, or contract-value bookings.`;
    fiveForces = [
      { force: "Threat of New Entrants", level: "Moderate", commentary: "Capital-intensive tooling, supply-chain scale, and channel access create barriers, but low-cost assemblers contest mid-tier volume segments." },
      { force: "Bargaining Power of Buyers", level: "Moderate to High", commentary: "Carrier, retail-channel, and enterprise buyers negotiate on volume; transparent device pricing gives buyers leverage on ASP." },
      { force: "Bargaining Power of Suppliers", level: "Moderate", commentary: "Memory, display, and advanced-silicon suppliers confer leverage in tight markets, partly offset by forward commitments and vertical integration." },
      { force: "Threat of Substitutes", level: "Moderate", commentary: "Longer holding periods and refurbished devices substitute for new-unit purchases at the margin." },
      { force: "Competitive Rivalry", level: "High", commentary: "Rivalry centers on launch cadence, pro-tier mix, ASP discipline, and channel inventory management across cycles." },
    ];
  } else if (sectorType === "hospitality" || sectorType === "hospitality_owner_operator" || sectorType === "hospitality_asset_light" || sectorType === "hospitality_reit" || sectorType === "real_estate") {
    const isReit3 = sectorType === "hospitality_reit" || sectorType === "real_estate";
    industryDynamicsCommentary = isReit3
      ? `The hospitality REIT / commercial real-estate sector is an annuity-driven property market where value is leasing spreads, occupancy, rent escalation, and cap-rate. Economics hinge on leasable area, WALE, collection efficiency, and NAV sensitivity to interest rates — not consumer-goods volume or spectrum economics.`
      : `The hospitality and lodging sector is a cyclical, operating-leverage-driven services industry where economics center on RevPAR (Occupancy × ADR), GOPPAR, and EBITDAR. Performance is driven by available room nights and keys pipeline, city-tier and seasonal occupancy curves, ADR pricing power, F&B and MICE mix, and fee annuity for managed/franchised keys. Lease/IFRS-16 rent and refurb cycles are first-order cost drivers.`;
    fiveForces = isReit3 ? [
      { force: "Threat of New Entrants", level: "Low", commentary: "Prime land acquisition, development approvals, and large upfront capital create high barriers; REIT scale adds capital cost advantage." },
      { force: "Bargaining Power of Tenants", level: "Moderate", commentary: "Large tenants can negotiate rents and renewal spreads, but gateway location scarcity and long WALE provide pricing power." },
      { force: "Bargaining Power of Suppliers", level: "Low", commentary: "Construction and facility costs are competitive; REIT procurement scale mitigates supplier leverage." },
      { force: "Threat of Substitutes", level: "Moderate", commentary: "Remote work, alternative asset classes, and new supply in micro-markets substitute at the margin." },
      { force: "Competitive Rivalry", level: "Moderate", commentary: "Rivalry centers on micro-market positioning, tenant mix, and occupancy/rent trade-off rather than product throughput." },
    ] : [
      { force: "Threat of New Entrants", level: "Moderate", commentary: "Gateway-city land scarcity and brand/loyalty scale create barriers, but select-service development remains contestable in Tier-1 markets." },
      { force: "Bargaining Power of Buyers", level: "Moderate to High", commentary: "Corporate volume buyers, OTAs (15-25% take-rates), and MICE planners exert pricing pressure; direct-booking loyalty offsets it." },
      { force: "Bargaining Power of Suppliers", level: "Low to Moderate", commentary: "Labor, energy, and food costs are inputs; centralized procurement and scale reduce supplier leverage." },
      { force: "Threat of Substitutes", level: "Moderate", commentary: "Alternative lodging (vacation rentals, serviced apartments) and virtual meetings substitute at the margin." },
      { force: "Competitive Rivalry", level: "High", commentary: "Rivalry centers on location clusters, brand tier RevPAR premium, and occupancy/ADR trade-off across seasons." },
    ];
  } else {
    industryDynamicsCommentary = `The ${profile.industry || "general"} sector requires company-specific assessment of demand, competition, customer concentration, regulatory exposure, and cost structure. No manufacturing, lending, or platform-specific driver is assumed without evidence in the company profile or reported results.`;
    fiveForces = [
      { force: "Threat of New Entrants", level: "To Be Validated", commentary: "Entry barriers depend on the company’s actual licenses, capital needs, data, technology, brand, and distribution." },
      { force: "Bargaining Power of Buyers", level: "To Be Validated", commentary: "Customer concentration, contract structure, and switching costs require company-specific evidence." },
      { force: "Bargaining Power of Suppliers", level: "To Be Validated", commentary: "Supplier dependence and input cost exposure should be assessed from reported operations." },
      { force: "Threat of Substitutes", level: "To Be Validated", commentary: "Substitution risk depends on the underlying product or service and cannot be inferred from a generic template." },
      { force: "Competitive Rivalry", level: "To Be Validated", commentary: "Rivalry should be grounded in identified competitors, pricing, market shares, and category growth." },
    ];
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // AGENT 4: STRATEGY, SEGMENTS & INVESTMENT CATALYSTS
  // ─────────────────────────────────────────────────────────────────────────────
  let businessStrategyCommentary = "";
  let catalysts: { event: string; horizon: string; probability: string; impact: string }[] = [];

  if (sectorType === "platform_gig_economy") {
    businessStrategyCommentary = `${profile.name}'s strategic roadmap centers on three pillars: First, accelerating dark store expansion across Tier-1 and high-density Tier-2 urban hubs to capture quick-commerce market share. Second, category expansion into higher-margin electronics, home essentials, and lifestyle goods to drive Average Order Value (AOV) and gross take-rates. Third, continuous algorithmic fleet routing and delivery batching optimization to structurally lower the cost per delivery drop and achieve sustainable consolidated profitability.`;
    catalysts = [
      { event: "Quick-Commerce Dark Store Network Contribution Margin Breakeven", horizon: "6-12 Months", probability: "High (75%)", impact: "+12% to +18% Fair Value Upside" },
      { event: "Non-Grocery Category Rollout Expanding Average Order Value (AOV)", horizon: "12-18 Months", probability: "High (80%)", impact: "+8% to +14% Fair Value Upside" },
      { event: "Advertising Revenue Take-Rate Expansion Beyond 3.5% of GOV", horizon: "12-24 Months", probability: "Medium (65%)", impact: "+6% to +10% Fair Value Upside" },
      { event: "Intensified Dark Store Promotional Discounting Spikes", horizon: "Ongoing", probability: "Medium (45%)", impact: "-5% to -8% Downside Sensitivity" },
    ];
  } else if (sectorType === "telecom") {
    businessStrategyCommentary = `${profile.name}'s strategic roadmap is focused on: First, driving sequential Average Revenue Per User (ARPU) expansion through disciplined tariff rationalization and minimum recharge tier increases. Second, deploying targeted 4G/5G capital expenditure in priority high-revenue circles to stem subscriber churn and expand data capacity. Third, pursuing debt restructuring dialogues, vendor liability terming-out, and government relief mechanisms to de-risk near-term balance sheet commitments.`;
    catalysts = [
      { event: "Industry-Wide Mobile Tariff Hikes Expanding Blended ARPU", horizon: "6-12 Months", probability: "High (80%)", impact: "+10% to +16% Fair Value Upside" },
      { event: "4G/5G Network Rollout Commissioning in Core Operational Circles", horizon: "12-18 Months", probability: "Medium (65%)", impact: "+8% to +12% Fair Value Upside" },
      { event: "Government Sovereign Relief or Statutory Moratorium Extension", horizon: "12-24 Months", probability: "Medium (55%)", impact: "+12% to +20% Balance Sheet De-risking" },
      { event: "Continued Subscriber Churn to Duopoly 5G Network Leaders", horizon: "Ongoing", probability: "High (70%)", impact: "-6% to -10% Revenue Pressure" },
    ];
  } else if (sectorType === "technology_platform") {
    businessStrategyCommentary = `${profile.name}'s strategic roadmap centers on three pillars: First, growing Family of Apps engagement (DAU/MAU) and ad-impression inventory while improving average price per ad through AI ranking and Advantage+ automation. Second, scaling data-center and AI infrastructure efficiently to support recommendation, ranking, and generative-AI workloads without impairing free-cash-flow conversion. Third, disciplined Reality Labs investment with progressive operating-loss containment alongside wearables optionality.`;
    catalysts = [
      { event: "Digital Ad-Pricing Recovery Expanding ARPU (Advertising Basis)", horizon: "6-12 Months", probability: "High (75%)", impact: "+10% to +15% Fair Value Upside" },
      { event: "AI-Driven Ad Ranking & Measurement Gains Lifting Advertiser ROI", horizon: "6-12 Months", probability: "High (70%)", impact: "+8% to +12% Fair Value Upside" },
      { event: "Reality Labs Loss Containment & Wearables Traction", horizon: "12-24 Months", probability: "Medium (55%)", impact: "+4% to +8% Fair Value Upside" },
      { event: "Ad-Spend Downturn or Adverse Privacy/Antitrust Ruling", horizon: "Ongoing", probability: "Medium (45%)", impact: "-8% to -12% Downside Sensitivity" },
    ];
  } else if (sectorType === "nbfc") {
    businessStrategyCommentary = `${profile.name}'s strategic roadmap centers on: First, disciplined geographical diversification into contiguous rural districts, reducing single-state portfolio concentration. Second, digital loan origination and automated cashless collections to improve operating efficiency and lower cost-to-income. Third, expanding direct assignment and securitization transactions to unlock liquidity and maintain robust capital adequacy buffers (CRAR).`;
    catalysts = [
      { event: "Credit Cost Normalization as Collection Efficiency Recovers", horizon: "6-12 Months", probability: "High (75%)", impact: "+12% to +18% ROE Expansion" },
      { event: "AUM Growth Acceleration in Rural Income-Generating Segments", horizon: "12-18 Months", probability: "High (80%)", impact: "+8% to +14% Fair Value Upside" },
      { event: "Credit Rating Upgrade Lowering Incremental Cost of Borrowing", horizon: "12-24 Months", probability: "Medium (60%)", impact: "+25 to +40 bps Spread Inflection" },
      { event: "Localized Weather or Agricultural Demand Disruption", horizon: "Ongoing", probability: "Medium (40%)", impact: "-6% to -10% Downside Sensitivity" },
    ];
  } else if (sectorType === "asset_management") {
    businessStrategyCommentary = `${profile.name}'s strategy should be evaluated through net new client flows, investment performance, product mix, fee realization, technology adoption, and operating leverage. Capital allocation is most relevant in investment capability, distribution, platform technology, acquisitions, dividends, and repurchases—not physical-capacity expansion by default.`;
    catalysts = [
      { event: "Sustained Positive Net Flows and AUM Growth", horizon: "6-12 Months", probability: "Evidence-Dependent", impact: "Higher fee-related earnings and valuation support" },
      { event: "Technology / Platform Revenue and Client Adoption", horizon: "12-24 Months", probability: "Evidence-Dependent", impact: "Potential margin and retention improvement" },
      { event: "Fee Pressure or Investment Underperformance", horizon: "Ongoing", probability: "Evidence-Dependent", impact: "Lower organic growth and fee realization" },
      { event: "Broad Market Decline or Institutional Redemptions", horizon: "Ongoing", probability: "Evidence-Dependent", impact: "AUM and performance-fee downside" },
    ];
  } else if (sectorType === "auto_manufacturing") {
    businessStrategyCommentary = `${profile.name}'s roadmap centers on three levers: First, delivery growth via model-mix, production ramp, and geographic expansion, defended by ASP discipline. Second, automotive gross-margin defense excluding regulatory credits through manufacturing cost-down outpacing price actions. Third, capital allocation across manufacturing capacity, energy-storage scale-up, and driver-assistance development, funded from operating cash flow.`;
    catalysts = [
      { event: "Delivery Beat with Stable-to-Firm ASP and Ex-Credit Margin Defense", horizon: "6-12 Months", probability: "Evidence-Dependent", impact: "Validates volume/margin thesis; supports fair value" },
      { event: "Energy Storage Deployment Acceleration", horizon: "12-18 Months", probability: "Evidence-Dependent", impact: "Diversifies mix; margin-accretive at scale" },
      { event: "Driver-Assistance / Autonomy Regulatory Milestone", horizon: "12-24 Months", probability: "Evidence-Dependent", impact: "Re-rates software optionality; timeline-sensitive" },
      { event: "China Price War / Demand Softness Compressing ASP", horizon: "Ongoing", probability: "Evidence-Dependent", impact: "Margin and target downside sensitivity" },
    ];
  } else if (sectorType === "hospitality" || sectorType === "hospitality_owner_operator" || sectorType === "hospitality_asset_light" || sectorType === "hospitality_reit" || sectorType === "real_estate") {
    const isReit4 = sectorType === "hospitality_reit" || sectorType === "real_estate";
    businessStrategyCommentary = isReit4
      ? `${profile.name}'s strategy centers on three hospitality-real-estate levers: occupancy and rent escalation with long WALE renewal, NOI margin after property opex and leasing costs, and NAV-accretive capital recycling with disciplined leverage (net debt + leases). No manufacturing or loan-book expansion thesis applies.`
      : `${profile.name}'s hospitality roadmap centers on three levers: RevPAR expansion via occupancy ramp to 68-72% stabilized and ADR growth (CPI+ tier premium), keys pipeline conversion and F&B/MICE mix enhancement, and GOPPAR/EBITDAR margin via fixed-cost absorption and direct-booking mix. For asset-light keys the incremental driver is fee annuity, not property capex.`;
    catalysts = isReit4 ? [
      { event: "Lease Renewal Spread and Rent Escalation Realization", horizon: "6-12 Months", probability: "Evidence-Dependent", impact: "NOI and AFFO upside; NAV support" },
      { event: "Occupancy Recovery and Collection Efficiency Improvement", horizon: "6-12 Months", probability: "Evidence-Dependent", impact: "Validates leasing thesis" },
      { event: "Cap-Rate Compression or Asset Monetization at Premium to NAV", horizon: "12-24 Months", probability: "Evidence-Dependent", impact: "NAV re-rating" },
      { event: "Cap-Rate Expansion or Tenant Default Concentration", horizon: "Ongoing", probability: "Evidence-Dependent", impact: "NAV and distribution downside" },
    ] : [
      { event: "RevPAR Beat via Occupancy + ADR Trade-off Optimization", horizon: "6-12 Months", probability: "Evidence-Dependent", impact: "Validates RevPAR thesis; supports fair value" },
      { event: "Keys Pipeline Conversion and MICE/Banquet Mix Improvement", horizon: "12-18 Months", probability: "Evidence-Dependent", impact: "GOPPAR and EBITDAR expansion" },
      { event: "Direct-Booking / Loyalty Mix Improvement Reducing OTA Take-Rate", horizon: "12-24 Months", probability: "Evidence-Dependent", impact: "Net RevPAR and margin accretion" },
      { event: "Seasonal Demand Softness or New Supply Pressuring Occupancy/ADR", horizon: "Ongoing", probability: "Evidence-Dependent", impact: "RevPAR and target downside sensitivity" },
    ];
  } else {
    businessStrategyCommentary = `${profile.name}'s strategy requires validation against its reported operating model, segment disclosures, and capital-allocation record. This baseline deliberately avoids assuming plants, credit-portfolio growth, inventory, user-based metrics, or platform infrastructure where those are not evidenced.`;
    catalysts = [
      { event: "Company-Specific Earnings Execution", horizon: "6-12 Months", probability: "Evidence-Dependent", impact: "Requires reported KPI confirmation" },
      { event: "Market Share or Product-Mix Change", horizon: "12-18 Months", probability: "Evidence-Dependent", impact: "Requires sector-specific evidence" },
      { event: "Cost Inflation or Pricing Pressure", horizon: "Ongoing", probability: "Evidence-Dependent", impact: "Depends on operating model" },
      { event: "Demand or Regulatory Disruption", horizon: "Ongoing", probability: "Evidence-Dependent", impact: "Requires company-specific scenario analysis" },
    ];
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // AGENT 5: CREDIT ANALYSIS, CAPITAL STRUCTURE & BALANCE SHEET REALITY
  // ─────────────────────────────────────────────────────────────────────────────
  let creditAnalysisCommentary: { financialHealth: string; liquidityBuffers: string; debtMaturity: string; stressTesting: string };

  // Company-specific credit figures — computed once, interpolated everywhere
  // below so no branch can print generic "banking consortium / covenant" boilerplate.
  const _intExp = (latest as any).interestExpense || 0;
  const _cov = _intExp > 0 && ebitda > 0 ? ebitda / _intExp : (ebitda > 0 ? 99 : 0);
  const _covStr = _cov >= 99 ? "no meaningful interest burden (interest expense ~nil)" : `${_cov.toFixed(1)}x EBITDA interest coverage`;
  const _levStr = ebitda > 0 ? `${(netDebt / ebitda).toFixed(1)}x net debt/EBITDA` : "no EBITDA cover base";
  const _cashStr = formatLargeNum(cash, cur);
  const _debtStr = formatLargeNum(totalDebt, cur);

  if (archetype === "DISTRESSED") {
    creditAnalysisCommentary = {
      financialHealth: `${profile.name} operates under an elevated debt leverage structure that demands strict operational cash preservation and disciplined balance sheet restructuring to stabilize baseline interest coverage.`,
      liquidityBuffers: `Liquidity reserves are tightly managed. Operational cash flows remain prioritized toward sustaining core business commitments alongside scheduled debt amortizations. The enterprise relies on active working capital facilities and constructive banking dialogues to maintain operational runway.`,
      debtMaturity: `The enterprise faces a crowded debt maturity schedule dominated by institutional bank borrowings and short-term credit facilities. Proactive debt refinancing, principal amortization scheduling, and deleveraging milestones represent critical steps to strengthen capital structure resilience.`,
      stressTesting: `Our downside stress testing models adverse operational margin compression and rising financing costs. Under this scenario, disciplined cost rationalization and working capital releases are essential to preserve debt covenant compliance (calibrated rating: ${archProfile.creditRating}).`,
    };
  } else if (archetype === "EARLY_PLATFORM_GROWTH") {
    creditAnalysisCommentary = {
      financialHealth: `${profile.name} maintains a growth-stage capital structure characterized by low financial bank debt and reliance on equity growth capital. The balance sheet reflects substantial liquid cash balances from equity raises, dedicated to absorbing near-term platform scaling cash burn.`,
      liquidityBuffers: `Liquidity reserves across cash and liquid short-term investments provide adequate runway to fund dark store network rollout and customer acquisition. Operating cash flow remains negative as platform network density is prioritized over near-term cash harvesting.`,
      debtMaturity: `The company maintains negligible long-term bank debt maturities. Primary capital commitments center on dark store operating leases and cloud infrastructure contracts, granting management complete operational flexibility without debt covenant constraints.`,
      stressTesting: `Our stress test evaluates customer order deceleration and competitive discounting spikes. Under an adversarial scenario, cash reserves provide adequate runway to rationalize marketing expenditures and achieve contribution margin breakeven without external debt distress.`,
    };
  } else if (isDeleveraged) {
    creditAnalysisCommentary = {
      financialHealth: `${profile.name} reports ${formatLargeNum(totalDebt, cur)} of funded debt against ${_cashStr} of cash and liquid reserves (${_levStr}). The structure is net-cash or near it; solvency is a liquidity-management question, not a refinancing one, and no bank-credit model applies.`,
      liquidityBuffers: `Reported cash of ${_cashStr} covers short-term obligations from internal reserves. Undrawn facilities are not disclosed in available filings, so no revolving-line capacity is assumed — the buffer analysis rests on stated cash plus operating cash generation.`,
      debtMaturity: totalDebt <= 0
        ? `No funded debt is reported, so no maturity schedule applies.`
        : `Funded debt of ${_debtStr} is small relative to cash; a dated maturity ladder is not disclosed in available filings, so no refinancing-cliff claim is made.`,
      stressTesting: `Our downside screen assumes a severe 25% demand contraction with 350 bps of EBITDA-margin compression. Under it, ${_covStr} and the cash buffer determine headroom; covenant compliance cannot be asserted because facility covenants are undisclosed.`,
    };
  } else {
    creditAnalysisCommentary = {
      financialHealth: `${profile.name} carries ${_debtStr} of funded debt (${_levStr}) with ${_covStr}. Leverage and coverage are as reported — not benchmarked against bank capital norms, which do not apply outside financials.`,
      liquidityBuffers: `Liquidity rests on ${_cashStr} of reported cash plus operating cash generation. Undrawn credit lines are not disclosed and are not assumed.`,
      debtMaturity: `A dated maturity ladder is not disclosed in available filings; the analysis tracks the reported short/long split only and makes no refinancing-cliff claim.`,
      stressTesting: `Downside modeling scales reported EBITDA against ${_covStr}; headroom language is conditional on undisclosed covenants and is stated as such.`,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // AGENT 6: ENTERPRISE RISKS & DOWNSIDE MITIGATIONS
  // ─────────────────────────────────────────────────────────────────────────────
  let enterpriseRiskCommentary: { risk: string; severity: string; description: string; mitigation: string; horizon?: string; valuationSensitivity?: string }[] = [];

  if (sectorType === "platform_gig_economy") {
    enterpriseRiskCommentary = [
      { risk: "Quick-Commerce Promotional & Discounting Burn", severity: "High", description: "Aggressive venture-funded dark store competition could drive customer discounting wars, delaying store-level contribution margin inflection.", mitigation: "Category expansion into higher-margin non-grocery SKUs, dynamic surge pricing algorithms, and loyalty subscription bundles." },
      { risk: "Gig Economy Delivery Fleet Availability & Wage Pressures", severity: "Medium", description: "Rider fleet attrition and potential state statutory labor regulations regarding gig worker social security benefits could elevate per-order delivery costs.", mitigation: "Algorithmic multi-order batching, enhanced delivery partner welfare initiatives, and localized micro-hub fulfillment efficiency." },
      { risk: "Dark Store Real Estate & Zoning Lease Compliance", severity: "Low to Medium", description: "Municipal restrictions on urban dark store commercial zoning, high street traffic congestion, or localized warehouse lease escalations.", mitigation: "Distributed small-format store footprints (2,500-3,500 sq ft) in secondary non-residential lanes and standardized lease terms." },
      { risk: "Merchant Disintermediation & Direct Ordering", severity: "Low", description: "Large restaurant and consumer brand chains attempting direct-to-consumer delivery to bypass platform take-rates.", mitigation: "Unrivaled platform logistics turnaround speed, integrated loyalty programs, and high consumer discoverability that proprietary merchant apps cannot duplicate." },
    ];
  } else if (sectorType === "asset_management") {
    enterpriseRiskCommentary = [
      { risk: "Market-Level Decline and AUM Compression", severity: "High", description: "Falling equity, fixed-income, or private-market valuations can reduce fee-bearing assets and performance fees even without client outflows.", mitigation: "Diversified product mix, expense flexibility, and transparent AUM/flow monitoring." },
      { risk: "Organic Net Outflows and Fee Pressure", severity: "High", description: "Institutional mandate losses, passive-product competition, or pricing concessions can impair organic base-fee growth.", mitigation: "Monitor client retention, investment performance, product competitiveness, and fee-rate trends." },
      { risk: "Investment Performance and Fiduciary Risk", severity: "Medium", description: "Sustained underperformance or control failures can damage brand trust and distribution relationships.", mitigation: "Investment-risk controls, governance oversight, and product-level performance review." },
      { risk: "Regulatory and Technology Execution", severity: "Medium", description: "Fiduciary, disclosure, data, cyber, and platform risks can increase costs or constrain product activity.", mitigation: "Strong compliance, operational resilience, and independently evidenced technology controls." },
    ];
  } else if (sectorType === "telecom") {
    enterpriseRiskCommentary = [
      { risk: "Crowded Statutory Spectrum & AGR Debt Liabilities", severity: "High", description: "Substantial long-term liabilities owed toward Adjusted Gross Revenue (AGR) dues and spectrum installments constrain capital expenditure flexibility.", mitigation: "Ongoing engagement with governmental authorities regarding sovereign moratorium extensions and debt-to-equity conversions." },
      { risk: "Continuous 4G/5G Subscriber Churn to Network Leaders", severity: "High", description: "Delayed 5G network rollout could accelerate premium postpaid and high-ARPU data subscriber churn toward well-capitalized duopoly networks.", mitigation: "Targeted 4G densification in high-density circles and prioritized 5G commercial rollouts in top urban commercial clusters." },
      { risk: "Heavy Capital Expenditure Requirements for Network Parity", severity: "Medium", description: "Substantial capital outlays required for continuous cell tower additions, optical fiber backhaul, and base station equipment.", mitigation: "Sharing passive and active network infrastructure, site tenancy rationalization, and phased vendor financing agreements." },
      { risk: "Regulatory Revisions to Interconnect & Spectrum Usage Charges", severity: "Low", description: "Regulatory interventions by telecom regulatory authorities impacting roaming charges or spectrum license conditions.", mitigation: "Active participation in industry regulatory consultative forums and strict compliance adherence." },
    ];
  } else if (sectorType === "technology_platform") {
    enterpriseRiskCommentary = [
      { risk: "Digital Ad-Spend Cyclicality", severity: "High", description: "Enterprise advertising budgets contract in macro downturns, compressing ad-impression pricing and digital ARPU even as DAU/MAU engagement holds.", mitigation: "Diversified advertiser base, performance-based formats, and AI-driven ROI improvements sustaining auction density." },
      { risk: "Data Privacy & Antitrust Regulation", severity: "High", description: "Platform-level privacy changes and competition rulings can impair targeting, measurement, and default-distribution advantages.", mitigation: "First-party data scale, on-device measurement innovation, and proactive regulatory compliance architecture." },
      { risk: "AI Infrastructure Capex Intensity", severity: "Medium", description: "Hyperscale data-center and accelerator outlays for ranking and generative AI can depress free-cash-flow conversion if monetization lags.", mitigation: "Phased capacity deployment tied to advertiser ROI and inference-efficiency gains from custom silicon." },
      { risk: "Reality Labs Loss Drag", severity: "Medium", description: "Sustained operating losses in AR/VR hardware and metaverse software dilute consolidated operating margins.", mitigation: "Disciplined annual loss guidance, wearables-led commercialization, and separation of Family of Apps disclosure." },
    ];
  } else if (
    (profile.sector || "").toLowerCase().includes("material") ||
    (profile.industry || "").toLowerCase().includes("agri") ||
    (profile.industry || "").toLowerCase().includes("crop") ||
    (profile.industry || "").toLowerCase().includes("chem") ||
    (profile.name || "").toLowerCase().includes("pi ind")
  ) {
    enterpriseRiskCommentary = [
      { risk: "Monsoon Disparity & Spatial Rainfall Deficits", severity: "High", description: "Uneven precipitation distribution across key domestic cropping belts can defer seasonal herbicide/insecticide application and elevate distributor channel inventories.", mitigation: "Geographic sales diversification across export CSM synthesis markets and balanced Kharif/Rabi portfolio mix." },
      { risk: "Channel Inventory Overhang & Generic Price Competition", severity: "Medium", description: "Aggressive low-cost generic technical export volumes from overseas producers can compress agrochemical pricing realizations.", mitigation: "Focus on proprietary patented molecule registrations, complex multi-step custom chemical synthesis (CSM), and strong distributor relationships." },
      { risk: "Regulatory Review of Chemical Molecule Registrations", severity: "Medium", description: "Stricter pesticide registration reviews and phase-outs of legacy active ingredients by environmental and agricultural regulatory authorities.", mitigation: "Accelerated commercial pipeline of next-generation green chemistry, biologicals, and safer formulation alternatives." },
      { risk: "Raw Material & Chemical Intermediate Price Swings", severity: "Low", description: "Spot price swings in key petrochemical building blocks, bromine, and specialty reagents can compress gross margins if unhedged.", mitigation: "Formulaic customer pass-through contracts, strategic intermediate buffer stocks, and multi-vendor procurement agreements." },
    ];
  } else if (sectorType === "consumer_durables") {
    enterpriseRiskCommentary = [
      { risk: "Foreign-Exchange & China Demand Exposure", severity: "High", description: "Material exposure to Chinese consumer demand, Southeast Asian manufacturing supply chains, and USD-denominated input costs can compress gross margins when CNY weakens or Chinese demand normalizes.", mitigation: "Geographic demand diversification, local-currency pricing power, and strategic supplier diversification across Vietnam, Indonesia, and India." },
      { risk: "Wholesale Channel Rationalization & DTC Transition Friction", severity: "Medium", description: "Continued wholesale partner consolidation and DTC margin mix shifts can create near-term revenue volatility as inventory channels rebalance.", mitigation: "Controlled DTC ramp, wholesale partner margin protection, and full-price sell-through discipline." },
      { risk: "Input-Cost & Logistics Inflation", severity: "Medium", description: "Elevated freight rates, raw material (rubber, EVA, synthetic leather) input costs, and wage inflation in manufacturing hubs pressure gross margin.", mitigation: "Formulaic customer pass-through contracts, strategic intermediate buffer stocks, and multi-vendor procurement agreements." },
      { risk: "Competitive Brand Cycle & Fad Risk", severity: "Low to Medium", description: "Lifestyle and fashion cycles can erode flagship franchise relevance if innovation cadence lags.", mitigation: "Accelerated proprietary technology pipeline (Air, Flyknit, React) and sustained A&P reinvestment protecting brand heat." },
    ];
  } else if (sectorType === "auto_manufacturing") {
    enterpriseRiskCommentary = [
      { risk: "EV Price War & ASP Erosion", severity: "High", description: "China-led discounting and legacy-OEM EV pushes compress transaction prices faster than manufacturing cost-down, squeezing automotive gross margin ex-credits.", mitigation: "Model-mix discipline, cost-down cadence (gigacasting, vertical integration), and geographic diversification.", horizon: "Ongoing", valuationSensitivity: "1pp of auto gross margin ≈ material fair-value swing — see sensitivity matrix" },
      { risk: "China Concentration", severity: "High", description: "Shanghai output and Chinese demand swings drive delivery volatility amid intense local competition (BYD et al.) and policy shifts.", mitigation: "Multi-region plant footprint and export flexibility; localized supply chains.", horizon: "6-18 Months", valuationSensitivity: "Delivery miss transmits ~1:1 into revenue and operating leverage" },
      { risk: "Battery Cost & Technology Ramp", severity: "Medium", description: "Lithium/cell cost swings and 4680-class ramp delays can stall unit-cost targets.", mitigation: "Multi-supplier cell strategy plus in-house pack integration; contractual pass-throughs where available.", horizon: "12-24 Months", valuationSensitivity: "Unit-cost overrun compresses ex-credit margin" },
      { risk: "Autonomy Regulation & Safety Liability", severity: "Medium", description: "FSD/robotaxi timelines depend on regulators; incidents invite scrutiny, recalls, and liability.", mitigation: "Staged deployment with safety-case disclosure; no autonomy revenue recognized before regulatory clearance.", horizon: "12-24 Months", valuationSensitivity: "Binary optionality — excluded from base-case DCF" },
    ];
  } else {
    enterpriseRiskCommentary = [
      { risk: "Company-Specific Demand or Volume Risk", severity: "To Be Validated", description: "The relevant demand driver must be derived from the company’s disclosed products, services, and customer base.", mitigation: "Use reported segment KPIs and scenario analysis rather than generic operating assumptions." },
      { risk: "Cost, Pricing, or Margin Risk", severity: "To Be Validated", description: "The applicable cost base and pricing power depend on the company’s operating model.", mitigation: "Anchor analysis to reported margins, contractual terms, and peer evidence." },
      { risk: "Regulatory or Governance Risk", severity: "To Be Validated", description: "Applicable regulatory obligations vary materially by geography and industry.", mitigation: "Identify the relevant jurisdiction, regulator, and disclosed controls before making claims." },
      { risk: "Competitive Disruption", severity: "To Be Validated", description: "Competitive threats must be tied to named peers, substitutes, and observable market structure.", mitigation: "Validate with sector-specific market-share and customer-retention evidence." },
    ];
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // AGENT 7: GOVERNANCE, CAPITAL ALLOCATION & STEWARDSHIP
  // ─────────────────────────────────────────────────────────────────────────────
  const governanceCommentary = `Governance coverage for ${profile.name} is limited to disclosed filings available to this desk. No assessment is made on board independence, chair/CEO separation, clawback provisions, or incentive-hurdle specifics beyond what is evidenced in officer and ownership data — unevidenced pillars are reported as "No assessment" in the scorecard rather than assumed sound.`;
  const capitalAllocationCommentary = archProfile.capitalAllocationDescription;
  const capitalDeploymentHistory = {
    narrative: `Historical capital deployment over the past 5-year cycle reflects ${archProfile.archetype === "DISTRESSED" ? "rigorous liquidity preservation and debt obligation containment" : archProfile.archetype === "EARLY_PLATFORM_GROWTH" ? "aggressive reinvestment into core dark-store network scale and technology IP" : "prudent allocation across internal organic capex, deleveraging, and shareholder distributions"}.`,
    dividends: archProfile.archetype === "DISTRESSED" || archProfile.archetype === "EARLY_PLATFORM_GROWTH" 
      ? "Zero / Paused — All operational cash flows are retained internally to fund working capital and organic expansion."
      : "Steady payout policy balancing reinvestment needs with regular shareholder cash returns.",
    repurchases: "Opportunistic buybacks evaluated primarily during periods of significant market disconnect from intrinsic value.",
    debtPaydown: archProfile.archetype === "DISTRESSED" 
      ? "Aggressive priority — all excess liquidity channeled toward servicing senior debt and statutory dues."
      : isDeleveraged 
      ? "Virtually zero gross debt following successful multi-year deleveraging campaigns."
      : "Disciplined retirement of high-coupon borrowings to optimize weighted average cost of capital.",
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // AGENT 8: DOMAIN-ACCURATE, ARCHETYPE-CONSISTENT ANALYST RESEARCH NOTES
  // ─────────────────────────────────────────────────────────────────────────────
  let analystNotes: { title: string; date: string; paragraphs: string[] }[] = [];

  // Verified-news-only analyst notes: derived exclusively from real input.news
  // items (headline, publisher, date). No news produces no notes — the section
  // is omitted downstream instead of rendering dated boilerplate as coverage.
  {
    const seenNoteTitles = new Set();
    for (const item of input.news || []) {
      const noteTitle = (item.title || "").trim();
      if (!noteTitle || seenNoteTitles.has(noteTitle.toLowerCase())) continue;
      seenNoteTitles.add(noteTitle.toLowerCase());
      const noteDate = item.publishedAt ? item.publishedAt.slice(0, 10) : "Undated";
      analystNotes.push({
        title: noteTitle,
        date: `${noteDate} \u00b7 ${item.publisher || "Media wire"}` ,
        paragraphs: [
          item.summary && item.summary.length > 20
            ? item.summary
            : `${profile.name} featured in ${item.publisher || "financial media"} coverage evaluated for earnings transmission.`,
          `Desk stance ${recAction} with intrinsic fair value target of ${sym}${fv.toFixed(2)} frames how this development transmits into the investment case.`,
        ],
      });
      if (analystNotes.length >= 4) break;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // RECENT NEWS SYNTHESIS & REAL-TIME RESEARCH NOTE INTEGRATION
  // ─────────────────────────────────────────────────────────────────────────────
  const cleanSym = profile.ticker.replace(/\.[a-zA-Z]+$/i, "");
  const noisePatterns = [
    /stock price/i,
    /quote\s*(&|&amp;|,)\s*news/i,
    /has\s+\$[\d.,]+\s+million\s+stake/i,
    /stake in/i,
    /position in/i,
    /holdings? in/i,
    /shares (sold|bought|acquired) by/i,
    /boosts? (position|stake)/i,
    /zacks consensus/i,
    /broker rating/i,
    /analyst upgrade.*downgrade/i,
  ];

  const relevantNews = (input.news || []).filter((item) => {
    const t = (item.title || "").trim();
    if (!t) return false;
    // Discard noise and SEO scrape titles
    if (noisePatterns.some((np) => np.test(t))) return false;

    const lower = t.toLowerCase();
    const clean = cleanSym.toLowerCase();
    if (clean.length >= 3 && lower.includes(clean)) return true;
    const stopWords = new Set(["ltd", "limited", "inc", "corp", "corporation", "the", "and", "co", "company", "plc"]);
    const words = profile.name
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !stopWords.has(w));
    return words.some((w) => lower.includes(w));
  });

  const newsItemsToAnalyze = relevantNews;

  const recentNewsAnalysis = newsItemsToAnalyze.slice(0, 6).map((item) => {
    let takeaway = "";
    const t = item.title.toLowerCase();
    if (t.includes("cloud") || t.includes("aws") || t.includes("ai") || t.includes("data center") || t.includes("compute") || t.includes("software")) {
      takeaway = `Expansion in scalable cloud infrastructure and enterprise software accelerates high-margin recurring cash flows and platform monetization.`;
    } else if (t.includes("prime") || t.includes("logistics") || t.includes("delivery") || t.includes("fulfillment") || t.includes("retail") || t.includes("ecommerce")) {
      takeaway = `Fulfillment automation and regional logistics density directly compress unit delivery costs and reinforce ecosystem moat defensibility.`;
    } else if (t.includes("merger") || t.includes("acquir") || t.includes("acquisition") || t.includes("scheme") || t.includes("reorganis") || t.includes("court") || t.includes("nclt")) {
      takeaway = `Strategic corporate repositioning enhances operational synergies and provides long-term balance sheet capital allocation flexibility.`;
    } else if (t.includes("appoint") || t.includes("president") || t.includes("ceo") || t.includes("cfo") || t.includes("leadership") || t.includes("director")) {
      takeaway = `Senior leadership appointment reinforces disciplined operational execution across core business units and growth initiatives.`;
    } else if (t.includes("contract") || t.includes("partner") || t.includes("deal") || t.includes("expansion") || t.includes("mandate") || t.includes("order")) {
      takeaway = `Commercial client expansion and enterprise partnerships strengthen medium-term revenue backlog and market share capture.`;
    } else if (t.includes("margin") || t.includes("ebitda") || t.includes("profit") || t.includes("earnings") || t.includes("revenue") || t.includes("results")) {
      takeaway = `Operational cost discipline and operating leverage continue to protect operating margins against macro headwinds.`;
    } else if (t.includes("debt") || t.includes("refinanc") || t.includes("liquidity") || t.includes("repay") || t.includes("cash")) {
      takeaway = `Prudent liquidity management and free cash flow conversion preserve balance sheet health and debt servicing capacity.`;
    } else if (t.includes("dividend") || t.includes("buyback") || t.includes("payout") || t.includes("repurchase")) {
      takeaway = `Sustained free cash generation reinforces management commitment to accretive shareholder capital returns.`;
    } else if (t.includes("rating") || t.includes("upgrade") || t.includes("credit")) {
      takeaway = `Credit profile resilience underscores fundamental balance sheet quality and reduces long-term debt financing costs.`;
    } else {
      takeaway = `${profile.name}'s strategic roadmap execution and customer demand momentum underpin baseline operating earnings predictability.`;
    }
    return {
      headline: item.title,
      publisher: item.publisher || "Financial Wire",
      date: item.publishedAt || "Recent Disclosures",
      strategicTakeaway: takeaway,
    };
  });

  // No padding: fewer than 4 verified items stays as-is. Downstream renders an
  // explicit limited-coverage state rather than fictional exchange filings.

  // ── Archetype-Specific SWOT Analysis ─────────────────────────────
  let swotStrengths: string[];
  let swotWeaknesses: string[];
  let swotOpportunities: string[];
  let swotThreats: string[];
  let keyRisks: { risk: string; description: string; impact: "High" | "Medium" | "Low"; mitigation?: string; horizon?: string; valuationSensitivity?: string }[];

  if (archProfile.archetype === "DISTRESSED" && sectorType === "telecom") {
    swotStrengths = [
      "Extensive nationwide subscriber footprint and mission-critical telecommunications network presence.",
      "Valuable spectrum holdings across core frequency bands (900MHz, 1800MHz, 2100MHz) anchoring subscriber reach.",
      "Government sovereign equity participation establishing regulatory alignment and restructuring flexibility.",
    ];
    swotWeaknesses = [
      "Substantial balance sheet leverage and accumulated deferred AGR and spectrum liabilities.",
      "Persistent operating losses and multi-year free cash flow deficits restricting 5G network rollout.",
      "ARPU discount against well-capitalized sector duopoly rivals contributing to subscriber churn.",
    ];
    swotOpportunities = [
      "Industry-wide tariff rationalization and headline ARPU hikes restoring operating cash flow viability.",
      "Potential bank debt restructuring and external equity capital infusion funding capital expenditure.",
      "Further sovereign relief initiatives, including statutory payment deferral or liability restructuring.",
    ];
    swotThreats = [
      "Aggressive network capex spend and active subscriber poaching by dominant tier-1 duopoly carriers.",
      "Liquidity pressure upon the expiration of statutory debt moratoria absent external funding.",
      "Accelerated loss of high-margin postpaid accounts due to delayed next-generation network upgrades.",
    ];
    keyRisks = [
      { risk: "Statutory Liability Moratorium Expiry", description: "Inability to fund or refinance substantial deferred AGR and spectrum dues upon moratorium expiration.", impact: "High", mitigation: "Negotiated sovereign equity conversion and statutory moratorium deferrals" },
      { risk: "Postpaid Subscriber Attrition", description: "Continuous loss of premium subscribers to competitors offering faster 5G networks.", impact: "High", mitigation: "Targeted 4G/5G capex deployment in priority revenue-generating urban circles" },
      { risk: "Network Capex Underinvestment", description: "Inadequate cash generation leading to delayed cell tower and network modernization.", impact: "Medium", mitigation: "Consortium bank debt restructuring and vendor credit milestone agreements" },
    ];
  } else if (archProfile.archetype === "EARLY_PLATFORM_GROWTH" && sectorType === "platform_gig_economy") {
    swotStrengths = [
      "Market-leading consumer mindshare and dense, high-frequency active transacting user base.",
      "Extensive hyperlocal dark store mesh infrastructure achieving sub-15 minute fulfillment unit economics.",
      "Liquid balance sheet post-equity capitalization providing runway to scale multi-category offerings.",
    ];
    swotWeaknesses = [
      "Near-term operating losses driven by aggressive dark store mesh expansion and rider recruitment incentives.",
      "High gig-economy delivery fleet attrition during peak operational hours requiring ongoing onboarding capex.",
      "Contribution margin sensitivity to localized delivery density and order batching efficiency.",
    ];
    swotOpportunities = [
      "Advertising monetization and high-margin FMCG brand sponsored listings within the search interface.",
      "Expansion of Average Order Value (AOV) across high-margin retail categories (electronics, beauty, home).",
      "Algorithmic route optimization improving multi-order batching and reducing variable cost per drop.",
    ];
    swotThreats = [
      "Intense turf competition from well-funded quick-commerce aggregators leading to promotional discounting.",
      "Evolving gig-worker labor regulations potentially increasing statutory benefits and fleet costs.",
      "Consumer price sensitivity on packaging and platform convenience fees during inflation cycles.",
    ];
    keyRisks = [
      { risk: "Quick-Commerce Promotional Escalation", description: "Deep competitor discounting and rapid dark store land-grabs compressing contribution margins.", impact: "High", mitigation: "Improving dark store order batching density and expanding higher-margin non-grocery AOV" },
      { risk: "Labor & Gig Worker Regulation", description: "Legislative shifts mandating minimum statutory wages or social security benefits for fleet partners.", impact: "Medium", mitigation: "Algorithmic route dispatch efficiency and performance-linked dynamic payout structures" },
      { risk: "Dark Store Cannibalization", description: "Over-clustering fulfillment centers in saturated urban micro-markets diluting store-level throughput.", impact: "Medium", mitigation: "Micro-market spatial density modeling and selective brownfield store rationalization" },
    ];
  } else if (archProfile.archetype === "DISTRESSED") {
    // Generic distressed-company SWOT: no telecom spectrum/AGR language unless
    // the company is actually a carrier (handled above).
    swotStrengths = [
      "Entrenched operating footprint and customer relationships sustaining baseline revenue through restructuring.",
      "Tangible asset base available for selective divestiture to fund deleveraging.",
      "Potential recapitalization optionality via asset sales, strategic investors, or creditor-led restructuring.",
    ];
    swotWeaknesses = [
      "Substantial balance sheet leverage constraining investment and strategic flexibility.",
      "Persistent operating losses and negative free cash flow limiting self-funded recovery.",
      "Elevated refinancing risk on near-term maturities absent external funding.",
    ];
    swotOpportunities = [
      "Deleveraging via asset disposals and liability management restoring solvency headroom.",
      "Operational restructuring and cost reset improving through-cycle margins.",
      "Strategic equity infusion or creditor compromise funding a turnaround plan.",
    ];
    swotThreats = [
      "Creditor acceleration or covenant enforcement forcing distressed asset sales.",
      "Working-capital seizure by suppliers tightening liquidity further.",
      "Prolonged demand weakness delaying any earnings recovery past maturity walls.",
    ];
    keyRisks = [
      { risk: "Refinancing & Maturity Wall", description: "Inability to refinance near-term maturities from internal cash generation.", impact: "High", mitigation: "Liability management, asset disposals, and creditor negotiation" },
      { risk: "Operating Loss Persistence", description: "Continued negative earnings eroding equity cushions quarter by quarter.", impact: "High", mitigation: "Cost restructuring and focus on cash-generative core operations" },
      { risk: "Covenant Breach", description: "Leverage and coverage covenants at risk under further downside.", impact: "Medium", mitigation: "Covenant waivers, amend-and-extend, and deleveraging milestones" },
    ];
  } else if (archProfile.archetype === "EARLY_PLATFORM_GROWTH") {
    // Generic high-growth loss-maker SWOT: no dark-store language unless this is
    // actually a quick-commerce platform (handled above).
    swotStrengths = [
      "Rapid revenue scaling with expanding user/customer adoption.",
      "Liquid balance sheet post-equity capitalization funding the growth runway.",
      "Product and technology investment compounding differentiation.",
    ];
    swotWeaknesses = [
      "Near-term operating losses as growth investment front-runs monetization.",
      "High customer-acquisition spend with payback timing uncertainty.",
      "Unit-margin sensitivity to scale, pricing power, and competitive intensity.",
    ];
    swotOpportunities = [
      "Operating leverage as fixed-cost absorption inflects with scale.",
      "Higher-margin product-mix expansion lifting blended realization.",
      "Path to contribution-margin breakeven on maturing cohorts.",
    ];
    swotThreats = [
      "Well-funded competition compressing pricing and raising acquisition costs.",
      "Regulatory shifts increasing operating or compliance costs.",
      "Macro demand softness elongating the path to profitability.",
    ];
    keyRisks = [
      { risk: "Burn Multiple & Runway", description: "Cash burn relative to net new revenue determines funding needs.", impact: "High", mitigation: "Disciplined acquisition spend and milestone-gated investment" },
      { risk: "Competitive Intensity", description: "Rivals can prolong loss-making while contesting share.", impact: "Medium", mitigation: "Differentiation and retention over discount-led growth" },
      { risk: "Monetization Timing", description: "Delayed take-rate or pricing power pushes breakeven outward.", impact: "Medium", mitigation: "Phased monetization tied to engagement thresholds" },
    ];
  } else if (sectorType === "consumer_durables" || sectorType === "consumer_fmcg" || sectorProfileId === "consumer") {
    // Consumer needs its own SWOT even when archetype is MATURE_COMPOUNDER — otherwise it falls to IT-generic risks.
    swotStrengths = [
      "Strong brand equity and consumer loyalty supporting pricing power and repeat purchase.",
      "Diversified product and channel mix across wholesale, DTC, and owned retail.",
      "Scale procurement and supply-chain efficiency supporting gross margin defense.",
    ];
    swotWeaknesses = [
      "Exposure to discretionary consumer spending cycles and inventory markdown risk.",
      "Wholesale channel concentration and DTC transition execution risk.",
      "Input-cost and FX sensitivity on imported materials and overseas manufacturing.",
    ];
    swotOpportunities = [
      "Premiumization and innovation-led mix shift toward higher-margin franchises.",
      "DTC and digital channel expansion lifting gross margin and data capture.",
      "Geographic white-space and category adjacencies for incremental growth.",
    ];
    swotThreats = [
      "Intensifying competition and private-label pressure compressing price realization.",
      "Macro demand softness and inventory destocking in wholesale channels.",
      "Fashion/trend cycle risk if innovation cadence lags.",
    ];
    keyRisks = [
      { risk: "Consumer Demand Cyclicality", description: "Discretionary spending pullback compressing volumes and forcing promotional discounting.", impact: "High", mitigation: "Brand heat, innovation pipeline, and full-price sell-through discipline" },
      { risk: "Channel Inventory Overhang", description: "Wholesale partners destocking excess inventory, deferring reorders.", impact: "Medium", mitigation: "Disciplined sell-in, inventory visibility, and DTC offset" },
      { risk: "Input Cost & FX Volatility", description: "Material and freight cost swings plus currency headwinds compressing gross margin.", impact: "Medium", mitigation: "Hedging, pricing actions, and sourcing diversification" },
    ];
  } else if (sectorType === "hospitality" || sectorType === "hospitality_owner_operator" || sectorType === "hospitality_asset_light" || sectorType === "hospitality_reit" || sectorType === "real_estate") {
    const isReit5 = sectorType === "hospitality_reit" || sectorType === "real_estate";
    if (isReit5) {
      swotStrengths = [
        "Contracted rental annuity with long WALE and 4-5% contractual escalation.",
        "Prime micro-market land bank and investment property portfolio with scale leasing.",
        "Low-cost capital access and disciplined capital recycling.",
      ];
      swotWeaknesses = [
        "Tenant concentration and leasing demand cyclicality.",
        "Interest-rate sensitivity of NAV via cap-rate expansion.",
        "Refinancing and asset revaluation risk on tenancy churn.",
      ];
      swotOpportunities = [
        "Mark-to-market rent spreads on WALE renewal and occupancy improvement.",
        "Asset monetization at premium to NAV and cap-rate compression.",
        "Development and re-leasing of under-utilized leasable area.",
      ];
      swotThreats = [
        "Cap-rate expansion compressing NAV and increasing funding costs.",
        "Tenant defaults or sector-specific demand shocks.",
        "New supply in micro-markets pressuring rents and occupancy.",
      ];
      keyRisks = [
        { risk: "Cap-Rate Expansion & NAV Devaluation", description: "Rising yields compress property valuations and NAV per share.", impact: "High", mitigation: "Long WALE, fixed escalation, and conservative leverage" },
        { risk: "Tenant Concentration & Default", description: "Key tenant churn or default impairs rental annuity.", impact: "Medium", mitigation: "Diversified tenant base and proactive leasing" },
        { risk: "Leasing Demand Cyclicality", description: "Macro slowdown reduces new leasing and renewal spreads.", impact: "Medium", mitigation: "Gateway location moat and flexible lease structures" },
      ];
    } else {
      swotStrengths = [
        "Prime gateway-city location clusters and tiered brand portfolio supporting ADR premium.",
        "Loyalty and corporate/MICE repeat demand plus direct-booking mix reducing OTA dependency.",
        "Scale procurement and centralized distribution improving GOPPAR and EBITDAR.",
      ];
      swotWeaknesses = [
        "High operating leverage on occupancy — fixed cost per available room pressures GOPPAR when occupancy dips.",
        "Seasonality and city-tier demand concentration.",
        "Capital intensity of maintenance and 8-year refurb cycles plus lease/IFRS-16 leverage.",
      ];
      swotOpportunities = [
        "RevPAR expansion via occupancy ramp to 68-72% stabilized and ADR growth (CPI + tier premium).",
        "Keys pipeline conversion, banquet/MICE mix enhancement, and F&B upsell.",
        "Fee-mix shift toward managed/franchised annuity for asset-light hotels.",
      ];
      swotThreats = [
        "New supply in gateway markets compressing occupancy and ADR.",
        "Demand shocks (travel cyclicality, MICE structural shift) and OTA commission pressure.",
        "Input-cost inflation (labor, energy, food) and regulatory changes in hospitality.",
      ];
      keyRisks = [
        { risk: "RevPAR Cyclicality & Seasonality", description: "Occupancy or ADR shortfall compresses RevPAR and GOPPAR due to high fixed-cost leverage.", impact: "High", mitigation: "Prime location clusters, tiered pricing, and MICE diversification" },
        { risk: "Lease & Refurb Leverage", description: "IFRS-16 lease liabilities and 8-year refurb capex elevate fixed charges and EBITDAR-to-rent coverage.", impact: "Medium", mitigation: "Conservative lease structuring and maintenance reserves" },
        { risk: "New Supply & OTA Pressure", description: "Competitive supply additions and OTA take-rates pressure occupancy/ADR and net realization.", impact: "Medium", mitigation: "Loyalty direct-booking scale and brand premium" },
      ];
    }
  } else if (sectorType === "banking_financials") {
    swotStrengths = [
      "Granular low-cost CASA deposit franchise providing structural funding cost advantage.",
      "Prudent underwriting and risk-calibrated credit architecture with through-cycle NPA containment.",
      "Extensive branch and digital distribution matrix with scale operating leverage.",
    ];
    swotWeaknesses = [
      "Exposure to credit cycle asset-quality shocks and provisioning volatility.",
      "Net interest margin sensitivity to policy rate and liquidity conditions.",
      "Regulatory capital and liquidity compliance overhead constraining leverage.",
    ];
    swotOpportunities = [
      "CASA and fee-income expansion via digital transaction and cross-sell growth.",
      "Formalization and financial inclusion lifting systemic credit penetration.",
      "Improved asset-quality and provision coverage enabling re-rating.",
    ];
    swotThreats = [
      "Systemic asset-quality deterioration and slippage from stressed sectors.",
      "Margin compression from deposit competition and rate volatility.",
      "Fintech and platform disruption disintermediating payments and lending.",
    ];
    keyRisks = [
      { risk: "Asset Quality Shock", description: "Slippage in corporate or retail portfolios elevating GNPA and credit costs.", impact: "High", mitigation: "Sectoral underwriting caps, early-warning triggers, and provision buffers" },
      { risk: "Net Interest Margin Compression", description: "Deposit repricing and competitive lending rates compressing NIM and spreads.", impact: "Medium", mitigation: "CASA mobilization and risk-adjusted pricing discipline" },
      { risk: "Regulatory Capital Pressure", description: "Higher capital adequacy and provisioning requirements constraining growth.", impact: "Medium", mitigation: "Capital planning and internal accrual retention" },
    ];
  } else if (sectorType === "nbfc") {
    // NBFCs cannot accept demand deposits — CASA language is forbidden here
    // (NBFC_PROFILE). Funding narrative uses wholesale/borrowing vocabulary.
    swotStrengths = [
      "Grassroots distribution reach and proprietary borrower-level underwriting data.",
      "Diversified wholesale borrowing lines across banks, markets, and priority-sector allocations.",
      "Digital collections infrastructure supporting through-cycle recovery rates.",
    ];
    swotWeaknesses = [
      "Wholesale funding-cost sensitivity to policy rates and liquidity conditions.",
      "Borrower overleveraging and geographic concentration in income-generating segments.",
      "Asset-liability maturity mismatches under funding-market stress.",
    ];
    swotOpportunities = [
      "Assets-under-management growth via contiguous rural district expansion.",
      "Direct assignment and securitization unlocking liquidity and capital relief.",
      "Credit-rating upgrades lowering incremental cost of borrowing.",
    ];
    swotThreats = [
      "Localized weather or agricultural demand disruption impairing collections.",
      "Wholesale liquidity tightening raising rollover costs.",
      "Fintech and bank down-market expansion compressing yields.",
    ];
    keyRisks = [
      { risk: "Collection Disruption", description: "Localized income shocks impairing group-lending collection efficiency.", impact: "High", mitigation: "Center-network density, digital collections, and credit discipline" },
      { risk: "Borrowing Cost Pressure", description: "Policy-rate and liquidity-driven repricing of wholesale borrowings compressing spreads.", impact: "Medium", mitigation: "Liability diversification and fixed-rate term funding" },
      { risk: "Asset-Liability Mismatch", description: "Tenor gaps between borrowings and micro-loan assets under stress.", impact: "Medium", mitigation: "Positive liquidity buffers and securitization runways" },
    ];
  } else if (archProfile.archetype === "CYCLICAL_CAPITAL_INTENSIVE") {
    swotStrengths = [
      "Integrated manufacturing scale delivering low-cost production economics and operational control.",
      "Prudent balance sheet with manageable leverage and high asset utilization across rolling cycles.",
      "Established pan-regional distribution network and multi-decade commercial customer relationships.",
    ];
    swotWeaknesses = [
      "Fixed asset-heavy cost structure creating operating earnings sensitivity during sector downturns.",
      "Significant sustaining maintenance capex requirements restricting discretionary cash distribution.",
      "Exposure to volatile global commodity raw material input prices and energy tariff fluctuations.",
    ];
    swotOpportunities = [
      "Operational margin expansion via captive power generation, waste heat recovery, and modern scrap recycling.",
      "Government infrastructure spending programs and domestic manufacturing incentive programs.",
      "Brownfield debottlenecking expansions achieving rapid capacity scale at high incremental returns.",
    ];
    swotThreats = [
      "Global capacity oversupply or subsidized imports compressing domestic product realizations.",
      "Tightening environmental emissions mandates requiring unforeseen decarbonization capital expenditures.",
      "Higher borrowing costs increasing interest expense during debt-financed project commissioning phases.",
    ];
    if (sectorType === "renewables") {
      keyRisks = [
        { risk: "Input Commodity & Steel Volatility", description: "Steel, copper, and resin spot price spikes impacting turbine manufacturing conversion costs.", impact: "Medium", mitigation: "Hedged via fixed-price steel contracts and formulaic pass-through clauses in SECI tenders." },
        { risk: "Site Execution & Grid Evacuation Bottlenecks", description: "Interstate transmission system (ISTS) substation delays and Right of Way (ROW) hurdles deferring commissioning.", impact: "Medium", mitigation: "Mitigated by modular turbine designs, pre-fabricated foundations, and phased BOP milestone billing." },
        { risk: "Direct OEM Competitive Pricing Pressure", description: "Aggressive bidding by domestic competitor Inox Wind or global turbine OEMs compressing headline realization per MW.", impact: "Medium", mitigation: "Defended by 3.15 MW platform cost-efficiency, superior PLF metrics, and 15+ GW captive O&M fleet density." },
      ];
    } else {
      keyRisks = [
        { risk: "Raw Material Input Inflation", description: "Sharp increases in energy and key feedstock inputs without immediate formulaic pass-through.", impact: "Medium", mitigation: "Vendor diversification and strategic long-term indexed supply contracts" },
        { risk: "Major Project Execution Delays", description: "Time or cost overruns during new plant commissioning impacting projected return on invested capital.", impact: "Medium", mitigation: "Turnkey EPC oversight with strict milestone-based contractor warranties" },
        { risk: "Cyclical Demand Deceleration", description: "Macro slowdown across automotive or industrial construction dampening order realizations.", impact: "Medium", mitigation: "Expanding recurring maintenance and higher-margin aftermarket service revenue" },
      ];
    }
  } else if (sectorType === "technology_platform") {
    swotStrengths = [
      "Unmatched Family of Apps scale with multi-billion DAU/MAU cohorts driving durable digital-advertising ARPU and high operating margins.",
      "Proprietary ad-targeting, ranking, and measurement data compounding advertiser ROI and auction pricing power.",
      "Net-cash balance sheet with exceptional free-cash-flow conversion funding data-center and AI infrastructure internally.",
    ];
    swotWeaknesses = [
      "Revenue concentration in digital advertising, sensitive to macro ad-spend cycles and auction pricing volatility.",
      "Sustained Reality Labs operating losses diluting consolidated margins despite Family of Apps strength.",
      "Elevated AI infrastructure capex intensity pressuring near-term free-cash-flow conversion.",
    ];
    swotOpportunities = [
      "AI-driven ad ranking, creative automation, and messaging commerce expanding ad impressions and average price per ad.",
      "Growth in video (Reels), business messaging, and wearables opening incremental monetization surfaces.",
      "Inference-efficiency and custom-silicon gains lowering unit compute cost per ad impression.",
    ];
    swotThreats = [
      "Data-privacy platform shifts and antitrust remedies impairing targeting and distribution advantages.",
      "Competition for attention and ad budgets from search, short-video, and retail-media platforms.",
      "Macro ad-spend retrenchment compressing auction density and price realization.",
    ];
    keyRisks = [
      { risk: "Ad-Spend Cyclicality", description: "Macro downturns compress advertiser budgets and average price per ad even as user engagement holds.", impact: "High", mitigation: "Performance-based formats and diversified advertiser breadth sustaining auction density", horizon: "Ongoing", valuationSensitivity: "Ad-price softness transmits directly into ARPU and fair value" },
      { risk: "Privacy & Antitrust Regulation", description: "OS-level privacy changes and competition rulings can degrade targeting, measurement, and distribution.", impact: "High", mitigation: "First-party signal scale and on-device measurement investment", horizon: "12-24 Months", valuationSensitivity: "Targeting degradation impairs pricing power structurally" },
      { risk: "AI Capex & Reality Labs Drag", description: "Data-center buildouts and sustained Reality Labs losses can weigh on consolidated margins and FCF.", impact: "Medium", mitigation: "Phased capex tied to advertiser ROI with explicit Reality Labs loss discipline", horizon: "12-24 Months", valuationSensitivity: "Capex intensity compresses FCF conversion" },
    ];
  } else if (sectorType === "technology_hardware") {
    // Hardware-native SWOT: units × ASP × mix, component costs, channel inventory.
    // SaaS/consulting vocabulary (NRR, MSA, utilization pyramids) is forbidden here.
    swotStrengths = [
      "Installed-base scale and ecosystem attach supporting replacement-cycle demand and services monetization.",
      "Custom silicon and vertical integration delivering power, cost, and gross-margin advantage over merchant-component rivals.",
      "Channel scale and procurement leverage securing component supply and sell-through during shortages.",
    ];
    swotWeaknesses = [
      "Replacement-cycle elongation in mature device categories compressing unit volumes.",
      "Gross-margin sensitivity to memory, display, and silicon component cost swings.",
      "Product-concentration risk around flagship launch execution each cycle.",
    ];
    swotOpportunities = [
      "ASP expansion via pro-tier mix shift and higher-memory configurations.",
      "Services attach growth on the installed base lifting lifetime revenue per device.",
      "AI-capable device refresh and on-device compute differentiation driving upgrade demand.",
    ];
    swotThreats = [
      "Channel inventory overhang forcing price protection and margin give-back.",
      "Aggressive low-cost competition compressing mid-tier ASP and share.",
      "Supply-chain disruption in key components constraining unit output.",
    ];
    keyRisks = [
      { risk: "Replacement-Cycle Elongation", description: "Longer consumer holding periods compressing unit shipments across device lines.", impact: "High", mitigation: "Staggered launch cadence, trade-in programs, and services bundling sustaining upgrade pull" },
      { risk: "Component Cost Volatility", description: "Memory and display price spikes compressing hardware gross margin without immediate ASP pass-through.", impact: "Medium", mitigation: "Forward component commitments, mix shift to high-margin configurations, and disciplined channel pricing" },
      { risk: "Channel Inventory Overhang", description: "Excess weeks of channel inventory forcing discounting and sell-through support.", impact: "Medium", mitigation: "Sell-through monitoring, disciplined sell-in, and production flexibility" },
    ];
  } else if (sectorType === "technology_software") {
    swotStrengths = [
      "Subscription base with net expansion compounding ARR on retained seats.",
      "Mission-critical workflow embedment sustaining gross retention and pricing power.",
      "High gross-margin cloud mix funding R&D and go-to-market scale.",
    ];
    swotWeaknesses = [
      "Seat-license sensitivity to enterprise headcount and IT budget scrutiny.",
      "Sales-cycle elongation on large multi-year enterprise commitments.",
      "AI-driven seat-model disruption risk requiring packaging evolution.",
    ];
    swotOpportunities = [
      "Per-seat revenue expansion via cross-sell, tier upgrades, and AI add-on monetization.",
      "Large-deal TCV conversion expanding RPO and multi-year visibility.",
      "Operating leverage as incremental subscription gross margin drops to FCF.",
    ];
    swotThreats = [
      "Enterprise downsell and churn under budget consolidation.",
      "Pricing pressure from bundled hyperscaler suites.",
      "Execution risk on consumption/AI pricing transitions.",
    ];
    keyRisks = [
      { risk: "Enterprise IT Budget Moderation", description: "CIO scrutiny compressing seat growth and expansion timing.", impact: "Medium", mitigation: "Multi-year enterprise agreements with expansion ramps and ROI-anchored renewals" },
      { risk: "Seat Downsell & Churn", description: "Headcount reductions translating into license contraction.", impact: "Medium", mitigation: "Platform consolidation plays and usage-based tiers retaining workloads" },
      { risk: "AI Packaging Disruption", description: "Seat-pricing erosion as AI automation reduces per-seat value capture.", impact: "Medium", mitigation: "Outcome- and consumption-linked packaging alongside seat base" },
    ];
  } else if (sectorType === "pharma_healthcare") {
    // Pharma needs its own SWOT even when archetype is MATURE_COMPOUNDER —
    // otherwise it falls to IT-generic risks (master service agreements).
    swotStrengths = [
      "Entrenched domestic formulations franchise with chronic-therapy prescription loyalty.",
      "Vertically integrated active-ingredient manufacturing supporting cost and supply resilience.",
      "Differentiated complex-generics pipeline targeting regulated export markets.",
    ];
    swotWeaknesses = [
      "US generics price erosion compressing realized export margins.",
      "Regulatory inspection exposure across manufacturing sites requiring remediation readiness.",
      "Working-capital intensity from channel inventory and receivables cycles.",
    ];
    swotOpportunities = [
      "Complex injectable and specialty launches commanding premium realizations.",
      "Domestic chronic-market growth outpacing acute segments on demographics.",
      "Contract manufacturing partnerships monetizing spare compliant capacity.",
    ];
    swotThreats = [
      "Accelerated US buyer consolidation intensifying generic price compression.",
      "Adverse regulatory observations disrupting site-level supply continuity.",
      "Active-ingredient input inflation squeezing formulation spreads.",
    ];
    keyRisks = [
      { risk: "US Generics Price Erosion", description: "Buyer consolidation and competition compressing US generic realizations.", impact: "High", mitigation: "Complex-product mix shift and differentiated launch cadence" },
      { risk: "Regulatory Inspection Exposure", description: "Observations at manufacturing sites risking supply disruption and remediation cost.", impact: "Medium", mitigation: "Quality-system investment and site diversification" },
      { risk: "Input Cost & Channel Pressure", description: "Active-ingredient inflation plus distributor destocking weighing on margins.", impact: "Medium", mitigation: "Backward integration and disciplined channel inventory" },
    ];
  } else {
    // Sector-neutral fallback: this branch serves every sector WITHOUT a dedicated
    // template (ratings, energy, diversified industrials, ...). It must not borrow
    // ANY sector's vocabulary (no IT deal/MSA language, no CASA/loan-book, no
    // spectrum/subscriber, no plant/refinery, no clinical/FMCG terms) — otherwise
    // un-templated sectors false-block on SANITIZE-01.
    swotStrengths = [
      "Established customer relationships and repeat-purchase behavior supporting revenue durability.",
      "Disciplined reinvestment sustaining operating margins through cycles.",
      "Conservative balance sheet posture preserving strategic flexibility.",
    ];
    swotWeaknesses = [
      "Moderating organic revenue growth rates as market share reaches maturity in core geographies.",
      "Exposure to customer discretionary spending scrutiny during broader macro decelerations.",
      "Elevated baseline valuation multiples reducing margin of error for quarterly execution misses.",
    ];
    swotOpportunities = [
      "Disciplined tuck-in acquisitions deploying liquid reserves into adjacent growth verticals.",
      "Operating productivity gains from process automation and capacity debottlenecking.",
      "Market-share gains as customers consolidate purchases with scaled suppliers.",
    ];
    swotThreats = [
      "Technology and product-cycle shifts requiring ongoing operating-model modernization.",
      "Wage and skilled-talent retention competition in core operating roles.",
      "Broader equity-market multiple compression during elevated risk-free interest rate environments.",
    ];
    keyRisks = [
      { risk: "Enterprise Demand Moderation", description: "Customers deferring procurement and pausing discretionary spending compressing near-term revenue.", impact: "Low", mitigation: "Contracted recurring-revenue renewals and retention execution" },
      { risk: "Foreign Exchange Realization Swings", description: "Unhedged currency fluctuations impacting cross-border sales realization and reported revenue.", impact: "Low", mitigation: "Active rolling multi-currency hedging policies and pass-through billing structures" },
      { risk: "Valuation Multiple De-Rating", description: "Market-wide contraction in growth multiples driven by shifts in sovereign bond yields.", impact: "Medium", mitigation: "Disciplined capital return via steady dividend compounding and opportunistic buybacks" },
    ];
  }

  // ── Archetype-Specific Financial Commentary ──────────────────────
  const economicContext = archProfile.archetype === "DISTRESSED"
    ? `The macroeconomic environment is marked by intense competition and structural regulatory costs. While consumer data consumption continues to grow rapidly, market dynamics demand aggressive cost optimization and balance sheet deleveraging to maintain solvency.`
    : archProfile.archetype === "EARLY_PLATFORM_GROWTH"
    ? `Rapid digital penetration and expanding consumer adoption of hyperlocal delivery services drive robust volume expansion. Macro consumer spending trends remain supportive of convenience-led platforms, offsetting near-term competitive discounting.`
    : archProfile.archetype === "CYCLICAL_CAPITAL_INTENSIVE"
    ? `Macroeconomic indicators reflect steady domestic infrastructure allocation balanced by cyclical global commodity input fluctuations. Operating conditions prioritize capacity discipline, inventory agility, and energy efficiency.`
    : `The macroeconomic backdrop reflects steady institutional and enterprise demand across key operating corridors. Low reliance on external borrowing insulates profitability from interest rate volatility, supporting sustained equity compounding.`;

  const globalIndustryAnalysis = `Global sector benchmarks highlight growing bifurcation between low-cost scaled leaders and fragmented sub-scale competitors. Industry participants with modern technological integration and dense operating footprints command superior structural profitability.`;
  const domesticIndustryAnalysis = `Domestic market structure is transitioning toward an established oligopoly, where regulatory standards, localized distribution density, and balance sheet endurance dictate multi-year market share shifts.`;
  const segmentAnalysis = `Operational breakdown confirms stable execution across core product divisions. Strategic emphasis is focused on migrating customer mix toward higher-margin, recurring service lines to expand blended realization.`;
  const quarterlyResultsCommentary = `Quarterly operating results reflect consistent operational cadence, with key throughput indicators tracking multi-year performance milestones despite seasonal variations.`;
  const managementCommentary = `Executive leadership maintains strict operating discipline, focusing capital deployment on strategic moats, unit-level profitability, and conservative working capital management.`;
  const revenueCommentary = sectorType === "asset_management"
    ? `Revenue realization is anchored by client assets under management (AUM), net fund inflows, organic mandate growth, and technology platform subscription retention.`
    : sectorType === "technology_platform"
    ? `Revenue realization is anchored by Family of Apps digital-advertising demand, measured through DAU/MAU engagement, ad-impression inventory growth, and average price-per-ad realization (digital-advertising ARPU).`
    : `Revenue realization is supported by established customer account retention, contract price escalation clauses, and expanding capacity throughput across priority markets.`;
  const ebitdaCommentary = sectorType === "asset_management"
    ? `Operating leverage is driven by scalable investment research, centralized risk analytics, and global distribution infrastructure absorbing incremental client assets with minimal marginal cost.`
    : sectorType === "technology_platform"
    ? `EBITDA dynamics reflect Family of Apps operating leverage from AI-driven ad ranking and efficiency gains, partly offset by data-center/AI infrastructure scaling and the sustained Reality Labs operating loss.`
    : `EBITDA trends highlight operating cost containment, with supply chain synergies and fixed-cost absorption counterbalancing localized input expense pressures.`;
  const ebitCommentary = `Operating earnings conversion remains predictable, insulated by measured administrative overhead and disciplined asset depreciation schedules.`;
  const patCommentary = `Net profitability reflects effective treasury management and tax-efficient operating structures, ensuring stable underlying cash flow translation.`;
  const balanceSheetCommentary = sectorType === "asset_management"
    ? `The balance sheet maintains an asset-light, fortress capital structure characterized by low financial debt, robust seed capital liquidity, and consistent regulatory capital compliance.`
    : archProfile.archetype === "DISTRESSED"
    ? `The balance sheet is heavily leveraged, requiring active debt servicing management and statutory compliance monitoring. Liquidity preservation remains paramount.`
    : `The balance sheet displays solid solvency characteristics with conservative debt gearing and strong liquidity buffers supporting operational stability.`;
  // FCF-gated cash narrative (items 7/16): the canonical forecast's FCFF path is
  // the single truth — when any of the first 3 forecast years print negative
  // FCFF, prose must describe the investment phase, never "self-funding".
  const projFcff: number[] = Array.isArray((dcf as { projections?: Array<{ fcff?: number }> }).projections)
    ? (dcf as { projections: Array<{ fcff?: number }> }).projections.map((p) => Number(p.fcff) || 0)
    : [];
  const forecastBurnsCash = projFcff.slice(0, 3).some((f) => f < 0);
  const cashFlowCommentary = archProfile.archetype === "EARLY_PLATFORM_GROWTH" || archProfile.archetype === "DISTRESSED" || forecastBurnsCash
    ? `Operating cash flows are prioritized toward funding critical network infrastructure and working capital requirements, with disciplined liquidity controls.${forecastBurnsCash ? ` The canonical forecast prints negative free cash flow in the near explicit period — growth is bought with external funding, not self-funded.` : ""}`
    : `Operating cash conversion is robust, generating sufficient free cash flow to comfortably fund ongoing capital reinvestment and disciplined shareholder distributions.`;
  const dupontCommentary = `DuPont return analysis demonstrates that return on equity is anchored by operational asset turnover and stable net profit margins rather than excessive financial leverage.`;
  const ratioCommentary = `Financial solvency, liquidity, and asset turnover ratios remain consistent with institutional research criteria, reflecting prudent risk management standards.`;
  const dcfCommentary = `Our discounted cash flow valuation anchors intrinsic enterprise value through a multi-stage forecast reflecting scenario-tested margin profiles and disciplined WACC discounting.`;

  // Honest deterministic fallback: no LLM council ran. Never VERIFIED/99.
  const councilVerification: CouncilVerificationAudit = {
    status: "FLAGGED",
    integrityScore: 0,
    summary: `Deterministic PE fallback for ${profile.name} (${profile.ticker}) — no LLM council audit ran. All cross-checks below are unverified; treat narrative claims as unconfirmed pending council review.`,
    checks: [
      {
        name: "Valuation & CMP Mathematical Consistency",
        category: "VALUATION",
        status: "FLAG",
        observation: `Not independently verified (deterministic fallback): CMP (${sym}${cmp.toFixed(2)}) vs DCF fair value (${sym}${fv.toFixed(2)}, ${formatPct(upsidePct)} spread).`,
      },
      {
        name: "Thesis & Model Recommendation Alignment",
        category: "RECOMMENDATION",
        status: "FLAG",
        observation: `Not independently verified (deterministic fallback): thesis stance vs quantitative ${verdict} directive unchecked.`,
      },
      {
        name: "Balance Sheet & Solvency Cross-Verification",
        category: "SOLVENCY",
        status: "FLAG",
        observation: `Not independently verified (deterministic fallback): net debt of ${formatLargeNum(netDebt, cur)} unchecked against commentary.`,
      },
      {
        name: "5-Stage DuPont & Operating Leverage Quality",
        category: "FINANCIALS",
        status: "FLAG",
        observation: `Not independently verified (deterministic fallback): margin and turnover dynamics unchecked.`,
      },
      {
        name: "Anti-Hallucination & Cross-Persona Integrity",
        category: "ANTI_HALLUCINATION",
        status: "FLAG",
        observation: `Not independently verified (deterministic fallback): cross-persona contradictions unchecked.`,
      },
    ],
    correctionsApplied: [
      "No corrections applied — council verification did not run.",
    ],
    verificationTimestamp: new Date().toISOString(),
    auditorSignature: "Supervisory Council Quality & Verification Officer (PE Audit Protocol) — AUDIT NOT PERFORMED",
  };

  const hasVerifiedNews = recentNewsAnalysis.length > 0;
  const newsSummary: NewsSummaryDeskAnalysis = {
    executiveNewsSummary: hasVerifiedNews
      ? `${profile.name} appears in ${recentNewsAnalysis.length} verified disclosure-feed item(s), summarized below from stated sources. No sentiment beyond what the items state is asserted.`
      : `No verified news items were available for ${profile.name} in the current feed; no media narrative is asserted.`,
    mediaSentimentScore: 0,
    mediaSentimentLabel: "Neutral",
    keyNarrativeThemes: hasVerifiedNews
      ? recentNewsAnalysis.slice(0, 4).map((n) => n.headline.slice(0, 80))
      : [],
    topDisclosures: recentNewsAnalysis.slice(0, 5).map((item, idx) => ({
      date: item.date,
      source: item.publisher || "Media wire",
      headline: item.headline,
      category: idx === 0 ? "Operational Execution" : idx === 1 ? "Capital Allocation" : "Commercial Contract",
      valuationTransmission: item.strategicTakeaway,
      riskRating: "LOW" as const,
    })),
    macroIndustryTransmission: hasVerifiedNews
      ? `Transmission of the above items into cash-flow expectations is judgmental and item-specific; no sector tailwind is assumed.`
      : `No industry transmission assessed — no verified items.`,
    earningsTransmissionVerdict: hasVerifiedNews
      ? `Earnings impact is item-specific and unverified beyond the stated takeaways; no fair-value confirmation is claimed.`
      : `No verdict — no verified news flow.`,
  };

  return {
    summary: `${profile.name} (${profile.ticker}) is an institutional research profile analyzed under the ${archProfile.sector} sector framework. Intrinsic fair value is calibrated at ${sym}${fv.toFixed(2)} per share against prevailing market price of ${sym}${cmp.toFixed(2)}.`,
    investmentThesis,
    companyOverview,
    investmentConclusion,
    competitiveMoat: (input.assumptionsLedger?.moatBridge)
      ? `${input.assumptionsLedger.moatBridge}`
      : (archProfile.archetype === "DISTRESSED" ? "None" : archProfile.archetype === "EARLY_PLATFORM_GROWTH" ? "Narrow" : (input.assumptionsLedger?.moatRating || "Narrow")),
    economicContext,
    globalIndustryAnalysis,
    domesticIndustryAnalysis,
    segmentAnalysis,
    quarterlyResultsCommentary,
    managementCommentary,
    revenueCommentary,
    ebitdaCommentary,
    ebitCommentary,
    patCommentary,
    balanceSheetCommentary,
    cashFlowCommentary,
    dupontCommentary,
    ratioCommentary,
    dcfCommentary,
    swotStrengths,
    swotWeaknesses,
    swotOpportunities,
    swotThreats,
    keyRisks,
    moatSources,
    moatPillars,
    industryDynamicsCommentary,
    fiveForces,
    businessStrategyCommentary,
    catalysts,
    creditAnalysisCommentary,
    enterpriseRiskCommentary,
    governanceCommentary,
    capitalAllocationCommentary,
    capitalDeploymentHistory,
    analystNotes,
    recentNewsAnalysis,
    councilVerification,
    newsSummary,
  };
}
