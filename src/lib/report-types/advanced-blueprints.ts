/**
 * Advanced report-type blueprints (Phase 8).
 *
 * Ten specialized report types over the SAME Phase 3 module catalog and
 * Phase 4 contracts. Section titles are report-type copy — never
 * company-specific conclusions. No page caps. Existing institutional PDF
 * output is unchanged (these types are additive registry entries).
 *
 * PHASE 8 RULES (non-negotiable):
 *  - Modules ⊆ {business, statements, valuation, peers, moat, risk-catalyst,
 *    management, quality, thesis} — no parallel calculators.
 *  - Golden cases live in scratch/test-advanced-blueprints.ts (TOC + section
 *    order per type, concise and full).
 *  - Bank / insurance / REIT blueprints wire sector-native statements through
 *    the same `statements` module — sector architecture stays on the case.
 */
import { REPORT_BLUEPRINTS_VERSION, type ReportBlueprint, type SectionBlueprint } from "./types";

type Spec = Omit<ReportBlueprint, "version" | "defaultDepth" | "status"> &
  Partial<Pick<ReportBlueprint, "defaultDepth" | "status">>;

function bp(spec: Spec): ReportBlueprint {
  return {
    version: REPORT_BLUEPRINTS_VERSION,
    defaultDepth: spec.defaultDepth ?? "concise",
    status: spec.status ?? "stable",
    ...spec,
    sections: spec.sections.map((s) => ({ includeWhen: "always" as const, ...s })),
  };
}

// ── Industry ───────────────────────────────────────────────────────────

export const INDUSTRY_V1: ReportBlueprint = bp({
  id: "industry_v1",
  title: "Industry Research",
  description:
    "Sector structure, competitive landscape, economics/cycles, and valuation benchmarks.",
  requiredModules: ["business", "statements", "valuation", "peers", "moat", "risk-catalyst"],
  toc: [
    { title: "Industry Structure", depth: "both" },
    { title: "Competitive Landscape", depth: "both" },
    { title: "Economics & Cycles", depth: "both" },
    { title: "Sector Valuation Benchmarks", depth: "both" },
  ],
  sections: [
    { id: "industry-structure", title: "Industry Structure", modules: ["business", "moat"], depth: null },
    { id: "competitive-landscape", title: "Competitive Landscape", modules: ["peers", "moat"], depth: null },
    { id: "sector-economics", title: "Economics & Cycles", modules: ["statements", "business"], depth: null },
    { id: "valuation-benchmarks", title: "Sector Valuation Benchmarks", modules: ["valuation", "peers"], depth: null },
    { id: "regulatory-outlook", title: "Regulatory & Policy Outlook", modules: ["business", "risk-catalyst"], depth: "full" },
  ],
});

// ── Competitive ────────────────────────────────────────────────────────

export const COMPETITIVE_V1: ReportBlueprint = bp({
  id: "competitive_v1",
  title: "Competitive Analysis",
  description:
    "Peer set, market position, moat durability, and relative valuation.",
  requiredModules: ["business", "peers", "moat", "valuation", "quality", "risk-catalyst"],
  toc: [
    { title: "Competitive Set", depth: "both" },
    { title: "Market Position", depth: "both" },
    { title: "Moat Analysis", depth: "both" },
    { title: "Relative Valuation", depth: "both" },
  ],
  sections: [
    { id: "competitive-set", title: "Competitive Set", modules: ["peers", "business"], depth: null },
    { id: "market-position", title: "Market Position", modules: ["moat", "business"], depth: null },
    { id: "moat-analysis", title: "Moat Analysis", modules: ["moat", "quality"], depth: null },
    { id: "relative-valuation", title: "Relative Valuation", modules: ["valuation", "peers"], depth: null },
    { id: "share-dynamics", title: "Share Dynamics & Entry Threats", modules: ["peers", "risk-catalyst"], depth: "full" },
  ],
});

// ── Management ─────────────────────────────────────────────────────────

export const MANAGEMENT_V1: ReportBlueprint = bp({
  id: "management_v1",
  title: "Management & Governance Review",
  description:
    "Leadership track record, governance, capital allocation, and ownership structure.",
  requiredModules: ["management", "quality", "valuation", "thesis"],
  toc: [
    { title: "Leadership", depth: "both" },
    { title: "Governance", depth: "both" },
    { title: "Capital Allocation", depth: "both" },
    { title: "Ownership", depth: "both" },
  ],
  sections: [
    { id: "leadership", title: "Leadership", modules: ["management"], depth: null },
    { id: "governance", title: "Governance", modules: ["management", "quality"], depth: null },
    { id: "capital-allocation", title: "Capital Allocation", modules: ["management", "valuation"], depth: null },
    { id: "ownership", title: "Ownership", modules: ["management", "quality"], depth: null },
    { id: "incentives", title: "Incentives & Succession", modules: ["management", "thesis"], depth: "full" },
  ],
});

