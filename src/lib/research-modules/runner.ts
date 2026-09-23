/**
 * Research module runner (Phase 3).
 * Deterministic, non-blocking: a module failure never sinks the bundle —
 * the failed module is recorded with `available: false` and an error string.
 */
import type {
  ModuleContext,
  ModuleRunBundle,
  ResearchModule,
  ResearchModuleId,
  ResearchModuleOutputMap,
  ResearchModuleRun,
} from "./types";
import { RESEARCH_MODULES_VERSION, RESEARCH_MODULE_ORDER } from "./types";
import {
  businessModule,
  statementsModule,
  valuationModule,
  peersModule,
  moatModule,
  riskCatalystModule,
  managementModule,
  qualityModule,
  thesisModule,
} from "./modules";

export const RESEARCH_MODULES: readonly ResearchModule<unknown>[] = [
  businessModule,
  statementsModule,
  valuationModule,
  peersModule,
  moatModule,
  riskCatalystModule,
  managementModule,
  qualityModule,
  thesisModule,
] as readonly ResearchModule<unknown>[];

const MODULE_BY_ID = new Map<ResearchModuleId, ResearchModule<unknown>>(
  RESEARCH_MODULES.map((m) => [m.id, m as ResearchModule<unknown>])
);

export function listResearchModules(): Array<{
  id: ResearchModuleId;
  title: string;
  feeds: string[];
}> {
  return RESEARCH_MODULES.map((m) => ({ id: m.id, title: m.title, feeds: [...m.feeds] }));
}

export function getResearchModule(
  id: ResearchModuleId
): ResearchModule<unknown> | null {
  return MODULE_BY_ID.get(id) ?? null;
}

function sortSelected(ids: ResearchModuleId[]): ResearchModuleId[] {
  const order = new Map(RESEARCH_MODULE_ORDER.map((id, i) => [id, i]));
  return [...ids].sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99));
}

/**
 * Run selected modules (default: full catalog in presentation order).
 * Each module sees the same ModuleContext — no cross-mutation.
 */
export function runResearchModules(
  ctx: ModuleContext,
  ids?: ResearchModuleId[]
): ModuleRunBundle {
  if (!ctx?.researchCase) {
    throw new Error("runResearchModules: researchCase is required");
  }

  const requested = ids?.length ? ids : [...RESEARCH_MODULE_ORDER];
  const unknownIds = requested.filter((id) => !MODULE_BY_ID.has(id));
  if (unknownIds.length > 0) {
    throw new Error(`runResearchModules: unknown module id(s): ${unknownIds.join(", ")}`);
  }
  const selected = sortSelected(requested);

  const modules: ResearchModuleRun[] = selected.map((id) => {
    const mod = MODULE_BY_ID.get(id)!;
    try {
      const result = mod.run(ctx);
      return {
        moduleId: mod.id,
        title: mod.title,
        feeds: [...mod.feeds],
        available: result.available,
        unknowns: [...result.unknowns],
        sources: [...result.sources],
        data: result.data,
      };
    } catch (e) {
      return {
        moduleId: mod.id,
        title: mod.title,
        feeds: [...mod.feeds],
        available: false,
        unknowns: [`MODULE_FAILED: ${e instanceof Error ? e.message : String(e)}`],
        sources: [],
        data: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  });

  const unknowns = modules.flatMap((m) => m.unknowns);

  return {
    caseId: ctx.researchCase.caseId,
    version: ctx.researchCase.version,
    modulesVersion: RESEARCH_MODULES_VERSION,
    ranAt: new Date().toISOString(),
    modules,
    unknowns,
  };
}

/** Typed accessor for a single module slice from a bundle. */
export function getModuleData<K extends ResearchModuleId>(
  bundle: ModuleRunBundle,
  id: K
): ResearchModuleOutputMap[K] | null {
  const run = bundle.modules.find((m) => m.moduleId === id);
  if (!run || !run.available || run.data == null) return null;
  return run.data as ResearchModuleOutputMap[K];
}
