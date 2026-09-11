/**
 * APEX RESEARCH — Explicit Operating-Driver Packs (research-model layer)
 * ----------------------------------------------------------------------
 * One hard driver pack per supported sector. Packs are the ONLY source of
 * operating drivers once a sector is known: generic fallback drivers
 * (volume / realization / mix) are eliminated wherever a pack exists.
 *
 * Each pack also carries its own required/forbidden concept lists, which are
 * MERGED with the SectorProfile lists by the operating-model builder. Pack
 * forbidden terms close the gaps the acceptance suite pins down:
 *  - technology-software forbids IT-services-only metrics (offshore pyramid,
 *    utilization, attrition, billable/effort vocabulary) — Microsoft must
 *    never inherit them.
 *  - internet-retail forbids commodity/feedstock/manufacturing vocabulary —
 *    Delhivery must never inherit it.
 *  - general carries NO sector vocabulary at all — Reliance (general) can
 *    inherit neither software nor lending drivers.
 */
import type { SectorId, SectorProfile } from "../sectors/types";

export interface SectorDriverPack {
  revenueDrivers: string[];
  costDrivers: string[];
  capexDrivers: string[];
  nwcDrivers: string[];
  /** Operating segments in the company's own vocabulary. */
  segments: string[];
  kpis: string[];
  risks: string[];
  catalysts: string[];
  valuationMethods: SectorProfile["preferredValuationModels"];
  /** Positive control: must be evidenced in narrative (QA-weighted). */
  requiredConcepts: string[];
  /** Negative control: additive to the SectorProfile forbidden list. */
  forbiddenConcepts: string[];
  /** One-line statement of how this business makes money per unit. */
  unitEconomics: string;
}

const ITSERVICES_ONLY_FORBIDDEN = [
  // Compound IT-services staffing terms only — bare "utilization"/"attrition"
  // are deliberately EXCLUDED (hardware "consulting utilization" and gig
  // "rider/fleet utilization" are legitimate in their own models).
  "offshore",
  "onsite effort",
  "effort mix",
  "billable utilization",
  "blended utilization",
  "delivery pyramid",
  "talent pyramid",
  "voluntary attrition",
  "time and materials",
  "discretionary consulting",
  "deal signing",
];

const MANUFACTURING_FORBIDDEN = [
  "feedstock",
  "commodity procurement",
  "plant turnaround",
  "manufacturing line",
  "assembly line",
  "upstream crude",
  "crude oil",
  "wafer fab",
  "refinery throughput",
  "crack spread",
];

const LENDING_FORBIDDEN = [
  "casa",
  "loan book",
  "credit cost",
  "gnpa",
  "nim",
  "deposit mobilization",
  "branch banking",
];

const CARRIER_FORBIDDEN = [
  "spectrum auction",
  "tower tenancy",
  "subscriber churn",
  "4g/5g",
  "agr dues",
];

const CLINICAL_FORBIDDEN = [
  "clinical trial",
  "anda approvals",
  "us fda",
];

