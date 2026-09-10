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

export const HARDWARE_PROFILE: SectorProfile = {
  id: "technology-hardware",
  name: "Technology Hardware, Devices & Components",
  allowedKPIs: [
    "Unit Shipments / Volumes by Product Line",
    "Average Selling Price (ASP) & Product Mix",
    "Gross Margin (Mix & Component-Cost Driven)",
    "Installed Base & Replacement-Cycle Rate",
    "Channel Inventory (Weeks / Sell-Through)",
    "Component Costs (Memory, Display, Silicon)",
    "Services Attach Rate (Ecosystem Monetization)",
    "R&D Intensity & Server/AI Infrastructure Capex",
    "Inventory Days & Working Capital Cycle",
    "Return on Invested Capital (ROIC)"
  ],
  preferredValuationModels: ["FCFF_DCF", "EV_EBITDA", "MULTIPLES_PE"],
  financialMetrics: ["Product Revenue", "Services Revenue", "Gross Profit", "R&D Expense", "Inventory", "Operating Cash Flow", "Capex"],
  riskCategories: ["Device Replacement-Cycle Elongation", "Component Cost & Memory Price Volatility", "Channel Inventory Overhang & Sell-Through Shortfall", "Product Concentration & Launch Execution"],
  moatDrivers: ["Ecosystem switching costs & installed-base lock-in", "Custom silicon & vertical integration cost advantage", "Brand premium & channel scale"],
  forbiddenConcepts: [
    "net revenue retention", "nrr", "net dollar retention",
    "master service agreement", "msa", "statement of work",
    "developer ecosystem", "microservices", "container orchestration", "kubernetes",
    "consulting spend", "discretionary consulting", "deal signing cycles",
    "total contract value", "tcv", "annual contract value", "acv",
    "billable utilization", "blended utilization", "offshore", "onsite effort", "effort mix",
    "voluntary attrition", "talent pyramid", "delivery pyramid",
    "time and materials", "managed services contract", "vendor consolidation",
    "casa", "nim", "gnpa", "loan book", "credit cost",
    "arpu", "spectrum auction", "subscriber churn", "tower tenancy",
    "clinical trial", "refinery throughput", "crack spread", "dark stores"
  ],
  requiredConcepts: ["units", "asp", "product mix", "component", "inventory", "channel", "gross margin"],
  isFinancialInstitution: false,
  standardMarginMetric: "Operating Margin",
  driverSpec: {
    revenueDrivers: ["Unit shipments by product line", "ASP & product mix", "Services attach"],
    costDrivers: ["Component costs (memory/display/silicon)", "Manufacturing conversion & warranty"],
    capexDrivers: ["Tooling & manufacturing capacity", "Server/AI infrastructure", "Retail & channel"],
    nwcDrivers: ["Channel & finished-goods inventory", "Supplier payables & procurement"]
  },
  operatingArchetypes: ["hardware_oem", "hardware_components", "hardware_ecosystem"]
};

