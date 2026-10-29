import type { ExportPayload } from "../exporters";
import type { AgentAction, AgentResult, AgentSection } from "./types";
import { isNum, pct } from "../format";

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

export function sourcesAgent(payload: ExportPayload): AgentResult {
  const actions: AgentAction[] = [];
  const assumptions = payload.assumptions || payload.forecast?.assumptions || {};
  const driverSources = payload.assumption_sources || payload.forecast?.assumption_sources || null;
  const entries = Object.entries(assumptions).filter(([, v]) => isNum(v));
  if (entries.length) {
    const rows = entries.map(([key, value]) => ({
      driver: key.replace(/_/g, " "),
      value: pct(value as number, 2),
      source: driverSources ? String((driverSources as any)[key] ?? "Documented engine default") : "Documented engine default",
    }));
    actions.push(
      act("sources-01", "Sources Agent", "assumption sources", "sources", "addTable", `assumption_sources · ${entries.length} drivers`, 0.96, "Per-driver values and their provenance: derived from history, engine defaults, or user inputs.", { rows }),
    );
  }
  actions.push(
    act("sources-02", "Sources Agent", "engine version", "sources", "addPair", `Engine version · ${payload.engine_version || "—"}`, 0.9, "Deterministic engine build that produced the report."),
    act("sources-03", "Sources Agent", "data source", "sources", "addPair", `Data source · ${payload.data_source || "APEX local deterministic fixture"}`, 0.93, "Origin of market and statement data."),
    act("sources-04", "Sources Agent", "retrieved at", "sources", "addPair", `Retrieved · ${payload.retrieved_at || payload.generated_at || "—"}`, 0.92, "When the source data was captured."),
    act("sources-05", "Sources Agent", "methodology", "sources", "addText", "Forecast: deterministic three-statement model driven by documented assumptions. Valuation: unlevered FCF discounted at CAPM-built WACC with Gordon-growth or exit-multiple terminal value. Rating: mechanical band on model upside (BUY ≥ +10%, HOLD ±10%, SELL < −10%), withheld when integrity gates fail. Every figure is a model output.", 0.95, "Full methodology statement for the report."),
  );
  const findings = [`Sources: ${entries.length} documented assumption drivers, engine ${payload.engine_version || "n/a"}, data ${payload.data_source || "n/a"}.`];
  return { agentId: "sources-01", agentName: "Sources Agent", lens: "assumption sources & methodology", actions, findings, confidence: 0.94 };
}

export function sectorModelAgent(payload: ExportPayload): AgentResult {
  const actions: AgentAction[] = [];
  const sector = payload.sector_model || null;
  if (!sector) return { agentId: "sector-01", agentName: "Sector Model Agent", lens: "sector-specific model notes", actions, findings: ["No sector model available."], confidence: 0.6 };
  const lines: string[] = [];
  lines.push(`Approach: ${sector.valuationApproach || "Standard three-statement DCF"}.`);
  lines.push(`Applicable methods: ${Array.isArray(sector.applicableMethods) ? sector.applicableMethods.join(", ") : "DCF"}.`);
  if (sector.availableInputs?.length) lines.push(`Available inputs: ${sector.availableInputs.join(", ")}.`);
  if (sector.missingInputs?.length) lines.push(`Missing inputs: ${sector.missingInputs.join(", ")}.`);
  if (sector.limitations) lines.push(`Limitations: ${sector.limitations}.`);
  if (sector.modelOutputs && typeof sector.modelOutputs === "object") {
    const out = sector.modelOutputs as any;
    if (out.note) lines.push(`Sector note: ${out.note}.`);
    if (out.capex_intensity !== undefined) lines.push(`Capex intensity flag: ${out.capex_intensity}.`);
  }
  actions.push(
    act("sector-01", "Sector Model Agent", "sector model", "sources", "addText", lines.join(" "), 0.93, "Sector-specific valuation approach and data availability notes."),
  );
  const findings = [`Sector model: ${sector.key || "generic"} — ${sector.valuationApproach || "DCF"}, ${(sector.availableInputs?.length ?? 0)} available, ${(sector.missingInputs?.length ?? 0)} missing inputs.`];
  return { agentId: "sector-01", agentName: "Sector Model Agent", lens: "sector-specific model notes", actions, findings, confidence: 0.93 };
}

export function conclusionAgent(payload: ExportPayload): AgentResult {
  const actions: AgentAction[] = [];
  const report = payload.report || {};
  const drivers: string[] = Array.isArray(report.thesis_drivers) ? report.thesis_drivers : [];
  actions.push(
    act("conclusion-01", "Conclusion Agent", "conclusion", "conclusion", "addText", String(report.conclusion || "No conclusion available."), 0.96, "Final investment conclusion."),
    act("conclusion-02", "Conclusion Agent", "investment thesis", "conclusion", "addText", String(report.investment_thesis || ""), 0.95, "Core investment thesis narrative."),
    act("conclusion-03", "Conclusion Agent", "thesis drivers", "conclusion", "addText", drivers.length ? `Thesis drivers: ${drivers.join("; ")}` : "No thesis drivers recorded.", 0.94, "Itemized drivers supporting the thesis."),
    act("conclusion-04", "Conclusion Agent", "disclaimer", "conclusion", "addText", String(report.disclaimer || "Generated by the APEX deterministic engine. Research software, not investment advice."), 0.9, "Standard investment-research disclaimer."),
  );
  const findings = [`Conclusion: ${drivers.length} thesis drivers recorded.`];
  return { agentId: "conclusion-01", agentName: "Conclusion Agent", lens: "conclusion & thesis", actions, findings, confidence: 0.95 };
}
