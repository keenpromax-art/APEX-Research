import type { ExportPayload } from "../exporters";

export type AgentSection =
  | "cover"
  | "summary"
  | "company"
  | "financials"
  | "forecast"
  | "valuation"
  | "risks"
  | "modelQuality"
  | "sources"
  | "conclusion";

export type AgentActionKind =
  | "addTable"
  | "addChart"
  | "addText"
  | "addPair"
  | "addCallout"
  | "addSection";

export type AgentAction = {
  agentId: string;
  agentName: string;
  lens: string;
  section: AgentSection;
  kind: AgentActionKind;
  target: string;
  payload: any;
  confidence: number;
  rationale: string;
};

export type AgentResult = {
  agentId: string;
  agentName: string;
  lens: string;
  actions: AgentAction[];
  findings: string[];
  confidence: number;
};

export type AgentRegistry = Record<string, (payload: ExportPayload) => AgentResult>;

export type CoordinatorOutput = {
  actions: AgentAction[];
  findings: string[];
  agentCount: number;
  bySection: Record<AgentSection, AgentAction[]>;
};
