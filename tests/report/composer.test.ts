import { createSuite, check, report } from "../helpers/assert";
import { composeReport } from "../../src/lib/report-composer/compose";
import { getReportBlueprint, resolveReportOutline } from "../../src/lib/report-types";

const suite = createSuite();

function minimalCase(): Record<string, unknown> {
  return {
    caseId: "RC-COMPAT-001",
    company: { id: "TEST", ticker: "TEST", name: "Test Co", exchange: "NSE" },
    dataCutoff: "2026-09-25",
    createdAt: "2026-09-25T12:00:00.000Z",
    assumptionsLedger: { rating: "HOLD", targetPrice: 100, fairValue: 100, currentPrice: 95 },
    thesis: { statement: "Deterministic thesis fixture", keyDebate: null, invalidation: [] },
    forecast: { projectionCount: 0, rows: [] },
    evidence: { evidenceCount: 0, conflictCount: 0 },
    unknowns: [],
  };
}

check(suite, "institutional blueprint resolves", getReportBlueprint("institutional_equity_v1") !== null);
check(suite, "outline resolves sections", resolveReportOutline(getReportBlueprint("institutional_equity_v1")!, {} as never).sections.length > 0);
check(suite, "composer requires research case", (() => {
  try {
    composeReport({ context: {} as never });
    return false;
  } catch {
    return true;
  }
})());
check(suite, "composer produces versioned report", (() => {
  const context = { researchCase: minimalCase(), researchReport: null, evidenceGraph: null } as never;
  const composed = composeReport({ context, composedAt: "2026-09-25T12:00:00.000Z" });
  return composed.version === "report-composer-v1" && composed.sections.length > 0 && composed.caseId === "RC-COMPAT-001";
})());
check(suite, "missing modules stay null with unknowns", (() => {
  const context = { researchCase: minimalCase(), researchReport: null, evidenceGraph: null } as never;
  const composed = composeReport({ context, composedAt: "2026-09-25T12:00:00.000Z" });
  return Array.isArray(composed.unknowns) && composed.sections.every((s) => typeof s.index === "number" && typeof s.title === "string");
})());

report(suite, "report/composer");