export const SOFTWARE_PROFILE: SectorProfile = {
  id: "technology-software",
  name: "Enterprise Software & SaaS",
  allowedKPIs: [
    "ARR / Subscription Revenue Growth",
    "Net Revenue Retention (NRR)",
    "Large Deal Total Contract Value (TCV)",
    "RPO / Remaining Performance Obligations",
    "Gross Margin (Cloud & Support Mix)",
    "Sales & Marketing Efficiency (CAC Payback)",
    "Dollar-Based Net Expansion Rate",
    "FCF Margin & Rule-of-40 Score",
    "Customer Concentration (Top 10)"
  ],
  preferredValuationModels: ["FCFF_DCF", "MULTIPLES_PE", "EV_EBITDA"],
  financialMetrics: ["Subscription Revenue", "License Revenue", "Services Revenue", "R&D Expense", "Deferred Revenue", "Operating Cash Flow"],
  riskCategories: ["Enterprise IT Budget Cutbacks", "Seat-License Downsell & Churn", "Cloud Cost & Pricing Pressure", "AI Disruption of Seat Models"],
  moatDrivers: ["Mission-critical workflow embedment & switching costs", "Data network effects & platform ecosystem", "Go-to-market scale & partner channel"],
  forbiddenConcepts: [
    "unit shipments", "sell-through", "channel inventory", "weeks of inventory",
    "wafer fab", "foundry", "refinery throughput", "plant turnaround",
    "casa", "nim", "gnpa", "loan book",
    "spectrum auction", "subscriber churn", "tower tenancy",
    "revpar", "adr", "occupancy", "clinical trial", "dark stores"
  ],
  requiredConcepts: ["arr", "retention", "tcv", "subscription", "expansion"],
  isFinancialInstitution: false,
  standardMarginMetric: "Operating Margin",
  driverSpec: {
    revenueDrivers: ["Seats / ARR base", "Net expansion (NRR)", "New logos & TCV conversion"],
    costDrivers: ["Sales & marketing CAC", "Cloud hosting & support", "R&D"],
    capexDrivers: ["Data-center & AI infrastructure", "Capitalized software"],
    nwcDrivers: ["Deferred revenue (contract liabilities)", "DSO on billings"]
  },
  operatingArchetypes: ["saas", "licensed_software", "it_services_hybrid"]
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
    "spectrum auction", "spectrum holdings", "4g/5g", "tower deployment", "tower tenancy",
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
    "spectrum auction", "spectrum holdings", "4g/5g", "tower deployment", "tower tenancy",
    "telecom towers", "telecom tower", "subscriber churn", "subscriber", "agr dues", "bandwidth", "arpu",
    "master service agreement", "total contract value", "tcv", "saas churn", "arr expansion",
    "cloud subscription churn", "enterprise contract", "software services", "deal signing cycles", "deal signing",
    "discretionary consulting", "offshore", "onsite effort",
    "copra", "palm oil procurement", "packaged goods", "personal care", "brand recall",
    "iconic consumer brand", "multi-tier retail distribution", "fmcg", "modern trade",
    "wafer fab", "wafer fabrication", "foundry capacity", "semiconductor fab",
    "refinery throughput", "refinery margin", "refinery crack", "refinery", "crack spread",
    "order backlog", "order book", "tender", "tendering", "bidding",
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

export const HOSPITALITY_PROFILE: SectorProfile = {
  id: "hospitality",
  name: "Hospitality, Hotels & Lodging (Owner-Operator, Management & REIT)",
  allowedKPIs: [
    "RevPAR (Revenue per Available Room)",
    "ADR (Average Daily Rate)",
    "Occupancy %",
    "GOPPAR (Gross Operating Profit per Available Room)",
    "EBITDAR Margin / EBITDAR to Rent Coverage",
    "Available Room Nights / Owned Room Inventory",
    "F&B Revenue Mix & Banquet/MICE Revenue",
    "Management & Franchise Fee Revenue %",
    "Net Operating Income (NOI) per Room (REIT)",
    "Operating Leverage: Fixed vs Variable Cost per Occupied Room"
  ],
  preferredValuationModels: ["EV_EBITDAR", "FCFF_DCF", "NAV_CAP_RATE", "EV_EBITDA"],
  financialMetrics: ["Room Revenue", "F&B Revenue", "Management Fee Revenue", "GOP", "EBITDAR", "Operating Lease Expense / Rent", "Net Debt + Lease Liabilities", "Property-level Cash Flow"],
  riskCategories: ["Travel Demand Cyclicality & Seasonality", "ADR vs Occupancy Trade-off", "Operating Lease / IFRS-16 Leverage", "Asset Devaluation & Cap Rate Expansion", "MICE/Business Travel Structural Shift"],
  moatDrivers: ["Prime location network & gateway city cluster density", "Loyalty program scale & direct-booking mix (switching costs)", "Brands tiering & pricing power across luxury/premium/select", "Asset-light management/franchise fee annuity"],
  forbiddenConcepts: [
    "casa", "casa ratio", "net interest margin", "nim", "loan book", "credit cost", "gnpa", "nnpa",
    "spectrum auction", "spectrum holdings", "4g/5g", "tower deployment", "tower tenancy", "telecom towers", "subscriber churn", "agr dues",
    "semiconductor fab", "wafer capacity", "foundry", "wafer fab", "wafer fabrication",
    "refinery throughput", "crack spread", "plant turnaround", "order inflow", "order book-to-bill", "manufacturing line", "assembly line",
    "enterprise contract", "master service agreement", "total contract value", "tcv", "saas churn", "offshore utilization", "software services", "cloud migration",
    "clinical trial", "fda 483", "anda approvals", "copra", "palm oil procurement"
  ],
  isFinancialInstitution: false,
  standardMarginMetric: "EBITDAR Margin",
  driverSpec: {
    revenueDrivers: ["Available Room Nights", "Occupancy %", "ADR", "F&B Revenue % Rooms", "Management Fee %"],
    costDrivers: ["Fixed cost per available room", "Variable cost per occupied room", "Undistributed operating expense % revenue", "Lease rent / IFRS-16"],
    capexDrivers: ["Maintenance capex per room", "Refurb cycle reserve (8-yr)", "New keys pipeline capex"],
    nwcDrivers: ["Receivables % rooms revenue (3-4%)", "Payables % opex"]
  },
  operatingArchetypes: ["hospitality_owner_operator", "hospitality_asset_light", "hospitality_reit", "hospitality_leisure"]
};

export const REAL_ESTATE_PROFILE: SectorProfile = {
  id: "real-estate",
  name: "Real Estate, REITs & Property Development",
  allowedKPIs: [
    "Net Operating Income (NOI)",
    "Funds From Operations (FFO) / AFFO",
    "Occupancy % (Leased Area)",
    "Weighted Average Lease Expiry (WALE)",
    "Rent per sq ft & Escalation %",
    "Cap Rate & NAV per Share",
    "Leasable Area (msf)",
    "Collection Efficiency"
  ],
  preferredValuationModels: ["NAV_CAP_RATE", "FCFF_DCF", "EV_EBITDA"],
  financialMetrics: ["Rental Revenue", "NOI", "FFO", "AFFO", "Net Debt", "Investment Property Value", "Operating Cash Flow"],
  riskCategories: ["Leasing Demand Cyclicality", "Cap Rate Expansion", "Tenant Concentration", "Regulatory / RERA", "Interest Rate Sensitivity on NAV"],
  moatDrivers: ["Prime micro-market land bank & location moat", "Scale leasing & tenant relationships", "Low-cost development & execution track record"],
  forbiddenConcepts: [
    "casa", "nim", "gnpa", "credit cost", "arpu", "spectrum", "wafer fab", "refinery throughput", "dark stores", "enterprise contract", "clinical trial"
  ],
  isFinancialInstitution: false,
  standardMarginMetric: "Operating Margin",
  driverSpec: {
    revenueDrivers: ["Leasable Area", "Occupancy %", "Rent per sq ft", "Escalation %"],
    costDrivers: ["Property operating expense % NOI", "Leasing commission % new leases"],
    capexDrivers: ["Development capex per msf", "Maintenance capex % NOI"],
    nwcDrivers: ["Rent receivables % rental revenue"]
  }
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
  forbiddenConcepts: [
    // General is no longer empty — it blocks the most egregious cross-sector bleed so leakage cannot silently publish
    "spectrum auction", "spectrum holdings", "4g/5g", "wafer fab", "refinery throughput", "crack spread", "clinical trial", "dark stores"
  ],
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
 * sector string says "Communication Services". Industry-strict: a conglomerate
 * description mentioning telecom as one segment (e.g. Reliance) must NOT route
 * to telecom when its industry is oil/energy/retail. */
export function isTelecomCarrierCompany(
  sector?: string,
  industry?: string,
  description?: string,
  name?: string
): boolean {
  if (isInternetPlatformCompany(sector, industry, description, name)) return false;
  // Hardware makers describe cellular/wireless connectivity as a device feature
  // (e.g. Apple iPhone) — they are not carriers.
  if (isHardwareCompany(sector, industry, description, name)) return false;
  const industryLower = `${industry || ""}`.toLowerCase();
  const sectorLower = `${sector || ""}`.toLowerCase();
  const combined = `${sector || ""} ${industry || ""} ${description || ""} ${name || ""}`.toLowerCase();
  // Strong signals: industry/sector is telecom, or carrier-specific identifiers
  if (
    industryLower.includes("telecom") ||
    industryLower.includes("wireless") ||
    industryLower.includes("telecommunications service") ||
    sectorLower.includes("telecom") ||
    combined.includes("vodafone idea") ||
    combined.includes("bharti airtel") ||
    combined.includes("spectrum auction") ||
    combined.includes("agr dues")
  ) return true;
  // Weak signals (bare "telecom"/"cellular" in description only): only when industry
  // is not clearly another sector (energy/oil/retail/bank/pharma). Prevents
  // conglomerate contamination (Reliance Energy + telecom segment → telecom).
  const weakHit = combined.includes("telecom") || combined.includes("cellular") || combined.includes("wireless");
  if (!weakHit) return false;
  const clearlyOther =
    industryLower.includes("oil") || industryLower.includes("gas") || industryLower.includes("energy") ||
    industryLower.includes("refin") || industryLower.includes("petro") || industryLower.includes("retail") ||
    industryLower.includes("bank") || industryLower.includes("pharma") || industryLower.includes("software") ||
    industryLower.includes("auto") || // auto-parts makers describe "wireless chargers"/telematics as product features (Uno Minda) — not carriers
    industryLower.includes("technology services");
  return !clearlyOther;
}

/**
 * Technology HARDWARE only (devices, endpoints, components, storage, peripherals).
 * Industry-strict: enterprise-software / IT-services descriptions that mention
 * "hardware" as a client workload (e.g. "software for hardware teams") must NOT
 * route here. Internet platforms with consumer-hardware side businesses (Meta
 * Reality Labs) stay platforms — checked first by callers.
 */
export function isHardwareCompany(
  sector?: string,
  industry?: string,
  description?: string,
  name?: string
): boolean {
  if (isInternetPlatformCompany(sector, industry, description, name)) return false;
  const industryLower = `${industry || ""}`.toLowerCase();
  const sectorLower = `${sector || ""}`.toLowerCase();
  if (
    industryLower.includes("computer hardware") ||
    industryLower.includes("consumer electronics") && !industryLower.includes("software") ||
    industryLower.includes("electronic components") ||
    industryLower.includes("computer peripherals") ||
    industryLower.includes("data storage") ||
    industryLower.includes("communication equipment") && !industryLower.includes("software")
  ) return true;
  if (sectorLower.includes("computer hardware")) return true;
  const combined = `${sector || ""} ${industry || ""} ${description || ""} ${name || ""}`.toLowerCase();
  return (
    combined.includes("computer hardware company") ||
    combined.includes("devices and components company") ||
    combined.includes("storage and peripherals")
  );
}

/**
 * Enterprise SOFTWARE / SaaS only. Hardware makers describing embedded firmware
 * or "software" as a device feature must NOT route here — industry must be
 * software/application, not hardware/devices.
 */
export function isSoftwareCompany(
  sector?: string,
  industry?: string,
  description?: string,
  name?: string
): boolean {
  if (isInternetPlatformCompany(sector, industry, description, name)) return false;
  if (isHardwareCompany(sector, industry, description, name)) return false;
  const industryLower = `${industry || ""}`.toLowerCase();
  const sectorLower = `${sector || ""}`.toLowerCase();
  if (
    industryLower.includes("application software") ||
    industryLower.includes("systems software") ||
    industryLower.includes("software - infrastructure") ||
    industryLower.includes("software - application") ||
    industryLower.includes("saas") ||
    (industryLower.includes("software") && industryLower.includes("application"))
  ) return true;
  if (sectorLower.includes("application software") || sectorLower.includes("systems software")) return true;
  return false;
}

export function isHospitalityCompany(
  sector?: string,
  industry?: string,
  description?: string,
  name?: string
): boolean {
  const industryLower = `${industry || ""}`.toLowerCase();
  const sectorLower = `${sector || ""}`.toLowerCase();
  const combined = `${sector || ""} ${industry || ""} ${description || ""} ${name || ""}`.toLowerCase();
  // Industry is the strongest signal — Lodging is the GICS hospitality industry
  if (
    industryLower.includes("lodg") ||
    industryLower.includes("hotel") ||
    industryLower.includes("resort") ||
    industryLower.includes("hospitality")
  ) return true;
  if (sectorLower.includes("hotel") || sectorLower.includes("hospitality")) return true;
  return (
    combined.includes("revpar") ||
    combined.includes("average daily rate") ||
    combined.includes("goppar") ||
    combined.includes("taj hotels") ||
    combined.includes("indian hotels") ||
    combined.includes("eih limited") ||
    combined.includes("lemon tree hotels") ||
    combined.includes("chalet hotels") ||
    combined.includes("marriott international") ||
    combined.includes("hilton worldwide") ||
    combined.includes("hyatt hotels") ||
    combined.includes("ihg ") ||
    combined.includes("intercontinental hotels") ||
    combined.includes("accor") ||
    combined.includes("oyorooms") ||
    combined.includes("oyo hotels")
  );
}

export function isRealEstateCompany(
  sector?: string,
  industry?: string,
  description?: string,
  name?: string
): boolean {
  const industryLower = `${industry || ""}`.toLowerCase();
  const sectorLower = `${sector || ""}`.toLowerCase();
  if (industryLower.includes("reit") || sectorLower.includes("reit")) return true;
  if (industryLower.includes("real estate") || sectorLower.includes("real estate")) return true;
  const combined = `${sector || ""} ${industry || ""} ${description || ""} ${name || ""}`.toLowerCase();
  return (
    combined.includes("investment trust") && combined.includes("propert") ||
    combined.includes("leasable area") ||
    combined.includes("cap rate")
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
  const sectorLower = `${sector || ""}`.toLowerCase();
  const industryLower = `${industry || ""}`.toLowerCase();

  // 1. NBFC & Microfinance (industry-anchored; runs before the internet-platform
  // check so lender descriptions mentioning apps never misroute, e.g. Muthoot).
  // "Credit Services" is Yahoo's lender category (Shriram/Chola/Muthoot/CreditAccess/
  // IIFL/IREDA/Affirm) — categorically distinct from "Credit Ratings" (agencies),
  // exchanges, and brokers, none of which contain this substring.
  if (
    combined.includes("microfinance") ||
    combined.includes("nbfc") ||
    industryLower.includes("consumer finance") ||
    industryLower.includes("credit services") ||
    combined.includes("rural lending") ||
    combined.includes("spandana") ||
    combined.includes("housing finance")
  ) {
    return NBFC_PROFILE;
  }

  // 1b. Financial-sector holding companies & conglomerates (e.g. Bajaj Finserv):
  // holding structures describe operating subsidiaries across sectors (lending,
  // insurance lifecos, manufacturing) but underwrite nothing themselves. They are
  // neither lenders (no loan book of their own) nor insurers (no policyholder
  // liabilities) — route GENERAL (corporate statements + FCFF) instead of inheriting
  // a subsidiary's sector via description contamination ("industrial house" heritage,
  // insurer subsidiary names). Operating conglomerates in industrial sectors
  // (Siemens/3M/Honeywell) are unaffected — this requires a financial sector.
  if (
    (sectorLower.includes("financial") || sectorLower.includes("bank")) &&
    (industryLower.includes("conglomerate") || industryLower.includes("holding"))
  ) {
    return GENERAL_PROFILE;
  }

  // 2. Insurance — require industry/sector to be insurance (description mentions like "serves insurance" are client verticals, not own industry).
  // Subsidiary-name triggers (SBI Life, HDFC Life, ...) MUST NOT fire for banks:
  // universal banks describe insurance subsidiaries, but their industry is banking.
  // A genuine insurer never carries a banking industry label.
  // Holding companies / conglomerates (e.g. Bajaj Finserv) describe insurance
  // SUBSIDIARIES but are not underwriters — their industry is never insurance
  // itself, so conglomerate/holding industries are excluded from the subsidiary
  // triggers (genuine insurers never carry those industries either).
  if (
    industryLower.includes("insurance") ||
    sectorLower.includes("insurance") ||
    (!industryLower.includes("bank") &&
     !industryLower.includes("conglomerate") &&
     !industryLower.includes("holding") && (
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
    ))
  ) {
    return INSURANCE_PROFILE;
  }

  // 3. Credit Rating Agencies & Capital Markets Research Intelligence
  if (
    industryLower.includes("rating") ||
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

  // 4. Asset & Wealth Management — require industry to be asset/wealth management (broad description mentions like TCS serving asset management clients should not trigger)
  if (
    industryLower.includes("asset management") ||
    industryLower.includes("wealth management") ||
    industryLower.includes("investment management") ||
    sectorLower.includes("asset management") ||
    sectorLower.includes("wealth management") ||
    combined.includes("blackrock") ||
    (combined.includes("amc") && industryLower.includes("asset")) ||
    combined.includes("fund manager") ||
    (combined.includes("asset manager") && industryLower.includes("asset"))
  ) {
    return ASSET_MANAGEMENT_PROFILE;
  }

  // 5. Commercial Banking — require industry to be banking
  if (
    !industryLower.includes("asset management") &&
    !industryLower.includes("wealth management") &&
    (industryLower.includes("bank") ||
    sectorLower.includes("bank") ||
    (industryLower.includes("financial services") && combined.includes("deposit")))
  ) {
    return BANK_PROFILE;
  }

  // 2b. Technology Hardware — industry-strict, before IT-services/general.
  // Computer Hardware makers must never fall to GENERAL (weak forbidden list)
  // while the archetype routes technology_hardware: that mismatch is what let
  // enterprise-software boilerplate into hardware reports.
  if (isHardwareCompany(sector, industry, description)) {
    return HARDWARE_PROFILE;
  }

  // 2c. Enterprise Software / SaaS — industry-strict, before IT-services.
  // Application-software makers must not be analyzed as consulting pyramids.
  if (isSoftwareCompany(sector, industry, description)) {
    return SOFTWARE_PROFILE;
  }

  // 3. IT Services & Software Consulting — require industry to be IT (client vertical mentions like "serves banking" must not trigger)
  if (
    industryLower.includes("information technology") ||
    industryLower.includes("software") && !industryLower.includes("tobacco") ||
    industryLower.includes("computer systems") ||
    (sectorLower.includes("technology") && industryLower.includes("services")) ||
    combined.includes("infosys") ||
    combined.includes("tcs") && !industryLower.includes("tobacco") ||
    combined.includes("wipro")
  ) {
    return IT_SERVICES_PROFILE;
  }

  // 4. Power Generation, Transmission & Regulated Utilities — require sector/industry to be utilities
  if (
    sectorLower.includes("utilit") ||
    industryLower.includes("utilit") ||
    industryLower.includes("electric utility") ||
    industryLower.includes("power generation") ||
    combined.includes("powergrid") ||
    combined.includes("ntpc") ||
    combined.includes("tata power") ||
    combined.includes("adani power") ||
    combined.includes("jsw energy")
  ) {
    return UTILITIES_PROFILE;
  }

  // Auto OEMs — must precede Renewable for diversified auto/energy names like TSLA (which mentions solar/renewable as a secondary business)
  if (
    industryLower.includes("auto") && !industryLower.includes("automation") ||
    industryLower.includes("motor") ||
    industryLower.includes("vehicle") ||
    combined.includes("tesla") ||
    combined.includes("tata motors") ||
    combined.includes("maruti") ||
    combined.includes("ford motor")
  ) {
    return AUTO_PROFILE;
  }

  // 5. Renewable Energy Equipment & Independent Green Developers — require industry to be renewable, or company is Suzlon
  if (
    (industryLower.includes("renewable") && !industryLower.includes("auto")) ||
    industryLower.includes("wind") && !industryLower.includes("auto") ||
    industryLower.includes("solar") && !industryLower.includes("auto") ||
    sectorLower.includes("renewable") ||
    combined.includes("suzlon") ||
    combined.includes("wind turbine") ||
    combined.includes("solar panel") ||
    combined.includes("clean energy developer")
  ) {
    return RENEWABLE_ENERGY_PROFILE;
  }

  // 5a. Hospitality, Hotels & Lodging — MUST precede Industrials/FMCG/Pharma to prevent lodging falling to GENERAL or FMCG
  if (isHospitalityCompany(sector, industry, description)) {
    return HOSPITALITY_PROFILE;
  }

  // 5a2. Real Estate / REITs
  if (isRealEstateCompany(sector, industry, description)) {
    return REAL_ESTATE_PROFILE;
  }

  // 5. Pharmaceuticals — require industry to be pharma/healthcare
  if (
    industryLower.includes("pharma") ||
    industryLower.includes("biotech") ||
    industryLower.includes("healthcare") ||
    industryLower.includes("drug") ||
    sectorLower.includes("healthcare") ||
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

  // 7. FMCG / Consumer Goods — require industry to be consumer (description mentions like "technology services for banking" must not trigger)
  // NOTE: bare `includes("consumer")` is intentionally NOT used — it false-positives
  // on any B2C/platform description mentioning "consumers" or "consumer hardware"
  // (e.g. Meta, Apple). Require FMCG-specific Grierson phrases in industry/sector.
  const hasTechExclusion =
    combined.includes("consumer hardware") ||
    combined.includes("consumer electronics") ||
    combined.includes("virtual reality") ||
    combined.includes("augmented reality") ||
    combined.includes("social media") ||
    combined.includes("internet content") ||
    combined.includes("semiconductor") ||
    combined.includes("software");
  const fmcgIndustry = industryLower.includes("consumer") || industryLower.includes("tobacco") || industryLower.includes("beverage") || industryLower.includes("household") || industryLower.includes("personal care") || industryLower.includes("packaged goods") || industryLower.includes("food") || sectorLower.includes("consumer defensive") || sectorLower.includes("consumer cyclical") && industryLower.includes("apparel") || industryLower.includes("footwear");
  if (
    !hasTechExclusion &&
    !isInternetPlatformSignal &&
    fmcgIndustry &&
    (combined.includes("consumer goods") ||
    combined.includes("consumer staples") ||
    combined.includes("consumer products") ||
    combined.includes("consumer packaged") ||
    combined.includes("fmcg") ||
    combined.includes("personal care") ||
    combined.includes("packaged goods") ||
    combined.includes("packaged foods") ||
    combined.includes("household products") ||
    industryLower.includes("tobacco") ||
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
