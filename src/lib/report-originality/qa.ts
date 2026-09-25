import type { OriginalityReport } from "./collision";
import { isOriginalityBlocking } from "./collision";

export interface OriginalityQaResult {
  passed: boolean;
  blockers: string[];
  warnings: string[];
  status: OriginalityReport["status"];
}

export function evaluateOriginalityQa(report: OriginalityReport | null, options: { peerTickers?: string[] } = {}): OriginalityQaResult {
  void options;
  if (!report) return { passed: true, blockers: [], warnings: ["Originality report is unavailable; publication proceeds on canonical QA alone."], status: "clear" };
  if (isOriginalityBlocking(report)) {
    return { passed: false, blockers: [`originality-collision: ${report.reasons.join("; ")}`], warnings: [], status: report.status };
  }
  if (report.status === "watch") {
    return { passed: true, blockers: [], warnings: [`originality-watch: ${report.reasons.join("; ")}`], status: report.status };
  }
  return { passed: true, blockers: [], warnings: [], status: report.status };
}

export function originalityGateForPublication(report: OriginalityReport | null): { publishAllowed: boolean; label: string; reasons: string[] } {
  const result = evaluateOriginalityQa(report);
  if (!result.passed) return { publishAllowed: false, label: "Diagnostic preview (non-publishable)", reasons: result.blockers };
  if (result.warnings.length > 0) return { publishAllowed: true, label: "Qualified PDF with disclosed qualifications", reasons: result.warnings };
  return { publishAllowed: true, label: "PDF", reasons: [] };
}