// ── Risk ───────────────────────────────────────────────────────────────

export const RISK_V1: ReportBlueprint = bp({
  id: "risk_v1",
  title: "Risk Report",
  description:
    "Risk register, scenario stress, catalyst timeline, and ongoing monitoring.",
  requiredModules: ["risk-catalyst", "quality", "valuation", "thesis"],
  toc: [
    { title: "Risk Register", depth: "both" },
    { title: "Scenario Stress", depth: "both" },
    { title: "Catalysts & Timeline", depth: "both" },
    { title: "Monitoring Dashboard", depth: "both" },
  ],
  sections: [
    { id: "risk-register", title: "Risk Register", modules: ["risk-catalyst", "quality"], depth: null },
    { id: "scenario-stress", title: "Scenario Stress", modules: ["valuation", "risk-catalyst"], depth: null },
    { id: "catalysts-timeline", title: "Catalysts & Timeline", modules: ["risk-catalyst", "thesis"], depth: null },
    { id: "monitoring-dashboard", title: "Monitoring Dashboard", modules: ["quality", "risk-catalyst"], depth: null },
    { id: "tail-risks", title: "Tail Risks & Invalidations", modules: ["risk-catalyst", "valuation"], depth: "full" },
  ],
});

// ── SOTP ───────────────────────────────────────────────────────────────

export const SOTP_V1: ReportBlueprint = bp({
  id: "sotp_v1",
  title: "Sum-of-the-Parts Valuation",
  description:
    "Segment map, per-segment valuation, bridge to equity, and scenario SOTP.",
  requiredModules: ["business", "statements", "valuation", "thesis", "quality"],
  toc: [
    { title: "Segment Map", depth: "both" },
    { title: "Segment Valuation", depth: "both" },
    { title: "Bridge to Equity", depth: "both" },
    { title: "Scenarios", depth: "both" },
  ],
  sections: [
    { id: "segment-map", title: "Segment Map", modules: ["business", "statements"], depth: null },
    { id: "segment-valuation", title: "Segment Valuation", modules: ["valuation", "business"], depth: null },
    { id: "bridge-equity", title: "Bridge to Equity", modules: ["valuation", "statements"], depth: null },
    { id: "sotp-scenarios", title: "Scenarios", modules: ["valuation", "thesis"], depth: null },
    { id: "holdco-discount", title: "Holdco Discount & Cross-Holdings", modules: ["valuation", "quality"], depth: "full" },
  ],
});

// ── Bank ───────────────────────────────────────────────────────────────

export const BANK_V1: ReportBlueprint = bp({
  id: "bank_v1",
  title: "Banking Sector Report",
  description:
    "Franchise & deposits, asset quality, capital/profitability, and bank valuation.",
  requiredModules: ["business", "statements", "valuation", "quality", "risk-catalyst", "peers"],
  toc: [
    { title: "Franchise & Deposits", depth: "both" },
    { title: "Asset Quality", depth: "both" },
    { title: "Capital & Profitability", depth: "both" },
    { title: "Bank Valuation", depth: "both" },
  ],
  sections: [
    { id: "franchise-deposits", title: "Franchise & Deposits", modules: ["business", "statements"], depth: null },
    { id: "asset-quality", title: "Asset Quality", modules: ["statements", "quality", "risk-catalyst"], depth: null },
    { id: "capital-profitability", title: "Capital & Profitability", modules: ["statements", "valuation"], depth: null },
    { id: "bank-valuation", title: "Bank Valuation", modules: ["valuation", "peers"], depth: null },
    { id: "nim-sensitivity", title: "NIM & Rate Sensitivity", modules: ["statements", "valuation"], depth: "full" },
    { id: "regulatory-capital", title: "Regulatory Capital Framework", modules: ["statements", "quality"], depth: "full" },
  ],
});

// ── Insurance ──────────────────────────────────────────────────────────

export const INSURANCE_V1: ReportBlueprint = bp({
  id: "insurance_v1",
  title: "Insurance Sector Report",
  description:
    "Underwriting & float, reserves & solvency, embedded value, and insurance valuation.",
  requiredModules: ["business", "statements", "valuation", "quality", "risk-catalyst", "peers"],
  toc: [
    { title: "Underwriting & Float", depth: "both" },
    { title: "Reserves & Solvency", depth: "both" },
    { title: "Embedded Value", depth: "both" },
    { title: "Insurance Valuation", depth: "both" },
  ],
  sections: [
    { id: "underwriting-float", title: "Underwriting & Float", modules: ["business", "statements"], depth: null },
    { id: "reserves-solvency", title: "Reserves & Solvency", modules: ["statements", "quality", "risk-catalyst"], depth: null },
    { id: "embedded-value", title: "Embedded Value", modules: ["valuation", "statements"], depth: null },
    { id: "insurance-valuation", title: "Insurance Valuation", modules: ["valuation", "peers"], depth: null },
    { id: "combined-ratio", title: "Combined Ratio Trends", modules: ["statements", "quality"], depth: "full" },
  ],
});

