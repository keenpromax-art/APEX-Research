/**
 * Pure progress-step builder — kept out of the React component so tests can
 * assert per-report-type labels without importing CSS modules.
 * Step keys/order are fixed (shared generation phases); labels 03–05 carry
 * the selected blueprint title so every report type reads distinctly.
 */
import type { GenerationStep } from "@/types/report";

export interface ProgressStep {
  key: GenerationStep;
  label: string;
  index: string;
}

export const STEP_ORDER: GenerationStep[] = [
  "fetching_data",
  "calculating",
  "generating_ai",
  "building_pdf",
  "done",
];

export const DEFAULT_PROGRESS_TITLE = "Institutional Equity Research";

export function buildProgressSteps(reportTitle?: string): ProgressStep[] {
  const title = reportTitle?.trim() || DEFAULT_PROGRESS_TITLE;
  return [
    { key: "fetching_data", label: "Querying Yahoo Finance Market Data", index: "01" },
    { key: "calculating", label: "Computing Financial Ratios & DCF Model", index: "02" },
    { key: "generating_ai", label: `Structuring ${title}`, index: "03" },
    { key: "building_pdf", label: `Assembling ${title} Dossier`, index: "04" },
    { key: "done", label: `${title} Ready`, index: "05" },
  ];
}
