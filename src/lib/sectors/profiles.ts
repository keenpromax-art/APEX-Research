/**
 * APEX RESEARCH - Comprehensive Sector Profiles & Ontology
 * 
 * Strict Financial Invariant:
 * Sector leakage is strictly prohibited.
 * NBFCs must never mention CASA, ARPU, or manufacturing downtime.
 * IT companies must never report loan loss provisions or plant utilization.
 */

import { SectorId, SectorProfile } from "./types";

export const BANK_PROFILE: SectorProfile = {
  id: "bank",
  name: "Commercial & Retail Banking",
  allowedKPIs: [
    "CASA Ratio",
    "Net Interest Margin (NIM)",
    "Gross Non-Performing Assets (GNPA)",
    "Net Non-Performing Assets (NNPA)",
    "Provision Coverage Ratio (PCR)",
    "Cost-to-Income Ratio",
    "Capital Adequacy Ratio (CRAR / Tier-1)",
    "Return on Assets (ROA)",
    "Return on Equity (ROE)",
    "Credit Cost"
  ],
  preferredValuationModels: ["PB_RESIDUAL_INCOME", "MULTIPLES_PB", "DDM", "MULTIPLES_PE"],
  financialMetrics: ["Net Interest Income", "Non-Interest Income", "Provisions", "Advances", "Deposits", "Net Worth"],
  riskCategories: ["Asset Quality Shock", "Margin Compression", "Regulatory Liquidity Standards", "Credit Migration"],
  moatDrivers: ["Low-cost CASA deposit franchise", "Underwriting risk discipline", "Branch density and digital banking reach"],
  forbiddenConcepts: [
    "arpu", "4g/5g", "spectrum auction", "tower deployment", "subscriber churn",
    "semiconductor fab", "wafer capacity", "refinery throughput", "crack spread",
    "clinical trial", "fda 483", "plant turnaround", "dark stores", "gross merchandise value"
  ],
  isFinancialInstitution: true,
  standardMarginMetric: "NIM"
};

export const NBFC_PROFILE: SectorProfile = {
  id: "nbfc",
  name: "Non-Banking Financial Company & Microfinance",
  allowedKPIs: [
    "Assets Under Management (AUM)",
    "AUM Growth",
    "Net Interest Margin (NIM) / Spread",
    "Gross Stage-3 Assets (GNPA)",
    "Net Stage-3 Assets (NNPA)",
    "Provision Coverage",
    "Credit Costs",
    "Collection Efficiency",
    "Cost of Borrowing",
    "Capital Adequacy (CRAR)"
  ],
  preferredValuationModels: ["PB_RESIDUAL_INCOME", "MULTIPLES_PB", "MULTIPLES_PE", "DDM"],
  financialMetrics: ["Net Interest Income", "Total AUM", "Disbursements", "Borrowings", "Provisions", "Tangible Net Worth"],
  riskCategories: ["Borrower Overleveraging", "Collection Disruptions", "Wholesale Liquidity Tightening", "Asset-Liability Mismatch"],
  moatDrivers: ["Proprietary credit underwriting data", "Grassroots rural distribution network", "Diversified institutional funding lines"],
  forbiddenConcepts: [
    "casa", "casa ratio", "current account savings account", // NBFCs cannot accept demand deposits / CASA!
    "arpu", "4g/5g", "spectrum", "telecom towers", "subscriber churn",
    "wafer fab", "refinery margin", "plant turnaround", "clinical trials", "anda approvals", "dark stores"
  ],
  isFinancialInstitution: true,
  standardMarginMetric: "Net Spread"
};

export const INSURANCE_PROFILE: SectorProfile = {
  id: "insurance",
  name: "Life & General Insurance",
  allowedKPIs: [
    "Value of New Business (VNB)",
    "VNB Margin",
    "Embedded Value (EV)",
    "Operating Return on EV (ROEV)",
    "Combined Ratio",
    "Loss Ratio",
    "Expense Ratio",
    "Persistency Ratio (13th Month / 61st Month)",
    "Solvency Margin / Solvency Ratio",
    "Gross Written Premium (GWP)",
    "Net Premium Earned",
    "Investment Yield on Float"
  ],
  preferredValuationModels: ["PB_RESIDUAL_INCOME", "DDM", "MULTIPLES_PB", "MULTIPLES_PE"],
  financialMetrics: ["Gross Written Premium", "Net Premium Earned", "Policyholder Float", "Claims Paid", "Underwriting Profit", "Net Worth / Embedded Value"],
  riskCategories: ["Mortality / Catastrophe Shock", "Interest Rate Mismatch on Policy Liabilities", "Regulatory Solvency Requirements", "Investment Portfolio Credit Risk"],
  moatDrivers: ["Agency distribution network & bancassurance partnerships", "Actuarial underwriting pricing discipline", "Massive low-cost policyholder float"],
  forbiddenConcepts: [
    "casa", "casa ratio", "spectrum", "4g/5g", "arpu", "telecom towers",
    "semiconductor fab", "wafer capacity", "refinery throughput", "crack spread", "clinical trial"
  ],
  isFinancialInstitution: true,
  standardMarginMetric: "Underwriting Margin"
};

