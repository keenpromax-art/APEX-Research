import type { ExportPayload } from "../exporters";
import type { AgentAction, AgentResult, AgentSection } from "./types";

const act = (
  agentId: string,
  agentName: string,
  lens: string,
  section: AgentSection,
  kind: AgentAction["kind"],
  target: string,
  confidence: number,
  rationale: string,
  payload: any = {},
): AgentAction => ({ agentId, agentName, lens, section, kind, target, payload, confidence, rationale });

export function riskAgent(payload: ExportPayload): AgentResult {
  const actions: AgentAction[] = [];
  const report = payload.report || {};
  const risks: any[] = Array.isArray(report.risks) ? report.risks : [];
  const strengths: string[] = Array.isArray(report.strengths) ? report.strengths : [];
  const catalysts: any[] = Array.isArray(report.catalysts) ? report.catalysts : [];
  if (strengths.length) {
    actions.push(act("risk-01", "Risk & Catalyst Agent", "strengths", "risks", "addText", `Strengths: ${strengths.join("; ")}`, 0.94, "Competitive advantages supporting the investment case."));
  }
  if (risks.length) {
    actions.push(act("risk-02", "Risk & Catalyst Agent", "risks", "risks", "addText", `Risks: ${risks.map((r: any) => (typeof r === "string" ? r : r.title || "Risk")).join("; ")}`, 0.95, "Key risks that could impair the investment case."));
    risks.forEach((risk, i) => {
      if (typeof risk === "object" && risk) {
        actions.push(act(`risk-02-${i}`, "Risk & Catalyst Agent", `risk detail: ${risk.title || "Risk"}`, "risks", "addText", `• ${risk.title || "Risk"} — ${risk.exposure ? `Exposure: ${risk.exposure}. ` : ""}${risk.impact ? `Impact: ${risk.impact}. ` : ""}${risk.monitoring_metric ? `Monitor: ${risk.monitoring_metric}.` : ""}`.trim(), 0.9, "Granular risk breakdown with exposure, impact and monitoring metric."));
      }
    });
  }
  if (catalysts.length) {
    actions.push(act("risk-03", "Risk & Catalyst Agent", "catalysts", "risks", "addText", `Catalysts: ${catalysts.map((c: any) => (typeof c === "string" ? c : c.title || "Catalyst")).join("; ")}`, 0.94, "Events that could drive a re-rating."));
    catalysts.forEach((c, i) => {
      if (typeof c === "object" && c) {
        actions.push(act(`risk-03-${i}`, "Risk & Catalyst Agent", `catalyst detail: ${c.title || "Catalyst"}`, "risks", "addText", `• ${c.title || "Catalyst"} — ${c.event ? `Event: ${c.event}. ` : ""}${c.timing ? `Timing: ${c.timing}. ` : ""}${c.grounding ? `Grounding: ${c.grounding}.` : ""}`.trim(), 0.9, "Granular catalyst breakdown with event, timing and grounding."));
      }
    });
  }
  const findings = [`Risks & catalysts: ${strengths.length} strengths, ${risks.length} risks, ${catalysts.length} catalysts identified.`];
  return { agentId: "risk-01", agentName: "Risk & Catalyst Agent", lens: "strengths / risks / catalysts", actions, findings, confidence: 0.94 };
}

export function modelQualityAgent(payload: ExportPayload): AgentResult {
  const actions: AgentAction[] = [];
  const report = payload.report || {};
  const forecast = payload.forecast || null;
  const dcf = payload.dcf || null;
  const validation: any[] = Array.isArray(payload.validation) ? payload.validation : [];
  const errors = validation.filter((v) => v.severity === "error" || v.blocking);
  const warns = validation.filter((v) => v.severity === "warn" && !v.blocking);
  actions.push(
    act("modelQuality-01", "Model Quality Agent", "conviction", "modelQuality", "addCallout", `Conviction: ${String((report.conviction?.level || "")).toUpperCase()}`, 0.96, "Analyst conviction level and its basis.", { accent: report.conviction?.level === "low" ? "amber" : "accent", titleColor: report.conviction?.level === "low" ? "amber" : "accent", body: String(report.conviction?.basis || "") }),
    act("modelQuality-02", "Model Quality Agent", "balance identity", "modelQuality", "addPair", `Balance-sheet identity · ${forecast?.summary?.balance_ok ? "Pass" : "Check residual"}`, forecast?.summary?.balance_ok ? 0.97 : 0.6, "Three-statement model balances in every forecast year."),
    act("modelQuality-03", "Model Quality Agent", "DCF produced value", "modelQuality", "addPair", `DCF produced a value · ${dcf && !dcf.error ? "Yes" : "No"}`, dcf && !dcf.error ? 0.97 : 0.5, "Whether the DCF model converged to a value."),
    act("modelQuality-04", "Model Quality Agent", "integrity errors", "modelQuality", "addPair", `Integrity errors (blocking) · ${errors.length}`, errors.length ? 0.4 : 0.97, "Blocking integrity checks that withhold the rating."),
    act("modelQuality-05", "Model Quality Agent", "integrity warnings", "modelQuality", "addPair", `Integrity warnings · ${warns.length}`, warns.length ? 0.7 : 0.95, "Non-blocking validation warnings."),
    act("modelQuality-06", "Model Quality Agent", "validation detail", "modelQuality", "addText", validation.map((v: any) => `[${v.severity === "error" || v.blocking ? "ERROR" : v.severity === "warn" ? "WARN" : "INFO"}] ${v.code}: ${v.message}`).join("; "), 0.92, "Itemized validation issues with severity."),
  );
  const findings = [`Model quality: conviction ${String(report.conviction?.level || "n/a")}, ${errors.length} blocking errors, ${warns.length} warnings.`];
  return { agentId: "modelQuality-01", agentName: "Model Quality Agent", lens: "conviction & integrity", actions, findings, confidence: 0.94 };
}

export function dataQualityAgent(payload: ExportPayload): AgentResult {
  const actions: AgentAction[] = [];
  const alerts: any[] = Array.isArray(payload.data_quality?.alerts) ? payload.data_quality.alerts : [];
  if (!alerts.length) return { agentId: "dataQuality-01", agentName: "Data Quality Agent", lens: "data quality & coverage", actions, findings: ["No data-quality alerts."], confidence: 0.8 };
  actions.push(
    act("dataQuality-01", "Data Quality Agent", "alerts", "sources", "addText", `Data quality & coverage: ${alerts.map((a) => `[${String(a.level || "info").toUpperCase()}] [${String(a.mode || "engine")}] ${String(a.message)}`).join("; ")}`, 0.94, "Provider and engine data-quality flags that qualify the report's figures."),
  );
  const findings = [`Data quality: ${alerts.length} alerts across providers and engine.`];
  return { agentId: "dataQuality-01", agentName: "Data Quality Agent", lens: "data quality & coverage", actions, findings, confidence: 0.94 };
}
