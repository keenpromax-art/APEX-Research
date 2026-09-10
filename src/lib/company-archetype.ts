// ============================================================
// Institutional Company Archetype & GICS Sector Classifier
// Prevents "Frankenstein" architecture by establishing the company's
// operational reality before generating financial templates and narratives.
// ============================================================
import type { CompanyProfile, StockData, AnnualFinancials } from "@/types/report";
import { stmtNum, isReitStatement, isInsuranceStatement, isAssetLightStatement } from "@/types/report";
import { isInternetPlatformCompany, isHospitalityCompany, isRealEstateCompany, isTelecomCarrierCompany, isHardwareCompany, isSoftwareCompany } from "./sectors/profiles";

export type FinancialArchetype =
  | "DISTRESSED"              // High leverage, negative EBITDA/earnings, debt restructuring (e.g. Vodafone Idea)
  | "EARLY_PLATFORM_GROWTH"   // Cash-burning platform, high customer acquisition, 0 dividends (e.g. Swiggy, Zomato)
  | "CYCLICAL_CAPITAL_INTENSIVE" // Heavy capex, cyclical commodity/capacity (e.g. Reliance, Tata Steel, Suzlon)
  | "MATURE_COMPOUNDER";      // High ROIC, profitable cash flow, dividend/buybacks (e.g. Apple, TCS, HUL)

export type GICSSector =
  | "platform_gig_economy"     // Food delivery, quick commerce, ride hailing, logistics platforms
  | "telecom"                  // Wireless carriers, telecom towers, fiber networks
  | "technology_platform"      // Internet platforms, social media, digital advertising (e.g. Meta, Alphabet)
  | "technology_software"      // Enterprise software, SaaS, IT services
  | "technology_hardware"      // Semiconductors, custom silicon, hardware devices
  | "renewables"               // Wind, solar, clean energy infrastructure
  | "energy_petrochem"         // Oil, gas, refining, petrochemicals
  | "financial_data_ratings"   // Credit rating agencies, market intelligence, exchanges
  | "asset_management"         // Asset & wealth management (e.g. BlackRock, HDFC AMC)
  | "nbfc"                     // Non-Banking Financial Companies, Microfinance, Housing Finance
  | "banking_financials"       // Commercial banks with CASA deposits
  | "pharma_healthcare"        // Pharmaceuticals, generic drugs, formulations
  | "consumer_fmcg"            // Consumer packaged goods, food manufacturing, personal care
  | "consumer_durables"        // Branded footwear, apparel, accessories, sportswear, luxury goods
  | "auto_manufacturing"       // Automotive OEMs, vehicles, auto components
  | "hospitality"              // Hotels, resorts, lodging — RevPAR/ADR/Occupancy driven
  | "hospitality_owner_operator"
  | "hospitality_asset_light"
  | "hospitality_reit"
  | "real_estate"              // REITs, property development — NOI/AFFO driven
  | "general_industrial";      // Capital goods, engineering, diversified manufacturing

export interface ArchetypeProfile {
  archetype: FinancialArchetype;
  sector: GICSSector;
  creditRating: string;
  isDividendPaying: boolean;
  dividendCAGRDisplay: string;
  buybackYieldDisplay: string;
  totalShareholderYieldDisplay: string;
  capitalAllocationLabel: string;
  capitalAllocationDescription: string;
  valuationAnchor: string;
  scenarioMargins: {
    bearMargin: number;
    baseMargin: number;
    bullMargin: number;
    bearMarginDisplay: string;
    baseMarginDisplay: string;
    bullMarginDisplay: string;
  };
}

