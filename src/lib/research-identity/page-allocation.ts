import type {
  MaterialityProfile,
  PageAllocation,
  PageAllocationPlan,
  SectionArchitecture,
  SignatureAnalysis,
} from "./types";

/** Presentation-only units-per-page estimate. Never a cap on report length. */
export const PAGE_ALLOCATION_UNITS_PER_PAGE = 3;

export function buildPageAllocation(input: {
  materiality: MaterialityProfile;
  sections: SectionArchitecture;
  signatures: SignatureAnalysis[];
  chartCounts: Map<string, number>;
  tableCounts: Map<string, number>;
}): PageAllocationPlan {
  const signatureIds = new Set(input.signatures.map((s) => s.id));
  const allocations: PageAllocation[] = input.sections.included.map((section) => {
    const chartCount = input.chartCounts.get(section.sectionId) ?? section.chartIds.length;
    const tableCount = input.tableCounts.get(section.sectionId) ?? section.tableIds.length;
    const signatureBoost = section.signatureIds.some((id) => signatureIds.has(id)) ? 2 : 0;
    const spaceUnits = Math.max(1, section.depth + chartCount + tableCount + signatureBoost);
    return {
      sectionId: section.sectionId,
      title: section.title,
      depth: section.depth,
      spaceUnits,
      relativeShare: 0,
      estimatedPages: 0,
      chartCount,
      tableCount,
      rationale: `Depth ${section.depth} with ${chartCount} chart(s), ${tableCount} table(s)${signatureBoost > 0 ? " and signature expansion" : ""}.`,
    };
  });
  const totalUnits = allocations.reduce((sum, a) => sum + a.spaceUnits, 0);
  for (const allocation of allocations) {
    allocation.relativeShare = totalUnits > 0 ? Math.round((allocation.spaceUnits / totalUnits) * 1000) / 1000 : 0;
    allocation.estimatedPages =
      Math.round((allocation.spaceUnits / PAGE_ALLOCATION_UNITS_PER_PAGE) * 100) / 100;
  }
  const estimatedPages =
    Math.round((totalUnits / PAGE_ALLOCATION_UNITS_PER_PAGE) * 100) / 100;
  return {
    status: allocations.length > 0 ? "available" : "unavailable",
    totalUnits,
    estimatedPages,
    allocations,
  };
}
