/**
 * institutional_equity_v1 — the existing multi-page institutional equity
 * research report. Section titles and render order are the golden contract
 * against `src/components/PDFDocument/index.tsx` (TOC + ReportDocument).
 *
 * Depth semantics match `concise = true|false` on ReportDocument:
 *  - concise: load-bearing surfaces only (default)
 *  - full: adds credit, management, events, methodology, AI disclosure pages
 */
import { REPORT_BLUEPRINTS_VERSION, type ReportBlueprint, type ResearchDepth, type TocEntryBlueprint } from "./types";

/** Cover TOC — concise mode (PDFDocument CoverPage). */
const TOC_CONCISE: TocEntryBlueprint[] = [
  { title: "Executive Summary & Thesis", depth: "both" },
  { title: "Valuation: DCF, Scenarios & Sensitivity", depth: "both" },
  { title: "Moat & Price / Fair Value", depth: "both" },
  { title: "Bulls / Bears, Risks & Catalysts", depth: "both" },
  { title: "Multi-Year Statement Models", depth: "both" },
  { title: "Comparable Company Comps", depth: "both" },
  { title: "QA Checksum & Disclosures", depth: "both" },
];

/** Full-mode TOC titles in PDF print order (distinct list, not a merge). */
const TOC_FULL: TocEntryBlueprint[] = [
  { title: "Executive Summary & Thesis", depth: "both" },
  { title: "Credit & Solvency Analysis", depth: "full" },
  { title: "Management & Governance", depth: "full" },
  { title: "Catalysts & Market Reaction", depth: "full" },
  { title: "Multi-Year Statement Models", depth: "both" },
  { title: "Comparable Company Comps", depth: "both" },
  { title: "Valuation & Credit Models", depth: "full" },
  { title: "Statutory Disclosures & QA", depth: "full" },
];

/**
 * Page-sections in ReportDocument render order.
 * `depth: null` = both; `"full"` = full only.
 */
const SECTIONS: Array<{
  id: string;
  title: string;
  modules: readonly string[];
  depth: ResearchDepth | null;
  includeWhen?: "always" | "researchDebates";
  pdfComponent: string;
}> = [
  { id: "cover", title: "Cover & Report Contents", modules: ["business", "thesis"], depth: null, pdfComponent: "CoverPage" },
  {
    id: "research-debates",
    title: "Research Debates & Evidence Map",
    modules: ["thesis", "quality"],
    depth: null,
    includeWhen: "researchDebates",
    pdfComponent: "ResearchDebatesPage",
  },
  { id: "fundamental-analysis", title: "Fundamental & Valuation Analysis", modules: ["valuation", "statements"], depth: null, pdfComponent: "FundamentalAnalysisPage" },
  { id: "moat-price-fair-value", title: "Competitive Moat & Price / Fair Value", modules: ["moat", "valuation"], depth: null, pdfComponent: "MoatAndPriceFairValuePage" },
  { id: "moat-sources", title: "Moat Sources & Industry Structure", modules: ["moat", "business"], depth: "full", pdfComponent: "MoatSourcesPage" },
  { id: "bulls-bears", title: "Bulls Say / Bears Say & Strategic Catalysts", modules: ["risk-catalyst", "thesis"], depth: null, pdfComponent: "BullsSayBearsSayPage" },
  { id: "credit-analysis-1", title: "Institutional Credit Analysis", modules: ["statements", "quality"], depth: "full", pdfComponent: "CreditAnalysisPage1" },
  { id: "credit-analysis-2", title: "Capital Structure & Enterprise Risk", modules: ["statements", "risk-catalyst"], depth: "full", pdfComponent: "CreditAnalysisPage2" },
  { id: "management-1", title: "Management & Governance", modules: ["management"], depth: "full", pdfComponent: "ManagementAndOwnershipPage1" },
  { id: "management-2", title: "Capital Allocation & Corporate Strategy", modules: ["management"], depth: "full", pdfComponent: "ManagementAndOwnershipPage2" },
  { id: "event-price-movement", title: "Event-Based Price Movement & Market Reaction", modules: ["risk-catalyst"], depth: "full", pdfComponent: "EventBasedPriceMovementPage" },
  { id: "disclosures-catalysts", title: "Corporate Disclosures & Catalyst Transmission", modules: ["risk-catalyst", "quality"], depth: "full", pdfComponent: "CorporateDisclosuresAndCatalystsPage" },
  { id: "analyst-forecasts", title: "Analyst Forecasts & Financial Summary", modules: ["statements", "valuation"], depth: "full", pdfComponent: "AnalystForecastsSummaryPage" },
  { id: "income-statement", title: "Income Statement Multi-Year Model", modules: ["statements"], depth: null, pdfComponent: "IncomeStatementDetailedPage" },
  { id: "balance-sheet", title: "Balance Sheet Multi-Year Model", modules: ["statements"], depth: null, pdfComponent: "BalanceSheetDetailedPage" },
  { id: "cash-flow", title: "Cash Flow Multi-Year Model", modules: ["statements"], depth: null, pdfComponent: "CashFlowDetailedPage" },
  { id: "comps-1", title: "Comparable Company Analysis", modules: ["peers"], depth: null, pdfComponent: "ComparableCompanyAnalysisPage1" },
  { id: "comps-2", title: "Comparable Company Analysis (Profitability & Leverage)", modules: ["peers"], depth: "full", pdfComponent: "ComparableCompanyAnalysisPage2" },
  { id: "methodology-1", title: "Institutional Research Methodology", modules: ["valuation"], depth: "full", pdfComponent: "ResearchMethodologyValuationPage1" },
  { id: "methodology-2", title: "Valuation Uncertainty & Margin of Safety", modules: ["valuation", "quality"], depth: "full", pdfComponent: "ResearchMethodologyValuationPage2" },
  { id: "credit-rating-1", title: "Corporate Credit Rating Framework", modules: ["statements", "quality"], depth: "full", pdfComponent: "CreditRatingApproachPage1" },
  { id: "credit-rating-2", title: "Corporate Credit Assessment & Solvency Scorecard", modules: ["statements", "quality"], depth: "full", pdfComponent: "CreditRatingApproachPage2" },
  { id: "disclaimer", title: "Statutory Disclosures & Limitation of Liability", modules: ["quality"], depth: null, pdfComponent: "InstitutionalDisclaimerPage" },
  { id: "analyst-ai-disclosure", title: "Analyst Certifications & AI Safe Harbor", modules: ["quality"], depth: "full", pdfComponent: "AnalystAIDisclosurePage" },
  { id: "qa-checksum", title: "Valuation Integrity & Quality Assurance Audit", modules: ["quality", "valuation"], depth: null, pdfComponent: "QualityAssuranceChecksumPage" },
];