export const RATINGS_AGENCY_PROFILE: SectorProfile = {
  id: "ratings-agency",
  name: "Credit Rating & Financial Intelligence",
  allowedKPIs: [
    "Ratings Coverage Universe",
    "Recurring Subscription Revenue %",
    "Bond & Commercial Paper Volume Rated",
    "Operating EBITDA Margin",
    "FCF to Net Income Conversion",
    "Research & Analytics TCV",
    "Return on Equity (ROE)"
  ],
  preferredValuationModels: ["PB_RESIDUAL_INCOME", "DDM", "MULTIPLES_PE", "FCFF_DCF"],
  financialMetrics: ["Rating Fee Revenue", "Research & Analytics Revenue", "Operating Income", "Net Income", "Net Worth", "Operating Cash Flow"],
  riskCategories: ["Corporate Bond Issuance Slowdown", "Regulatory Scrutiny on Rating Methodologies", "Reputational Risk from Default Surprises"],
  moatDrivers: ["Regulatory licensing moats (NRSRO / SEBI CRA accreditation)", "Brand trust and market convention pricing power", "Zero-capex high-ROIC operating leverage"],
  forbiddenConcepts: [
    "gnpa", "nnpa", "casa", "loan book", "credit cost", "nim",
    "refinery crack", "clinical trial", "plant turnaround", "spectrum"
  ],
  isFinancialInstitution: true,
  standardMarginMetric: "Operating Margin"
};

export const ASSET_MANAGEMENT_PROFILE: SectorProfile = {
  id: "asset-management",
  name: "Asset & Wealth Management",
  allowedKPIs: [
    "Assets Under Management (AUM)",
    "AUM Net Inflows / Organic Growth",
    "Base Fee Realization Rate (bps)",
    "Performance Fees",
    "Technology Services (Aladdin) Revenue",
    "Fee-Related Earnings (FRE) Margin",
    "Adjusted Operating Margin",
    "Free Cash Flow Conversion",
    "Return on Equity (ROE)"
  ],
  preferredValuationModels: ["FCFF_DCF", "MULTIPLES_PE", "EV_EBITDA", "DDM"],
  financialMetrics: ["Investment Advisory Fees", "Performance Fees", "Technology Services Revenue", "Operating Income", "Net Income", "Free Cash Flow"],
  riskCategories: ["Market-Driven AUM Contraction", "Passive Index Fee Compression", "Institutional Mandate Redemptions", "Regulatory Fiduciary Oversight"],
  moatDrivers: ["Entrenched institutional fiduciary relationships", "Multi-decade asset allocation track record", "Scale operating leverage & Aladdin technology platform ecosystem"],
  forbiddenConcepts: [
    "casa", "casa ratio", "casa deposits", "current account savings account", "demand deposits", "deposit mobilization",
    "net interest margin", "nim", "loan book", "credit cost", "loan underwriting", "branch banking",
    "gross non-performing assets", "gnpa", "nnpa", "stage-3 assets", "credit provisioning",
    "banking charter", "loan repricing", "basel-iii", "tier-ii bonds", "rbi",
    "assembly line", "assembly lines", "production facilities", "manufacturing overhead", "plant and equipment", "factory", "refinery"
  ],
  isFinancialInstitution: false,
  standardMarginMetric: "Operating Margin"
};

export const IT_SERVICES_PROFILE: SectorProfile = {
  id: "it-services",
  name: "IT Services & Software Consulting",
  allowedKPIs: [
    "Constant Currency Revenue Growth",
    "Operating / EBIT Margin",
    "Large Deal Total Contract Value (TCV)",
    "Voluntary Attrition Rate (LTM)",
    "Blended Utilization Rate",
    "Offshore / Onsite Effort Mix",
    "FCF to Net Income Conversion",
    "Revenue per Employee",
    "Client Concentration (Top 5 / Top 10)"
  ],
  preferredValuationModels: ["FCFF_DCF", "MULTIPLES_PE", "EV_EBITDA"],
  financialMetrics: ["EBIT", "NOPAT", "Free Cash Flow", "DSO (Days Sales Outstanding)", "Net Cash Reserves"],
  riskCategories: ["US/European Enterprise Tech Spending Cutbacks", "Wage Inflation & Talent Attrition", "Disruptive GenAI Delivery Shifts", "FX Volatility"],
  moatDrivers: ["Mission-critical client stickiness & switching costs", "Deep enterprise domain expertise", "Global delivery scale"],
  forbiddenConcepts: [
    "gnpa", "nnpa", "casa", "loan book", "credit cost", "nim", "provisions for bad debt",
    "spectrum", "4g/5g", "refinery crack", "plant utilization", "clinical trials"
  ],
  isFinancialInstitution: false,
  standardMarginMetric: "Operating Margin"
};