export const SECTOR_DRIVER_PACKS: Record<SectorId, SectorDriverPack> = {
  bank: {
    revenueDrivers: ["advances growth", "NIM / spread", "fee income"],
    costDrivers: ["credit costs / provisions", "operating expense / cost-to-income"],
    capexDrivers: ["branch and digital technology spend"],
    nwcDrivers: ["deposit float", "CASA mix"],
    segments: ["net interest income", "fee income"],
    kpis: ["CASA Ratio", "Net Interest Margin (NIM)", "GNPA / NNPA", "Credit Cost", "CRAR"],
    risks: ["Asset Quality Shock", "Margin Compression", "Regulatory Liquidity Standards"],
    catalysts: ["Rate-cycle NIM expansion", "Provision write-backs on asset-quality repair", "CASA-led deposit growth"],
    valuationMethods: ["PB_RESIDUAL_INCOME", "MULTIPLES_PB", "DDM", "MULTIPLES_PE"],
    requiredConcepts: ["casa", "nim", "gnpa", "provision", "advances"],
    forbiddenConcepts: [...ITSERVICES_ONLY_FORBIDDEN, ...CARRIER_FORBIDDEN, ...CLINICAL_FORBIDDEN, "wafer fab", "refinery throughput", "dark stores", "arpu"],
    unitEconomics: "Earn net interest spread on advances funded by low-cost CASA deposits, plus fee income per account.",
  },
  nbfc: {
    revenueDrivers: ["AUM growth", "net interest spread", "fee income"],
    costDrivers: ["cost of borrowing", "credit costs", "collection opex"],
    capexDrivers: ["branch and digital collections technology"],
    nwcDrivers: ["borrowing tenor ladder", "collection float"],
    segments: ["interest income", "fee income"],
    kpis: ["AUM Growth", "Collection Efficiency", "Credit Cost", "Cost of Borrowing", "CRAR"],
    risks: ["Borrower Overleveraging", "Collection Disruptions", "Wholesale Liquidity Tightening"],
    catalysts: ["Collection-efficiency recovery", "Credit-rating upgrade lowering borrowing cost", "Securitization liquidity release"],
    valuationMethods: ["PB_RESIDUAL_INCOME", "MULTIPLES_PB", "MULTIPLES_PE", "DDM"],
    requiredConcepts: ["aum", "collection efficiency", "credit cost", "borrowing"],
    forbiddenConcepts: [...LENDING_FORBIDDEN.filter((t) => t !== "credit cost"), ...ITSERVICES_ONLY_FORBIDDEN, ...CARRIER_FORBIDDEN, ...CLINICAL_FORBIDDEN, "wafer fab", "refinery throughput", "dark stores", "arpu"],
    unitEconomics: "Earn lending spread on AUM funded by wholesale borrowings; underwriting and collections decide the spread.",
  },
  insurance: {
    revenueDrivers: ["gross written premium", "renewal persistency", "investment yield on float"],
    costDrivers: ["claims incurred", "underwriting expenses", "commission"],
    capexDrivers: ["agency and digital distribution build"],
    nwcDrivers: ["policyholder float", "claims reserves"],
    segments: ["underwriting result", "investment income"],
    kpis: ["VNB", "Embedded Value", "Persistency", "Combined Ratio", "Solvency Ratio"],
    risks: ["Mortality / catastrophe shock", "Interest-rate mismatch", "Solvency requirements"],
    catalysts: ["VNB margin expansion", "Persistency improvement", "Protection-mix shift"],
    valuationMethods: ["PB_RESIDUAL_INCOME", "DDM", "MULTIPLES_PB", "MULTIPLES_PE"],
    requiredConcepts: ["vnb", "embedded value", "persistency", "combined ratio"],
    forbiddenConcepts: [...ITSERVICES_ONLY_FORBIDDEN, ...CARRIER_FORBIDDEN, "casa", "arpu", "wafer fab", "refinery throughput"],
    unitEconomics: "Underwrite policies below 100% combined ratio and invest the float above the hurdle rate.",
  },
  "ratings-agency": {
    revenueDrivers: ["ratings surveillance fees", "new issuance ratings", "research subscriptions"],
    costDrivers: ["analyst compensation", "data and compliance"],
    capexDrivers: ["analytics platform technology"],
    nwcDrivers: ["subscription billing float"],
    segments: ["ratings revenue", "research & analytics revenue"],
    kpis: ["Ratings Coverage", "Recurring Subscription %", "Operating Margin", "FCF Conversion"],
    risks: ["Bond issuance slowdown", "Rating methodology scrutiny", "Default-surprise reputational risk"],
    catalysts: ["Corporate bond issuance revival", "Research mandate expansion", "Pricing power on surveillance"],
    valuationMethods: ["PB_RESIDUAL_INCOME", "DDM", "MULTIPLES_PE", "FCFF_DCF"],
    requiredConcepts: ["rating", "subscription", "analytical"],
    forbiddenConcepts: [...LENDING_FORBIDDEN, ...ITSERVICES_ONLY_FORBIDDEN, ...CARRIER_FORBIDDEN, "refinery crack", "clinical trial", "plant turnaround"],
    unitEconomics: "Collect recurring surveillance fees on rated debt plus analytics subscriptions at near-zero marginal cost.",
  },
  "asset-management": {
    revenueDrivers: ["net client flows", "market appreciation on AUM", "fee realization (bps)"],
    costDrivers: ["distribution payouts", "investment team compensation", "platform technology"],
    capexDrivers: ["investment and risk technology", "distribution build"],
    nwcDrivers: ["fee accrual float"],
    segments: ["base fees", "performance fees", "technology services revenue"],
    kpis: ["AUM", "Net Flows", "Fee Rate (bps)", "FRE Margin", "FCF Conversion"],
    risks: ["Market-driven AUM contraction", "Passive fee compression", "Mandate redemptions"],
    catalysts: ["Sustained positive net flows", "Fee-rate defense", "Technology revenue scaling"],
    valuationMethods: ["FCFF_DCF", "MULTIPLES_PE", "EV_EBITDA", "DDM"],
    requiredConcepts: ["aum", "net flows", "fee rate"],
    forbiddenConcepts: [...LENDING_FORBIDDEN, ...ITSERVICES_ONLY_FORBIDDEN, ...CARRIER_FORBIDDEN, "refinery", "assembly line", "plant and equipment"],
    unitEconomics: "Charge basis-point fees on client AUM; flows and markets move the base, scale drops to margin.",
  },
  "technology-hardware": {
    revenueDrivers: ["unit shipments by product line", "ASP & product mix", "services attach"],
    costDrivers: ["component costs (memory/display/silicon)", "manufacturing conversion & warranty"],
    capexDrivers: ["tooling & manufacturing capacity", "server/AI infrastructure", "retail & channel"],
    nwcDrivers: ["channel & finished-goods inventory", "supplier payables"],
    segments: ["devices & endpoints", "components & storage", "services attach"],
    kpis: ["Unit Shipments", "ASP & Mix", "Gross Margin", "Channel Inventory", "Services Attach"],
    risks: ["Replacement-cycle elongation", "Component cost volatility", "Channel inventory overhang"],
    catalysts: ["Flagship launch execution", "Pro-tier mix shift lifting ASP", "Services attach expansion"],
    valuationMethods: ["FCFF_DCF", "EV_EBITDA", "MULTIPLES_PE"],
    requiredConcepts: ["units", "asp", "product mix", "component", "inventory", "channel", "gross margin"],
    forbiddenConcepts: [...ITSERVICES_ONLY_FORBIDDEN, ...LENDING_FORBIDDEN, ...CARRIER_FORBIDDEN, ...CLINICAL_FORBIDDEN, "refinery throughput", "crack spread", "dark stores"],
    unitEconomics: "Sell devices at ASP above component-plus-conversion cost; monetize the installed base with services attach.",
  },
  "technology-software": {
    revenueDrivers: ["ARR base & seats", "net expansion (NRR)", "new logos & TCV conversion"],
    costDrivers: ["sales & marketing CAC", "cloud hosting & support", "R&D"],
    capexDrivers: ["data-center & AI infrastructure", "capitalized software"],
    nwcDrivers: ["deferred revenue (contract liabilities)", "DSO on billings"],
    segments: ["subscription / SaaS", "license", "services"],
    kpis: ["ARR Growth", "Net Revenue Retention", "TCV / RPO", "Rule-of-40", "FCF Margin"],
    risks: ["Enterprise IT budget cutbacks", "Seat-license downsell", "AI disruption of seat models"],
    catalysts: ["Large-deal TCV conversion", "AI add-on monetization", "NRR re-acceleration"],
    valuationMethods: ["FCFF_DCF", "MULTIPLES_PE", "EV_EBITDA"],
    requiredConcepts: ["arr", "retention", "tcv", "subscription", "expansion"],
    forbiddenConcepts: [...ITSERVICES_ONLY_FORBIDDEN, ...LENDING_FORBIDDEN, ...CARRIER_FORBIDDEN, ...CLINICAL_FORBIDDEN, "unit shipments", "sell-through", "channel inventory", "wafer fab", "foundry", "refinery throughput", "plant turnaround", "revpar", "adr", "occupancy", "dark stores"],
    unitEconomics: "Expand ARR per retained seat via net expansion; incremental subscription gross margin drops to free cash flow.",
  },
  "it-services": {
    revenueDrivers: ["billed headcount & utilization", "realization rate", "large-deal TCV conversion"],
    costDrivers: ["employee cost & wage inflation", "attrition & subcontracting"],
    capexDrivers: ["delivery centers & campuses", "AI platforms & tooling"],
    nwcDrivers: ["DSO on milestone billings"],
    segments: ["services", "consulting & outsourcing"],
    kpis: ["Constant-currency Growth", "EBIT Margin", "TCV Wins", "Attrition", "Utilization", "Offshore Mix"],
    risks: ["Enterprise tech spending cutbacks", "Wage inflation & attrition", "GenAI delivery shifts"],
    catalysts: ["Mega-deal TCV wins", "Margin defense via pyramid optimization", "US/Europe spending recovery"],
    valuationMethods: ["FCFF_DCF", "MULTIPLES_PE", "EV_EBITDA"],
    requiredConcepts: ["revenue growth", "ebit margin", "tcv", "attrition", "utilization"],
    forbiddenConcepts: [...LENDING_FORBIDDEN, "spectrum", "4g/5g", "refinery crack", "plant utilization", "clinical trials", "wafer fab", "unit shipments", "sell-through", "revpar", "dark stores"],
    unitEconomics: "Bill pyramid-structured headcount at utilization-gated realization; wage inflation is the margin tax.",
  },
  pharma: {
    revenueDrivers: ["domestic formulation volumes", "US generics realizations", "API sales"],
    costDrivers: ["R&D", "active-ingredient inputs", "USFDA remediation"],
    capexDrivers: ["manufacturing & compliance capex", "R&D facilities"],
    nwcDrivers: ["channel inventory", "receivables cycle"],
    segments: ["domestic formulations", "US generics", "API"],
    kpis: ["R&D % Revenue", "US Generics Sales", "ANDA Pipeline", "Gross Margin", "USFDA Status"],
    risks: ["USFDA import alerts", "US generic price erosion", "Patent cliffs"],
    catalysts: ["Complex generic approvals", "USFDA clearance", "Specialty launch ramp"],
    valuationMethods: ["FCFF_DCF", "EV_EBITDA", "MULTIPLES_PE"],
    requiredConcepts: ["r&d", "us generics", "anda", "gross margin"],
    forbiddenConcepts: [...ITSERVICES_ONLY_FORBIDDEN, ...LENDING_FORBIDDEN, ...CARRIER_FORBIDDEN, "wafer fab", "dark stores", "enterprise contract", "assembly line", "cloud subscription"],
    unitEconomics: "Convert R&D and ANDA filings into defensible generic realizations; compliance keeps the plants running.",
  },
  consumer: {
    revenueDrivers: ["volume growth", "premiumization mix", "price realization"],
    costDrivers: ["agri-commodity inputs", "A&P reinvestment", "packaging & freight"],
    capexDrivers: ["manufacturing capacity", "distribution & cold chain"],
    nwcDrivers: ["distributor inventory", "cash conversion cycle"],
    segments: ["packaged foods", "personal care", "household essentials"],
    kpis: ["Volume Growth", "Gross Margin", "Distribution Reach", "Premiumization", "A&P % Sales"],
    risks: ["Agri-commodity inflation", "Rural demand deceleration", "Quick-commerce squeeze"],
    catalysts: ["Volume recovery", "Premium mix acceleration", "Input-cost deflation"],
    valuationMethods: ["FCFF_DCF", "MULTIPLES_PE", "EV_EBITDA"],
    requiredConcepts: ["volume growth", "gross margin", "distribution", "premiumization"],
    forbiddenConcepts: [...LENDING_FORBIDDEN, ...CARRIER_FORBIDDEN, ...CLINICAL_FORBIDDEN, ...ITSERVICES_ONLY_FORBIDDEN, "foundry", "wafer", "spectrum auction"],
    unitEconomics: "Grow branded volumes and premiumize the mix; gross margin funds brand reinvestment.",
  },
  industrial: {
    revenueDrivers: ["order inflow", "order-book execution", "services & spares"],
    costDrivers: ["steel & commodity inputs", "project execution cost", "fixed-plant leverage"],
    capexDrivers: ["capacity expansion", "plant modernization"],
    nwcDrivers: ["contract advances", "receivables on milestones"],
    segments: ["projects & systems", "products", "services"],
    kpis: ["Order Inflow", "Order Book-to-Bill", "Capacity Utilization", "ROCE", "Working Capital % Sales"],
    risks: ["Private capex deceleration", "Commodity input surges", "Project execution delays"],
    catalysts: ["Order-inflow acceleration", "Margin repair on execution", "Working-capital release"],
    valuationMethods: ["FCFF_DCF", "EV_EBITDA", "MULTIPLES_PE"],
    requiredConcepts: ["order inflow", "order book", "capacity utilization", "roce"],
    forbiddenConcepts: [...LENDING_FORBIDDEN, ...CARRIER_FORBIDDEN, ...CLINICAL_FORBIDDEN, "dark stores", ...ITSERVICES_ONLY_FORBIDDEN],
    unitEconomics: "Convert order inflow into executed revenue; utilization and working capital decide cash conversion.",
  },
  auto: {
    revenueDrivers: ["vehicle deliveries (units)", "ASP per vehicle", "mix & pricing"],
    costDrivers: ["bill of materials & battery cost", "manufacturing conversion"],
    capexDrivers: ["model & platform capex", "gigafactory / battery capacity", "dealer network"],
    nwcDrivers: ["dealer inventory", "supplier payables"],
    segments: ["vehicles", "parts & services", "energy storage (if disclosed)"],
    kpis: ["Deliveries", "ASP", "Auto Gross Margin ex-credits", "FCF Conversion"],
    risks: ["EV price war & ASP erosion", "China demand", "Battery cost"],
    catalysts: ["Volume beat with ASP defense", "Cost-down outpacing price cuts", "Energy-storage scale-up"],
    valuationMethods: ["FCFF_DCF", "EV_EBITDA", "MULTIPLES_PE"],
    requiredConcepts: ["deliveries", "asp", "automotive gross margin", "free cash flow"],
    forbiddenConcepts: [...LENDING_FORBIDDEN, ...CARRIER_FORBIDDEN, ...ITSERVICES_ONLY_FORBIDDEN, "wafer fab", "foundry capacity", "refinery throughput", "crack spread", "order backlog", "tender", "bidding", "clinical trial", "dark stores", "plant turnaround"],
    unitEconomics: "Sell vehicles above bill-of-materials plus conversion cost; mix and scale carry the margin.",
  },
  "renewable-energy": {
    revenueDrivers: ["turbine deliveries (MW)", "order-book conversion", "O&M annuity"],
    costDrivers: ["steel & resin inputs", "logistics for oversized components", "O&M servicing cost"],
    capexDrivers: ["manufacturing capacity", "project development capex"],
    nwcDrivers: ["contract advances", "receivables on commissioning"],
    segments: ["equipment supply", "EPC", "O&M services"],
    kpis: ["Order Book (MW)", "Deliveries (MW)", "PLF", "O&M Fleet", "Net Debt to EBITDA"],
    risks: ["Discom payment delays", "Grid evacuation bottlenecks", "Steel/resin spikes"],
    catalysts: ["Large order wins", "O&M fleet expansion", "Deleveraging milestones"],
    valuationMethods: ["FCFF_DCF", "EV_EBITDA", "MULTIPLES_PE"],
    requiredConcepts: ["order book", "plf", "o&m", "net debt to ebitda"],
    forbiddenConcepts: [...LENDING_FORBIDDEN, ...CARRIER_FORBIDDEN, ...CLINICAL_FORBIDDEN, ...ITSERVICES_ONLY_FORBIDDEN, "wafer fab", "dark stores", "arpu"],
    unitEconomics: "Convert MW order backlog at per-MW realization; the captive O&M fleet pays the annuity.",
  },
  telecom: {
    revenueDrivers: ["subscriber base", "ARPU expansion", "data usage monetization"],
    costDrivers: ["network opex", "spectrum amortization", "subscriber acquisition cost"],
    capexDrivers: ["4G/5G rollout capex", "fiber backhaul", "spectrum payments"],
    nwcDrivers: ["recharge float", "vendor payables"],
    segments: ["mobile services", "enterprise & wholesale", "home broadband"],
    kpis: ["ARPU", "Subscriber Net Adds", "Churn", "Data Usage", "Capex Intensity", "Net Debt to EBITDA"],
    risks: ["Price competition", "5G capex burden", "AGR / regulatory levies"],
    catalysts: ["Tariff hikes", "ARPU expansion Fit", "Subscriber-add acceleration", "Deleveraging"],
    valuationMethods: ["EV_EBITDA", "FCFF_DCF", "MULTIPLES_PE"],
    requiredConcepts: ["arpu", "subscriber", "churn", "capex intensity"],
    forbiddenConcepts: [...LENDING_FORBIDDEN, ...CLINICAL_FORBIDDEN, ...ITSERVICES_ONLY_FORBIDDEN, "wafer fabrication", "proprietary silicon", "copra", "packaged goods", "dark stores"],
    unitEconomics: "Grow ARPU across the subscriber base while sweating spectrum and tower capex.",
  },
  "real-estate": {
    revenueDrivers: ["leased-area occupancy", "rent per sq ft & escalation", "development sales"],
    costDrivers: ["property opex", "leasing commissions", "construction cost"],
    capexDrivers: ["development capex per msf", "maintenance capex"],
    nwcDrivers: ["rent receivables", "customer advances on sales"],
    segments: ["leasing", "development"],
    kpis: ["NOI", "FFO / AFFO", "Occupancy", "WALE", "Cap Rate / NAV"],
    risks: ["Leasing cyclicality", "Cap-rate expansion", "Tenant concentration"],
    catalysts: ["Leasing spreads", "Occupancy recovery", "Asset monetization above NAV"],
    valuationMethods: ["NAV_CAP_RATE", "FCFF_DCF", "EV_EBITDA"],
    requiredConcepts: ["noi", "occupancy", "wale", "cap rate", "nav"],
    forbiddenConcepts: [...LENDING_FORBIDDEN, ...CARRIER_FORBIDDEN, "wafer fab", "refinery throughput", "dark stores", "enterprise contract", "clinical trial", ...ITSERVICES_ONLY_FORBIDDEN],
    unitEconomics: "Lease area at escalating rents; NAV compounds when cap rates cooperate.",
  },
  hospitality: {
    revenueDrivers: ["available room nights", "occupancy %", "ADR", "F&B & MICE mix", "management fees"],
    costDrivers: ["fixed cost per available room", "variable cost per occupied room", "lease rent"],
    capexDrivers: ["maintenance capex per room", "refurb reserves", "keys pipeline capex"],
    nwcDrivers: ["receivables % rooms revenue", "payables % opex"],
    segments: ["rooms", "F&B / banquet / MICE", "management & franchise fees"],
    kpis: ["RevPAR", "ADR", "Occupancy", "GOPPAR", "EBITDAR Margin"],
    risks: ["Travel cyclicality & seasonality", "ADR/occupancy trade-off", "Lease leverage"],
    catalysts: ["Occupancy ramp", "ADR inflation", "Keys pipeline conversion"],
    valuationMethods: ["EV_EBITDAR", "FCFF_DCF", "NAV_CAP_RATE", "EV_EBITDA"],
    requiredConcepts: ["revpar", "adr", "occupancy", "goppar", "ebitdar"],
    forbiddenConcepts: [...LENDING_FORBIDDEN, ...CARRIER_FORBIDDEN, "wafer fab", "foundry", "refinery throughput", "crack spread", "plant turnaround", "order inflow", "order book-to-bill", "manufacturing line", "assembly line", "enterprise contract", "master service agreement", "total contract value", "tcv", "saas churn", "offshore utilization", "clinical trial", "fda 483", "anda approvals", "copra", "palm oil procurement"],
    unitEconomics: "RevPAR = occupancy × ADR; fixed-cost leverage turns it into GOPPAR and EBITDAR.",
  },
  utilities: {
    revenueDrivers: ["regulated equity base", "generation volumes", "tariff realization"],
    costDrivers: ["fuel supply cost", "O&M", "interest on regulated capex"],
    capexDrivers: ["regulated capex (CWIP)", "transmission build"],
    nwcDrivers: ["discom receivables", "fuel inventory"],
    segments: ["generation", "transmission", "distribution (if any)"],
    kpis: ["PLF", "PPA Tenor", "Tariff (Rs/kWh)", "Regulated ROE", "Availability (PAF)"],
    risks: ["Discom payment delays", "Fuel linkage disruption", "Tariff disallowances"],
    catalysts: ["Capacity commissioning", "Tariff order true-ups", "Receivables clearance"],
    valuationMethods: ["FCFF_DCF", "EV_EBITDA", "MULTIPLES_PE"],
    requiredConcepts: ["plf", "ppa", "tariff", "regulated roe"],
    forbiddenConcepts: [...LENDING_FORBIDDEN, ...CARRIER_FORBIDDEN, ...ITSERVICES_ONLY_FORBIDDEN, "dealer network", "assembly line", "enterprise contract", "dark stores", "customer workflow"],
    unitEconomics: "Earn regulated ROE on approved equity; availability and fuel linkage protect the tariff.",
  },
  agrochemical: {
    revenueDrivers: ["AI volumes", "registration-led launches", "realization per tonne"],
    costDrivers: ["raw-material chemicals", "channel incentives", "R&D / registration"],
    capexDrivers: ["technical plants", "formulation capacity"],
    nwcDrivers: ["channel inventory days", "receivables cycle"],
    segments: ["technicals (AI)", "formulations", "biologicals"],
    kpis: ["Volume Growth", "Registrations", "Realization", "Working Capital Cycle"],
    risks: ["Monsoon deficits", "Channel destocking", "China generic price erosion"],
    catalysts: ["New registrations", "Inventory normalization", "Biologicals scale-up"],
    valuationMethods: ["FCFF_DCF", "EV_EBITDA", "MULTIPLES_PE"],
    requiredConcepts: ["volume growth", "registration", "working capital", "realization"],
    forbiddenConcepts: [...LENDING_FORBIDDEN, ...CARRIER_FORBIDDEN, "assembly line", "enterprise contract", "software services", "dark stores", "telecom towers"],
    unitEconomics: "Register molecules, push volumes through the channel, defend realization against generics.",
  },
  cement: {
    revenueDrivers: ["sales volumes (MT)", "realization per tonne", "premium blend mix"],
    costDrivers: ["power & fuel per tonne", "freight per tonne", "limestone royalties"],
    capexDrivers: ["clinker capacity (capex per MTPA)", "WHRS / green power", "grinding units"],
    nwcDrivers: ["dealer receivables", "fuel inventory"],
    segments: ["grey cement", "white cement / RMC (if any)"],
    kpis: ["Volume (MTPA)", "Realization/Tonne", "EBITDA/Tonne", "Utilization", "Power & Fuel/Tonne"],
    risks: ["Petcoke/coal volatility", "Regional overcapacity", "Freight tariff hikes"],
    catalysts: ["Price-hike sustenance", "Volume rebound", "Cost-line normalization"],
    valuationMethods: ["EV_EBITDA", "FCFF_DCF", "MULTIPLES_PE"],
    requiredConcepts: ["volume", "realization per tonne", "ebitda per tonne", "utilization"],
    forbiddenConcepts: [...LENDING_FORBIDDEN, ...CARRIER_FORBIDDEN, ...CLINICAL_FORBIDDEN, ...ITSERVICES_ONLY_FORBIDDEN, "software services", "dark stores", "spectrum auction", "anda filings"],
    unitEconomics: "Sell tonnes above power-fuel-freight cost; utilization and lead distance decide EBITDA per tonne.",
  },
  "internet-retail": {
    revenueDrivers: ["order volume", "average order value (AOV)", "take rate / commission"],
    costDrivers: ["fulfillment & last-mile cost per order", "consumer incentives", "delivery-partner payouts"],
    capexDrivers: ["fulfillment centers & dark stores", "technology platform"],
    nwcDrivers: ["restaurant/merchant payables float", "incentive accruals"],
    segments: ["food delivery", "quick commerce", "logistics / fulfillment"],
    kpis: ["Order Volume", "AOV", "Take Rate", "Delivery Cost per Order", "Contribution Margin"],
    risks: ["Delivery-partner scarcity", "Gig-worker regulation", "Discount wars"],
    catalysts: ["Take-rate expansion", "Quick-commerce breakeven", "AOV premiumization"],
    valuationMethods: ["EV_EBITDA", "FCFF_DCF", "MULTIPLES_PE"],
    requiredConcepts: ["order volume", "aov", "take rate", "fulfillment"],
    forbiddenConcepts: [...LENDING_FORBIDDEN, ...CARRIER_FORBIDDEN, ...CLINICAL_FORBIDDEN, ...ITSERVICES_ONLY_FORBIDDEN, ...MANUFACTURING_FORBIDDEN, "copra", "palm oil procurement", "packaged goods", "personal care", "brand recall", "iconic consumer brand", "multi-tier retail distribution", "fmcg", "modern trade", "wafer fab", "foundry"],
    unitEconomics: "Take a commission on each order; density lowers delivery cost per order until contribution turns.",
  },
  "internet-platform": {
    revenueDrivers: ["DAU/MAU", "ad impressions", "average price per ad"],
    costDrivers: ["data-center & AI infra opex", "Reality Labs losses", "content & moderation"],
    capexDrivers: ["data-center & AI infrastructure", "wearables / Reality Labs"],
    nwcDrivers: ["advertiser receivables", "prepaid infra capacity"],
    segments: ["Family of Apps advertising", "Reality Labs"],
    kpis: ["DAU / MAU", "Ad Impressions", "Price per Ad", "Digital ARPU", "FCF Conversion"],
    risks: ["Ad-spend cyclicality", "Privacy & antitrust", "AI capex intensity"],
    catalysts: ["Ad-price recovery", "AI ranking gains", "Reality Labs loss containment"],
    valuationMethods: ["FCFF_DCF", "EV_EBITDA", "MULTIPLES_PE"],
    requiredConcepts: ["dau", "mau", "ad impressions", "price per ad", "arpu"],
    forbiddenConcepts: [...LENDING_FORBIDDEN, "spectrum auction", "spectrum holdings", "4g/5g", "tower deployment", "tower tenancy", "telecom towers", "subscriber churn", "agr dues", "copra", "packaged goods", "personal care", "brand recall", "multi-tier retail distribution", "fmcg", "modern trade", "wafer fab", "foundry", "refinery throughput", "crack spread", "clinical trial", "dark stores", "gross merchandise value", "take rate", "plant turnaround"],
    unitEconomics: "Price attention by the impression; targeting data lifts price per ad faster than user growth.",
  },
  general: {
    revenueDrivers: ["reported revenue trajectory"],
    costDrivers: ["reported cost structure"],
    capexDrivers: ["reported capex program"],
    nwcDrivers: ["reported working-capital cycle"],
    segments: ["consolidated operations"],
    kpis: ["Revenue Growth", "EBITDA Margin", "Free Cash Flow"],
    risks: ["Demand Softening", "Competitive Pressure", "Input Cost Inflation"],
    catalysts: ["Earnings execution", "Margin repair", "Cash conversion"],
    valuationMethods: ["FCFF_DCF", "EV_EBITDA", "MULTIPLES_PE"],
    requiredConcepts: ["revenue", "ebitda margin", "free cash flow"],
    forbiddenConcepts: [
      "spectrum auction", "spectrum holdings", "4g/5g", "wafer fab", "refinery throughput", "crack spread", "clinical trial", "dark stores",
    ],
    unitEconomics: "Judged on reported revenue, margins, and cash conversion — no sector unit economics assumed.",
  },
};

/** Every supported sector must resolve to an explicit pack (no silent undefined). */
export function getSectorDriverPack(sectorId: SectorId): SectorDriverPack {
  return SECTOR_DRIVER_PACKS[sectorId] ?? SECTOR_DRIVER_PACKS.general;
}

/** True when the sector carries explicit operating content (general does not). */
export function isKnownSectorPack(sectorId: SectorId): boolean {
  return sectorId !== "general";
}