/**
 * Depth-aware TOC rows for the institutional blueprint.
 * Template stored as concise rows (`both`) + full-only rows (`full`) so a
 * naive depth filter would over-emit full; resolve uses these helpers instead.
 */
export function institutionalTocForDepth(depth: ResearchDepth): TocEntryBlueprint[] {
  const source = depth === "concise" ? TOC_CONCISE : TOC_FULL;
  return source.map((row) => ({ ...row }));
}

export function institutionalConciseTocTitles(): string[] {
  return institutionalTocForDepth("concise").map((t) => t.title);
}

export function institutionalFullTocTitles(): string[] {
  return institutionalTocForDepth("full").map((t) => t.title);
}

/**
 * Template toc: full list is authoritative for `full` resolution via helper;
 * stored rows cover concise (`both`) + full-only (`full`) for generic filters.
 */
const TOC_TEMPLATE: TocEntryBlueprint[] = [
  ...TOC_CONCISE.map((t) => ({ ...t })),
  ...TOC_FULL.filter((t) => t.depth === "full").map((t) => ({ ...t })),
];

export const INSTITUTIONAL_EQUITY_V1: ReportBlueprint = {
  id: "institutional_equity_v1",
  title: "Institutional Equity Research",
  description:
    "Full institutional equity research report (thesis, valuation, moat, risks, statements, comps, QA). Matches the existing PDF pipeline.",
  version: REPORT_BLUEPRINTS_VERSION,
  requiredModules: [
    "business",
    "statements",
    "valuation",
    "peers",
    "moat",
    "risk-catalyst",
    "management",
    "quality",
    "thesis",
  ],
  toc: TOC_TEMPLATE,
  sections: SECTIONS.map((s) => ({
    id: s.id,
    title: s.title,
    modules: [...s.modules] as ReportBlueprint["sections"][number]["modules"],
    depth: s.depth,
    includeWhen: s.includeWhen ?? "always",
    pdfComponent: s.pdfComponent,
  })),
  defaultDepth: "concise",
  status: "stable",
};
