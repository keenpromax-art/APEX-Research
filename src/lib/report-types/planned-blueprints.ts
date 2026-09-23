/**
 * Planned report-type blueprints (Phase 4 skeletons).
 * Registered so the UI/planner can enumerate types; full section grids land
 * in Phase 8 (advanced report types). None alter the existing PDF.
 */
import { REPORT_BLUEPRINTS_VERSION, type ReportBlueprint } from "./types";

export const TEARSHEET_V1: ReportBlueprint = {
  id: "tearsheet_v1",
  title: "Equity Tearsheet",
  description:
    "One-page investment snapshot: thesis anchors, valuation, quality, top risks/catalysts.",
  version: REPORT_BLUEPRINTS_VERSION,
  requiredModules: ["thesis", "valuation", "quality", "risk-catalyst", "peers"],
  toc: [
    { title: "Snapshot & Thesis", depth: "both" },
    { title: "Valuation & Scenarios", depth: "both" },
    { title: "Quality, Risks & Catalysts", depth: "both" },
  ],
  sections: [
    {
      id: "snapshot",
      title: "Investment Snapshot",
      modules: ["thesis", "valuation"],
      depth: null,
      includeWhen: "always",
    },
    {
      id: "valuation-snapshot",
      title: "Valuation & Scenarios",
      modules: ["valuation"],
      depth: null,
      includeWhen: "always",
    },
    {
      id: "quality-risks",
      title: "Quality, Risks & Catalysts",
      modules: ["quality", "risk-catalyst"],
      depth: null,
      includeWhen: "always",
    },
  ],
  defaultDepth: "concise",
  status: "planned",
};

export const VALUATION_DOSSIER_V1: ReportBlueprint = {
  id: "valuation_dossier_v1",
  title: "Valuation Dossier",
  description:
    "Deep valuation pack: model bridge, scenarios, sensitivity, methodology, audit annex.",
  version: REPORT_BLUEPRINTS_VERSION,
  requiredModules: ["valuation", "statements", "quality", "thesis"],
  toc: [
    { title: "Valuation Summary", depth: "both" },
    { title: "Scenarios & Sensitivity", depth: "both" },
    { title: "Methodology & Audit", depth: "both" },
  ],
  sections: [
    {
      id: "valuation-summary",
      title: "Valuation Summary",
      modules: ["valuation", "thesis"],
      depth: null,
      includeWhen: "always",
    },
    {
      id: "scenarios-sensitivity",
      title: "Scenarios & Sensitivity",
      modules: ["valuation"],
      depth: null,
      includeWhen: "always",
    },
    {
      id: "methodology-audit",
      title: "Methodology & Audit",
      modules: ["valuation", "quality"],
      depth: null,
      includeWhen: "always",
    },
  ],
  defaultDepth: "concise",
  status: "planned",
};

export const EARNINGS_DEEP_DIVE_V1: ReportBlueprint = {
  id: "earnings_deep_dive_v1",
  title: "Earnings Deep-Dive",
  description:
    "Quarterly results, guidance bridge, event reaction, and estimate revision view.",
  version: REPORT_BLUEPRINTS_VERSION,
  requiredModules: ["statements", "risk-catalyst", "quality", "thesis"],
  toc: [
    { title: "Quarterly Results", depth: "both" },
    { title: "Guidance & Estimates", depth: "both" },
    { title: "Market Reaction", depth: "both" },
  ],
  sections: [
    {
      id: "quarterly-results",
      title: "Quarterly Results",
      modules: ["statements"],
      depth: null,
      includeWhen: "always",
    },
    {
      id: "guidance-estimates",
      title: "Guidance & Estimates",
      modules: ["statements", "valuation"],
      depth: null,
      includeWhen: "always",
    },
    {
      id: "market-reaction",
      title: "Market Reaction",
      modules: ["risk-catalyst"],
      depth: null,
      includeWhen: "always",
    },
  ],
  defaultDepth: "concise",
  status: "planned",
};

export const FORENSIC_V1: ReportBlueprint = {
  id: "forensic_v1",
  title: "Forensic Accounting Review",
  description:
    "Accounting quality, identity checks, cash-flow anomalies, and disclosure red flags.",
  version: REPORT_BLUEPRINTS_VERSION,
  requiredModules: ["statements", "quality", "risk-catalyst", "business"],
  toc: [
    { title: "Accounting Quality", depth: "both" },
    { title: "Identities & Anomalies", depth: "both" },
    { title: "Disclosure Risks", depth: "both" },
  ],
  sections: [
    {
      id: "accounting-quality",
      title: "Accounting Quality",
      modules: ["quality", "statements"],
      depth: null,
      includeWhen: "always",
    },
    {
      id: "identities-anomalies",
      title: "Identities & Anomalies",
      modules: ["statements", "quality"],
      depth: null,
      includeWhen: "always",
    },
    {
      id: "disclosure-risks",
      title: "Disclosure Risks",
      modules: ["risk-catalyst", "quality"],
      depth: null,
      includeWhen: "always",
    },
  ],
  defaultDepth: "concise",
  status: "planned",
};