export const PHARMA_PROFILE: SectorProfile = {
  id: "pharma",
  name: "Pharmaceuticals & Healthcare",
  allowedKPIs: [
    "R&D Spend as % of Revenue",
    "Domestic Formulations Growth",
    "US Generics Sales",
    "ANDA Approvals & Pipeline",
    "Gross Margin",
    "USFDA Regulatory Compliance Status",
    "Active Pharmaceutical Ingredients (API) Share"
  ],
  preferredValuationModels: ["FCFF_DCF", "EV_EBITDA", "MULTIPLES_PE"],
  financialMetrics: ["Gross Profit", "EBITDA", "R&D Expense", "Capex", "Operating Cash Flow"],
  riskCategories: ["USFDA Import Alerts / Warning Letters", "US Generic Price Erosion", "Patent Cliff Expirations", "Raw Material Active Ingredient Inflation"],
  moatDrivers: ["Complex generic & biosimilar barriers to entry", "Proprietary drug delivery patents", "Established doctor prescription brands"],
  forbiddenConcepts: [
    "casa", "nim", "gnpa", "credit cost", "aum", "arpu", "spectrum auction", "wafer fab", "dark stores",
    "enterprise contract", "master service agreement", "software services", "cloud subscription", "assembly line"
  ],
  isFinancialInstitution: false,
  standardMarginMetric: "EBITDA Margin"
};

export const CONSUMER_PROFILE: SectorProfile = {
  id: "consumer",
  name: "Fast Moving Consumer Goods & HPC",
  allowedKPIs: [
    "Volume Growth",
    "Underlying Volume Growth (UVG)",
    "Domestic Volume Growth",
    "Gross Margin Expansion",
    "Brand Investment (A&P % of Sales)",
    "Direct Rural & Urban Distribution Reach",
    "Portfolio Premiumization Mix",
    "Working Capital Cash Conversion Cycle",
    "Return on Invested Capital (ROIC)"
  ],
  preferredValuationModels: ["FCFF_DCF", "MULTIPLES_PE", "EV_EBITDA"],
  financialMetrics: ["Revenue", "Gross Profit", "A&P Spend", "EBITDA", "Free Cash Flow", "Working Capital"],
  riskCategories: ["Agri Commodity Input Inflation", "Rural Demand Deceleration", "Regional Competitor Discounting", "Modern Trade / Quick Commerce Squeeze"],
  moatDrivers: ["Iconic consumer brand recall & pricing power", "Deep multi-tier retail distribution reach", "Raw material copra/palm oil procurement scale"],
  forbiddenConcepts: [
    "casa", "nim", "gnpa", "credit cost", "arpu", "spectrum auction", "clinical trials", "anda filings",
    "enterprise contract", "master service agreement", "software services", "cloud migration", "foundry", "wafer"
  ],
  isFinancialInstitution: false,
  standardMarginMetric: "EBITDA Margin"
};

export const INTERNET_RETAIL_PROFILE: SectorProfile = {
  id: "internet-retail",
  name: "Internet Retail, Food Delivery & Quick Commerce",
  allowedKPIs: [
    "Gross Merchandise Value (GMV)",
    "Order Volume & Frequency",
    "Average Order Value (AOV)",
    "Take Rate / Commission %",
    "Average Revenue Per User (ARPU)",
    "Delivery Cost per Order",
    "Logistics & Fulfillment Intensity",
    "Food Delivery & Quick Commerce Margin",
    "Consumer Incentive Spend",
    "App Active Users / Frequency"
  ],
  preferredValuationModels: ["EV_EBITDA", "FCFF_DCF", "MULTIPLES_PE"],
  financialMetrics: ["GMV", "Revenue", "Order Fulfillment Cost", "Marketing & Incentive Spend", "EBITDA", "Free Cash Flow"],
  riskCategories: ["Delivery Partner Supply Scarcity", "Regulation on Gig Worker Benefits", "Quick Commerce Margin Squeeze", "Food Delivery Discount War"],
  moatDrivers: ["Network effects in order density", "Last-mile logistics efficiency", "Dual food delivery & quick commerce ecosystem"],
  forbiddenConcepts: [
    "casa", "nim", "gnpa", "credit cost", "aum", "spectrum auction", "clinical trials", "anda filings",
    "wafer fab", "refinery throughput", "crack spread", "plant turnaround", "agri commodity",
    "copra", "palm oil procurement", "packaged goods", "personal care", "brand recall",
    "iconic consumer brand", "multi-tier retail distribution", "fmcg", "modern trade"
  ],
  isFinancialInstitution: false,
  standardMarginMetric: "EBITDA Margin"
};

