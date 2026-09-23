/**
 * APEX RESEARCH — ResearchCase module (Phase 1 entry point)
 *
 * Canonical report-agnostic research object + deterministic complexity engine.
 * Report blueprints, research modules and the report composer (later phases)
 * consume `buildResearchCase(...)` output — they do not rebuild financials.
 */
export * from "./types";
export * from "./complexity";
export { buildResearchCase } from "./builder";
