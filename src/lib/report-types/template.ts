import type { ReportBlueprint, ReportTypeId } from "./types";
import { getReportBlueprint } from "./registry";

export const BLUEPRINT_ROLE = "template";
export const BLUEPRINT_PRODUCTION_DRIVER = "report-plan";

export function isBlueprintTemplate(id: ReportTypeId): boolean {
  return getReportBlueprint(id) !== null;
}

export function blueprintAsTemplate(id: ReportTypeId): ReportBlueprint | null {
  const blueprint = getReportBlueprint(id);
  if (!blueprint) return null;
  return { ...blueprint, sections: blueprint.sections.map((section) => ({ ...section, modules: [...section.modules] })) };
}

export function blueprintRoleOf(id: ReportTypeId): string {
  return isBlueprintTemplate(id) ? BLUEPRINT_ROLE : "unknown";
}