export const INTERNET_PLATFORM_PROFILE: SectorProfile = {
  id: "internet-platform",
  name: "Internet Platform, Social Media & Digital Advertising",
  allowedKPIs: [
    "Family of Apps Advertising Revenue Growth",
    "Average Revenue Per User (ARPU) - Digital Advertising",
    "Daily Active Users (DAU)",
    "Monthly Active Users (MAU)",
    "Ad Impressions Growth",
    "Average Price per Ad Growth",
    "Operating Margin",
    "Free Cash Flow Conversion",
    "Reality Labs Operating Loss",
    "Data Center & AI Infrastructure Capex Intensity",
    "Return on Invested Capital (ROIC)"
  ],
  preferredValuationModels: ["FCFF_DCF", "EV_EBITDA", "MULTIPLES_PE"],
  financialMetrics: ["Advertising Revenue", "Reality Labs Revenue", "Reality Labs Operating Loss", "Operating Income", "Data Center & AI Capex", "Operating Cash Flow", "Free Cash Flow"],
  riskCategories: ["Digital Advertising Spend Cyclicality", "Data Privacy & Antitrust Regulation", "AI Infrastructure Capex Intensity", "Reality Labs Loss Drag"],
  moatDrivers: ["Global social network effects across Family of Apps", "Proprietary ad targeting data and measurement scale", "Massive AI and data-center infrastructure scale"],
  forbiddenConcepts: [
    "casa", "casa ratio", "current account savings account", "net interest margin", "nim",
    "loan book", "credit cost", "gross non-performing assets", "gnpa", "nnpa",
    "spectrum auction", "spectrum", "4g/5g", "tower deployment", "tower tenancy",
    "telecom towers", "telecom tower", "subscriber churn", "agr dues",
    "copra", "palm oil procurement", "packaged goods", "personal care", "brand recall",
    "iconic consumer brand", "multi-tier retail distribution", "fmcg", "modern trade",
    "kirana", "underlying volume growth", "uvg",
    "wafer fab", "wafer fabrication", "wafer capacity", "semiconductor fab", "foundry capacity", "foundry",
    "refinery throughput", "refinery margin", "refinery crack", "refinery", "crack spread",
    "clinical trial", "clinical trials", "fda 483", "us fda", "anda approvals", "anda filings",
    "cgmp", "dark stores", "dark store", "gross merchandise value", "take rate",
    "plant turnaround", "plant utilization", "refinery"
  ],
  isFinancialInstitution: false,
  standardMarginMetric: "Operating Margin"
};

export const AUTO_PROFILE: SectorProfile = {
  id: "auto",
  name: "Automotive OEMs, EVs & Auto Components",
  allowedKPIs: [
    "Vehicle Deliveries (units)",
    "Average Selling Price (ASP) per Vehicle",
    "Automotive Gross Margin ex-Regulatory Credits",
    "Regulatory Credit Revenue",
    "Energy Storage Deployments (MWh)",
    "Operating Margin",
    "Free Cash Flow Conversion",
    "China Mix & Shanghai Output",
    "Supercharger / Services Revenue",
    "Return on Invested Capital (ROIC)"
  ],
  preferredValuationModels: ["FCFF_DCF", "EV_EBITDA", "MULTIPLES_PE"],
  financialMetrics: ["Automotive Sales Revenue", "Regulatory Credit Revenue", "Energy Generation & Storage Revenue", "Services Revenue", "Operating Income", "Manufacturing Capex", "Operating Cash Flow", "Free Cash Flow"],
  riskCategories: ["EV Price-War & ASP Erosion", "China Demand & Competition", "Autonomy Regulation (FSD/Robotaxi)", "Battery Cost & 4680 Ramp"],
  moatDrivers: ["Manufacturing scale and vertical integration (gigafactories)", "Software-defined vehicle stack and fleet data scale", "Charging network and brand pull"],
  forbiddenConcepts: [
    "casa", "casa ratio", "current account savings account", "net interest margin", "nim",
    "loan book", "loan books", "credit cost", "credit costs", "gross non-performing assets", "gnpa", "nnpa", "credit provisioning",
    "deposits", "deposit", "branch", "branches", "branch banking", "loan repricing", "net interest", "interest margin",
    "spectrum auction", "spectrum", "4g/5g", "tower deployment", "tower tenancy", "tower", "towers",
    "telecom towers", "telecom tower", "subscriber churn", "subscriber", "agr dues", "ran", "bandwidth", "arpu",
    "master service agreement", "total contract value", "tcv", "saas churn", "arr expansion",
    "cloud subscription churn", "enterprise contract", "software services", "deal signing cycles", "deal signing",
    "discretionary consulting", "offshore", "onsite effort",
    "copra", "palm oil procurement", "packaged goods", "personal care", "brand recall",
    "iconic consumer brand", "multi-tier retail distribution", "fmcg", "modern trade",
    "wafer fab", "wafer fabrication", "foundry capacity", "semiconductor fab",
    "refinery throughput", "refinery margin", "refinery crack", "refinery", "crack spread",
    "order backlog", "order book", "tender", "tendering", "bidding", "commodity", "commodities", "feedstock", "feedstocks",
    "clinical trial", "clinical trials", "fda 483", "us fda", "anda approvals", "anda filings",
    "dark stores", "dark store", "gross merchandise value", "take rate",
    "plant turnaround", "plant utilization"
  ],
  isFinancialInstitution: false,
  standardMarginMetric: "Operating Margin"
};

export const RENEWABLE_ENERGY_PROFILE: SectorProfile = {
  id: "renewable-energy",
  name: "Renewable Energy & Equipment",
  allowedKPIs: [
    "Order Book Execution Pipeline (MW)",
    "Wind / Solar Turbine Deliveries (MW)",
    "Fleet Operations & Maintenance (O&M) Capacity",
    "Plant Load Factor (PLF)",
    "Working Capital Days",
    "Steel & Commodity Pass-Through Coverage",
    "Net Debt to EBITDA"
  ],
  preferredValuationModels: ["FCFF_DCF", "EV_EBITDA", "MULTIPLES_PE"],
  financialMetrics: ["EBITDA", "O&M High-Margin Service Revenue", "Order Inflows", "Net Working Capital", "Net Debt"],
  riskCategories: ["Discom PPA Renegotiation & Payment Delays", "Grid Evacuation Infrastructure Bottlenecks", "Raw Material Steel/Resin Price Spikes"],
  moatDrivers: ["Dominant multi-gigawatt installed base with recurring 20-year O&M service annuities", "Indigenous supply chain scale"],
  forbiddenConcepts: [
    "casa", "nim", "credit cost", "arpu", "telecom towers", "clinical trials", "anda filings", "dark stores"
  ],
  isFinancialInstitution: false,
  standardMarginMetric: "EBITDA Margin"
};