// ── REIT ───────────────────────────────────────────────────────────────

export const REIT_V1: ReportBlueprint = bp({
  id: "reit_v1",
  title: "REIT Report",
  description:
    "Portfolio & occupancy, NAV & distributions, tenant credit, and REIT valuation.",
  requiredModules: ["business", "statements", "valuation", "quality", "risk-catalyst", "peers"],
  toc: [
    { title: "Portfolio & Occupancy", depth: "both" },
    { title: "NAV & Distributions", depth: "both" },
    { title: "Tenant Credit", depth: "both" },
    { title: "REIT Valuation", depth: "both" },
  ],
  sections: [
    { id: "portfolio-occupancy", title: "Portfolio & Occupancy", modules: ["business", "statements"], depth: null },
    { id: "nav-distributions", title: "NAV & Distributions", modules: ["valuation", "statements"], depth: null },
    { id: "tenant-credit", title: "Tenant Credit", modules: ["quality", "risk-catalyst"], depth: null },
    { id: "reit-valuation", title: "REIT Valuation", modules: ["valuation", "peers"], depth: null },
    { id: "lease-roll", title: "Lease Roll & WALE", modules: ["statements", "risk-catalyst"], depth: "full" },
  ],
});

// ── Special situation ──────────────────────────────────────────────────

export const SPECIAL_SITUATION_V1: ReportBlueprint = bp({
  id: "special_situation_v1",
  title: "Special Situation Report",
  description:
    "Situation thesis, catalyst timeline, scenario valuation, and invalidation risks.",
  requiredModules: ["thesis", "business", "risk-catalyst", "valuation", "quality", "management"],
  toc: [
    { title: "Situation Thesis", depth: "both" },
    { title: "Catalyst Timeline", depth: "both" },
    { title: "Scenario Valuation", depth: "both" },
    { title: "Risks & Invalidation", depth: "both" },
  ],
  sections: [
    { id: "situation-thesis", title: "Situation Thesis", modules: ["thesis", "business"], depth: null },
    { id: "catalyst-timeline", title: "Catalyst Timeline", modules: ["risk-catalyst", "thesis"], depth: null },
    { id: "scenario-valuation", title: "Scenario Valuation", modules: ["valuation", "risk-catalyst"], depth: null },
    { id: "risks-invalidation", title: "Risks & Invalidation", modules: ["risk-catalyst", "quality"], depth: null },
    { id: "event-drivers", title: "Event Drivers & Stakeholders", modules: ["management", "risk-catalyst"], depth: "full" },
  ],
});

// ── Portfolio ──────────────────────────────────────────────────────────

export const PORTFOLIO_V1: ReportBlueprint = bp({
  id: "portfolio_v1",
  title: "Portfolio Report",
  description:
    "Holdings overview, allocation & exposure, risk/return, and action list.",
  requiredModules: ["thesis", "business", "peers", "statements", "risk-catalyst", "valuation", "quality"],
  toc: [
    { title: "Holdings Overview", depth: "both" },
    { title: "Allocation & Exposure", depth: "both" },
    { title: "Risk & Return", depth: "both" },
    { title: "Action List", depth: "both" },
  ],
  sections: [
    { id: "holdings-overview", title: "Holdings Overview", modules: ["thesis", "business"], depth: null },
    { id: "allocation-exposure", title: "Allocation & Exposure", modules: ["peers", "statements"], depth: null },
    { id: "risk-return", title: "Risk & Return", modules: ["risk-catalyst", "valuation"], depth: null },
    { id: "action-list", title: "Action List", modules: ["thesis", "valuation", "quality"], depth: null },
    { id: "concentration", title: "Concentration & Liquidity", modules: ["quality", "risk-catalyst"], depth: "full" },
  ],
});

/** Phase 8 advanced blueprints in registry order. */
export const ADVANCED_BLUEPRINTS: readonly ReportBlueprint[] = [
  INDUSTRY_V1,
  COMPETITIVE_V1,
  MANAGEMENT_V1,
  RISK_V1,
  SOTP_V1,
  BANK_V1,
  INSURANCE_V1,
  REIT_V1,
  SPECIAL_SITUATION_V1,
  PORTFOLIO_V1,
] as const;

// Type-level guard: SectionBlueprint import keeps `depth`/`includeWhen` honest.
export type AdvancedSection = SectionBlueprint;
