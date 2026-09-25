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
      pdfComponent?: string;
    };

export interface ComposedPdfPlan {
  reportTitle: string;
  tocTitles: string[];
  pages: ComposedPdfPagePlan[];
  planHash: string | null;
  presentationHash: string | null;
}

export function composedPdfReportTitle(composed: ComposedReport): string {
  const identityTitle = composed.researchIdentity?.cover.title;
  if (identityTitle && identityTitle.trim().length > 3) return identityTitle;
  return getReportBlueprint(composed.blueprintId)?.title ?? "Institutional Equity Research";
}

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
  const planHash = (composed as { reportPlan?: { planHash?: string } }).reportPlan?.planHash ?? null;
  const presentationHash = (composed as { presentation?: { viewHash?: string } }).presentation?.viewHash ?? null;
  return { reportTitle, tocTitles, pages, planHash, presentationHash };
}

export function verifyComposedPdfPlan(plan: ComposedPdfPlan, composed: ComposedReport): boolean {
  if (!plan || !composed) return false;
  if (plan.tocTitles.length !== composed.toc.length) return false;
  const sectionPages = plan.pages.filter((p) => p.kind === "section");
  if (sectionPages.length !== composed.sections.length) return false;
  return true;
}