export const TELECOM_PROFILE: SectorProfile = {
  id: "telecom",
  name: "Telecommunications & Wireless Services",
  allowedKPIs: [
    "Average Revenue Per User (ARPU)",
    "Subscriber Net Additions",
    "Data Usage per Subscriber (GB/month)",
    "Blended Monthly Churn Rate",
    "4G/5G Network Cell Site Count",
    "Capex to Sales Intensity",
    "Net Debt to EBITDA"
  ],
  preferredValuationModels: ["EV_EBITDA", "FCFF_DCF", "MULTIPLES_PE"],
  financialMetrics: ["Service Revenue", "EBITDA", "Spectrum Amortization", "Network Operating Costs", "Gross Debt"],
  riskCategories: ["Intense Price Competition", "Massive 5G Capex Burden", "Spectrum Regulatory Fees & AGR Dues"],
  moatDrivers: ["Oligopolistic spectrum holdings", "Massive nationwide cell tower & fiber backhaul footprint"],
  forbiddenConcepts: [
    "casa", "nim", "loan book", "credit cost", "clinical trials", "anda approvals", "wafer fabrication"
  ],
  isFinancialInstitution: false,
  standardMarginMetric: "EBITDA Margin"
};

export const INDUSTRIAL_PROFILE: SectorProfile = {
  id: "industrial",
  name: "Capital Goods, Manufacturing & Industrials",
  allowedKPIs: [
    "Order Inflow Growth",
    "Order Book-to-Bill Ratio",
    "Capacity Utilization Rate",
    "Gross Margin Resilience",
    "Working Capital as % of Sales",
    "Return on Capital Employed (ROCE)",
    "FCF Conversion"
  ],
  preferredValuationModels: ["FCFF_DCF", "EV_EBITDA", "MULTIPLES_PE"],
  financialMetrics: ["Revenue", "EBITDA", "Capex", "Capital Employed", "Free Cash Flow"],
  riskCategories: ["Private Capex Cycle Deceleration", "Commodity Raw Material Surges", "Project Execution Delays"],
  moatDrivers: ["High engineering switching costs", "Long-term client qualification accreditations", "Manufacturing scale economies"],
  forbiddenConcepts: [
    "casa", "nim", "gnpa", "credit cost", "arpu", "spectrum auction", "clinical trials", "dark stores"
  ],
  isFinancialInstitution: false,
  standardMarginMetric: "EBITDA Margin"
};

export const UTILITIES_PROFILE: SectorProfile = {
  id: "utilities",
  name: "Power Generation, Transmission & Regulated Utilities",
  allowedKPIs: [
    "Generation Capacity (MW)",
    "Plant Load Factor (PLF)",
    "Availability Factor (PAF)",
    "Regulated Return on Equity (ROE)",
    "Power Purchase Agreement (PPA) Tenor",
    "Tariff Realization (Rs/kWh)",
    "Transmission Line Network (ckm)",
    "Regulated Capital Expenditure",
    "Fuel Supply Agreement Coverage"
  ],
  preferredValuationModels: ["FCFF_DCF", "EV_EBITDA", "MULTIPLES_PE"],
  financialMetrics: ["Regulated Equity", "Capex CWIP", "EBITDA", "Operating Cash Flow", "Interest Expense", "Net Debt"],
  riskCategories: ["Discom Counterparty Payment Delays", "Fuel Supply Agreement / Coal Linkage Disruption", "Regulatory Tariff Order Disallowances", "PPA Renegotiation Risks"],
  moatDrivers: ["Long-term 25-year PPAs with two-part regulated cost-plus tariff structures", "Irreplaceable transmission right-of-way (RoW) corridors", "Guaranteed 15.5% regulated ROE framework"],
  forbiddenConcepts: [
    "dealer network", "dealer networks", "manufacturing line", "manufacturing lines",
    "assembly line", "assembly-line", "enterprise contract", "enterprise contracts",
    "customer workflow", "customer workflows", "aftermarket reach", "contract manufacturing",
    "tier-1 qualification", "dark stores", "casa", "nim", "gnpa", "spectrum auction"
  ],
  isFinancialInstitution: false,
  standardMarginMetric: "EBITDA Margin"
};

