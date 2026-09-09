// ============================================================
// APEX RESEARCH — Dependency-Aware Error & Confidence Propagation (P0 #7)
// ------------------------------------------------------------
// DAG: if debt invalid → netDebt invalid → EV invalid → equityValue invalid → targetPrice invalid.
// If tax uncertain → NOPAT/ROIC confidence falls. Errors cannot disappear downstream.
// Every derived field carries { valid, confidence, blockedBy[] } and the gate refuses downstream PASS when upstream blocked.
// ============================================================
import type { OutputConfidence } from "./financial-kernel";
import { propagateConfidence } from "./financial-kernel";

export type NodeId = "revenue" | "ebit" | "tax" | "nopat" | "depreciation" | "capex" | "nwc" | "fcff" | "wacc" | "terminal" | "ev" | "netDebt" | "equityValue" | "shares" | "fairValue" | "roic";

const DAG: Record<NodeId, NodeId[]> = {
  revenue: [],
  ebit: ["revenue"],
  tax: ["ebit"],
  nopat: ["ebit", "tax"],
  depreciation: [],
  capex: [],
  nwc: [],
  fcff: ["nopat", "depreciation", "capex", "nwc"],
  wacc: [],
  terminal: ["fcff", "wacc"],
  ev: ["fcff", "terminal", "wacc"],
  netDebt: [],
  equityValue: ["ev", "netDebt"],
  shares: [],
  fairValue: ["equityValue", "shares"],
  roic: ["nopat", "netDebt"],
};

export interface NodeState {
  valid: boolean;
  confidence: OutputConfidence;
  blockedBy: NodeId[];
  reason?: string;
}

export function propagateInvalid(initial: Partial<Record<NodeId, NodeState>>): Record<NodeId, NodeState> {
  const state: Record<NodeId, NodeState> = {} as Record<NodeId, NodeState>;
  const all: NodeId[] = ["revenue","ebit","tax","nopat","depreciation","capex","nwc","fcff","wacc","terminal","ev","netDebt","equityValue","shares","fairValue","roic"];
  for (const id of all) state[id] = initial[id] ?? { valid: true, confidence: "HIGH", blockedBy: [] };
  // topological propagation (DAG is acyclic by construction)
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of all) {
      for (const dep of DAG[id]) {
        if (!state[dep].valid && state[id].valid) {
          state[id] = { valid: false, confidence: "UNKNOWN", blockedBy: [...new Set([...state[id].blockedBy, dep, ...state[dep].blockedBy])], reason: `Blocked by ${dep}${state[dep].reason ? `: ${state[dep].reason}` : ""}` };
          changed = true;
        } else if (state[dep].confidence === "LOW" && state[id].confidence === "HIGH") {
          state[id].confidence = "MODERATE";
        } else if (state[dep].confidence === "UNKNOWN" && state[id].confidence !== "UNKNOWN") {
          state[id].confidence = "LOW";
        }
      }
    }
  }
  return state;
}

export function confidenceFromDAG(state: Record<NodeId, NodeState>): { level: OutputConfidence; reasons: string[] } {
  const invalid = (Object.entries(state) as Array<[NodeId, NodeState]>).filter(([, s]) => !s.valid).map(([k, s]) => `${k}←${s.blockedBy.join(",")}`);
  if (invalid.length > 0) return { level: "UNKNOWN", reasons: [`Blocked nodes: ${invalid.join("; ")}`] };
  const low = (Object.entries(state) as Array<[NodeId, NodeState]>).filter(([, s]) => s.confidence === "LOW").map(([k]) => k);
  if (low.length > 0) return propagateConfidence({ estimateRatio: 0.3, integrityWarns: low.length, integrityBlocks: 0, tvShareOfEv: 0.6, reverseConverged: true, insufficientData: false });
  return { level: "HIGH", reasons: ["All dependencies high-confidence."] };
}
