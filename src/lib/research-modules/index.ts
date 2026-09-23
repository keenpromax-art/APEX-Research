/**
 * APEX RESEARCH — Research Modules (Phase 3 entry point)
 *
 * Deterministic wrappers around existing pipeline objects. Report blueprints
 * (Phase 4) select modules by id; the composer (Phase 5) consumes their
 * outputs. Modules do not rewrite financials, QA, or PDF logic.
 */
export * from "./types";
export { resolveValuationAnchors, resolveMoatAnchors } from "./anchors";
export type { ValuationAnchors, MoatAnchors } from "./anchors";
export {
  RESEARCH_MODULES,
  listResearchModules,
  getResearchModule,
  runResearchModules,
  getModuleData,
} from "./runner";