export const AGROCHEMICAL_PROFILE: SectorProfile = {
  id: "agrochemical",
  name: "Agrochemicals, Crop Protection & Speciality Inputs",
  allowedKPIs: [
    "Active Ingredients (AI) Volume Growth",
    "Molecules Registration Pipeline",
    "Crop Exposure Diversification",
    "Channel Inventory Days",
    "Technical Grade Realization",
    "Formulations Share %",
    "Biologicals & Green Chemistry Share",
    "Working Capital Cycle"
  ],
  preferredValuationModels: ["FCFF_DCF", "EV_EBITDA", "MULTIPLES_PE"],
  financialMetrics: ["Revenue", "Gross Profit", "EBITDA", "Working Capital", "R&D Expense", "Operating Cash Flow"],
  riskCategories: ["Monsoon Deficits & Spatial Rain Disparity", "High Channel Inventory & Distributor Destocking", "Red Sea / Raw Material Chemical Price Swings", "Generic Molecule Price Erosion from China"],
  moatDrivers: ["Proprietary molecule patent registrations & CRAMS synthesis contracts", "Multi-tier distributor channel stickiness & farmer brand trust", "Deep chemical synthesis infrastructure & cGMP/EHS clearances"],
  forbiddenConcepts: [
    "dealer network for automobiles", "assembly line", "assembly-line", "assembly-line automation",
    "enterprise contract", "enterprise contracts", "software services", "cloud subscription",
    "software automation", "product architecture", "localized talent delivery networks",
    "customer maintenance contracts", "automated delivery expansion", "proprietary frameworks",
    "casa", "nim", "gnpa", "spectrum auction", "dark stores", "dark store", "telecom towers"
  ],
  isFinancialInstitution: false,
  standardMarginMetric: "EBITDA Margin"
};

export const CEMENT_PROFILE: SectorProfile = {
  id: "cement",
  name: "Cement & Building Materials",
  allowedKPIs: [
    "Sales Volume (MTPA)",
    "Cement Realization per Tonne",
    "EBITDA per Tonne",
    "Clinker Capacity Utilization",
    "Power & Fuel Cost per Tonne",
    "Freight & Logistics Cost per Tonne",
    "Green Power / WHRS Share",
    "Blended Cement Ratio"
  ],
  preferredValuationModels: ["EV_EBITDA", "FCFF_DCF", "MULTIPLES_PE"],
  financialMetrics: ["Volume (MT)", "Net Realization", "EBITDA", "Capex per MTPA", "Freight Expense", "Power & Fuel"],
  riskCategories: ["Petcoke & Imported Coal Price Volatility", "Regional Capacity Clinker Additions & Price Wars", "Railway Freight Tariff Hikes", "Infrastructure Capex Slowdowns"],
  moatDrivers: ["Captive limestone mine reserves & long-term mining leases", "Strategic lead-distance logistics advantage (grinding unit radius)", "Brand equity across trade retail networks"],
  forbiddenConcepts: [
    "software services", "cloud subscription", "enterprise contract", "enterprise contracts",
    "dark stores", "casa", "nim", "gnpa", "spectrum auction", "clinical trials", "anda filings"
  ],
  isFinancialInstitution: false,
  standardMarginMetric: "EBITDA Margin"
};

export const GENERAL_PROFILE: SectorProfile = {
  id: "general",
  name: "General Corporate Equities",
  allowedKPIs: [
    "Revenue Growth",
    "EBITDA Margin",
    "Net Margin",
    "Return on Equity (ROE)",
    "Return on Capital Employed (ROCE)",
    "Debt to Equity",
    "Current Ratio",
    "Free Cash Flow"
  ],
  preferredValuationModels: ["FCFF_DCF", "EV_EBITDA", "MULTIPLES_PE"],
  financialMetrics: ["Revenue", "EBITDA", "Operating Income", "Net Income", "Total Debt", "Free Cash Flow"],
  riskCategories: ["Demand Softening", "Competitive Pricing Pressure", "Input Cost Inflation", "Macro Volatility"],
  moatDrivers: ["Brand recognition", "Distribution channels", "Operating cost efficiencies"],
  forbiddenConcepts: [],
  isFinancialInstitution: false,
  standardMarginMetric: "EBITDA Margin"
};

/**
 * Shared company-type predicates — SINGLE source of truth for the
 * platform-vs-carrier distinction. classifySector, classifyArchetype, the
 * ledger moat classifier, and the peer router MUST all use these; divergent
 * inline copies previously routed META to three different sectors at once.
 */
export function isInternetPlatformCompany(
  sector?: string,
  industry?: string,
  description?: string,
  name?: string
): boolean {
  const industryLower = `${industry || ""}`.toLowerCase();
  if (
    industryLower.includes("internet content") ||
    industryLower.includes("internet media") ||
    industryLower.includes("social media") ||
    industryLower.includes("social network") ||
    industryLower.includes("online advertising") ||
    industryLower.includes("digital advertising") ||
    industryLower.includes("interactive media")
  ) {
    return true;
  }
  const combined = `${sector || ""} ${industry || ""} ${description || ""} ${name || ""}`.toLowerCase();
  return (
    combined.includes("family of apps") ||
    combined.includes("reality labs") ||
    combined.includes("daily active users") ||
    combined.includes("monthly active users") ||
    combined.includes("ad impressions") ||
    combined.includes("average price per ad") ||
    combined.includes("meta platforms") ||
    combined.includes("facebook") ||
    combined.includes("instagram") ||
    combined.includes("whatsapp")
  );
}

/** Telecom CARRIERS only. Internet platforms are excluded even when their
 * sector string says "Communication Services". */