export function classifyArchetype(
  profile: CompanyProfile,
  stockData: StockData,
  annualFinancials: AnnualFinancials[]
): ArchetypeProfile {
  const s = (profile.sector || "").toLowerCase();
  const ind = (profile.industry || "").toLowerCase();
  const name = (profile.name || "").toLowerCase();
  const desc = (profile.description || "").toLowerCase();
  const ticker = (profile.ticker || "").toUpperCase();
  const text = `${ticker} ${name} ${s} ${ind} ${desc}`;

  // ── 1. GICS Sector Classification ──────────────────────────────────────
  // Precedence mirrors classifySector (#1–#5 financial first): lenders, raters,
  // managers, banks, and holdings resolve BEFORE platform/telecom keyword checks.
  // Otherwise lender app language / carrier-mentioning descriptions misroute
  // (Muthoot/UNOMINDA precedents) and disagree with the sector classifier —
  // a guaranteed QA block either way.
  let sector: GICSSector = "general_industrial";
  // Internet platform / social / digital advertising MUST be evaluated before
  // telecom: "Communication Services" covers both carriers AND platforms, and
  // platform descriptions contain "consumer hardware" (Meta Reality Labs).
  // Shared predicate with classifySector — do not fork a local copy.
  const isInternetPlatform = isInternetPlatformCompany(
    profile.sector,
    profile.industry,
    profile.description,
    profile.name
  );

  // Company-name triggers use word boundaries: bare substring matching false-positives
  // on ordinary vocabulary (e.g. "uber" inside "Kubernetes" routed a server maker to
  // food delivery). Multi-word concept phrases keep includes() (spaces prevent this).
  const gigNameHit = /\b(swiggy|zomato|doordash|uber|instamart|blinkit)\b/.test(text);
  if (
    ind.includes("financial data") ||
    ind.includes("rating") ||
    ind.includes("analytics") ||
    ind.includes("exchange") ||
    name.includes("crisil") ||
    name.includes("icra") ||
    name.includes("care") ||
    name.includes("moody") ||
    name.includes("s&p")
  ) {
    sector = "financial_data_ratings";
  } else if (
    text.includes("microfinance") ||
    text.includes("nbfc") ||
    text.includes("spandana") ||
    text.includes("rural lending") ||
    text.includes("housing finance") ||
    ind.includes("consumer finance") ||
    ind.includes("credit services")
  ) {
    // "Credit Services" is Yahoo's lender category (Shriram/Chola/Muthoot/CreditAccess/
    // IIFL/IREDA) — parity with classifySector, which also checks NBFC first.
    sector = "nbfc";
  } else if (
    ind.includes("asset management") ||
    ind.includes("wealth management") ||
    ind.includes("investment management") ||
    name.includes("blackrock") ||
    text.includes("blackrock amc") ||
    text.includes("hdfc amc")
  ) {
    sector = "asset_management";
  } else if (
    (s.includes("financial") || s.includes("bank")) &&
    (ind.includes("conglomerate") || ind.includes("holding"))
  ) {
    // Financial-sector holdings (Bajaj Finserv precedent): underwrite nothing —
    // general industrial, never a subsidiary's sector.
    sector = "general_industrial";
  } else if (
    s.includes("financial") ||
    ind.includes("bank") ||
    ind.includes("insurance") ||
    ind.includes("lending")
  ) {
    sector = "banking_financials";
    // (gig/platform/telecom continue the financial-first chain; their shared
    // predicates are declared above next to the sector init.)
  } else if (
    gigNameHit ||
    text.includes("food delivery") ||
    text.includes("quick commerce") ||
    text.includes("dark store") ||
    text.includes("hyperlocal") ||
    text.includes("ride hailing") ||
    text.includes("online food ordering")
  ) {
    sector = "platform_gig_economy";
  } else if (isInternetPlatform) {
    sector = "technology_platform";
  } else if (
    isTelecomCarrierCompany(profile.sector, profile.industry, profile.description, profile.name) ||
    ticker.includes("IDEA") ||
    ticker.includes("BHARTIARTL") ||
    ticker.includes("TATACOMM") ||
    text.includes("vodafone idea") ||
    text.includes("wireless carrier")
  ) {
    // Shared industry-strict predicate (not bare "cellular"/"wireless" description
    // keywords — those false-positive on hardware makers describing cellular
    // connectivity, e.g. Apple). NOTE: bare sector `includes("communication")` is
    // intentionally NOT used — Communication Services includes internet platforms.
    sector = "telecom";
  // Financial branches live at the TOP of this chain (financial-first precedence);
  // their duplicate lower copies were removed as unreachable dead code.
  } else if (
    s.includes("health") ||
    ind.includes("pharma") ||
    ind.includes("biotech") ||
    ind.includes("drug")
  ) {
    // Industry/sector-gated (parity with classifySector §5): description words like
    // "pharmaceuticals"/"formulations" are CUSTOMER verticals or product-form words
    // (IGL serves pharma customers; agrochemical makers sell "formulations") — never
    // own-industry evidence. Genuine pharma always carries Healthcare sector or a
    // pharma/biotech/drug industry label.
    sector = "pharma_healthcare";
  } else if (
    isHardwareCompany(profile.sector, profile.industry, profile.description, profile.name) ||
    ind.includes("semiconductor") ||
    ind.includes("hardware") ||
    name.includes("apple") ||
    ticker.includes("AAPL") ||
    name.includes("nvidia") ||
    ticker.includes("NVDA") ||
    name.includes("intel") ||
    ticker.includes("INTC") ||
    text.includes("microprocessor")
  ) {
    sector = "technology_hardware";
  } else if (
    isSoftwareCompany(profile.sector, profile.industry, profile.description, profile.name) ||
    s.includes("tech") ||
    ind.includes("software") ||
    ind.includes("it service") ||
    name.includes("tcs") ||
    name.includes("infosys")
  ) {
    sector = "technology_software";
  } else if (
    ind.includes("wind") ||
    ind.includes("solar") ||
    ind.includes("renewable") ||
    name.includes("suzlon") ||
    name.includes("adani green")
  ) {
    sector = "renewables";
  } else if (
    s.includes("energy") ||
    ind.includes("oil") ||
    ind.includes("gas") ||
    ind.includes("petro") ||
    ind.includes("refin") ||
    ticker.includes("RELIANCE")
  ) {
    sector = "energy_petrochem";
  } else if (
    ind.includes("auto") ||
    ind.includes("motor") ||
    ind.includes("vehicle")
  ) {
    sector = "auto_manufacturing";
  } else if (
    isHospitalityCompany(s, ind, desc, name) ||
    ind.includes("lodg") ||
    ind.includes("hotel") ||
    ind.includes("resort")
  ) {
    // Hospitality operating model decomposition (hard archetype)
    if (ind.includes("reit") || text.includes(" reit") || text.includes("trust") || name.includes("reit")) {
      sector = "hospitality_reit";
    } else if (
      text.includes("managed and franchised") ||
      text.includes("franchise fee") ||
      text.includes("asset-light") ||
      text.includes("asset light") ||
      name.includes("marriott") ||
      name.includes("hilton") ||
      name.includes("hyatt") ||
      name.includes("ihg")
    ) {
      sector = "hospitality_asset_light";
    } else if (text.includes("owned hotels") || text.includes("own hotels") || text.includes("owned rooms")) {
      sector = "hospitality_owner_operator";
    } else {
      sector = "hospitality";
    }
  } else if (
    isRealEstateCompany(s, ind, desc, name) ||
    ind.includes("real estate") ||
    s.includes("real estate")
  ) {
    sector = "real_estate";
  } else if (
    ind.includes("apparel") ||
    ind.includes("footwear") ||
    ind.includes("textile") ||
    ind.includes("garment") ||
    ind.includes("sportswear") ||
    ind.includes("luxury") ||
    ind.includes("accessories") ||
    ind.includes("leather") ||
    ticker.includes("NKE") ||
    ticker.includes("LULU") ||
    ticker.includes("DECK") ||
    ticker.includes("CROX")
  ) {
    sector = "consumer_durables";
  } else if (
    !isInternetPlatform &&
    !text.includes("consumer hardware") &&
    !text.includes("consumer electronics") &&
    !text.includes("virtual reality") &&
    !text.includes("augmented reality") &&
    (s.includes("consumer staples") ||
    s.includes("consumer goods") ||
    ind.includes("consumer goods") ||
    ind.includes("consumer staples") ||
    ind.includes("consumer packaged") ||
    ind.includes("beverage") ||
    (ind.includes("food") && !ind.includes("food delivery")) ||
    ind.includes("household") ||
    ind.includes("personal products"))
  ) {
    sector = "consumer_fmcg";
  }

  // ── 2. Financial Metrics Analysis ──────────────────────────────────────
  const latest = annualFinancials[annualFinancials.length - 1] || {} as AnnualFinancials;
  const rev = latest.revenue || 0;
  // stmtNum: EBITDA exists on corporate rows and as zeroed N/A on bank rows
  // (identical runtime to the old single-shape pipeline). REITs carry no EBITDA
  // by design — FFO is their earnings power for leverage/distress purposes.
  const ebitdaRaw = stmtNum(latest, "ebitda", Number.NaN);
  const ebitdaMarginRaw = stmtNum(latest, "ebitdaMargin", Number.NaN);
  const ebitda = isReitStatement(latest)
    ? latest.fundsFromOperations
    : (Number.isFinite(ebitdaRaw) ? ebitdaRaw : rev * (Number.isFinite(ebitdaMarginRaw) ? ebitdaMarginRaw : 0));
  const netIncome = latest.netIncome ?? 0;
  const totalDebt = latest.totalDebt || 0;
  const cash = latest.cash || 0;
  const netDebt = Math.max(0, totalDebt - cash);
  const fcf = latest.freeCashFlow ?? 0;
  const divYield = stockData.dividendYield || 0;

  const netDebtToEbitda = ebitda > 0 ? netDebt / ebitda : (totalDebt > 0 ? 999 : 0);
  const isLossMaking = netIncome < 0 || latest.netMargin < -0.01;
  // ebitdaMarginRaw is NaN on shapes without an EBITDA construct (REIT/insurance/fee).
  const isEbitdaNegative = ebitda <= 0 || (Number.isFinite(ebitdaMarginRaw) && ebitdaMarginRaw < 0);
  const isFinancialSector = sector === "banking_financials" || sector === "nbfc";
  const isAssetLightFinancial = sector === "asset_management" || sector === "financial_data_ratings";
  const isHospitalitySector = sector === "hospitality" || sector === "hospitality_owner_operator" || sector === "hospitality_asset_light" || sector === "hospitality_reit" || sector === "real_estate";

  // ── 3. Determine Financial Archetype ──────────────────────────────────
  let archetype: FinancialArchetype = "MATURE_COMPOUNDER";

  if (!isFinancialSector && !isAssetLightFinancial && (
    netDebtToEbitda > 6.0 ||
    (totalDebt > rev * 1.5 && isLossMaking) ||
    ticker.includes("IDEA") ||
    text.includes("vodafone idea") ||
    text.includes("debt restructuring") ||
    text.includes("agr dues")
  )) {
    archetype = "DISTRESSED";
  } else if (isFinancialSector && (isLossMaking && latest.totalEquity !== undefined && latest.totalEquity < 0)) {
    archetype = "DISTRESSED";
  } else if (
    sector === "platform_gig_economy" ||
    (isLossMaking && (stockData.revenueGrowth || (latest as any).revenueGrowthYoY || 0) > 0.15) ||
    (isEbitdaNegative && rev > 0)
  ) {
    archetype = "EARLY_PLATFORM_GROWTH";
  } else if (
    sector === "energy_petrochem" ||
    sector === "auto_manufacturing" ||
    sector === "renewables" ||
    sector === "hospitality" ||
    sector === "hospitality_owner_operator" ||
    sector === "hospitality_reit" ||
    (!isFinancialSector && !isAssetLightFinancial && !isHospitalitySector && totalDebt > rev * 0.35 && !isLossMaking)
  ) {
    archetype = "CYCLICAL_CAPITAL_INTENSIVE";
  } else {
    archetype = "MATURE_COMPOUNDER";
  }

  // ── 4. Calibrate Credit Rating (Strict Risk Model) ───────────────────
  let creditRating = "AA-";
  if (isFinancialSector) {
    // Commercial banks and established NBFCs: Credit is driven by equity capitalization, asset quality, and systemic scale
    if (netIncome > 0 && (latest.totalEquity || 0) > 0) {
      const isLargeCapBank = (stockData.marketCap > 5e11) || ((latest.totalEquity || 0) > 1e11) || ticker.includes("SBIN") || ticker.includes("HDFC") || ticker.includes("ICICI");
      if (isLargeCapBank) {
        creditRating = "AAA"; // High Investment Grade / D-SIB Sovereign Anchor
      } else if (latest.netMargin > 0.10) {
        creditRating = "AA";
      } else {
        creditRating = "A+";
      }
    } else {
      creditRating = "BBB-";
    }
  } else if (archetype === "DISTRESSED") {
    // Distressed companies MUST be speculative grade
    if (netDebtToEbitda > 10.0 || isEbitdaNegative) {
      creditRating = "CCC";
    } else if (netDebtToEbitda > 7.0) {
      creditRating = "B-";
    } else {
      creditRating = "B+";
    }
  } else if (archetype === "EARLY_PLATFORM_GROWTH") {
    // Platform growth companies have limited debt but lack positive earnings
    creditRating = totalDebt > 0 ? "BB-" : "Unrated (Growth)";
  } else if (isHospitalitySector) {
    // Hospitality leverage is measured on EBITDAR incl. leases; thresholds looser than manufacturing but tighter than REIT
    // netDebtToEbitda is a proxy (true EBITDAR would be lower leverage); use hospitality-specific grid
    if (netDebtToEbitda < 2.5) creditRating = "A";
    else if (netDebtToEbitda < 4.0) creditRating = "BBB+";
    else if (netDebtToEbitda < 5.5) creditRating = "BBB-";
    else if (netDebtToEbitda < 7.0) creditRating = "BB";
    else creditRating = "B+";
  } else if (archetype === "CYCLICAL_CAPITAL_INTENSIVE") {
    if (netDebtToEbitda < 1.5) creditRating = "AA-";
    else if (netDebtToEbitda < 3.0) creditRating = "A";
    else if (netDebtToEbitda < 4.5) creditRating = "BBB";
    else creditRating = "BB+";
  } else {
    // Mature Compounder
    if (netDebtToEbitda < 0.5 && fcf > 0) creditRating = "AAA";
    else if (netDebtToEbitda < 1.5) creditRating = "AA";
    else creditRating = "A+";
  }

  // ── 5. Calibrate Dividend & Shareholder Yield (Block Hallucinations) ───
  const isDividendPaying = divYield > 0.001 && !isLossMaking && archetype !== "DISTRESSED" && archetype !== "EARLY_PLATFORM_GROWTH";
  let dividendCAGRDisplay = "N/A";
  let buybackYieldDisplay = "None";
  let totalShareholderYieldDisplay = "0.0%";

  if (isFinancialSector && netIncome > 0) {
    if (divYield > 0.005) {
      dividendCAGRDisplay = "+12.0% p.a.";
      buybackYieldDisplay = "None (Capital Conservation)";
      totalShareholderYieldDisplay = `${(divYield * 100).toFixed(1)}% (Cash Dividend)`;
    } else {
      dividendCAGRDisplay = "N/A (Retained for Lending Growth)";
      buybackYieldDisplay = "None";
      totalShareholderYieldDisplay = "0.0% (Reinvested in CET1)";
    }
  } else if (archetype === "DISTRESSED") {
    dividendCAGRDisplay = "N/A (Capital Conservation)";
    buybackYieldDisplay = "None (Debt Restructuring)";
    totalShareholderYieldDisplay = "0.0% (Zero Distribution)";
  } else if (archetype === "EARLY_PLATFORM_GROWTH") {
    totalShareholderYieldDisplay = "0.0% (Platform Growth)";
  } else if (isDividendPaying) {
    const dCagr = Math.min(0.18, Math.max(0.04, divYield * 2.2));
    dividendCAGRDisplay = `${(dCagr * 100).toFixed(1)}% p.a.`;
    const bbYield = divYield * 0.8;
    buybackYieldDisplay = `${(bbYield * 100).toFixed(1)}%`;
    totalShareholderYieldDisplay = `${((divYield + bbYield) * 100).toFixed(1)}%`;
  } else {
    if (netDebt <= 0 && netIncome > 0) {
      // Hard ontology: net-cash alone does not justify forward yield. Must be ROIC-accretive.
      // For TSLA-like net-cash growth names with ROIC deficit (-8.4%), projecting forward yield is a logical misalignment.
      const roicProxy = (latest as any).roic ?? stockData.returnOnAssets ?? (ebitda > 0 && rev > 0 ? (ebitda / Math.max(1, (latest.totalAssets || rev * 1.2))) : 0);
      const lowReturn = roicProxy < 0.08 || (latest.netMargin !== undefined && latest.netMargin < 0.05) || (stockData.returnOnEquity !== undefined && stockData.returnOnEquity < 0.08);
      const isGrowthReinvestment = sector === "auto_manufacturing" || sector === "technology_hardware" || sector === "technology_platform" || archetype === "CYCLICAL_CAPITAL_INTENSIVE" && lowReturn;
      if (lowReturn) {
        // Value deficit: conserve cash, do not project yield
        dividendCAGRDisplay = "0.0% (Conservation — ROIC < WACC)";
        buybackYieldDisplay = "None (Value Deficit)";
        totalShareholderYieldDisplay = "0.0% (Retained — ROIC Deficit)";
      } else if (isGrowthReinvestment) {
        dividendCAGRDisplay = "0.0% (Growth Reinvestment — Zero Payout)";
        buybackYieldDisplay = "None (Reinvestment Priority)";
        totalShareholderYieldDisplay = "0.0% (Reinvested — Growth)";
      } else {
        dividendCAGRDisplay = "0.0% (Post Deleveraging Initiation Runway)";
        buybackYieldDisplay = "None (Historical Restructuring)";
        totalShareholderYieldDisplay = "Forward Yield Projected (Net Cash)";
      }
    } else {
      dividendCAGRDisplay = "N/A (Zero Dividend Track)";
      buybackYieldDisplay = "None";
      totalShareholderYieldDisplay = "0.0%";
    }
  }

  // ── 6. Capital Allocation Label & Commentary ───────────────────────────
  let capitalAllocationLabel = "Standard";
  let capitalAllocationDescription = "";

  if (archetype === "DISTRESSED") {
    capitalAllocationLabel = "Stressed / Capital Conservation";
    // Sector-conditional: carrier language ("spectrum", "telecom") must never
    // leak into non-carrier distressed names (it tripped sector QA on automakers).
    capitalAllocationDescription = sector === "telecom"
      ? `Management's capital allocation charter is constrained by high debt leverage and operational restructuring mandates. Capital priorities are strictly directed toward debt service, essential spectrum and network maintenance, and liquidity preservation, with equity capital distributions completely suspended.`
      : `Management's capital allocation charter is constrained by high debt leverage and operational restructuring mandates. Capital priorities are strictly directed toward debt service, critical operating infrastructure, and liquidity preservation, with equity capital distributions completely suspended.`;
  } else if (sector === "asset_management") {
    capitalAllocationLabel = "Disciplined Capital Return & Fiduciary Stewardship";
    capitalAllocationDescription = `Executive leadership manages capital allocation with an asset-light posture, directing resources toward core investment platform scalability, risk technology enhancements, and consistent shareholder capital returns through regular dividends and programmatic share repurchases.`;
  } else if (archetype === "EARLY_PLATFORM_GROWTH") {
    capitalAllocationLabel = "Growth Reinvestment / Platform Expansion";
    capitalAllocationDescription = sector === "platform_gig_economy"
      ? `The leadership team directs 100% of available capital into customer acquisition, dark store network rollout, technology infrastructure, and fulfillment density. Given platform scaling dynamics, capital distribution is deferred in favor of expanding market share and achieving long-term contribution margin operating leverage.`
      : `The leadership team directs 100% of available capital into customer acquisition, technology infrastructure, and operating scale. Given platform scaling dynamics, capital distribution is deferred in favor of expanding market share and achieving long-term contribution margin operating leverage.`;
  } else if (archetype === "CYCLICAL_CAPITAL_INTENSIVE") {
    if (netDebt <= 0 && netIncome > 0) {
      capitalAllocationLabel = "Disciplined Post-Deleveraging Reinvestment";
      capitalAllocationDescription = `Following comprehensive debt restructuring and full balance sheet deleveraging to a net-cash position, management has transitioned from historical capital conservation to disciplined capacity expansion. While historical distributions were zero under debt covenants, expanded operating cash flows and net-cash liquidity establish the foundation for forward dividend initiation alongside selective manufacturing cluster capex.`;
    } else {
      capitalAllocationLabel = "Disciplined Capital Investment";
      capitalAllocationDescription = `Management balances substantial multi-year project capex with disciplined balance sheet deleveraging. Free cash flows are channeled through prudent capital budgeting hurdles, maintaining leverage within target covenants while providing measured shareholder dividend distributions.`;
    }
  } else if (((stockData.returnOnEquity !== undefined && stockData.returnOnEquity < 0.08) || ((latest as any)?.roic !== undefined && (latest as any).roic < 0.08)) || (latest.netMargin !== undefined && latest.netMargin < 0.03)) {
    capitalAllocationLabel = "Measured / Capital Discipline Under Review";
    capitalAllocationDescription = `Management prioritizes balance sheet preservation and operational hurdle recalibration. Capital deployment is restrained until return on invested capital expands sustainably above the corporate hurdle rate.`;
  } else {
    capitalAllocationLabel = "Exemplary Fiduciary Stewardship";
    capitalAllocationDescription = `Executive management exhibits conservative capital stewardship, pairing high return on invested capital (ROIC) with disciplined capital return via steady dividend compounding and opportunistic counter-cyclical share repurchases.`;
  }

  // ── 7. Valuation Anchor ───────────────────────────────────────────────
  let valuationAnchor = "DCF Intrinsic Enterprise Value";
  if (archetype === "DISTRESSED") {
    valuationAnchor = "Recovery Value / Adjusted EV-to-EBITDA";
  } else if (archetype === "EARLY_PLATFORM_GROWTH") {
    valuationAnchor = "EV / Gross Order Value (GOV) & Contribution Margin DCF";
  }

  // ── 8. Monotonic Scenario Margins (Strictly Prevent Inversion) ─────────
  // Base margin is grounded in the company's real margin construct: EBITDA margin
  // for corporates/banks (bank zero preserved exactly), operating margin for
  // fee franchises (meaningful there), rental net margin for REITs, net margin
  // for insurers. Shapes without a margin construct fall back to 0.18.
  const scenarioMarginBasis = isAssetLightStatement(latest)
    ? latest.operatingMargin
    : isReitStatement(latest)
      ? (rev > 0 ? latest.netIncome / rev : undefined)
      : isInsuranceStatement(latest)
        ? latest.netMargin
        : stmtNum(latest, "ebitdaMargin", Number.NaN);
  const baseMargin = scenarioMarginBasis !== undefined && Number.isFinite(scenarioMarginBasis)
    ? scenarioMarginBasis
    : 0.18;
  let bearMargin: number;
  let bullMargin: number;

  if (baseMargin <= 0) {
    // Negative margin company (e.g. Swiggy -13.7%)
    bearMargin = Math.round((baseMargin - 0.055) * 1000) / 1000;
    bullMargin = Math.round(Math.min(0.045, baseMargin + 0.085) * 1000) / 1000;
  } else if (baseMargin < 0.10) {
    bearMargin = Math.round(Math.max(-0.02, baseMargin * 0.65) * 1000) / 1000;
    bullMargin = Math.round((baseMargin * 1.45) * 1000) / 1000;
  } else {
    bearMargin = Math.round((baseMargin * 0.75) * 1000) / 1000;
    bullMargin = Math.round((baseMargin * 1.25) * 1000) / 1000;
  }

  // Guarantee strict monotonicity: Bear < Base < Bull
  if (bearMargin >= baseMargin) bearMargin = baseMargin - 0.03;
  if (bullMargin <= baseMargin) bullMargin = baseMargin + 0.03;

  return {
    archetype,
    sector,
    creditRating,
    isDividendPaying,
    dividendCAGRDisplay,
    buybackYieldDisplay,
    totalShareholderYieldDisplay,
    capitalAllocationLabel,
    capitalAllocationDescription,
    valuationAnchor,
    scenarioMargins: {
      bearMargin,
      baseMargin,
      bullMargin,
      bearMarginDisplay: `${(bearMargin * 100).toFixed(1)}%`,
      baseMarginDisplay: `${(baseMargin * 100).toFixed(1)}%`,
      bullMarginDisplay: `${(bullMargin * 100).toFixed(1)}%`,
    },
  };
}
