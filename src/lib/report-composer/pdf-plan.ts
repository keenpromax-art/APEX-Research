/**
 * APEX RESEARCH — Composed PDF page plan (presentation-only)
 * ----------------------------------------------------------
 * Pure mapping from a ComposedReport outline to the PDF body plan:
 *  - report title + cover TOC titles come from the blueprint (per report type)
 *  - sections with a `pdfComponent` map to the existing institutional pages
 *  - sections without one render via the generic ComposedSectionPage
 *  - advanced blueprints (no CoverPage section) get a prepended cover so every
 *    composed PDF opens with the type's TOC
 *
 * NON-NEGOTIABLE: no financial computation, no LLM, no page-count caps, no
 * conclusions. Institutional composed path stays identical (cover present,
 * every section mapped) — regression-pinned in scratch/test-report-ui.ts.
 */
import { getReportBlueprint } from "@/lib/report-types";
import type { ResearchModuleId } from "@/lib/research-modules";
import type { ComposedReport } from "./types";

export type ComposedPdfPagePlan =
  | { kind: "cover"; reportTitle: string; tocTitles: string[] }
  | {
      kind: "section";
      sectionId: string;
      title: string;
      modules: ResearchModuleId[];
      /** Institutional page component; undefined → generic module-data page. */
      pdfComponent?: string;
    };

export interface ComposedPdfPlan {
  /** Blueprint title; institutional string when the id is unknown. */
  reportTitle: string;
  /** Cover TOC titles in outline order (page numbers stay presentation-only). */
  tocTitles: string[];
  pages: ComposedPdfPagePlan[];
}

/** Blueprint display title for a composed report (fail-closed to institutional). */
export function composedPdfReportTitle(composed: ComposedReport): string {
  return getReportBlueprint(composed.blueprintId)?.title ?? "Institutional Equity Research";
}

/**
 * Build the PDF body plan for a composed report. Deterministic: same
 * ComposedReport → same plan. Empty section lists are the caller's legacy-path
 * concern — this helper assumes `composed.sections.length > 0`.
 */
export function planComposedPdf(composed: ComposedReport): ComposedPdfPlan {
  const reportTitle = composedPdfReportTitle(composed);
  const tocTitles = composed.toc.map((t) => t.title);
  const hasCover = composed.sections.some((s) => s.pdfComponent === "CoverPage");

  const pages: ComposedPdfPagePlan[] = [];
  if (!hasCover) {
    pages.push({ kind: "cover", reportTitle, tocTitles });
  }
  for (const s of composed.sections) {
    pages.push({
      kind: "section",
      sectionId: s.id,
      title: s.title,
      modules: [...s.modules],
      pdfComponent:
        typeof s.pdfComponent === "string" && s.pdfComponent.length > 0
          ? s.pdfComponent
          : undefined,
    });
  }
  return { reportTitle, tocTitles, pages };
}