export function isTelecomCarrierCompany(
  sector?: string,
  industry?: string,
  description?: string,
  name?: string
): boolean {
  if (isInternetPlatformCompany(sector, industry, description, name)) return false;
  const combined = `${sector || ""} ${industry || ""} ${description || ""} ${name || ""}`.toLowerCase();
  return (
    combined.includes("telecom") ||
    combined.includes("wireless") ||
    combined.includes("cellular") ||
    combined.includes("telecommunications service") ||
    combined.includes("vodafone idea") ||
    combined.includes("spectrum auction") ||
    combined.includes("agr dues")
  );
}

/**
 * Classify a company into its authoritative SectorProfile.
 */
export function classifySector(
  sector?: string,
  industry?: string,
  description?: string
): SectorProfile {
  const combined = `${sector || ""} ${industry || ""} ${description || ""}`.toLowerCase();

  // 1. NBFC & Microfinance
  if (
    combined.includes("microfinance") ||
    combined.includes("nbfc") ||
    combined.includes("consumer finance") ||
    combined.includes("rural lending") ||
    combined.includes("spandana") ||
    combined.includes("housing finance")
  ) {
    return NBFC_PROFILE;
  }

  // 2. Insurance (Life, General, Health, Reinsurance)
  if (
    combined.includes("insurance") ||
    combined.includes("life assurance") ||
    combined.includes("general insurance") ||
    combined.includes("reinsurance") ||
    combined.includes("icici pru life") ||
    combined.includes("hdfc life") ||
    combined.includes("sbi life") ||
    combined.includes("max financial") ||
    combined.includes("star health") ||
    combined.includes("gic re") ||
    combined.includes("new india assurance")
  ) {
    return INSURANCE_PROFILE;
  }

  // 3. Credit Rating Agencies & Capital Markets Research Intelligence
  if (
    combined.includes("rating agency") ||
    combined.includes("credit rating") ||
    combined.includes("ratings agency") ||
    combined.includes("financial intelligence") ||
    combined.includes("crisil") ||
    combined.includes("icra") ||
    combined.includes("care ratings") ||
    combined.includes("moody's") ||
    combined.includes("s&p global") ||
    combined.includes("fitch")
  ) {
    return RATINGS_AGENCY_PROFILE;
  }

  // 4. Asset & Wealth Management
  if (
    combined.includes("asset management") ||
    combined.includes("wealth management") ||
    combined.includes("investment management") ||
    combined.includes("blackrock") ||
    combined.includes("amc") ||
    combined.includes("fund manager") ||
    combined.includes("asset manager")
  ) {
    return ASSET_MANAGEMENT_PROFILE;
  }

  // 5. Commercial Banking
  if (
    !combined.includes("asset management") &&
    !combined.includes("wealth management") &&
    (combined.includes("bank") ||
    (combined.includes("financial services") && combined.includes("deposit")))
  ) {
    return BANK_PROFILE;
  }

  // 3. IT Services & Software Consulting
  if (
    combined.includes("information technology") ||
    combined.includes("it services") ||
    combined.includes("software consulting") ||
    combined.includes("computer systems") ||
    combined.includes("infosys") ||
    combined.includes("tcs") ||
    combined.includes("wipro")
  ) {
    return IT_SERVICES_PROFILE;
  }

  // 4. Power Generation, Transmission & Regulated Utilities
  if (
    (sector && sector.toLowerCase().includes("utilit")) ||
    (industry && industry.toLowerCase().includes("utilit")) ||
    combined.includes("electric utility") ||
    combined.includes("power generation") ||
    combined.includes("electricity generation") ||
    combined.includes("transmission network") ||
    combined.includes("powergrid") ||
    combined.includes("ntpc") ||
    combined.includes("tata power") ||
    combined.includes("adani power") ||
    combined.includes("jsw energy")
  ) {
    return UTILITIES_PROFILE;
  }

  // 5. Renewable Energy Equipment & Independent Green Developers
  if (
    combined.includes("suzlon") ||
    combined.includes("wind turbine") ||
    combined.includes("solar panel") ||
    combined.includes("clean energy developer") ||
    (combined.includes("renewable") && !combined.includes("utility"))
  ) {
    return RENEWABLE_ENERGY_PROFILE;
  }

  // 5. Pharmaceuticals
  if (
    combined.includes("pharma") ||
    combined.includes("biotech") ||
    combined.includes("healthcare") ||
    combined.includes("drug") ||
    combined.includes("cipla")
  ) {
    return PHARMA_PROFILE;
  }

  // 5b. Internet Platform, Social Media & Digital Advertising.
  // MUST be evaluated BEFORE telecom and consumer FMCG: Communication Services
  // covers both telecom carriers AND internet platforms, and platform descriptions
  // legitimately contain the substring "consumer" (e.g. Meta's "consumer hardware"
  // + Reality Labs). Without this guard, Meta mis-routes to FMCG/telecom templates.
  // Shared helper below — ledger moat, archetype, and peer router MUST use it too.
  const isInternetPlatformSignal = isInternetPlatformCompany(sector, industry, description);
  if (isInternetPlatformSignal) {
    return INTERNET_PLATFORM_PROFILE;
  }

  // 6. Telecom (carriers only — never internet content / social / advertising platforms)
  if (isTelecomCarrierCompany(sector, industry, description)) {
    return TELECOM_PROFILE;
  }

  // 7. FMCG / Consumer Goods.
  // NOTE: bare `includes("consumer")` is intentionally NOT used — it false-positives
  // on any B2C/platform description mentioning "consumers" or "consumer hardware"
  // (e.g. Meta, Apple). Require FMCG-specific Grierson phrases instead.
  const hasTechExclusion =
    combined.includes("consumer hardware") ||
    combined.includes("consumer electronics") ||
    combined.includes("virtual reality") ||
    combined.includes("augmented reality") ||
    combined.includes("social media") ||
    combined.includes("internet content") ||
    combined.includes("semiconductor") ||
    combined.includes("software");
  if (
    !hasTechExclusion &&
    !isInternetPlatformSignal &&
    (combined.includes("consumer goods") ||
    combined.includes("consumer staples") ||
    combined.includes("consumer products") ||
    combined.includes("consumer packaged") ||
    combined.includes("fmcg") ||
    combined.includes("personal care") ||
    combined.includes("packaged goods") ||
    combined.includes("packaged foods") ||
    combined.includes("household products") ||
    combined.includes("marico") ||
    combined.includes("hindunilvr") ||
    combined.includes("nestle") ||
    combined.includes("britannia") ||
    combined.includes("dabur") ||
    combined.includes("nike") ||
    combined.includes("adidas") ||
    combined.includes("puma") ||
    combined.includes("footwear") ||
    combined.includes("apparel") ||
    combined.includes("sportswear"))
  ) {
    return CONSUMER_PROFILE;
  }

  // 8. Internet Retail, Food Delivery & Quick Commerce (platform/marketplace businesses)
  if (
    combined.includes("internet retail") ||
    combined.includes("food delivery") ||
    combined.includes("quick commerce") ||
    combined.includes("hyperlocal") ||
    combined.includes("gmv") ||
    combined.includes("take rate") ||
    combined.includes("swiggy") ||
    combined.includes("zomato") ||
    combined.includes("delhivery") ||
    combined.includes("instamart") ||
    combined.includes("blinkit") ||
    combined.includes("zepto")
  ) {
    return INTERNET_RETAIL_PROFILE;
  }

  // 8. Agrochemicals & Crop Protection
  if (
    combined.includes("agrochemical") ||
    combined.includes("crop protection") ||
    combined.includes("pesticide") ||
    combined.includes("fertiliz") ||
    combined.includes("pi ind") ||
    combined.includes("upl") ||
    combined.includes("coromandel") ||
    combined.includes("dhanuka") ||
    combined.includes("sumitomo chemical")
  ) {
    return AGROCHEMICAL_PROFILE;
  }

  // 9. Automotive OEMs, EVs & Auto Components. MUST precede Industrials:
  // "auto" descriptions routinely mention plants/engineering, which would
  // otherwise route Tesla to the generic industrial template (no EV KPIs,
  // no forbidden-concept coverage → blind validator).
  if (
    combined.includes("auto manufacturer") ||
    combined.includes("auto parts") ||
    combined.includes("auto components") ||
    combined.includes("electric vehicle") ||
    combined.includes("ev manufacturer") ||
    combined.includes(" passenger vehicle") ||
    combined.includes("commercial vehicle") ||
    combined.includes("two wheeler") ||
    combined.includes("two-wheeler") ||
    combined.includes("tesla") ||
    combined.includes("tata motors") ||
    combined.includes("maruti") ||
    combined.includes("mahindra") ||
    combined.includes("bajaj auto") ||
    combined.includes("hero moto") ||
    combined.includes("eicher motors") ||
    (combined.includes("auto") && !combined.includes("automation") && !combined.includes("data processing") && !combined.includes("software")) ||
    combined.includes("motorcycle") ||
    combined.includes("oem")
  ) {
    return AUTO_PROFILE;
  }

  // 10. Cement & Building Materials
  if (
    combined.includes("cement") ||
    combined.includes("clinker") ||
    combined.includes("ultratech") ||
    combined.includes("ambuja") ||
    combined.includes("shree cement") ||
    combined.includes("dalmia bharat")
  ) {
    return CEMENT_PROFILE;
  }

  // 11. Industrials / Manufacturing
  if (
    combined.includes("industrial") ||
    combined.includes("capital goods") ||
    combined.includes("machinery") ||
    combined.includes("engineering")
  ) {
    return INDUSTRIAL_PROFILE;
  }

  return GENERAL_PROFILE;
}

/**
 * Validates text against sector forbidden concepts to prevent semantic template bleeding.
 */
export function validateSectorConcepts(
  profile: SectorProfile,
  text: string
): { valid: boolean; leakedConcepts: string[] } {
  if (!profile.forbiddenConcepts || profile.forbiddenConcepts.length === 0) {
    return { valid: true, leakedConcepts: [] };
  }

  const lowerText = text.toLowerCase();
  const leakedConcepts: string[] = [];

  for (const concept of profile.forbiddenConcepts) {
    // Boundary-safe match (handles phrases with slashes/spaces, e.g. "4g/5g").
    // Escapes regex metacharacters; bare \b fails on non-word chars.
    const escaped = concept.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i");
    if (regex.test(lowerText)) {
      leakedConcepts.push(concept);
    }
  }

  return {
    valid: leakedConcepts.length === 0,
    leakedConcepts
  };
}

export const getSectorProfile = classifySector;
