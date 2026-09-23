/**
 * Outline resolution — pure, deterministic.
 * Filters TOC + sections by research depth and conditional gates; never
 * invents sections and never assigns page numbers.
 */
import { RESEARCH_MODULE_ORDER, type ResearchModuleId } from "@/lib/research-modules";
import { institutionalTocForDepth } from "./institutional-equity";
import type {
  ReportBlueprint,
  ResolveSectionsInput,
  ResearchDepth,
  ResolvedReportOutline,
  ResolvedSection,
  ResolvedTocEntry,
  SectionBlueprint,
} from "./types";

function resolveDepth(
  blueprint: ReportBlueprint,
  input: ResolveSectionsInput
): ResearchDepth {
  return input.depth ?? blueprint.defaultDepth;
}

function includeSection(
  section: SectionBlueprint,
  depth: ResearchDepth,
  input: ResolveSectionsInput
): boolean {
  if (section.depth != null && section.depth !== depth) return false;

  const when = section.includeWhen ?? "always";
  if (when === "always") return true;

  if (when === "researchDebates") {
    // Mirrors ResearchDebatesPage: omit when no debates and no research report.
    if (input.hasResearchDebates === true) return true;
    if (input.researchReport != null) return true;
    if (input.researchCaseHasResearch === true) return true;
    return false;
  }

  return true;
}

function resolveToc(blueprint: ReportBlueprint, depth: ResearchDepth): ResolvedTocEntry[] {
  if (blueprint.id === "institutional_equity_v1") {
    return institutionalTocForDepth(depth).map((row, i) => ({ ...row, index: i + 1 }));
  }

  const out: ResolvedTocEntry[] = [];
  for (const row of blueprint.toc) {
    if (row.depth === "both" || row.depth === depth) {
      out.push({ ...row, index: out.length + 1 });
    }
  }
  return out;
}

export function resolveReportOutline(
  blueprint: ReportBlueprint,
  input: ResolveSectionsInput = {}
): ResolvedReportOutline {
  if (!blueprint?.id) {
    throw new Error("resolveReportOutline: blueprint is required");
  }
  const depth = resolveDepth(blueprint, input);

  const sections: ResolvedSection[] = [];
  for (const section of blueprint.sections) {
    if (!includeSection(section, depth, input)) continue;
    sections.push({ ...section, index: sections.length + 1 });
  }

  const toc = resolveToc(blueprint, depth);

  const needed = new Set<ResearchModuleId>(blueprint.requiredModules);
  for (const s of sections) for (const m of s.modules) needed.add(m);
  const moduleIds = RESEARCH_MODULE_ORDER.filter((id) => needed.has(id));

  return {
    blueprintId: blueprint.id,
    depth,
    toc,
    sections,
    moduleIds,
  };
}
