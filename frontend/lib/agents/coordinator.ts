import type { ExportPayload } from "../exporters";
import type { AgentAction, AgentRegistry, AgentResult, CoordinatorOutput, AgentSection } from "./types";
import { coverAgent, summaryAgent, companyAgent } from "./cover";
import { incomeAgent, balanceAgent, cashFlowAgent, ratioAgent, growthAgent, marginAgent, returnAgent, leverageAgent, perShareAgent } from "./financials";
import { forecastAgent, dcfAgent, sensitivityAgent, reverseDcfAgent, scenarioAgent, monteCarloAgent, peerCompsAgent } from "./forecast";
import { riskAgent, modelQualityAgent, dataQualityAgent } from "./risks";
import { sourcesAgent, sectorModelAgent, conclusionAgent } from "./sources";

const REGISTRY: AgentRegistry = {
  "cover": coverAgent,
  "summary": summaryAgent,
  "company": companyAgent,
  "income": incomeAgent,
  "balance": balanceAgent,
  "cashflow": cashFlowAgent,
  "ratio": ratioAgent,
  "growth": growthAgent,
  "margin": marginAgent,
  "return": returnAgent,
  "leverage": leverageAgent,
  "perShare": perShareAgent,
  "forecast": forecastAgent,
  "dcf": dcfAgent,
  "sensitivity": sensitivityAgent,
  "reverseDcf": reverseDcfAgent,
  "scenario": scenarioAgent,
  "monteCarlo": monteCarloAgent,
  "peerComps": peerCompsAgent,
  "risk": riskAgent,
  "modelQuality": modelQualityAgent,
  "dataQuality": dataQualityAgent,
  "sources": sourcesAgent,
  "sectorModel": sectorModelAgent,
  "conclusion": conclusionAgent,
};

export const AGENT_IDS = Object.keys(REGISTRY);
export const AGENT_COUNT = AGENT_IDS.length;

export function runAgents(payload: ExportPayload): CoordinatorOutput {
  const actions: AgentAction[] = [];
  const findings: string[] = [];
  let agentCount = 0;

  for (const [id, fn] of Object.entries(REGISTRY)) {
    try {
      const result: AgentResult = fn(payload);
      agentCount += 1;
      actions.push(...result.actions);
      findings.push(...result.findings.map((f) => `[${id}] ${f}`));
    } catch (err) {
      findings.push(`[${id}] agent error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const bySection: Record<AgentSection, AgentAction[]> = {
    cover: [],
    summary: [],
    company: [],
    financials: [],
    forecast: [],
    valuation: [],
    risks: [],
    modelQuality: [],
    sources: [],
    conclusion: [],
  };
  for (const action of actions) {
    if (bySection[action.section]) bySection[action.section].push(action);
  }

  return { actions, findings, agentCount, bySection };
}

export { REGISTRY };
export type { AgentAction, AgentResult, CoordinatorOutput };
