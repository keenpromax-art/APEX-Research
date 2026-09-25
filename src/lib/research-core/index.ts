import type { CompanyUnderstanding, EconomicEngine, Risk, ScenarioSpecification, ThesisSpecification } from "@/lib/ai-first/types";
import type { BaselineReconciliation } from "@/lib/guidance-reconciliation";
import type { EvidenceRegistry } from "@/lib/evidence-registry";
import { extractStructuredClaims } from "@/lib/claims";
import { validateClaimSet } from "@/lib/claim-validator";

export type ThesisNodeStatus = "supported" | "partially-supported" | "unverified" | "contradicted";

export interface ThesisTreeNode {
  id: string;
  label: string;
  kind: "root" | "branch" | "leaf";
  status: ThesisNodeStatus;
  evidenceIds: string[];
  children: ThesisTreeNode[];
}

export interface ThesisTree {
  version: "thesis-tree-v1";
  root: ThesisTreeNode;
  unresolved: string[];
}

function nodeStatus(text: string, registry: EvidenceRegistry | null | undefined): { status: ThesisNodeStatus; evidenceIds: string[] } {
  const claims = extractStructuredClaims(text);
  if (claims.length === 0 || !registry) return { status: "unverified", evidenceIds: [] };
  const result = validateClaimSet(claims, registry);
  const material = claims.filter((claim) => claim.kind === "percentage" || claim.kind === "currency");
  const unsupported = result.verdicts.filter((verdict) => !verdict.supported && (verdict.kind === "percentage" || verdict.kind === "currency"));
  const evidenceIds = [...new Set(result.verdicts.filter((verdict) => verdict.supported && verdict.evidenceId).map((verdict) => verdict.evidenceId as string))].sort();
  if (unsupported.length > 0) return { status: material.length > 0 ? "partially-supported" : "unverified", evidenceIds };
  return { status: material.length > 0 && evidenceIds.length > 0 ? "supported" : "unverified", evidenceIds };
}

function leaf(id: string, text: string, registry: EvidenceRegistry | null | undefined): ThesisTreeNode {
  const result = nodeStatus(text, registry);
  return { id, label: text.trim().slice(0, 240) || "Unknown", kind: "leaf", status: result.status, evidenceIds: result.evidenceIds, children: [] };
}

export function buildThesisTree(thesis: ThesisSpecification | null | undefined, registry?: EvidenceRegistry | null): ThesisTree {
  const source = thesis ?? { thesis: "", bullCase: [], bearCase: [], keyDebate: "", keyInflectionPoints: [], whatMarketMayBeMissing: "", whatCouldInvalidate: [] };
  const children: ThesisTreeNode[] = [
    { id: "thesis:growth", label: "Growth case", kind: "branch", status: "unverified", evidenceIds: [], children: source.bullCase.map((text, index) => leaf(`thesis:growth:${index + 1}`, text, registry)) },
    { id: "thesis:risk", label: "Risk case", kind: "branch", status: "unverified", evidenceIds: [], children: source.bearCase.map((text, index) => leaf(`thesis:risk:${index + 1}`, text, registry)) },
    leaf("thesis:debate", source.keyDebate, registry),
    leaf("thesis:invalidation", source.whatCouldInvalidate.join("\n"), registry),
  ];
  const rootResult = nodeStatus(source.thesis, registry);
  const root: ThesisTreeNode = {
    id: "thesis:root",
    label: source.thesis || "Unknown thesis",
    kind: "root",
    status: rootResult.status,
    evidenceIds: rootResult.evidenceIds,
    children,
  };
  const unresolved: string[] = [];
  const visit = (node: ThesisTreeNode) => {
    if (node.status === "unverified" || node.status === "partially-supported") unresolved.push(node.label);
    node.children.forEach(visit);
  };
  visit(root);
  return { version: "thesis-tree-v1", root, unresolved: [...new Set(unresolved)] };
}

export interface ExpectationsGap {
  variable: string;
  marketImplied: number | null;
  modelValue: number | null;
  gap: number | null;
  unit: "decimal" | "currency" | "unknown";
  status: "quantified" | "unverified";
  interpretation: string;
}

export function buildExpectationsGap(input: {
  reverseValuation?: { variable: string; requiredValue: number; interpretation: string } | null;
  baselineReconciliation?: BaselineReconciliation | null;
}): ExpectationsGap {
  const reverse = input.reverseValuation;
  if (!reverse || !Number.isFinite(reverse.requiredValue)) {
    return { variable: reverse?.variable ?? "unknown", marketImplied: reverse?.requiredValue ?? null, modelValue: null, gap: null, unit: "unknown", status: "unverified", interpretation: "Market-implied expectations are not available." };
  }
  const variable = reverse.variable.toLowerCase();
  const row = input.baselineReconciliation?.rows.find((candidate) => {
    const metric = candidate.metric.toLowerCase();
    return variable.includes("cagr") || variable.includes("growth") ? metric.includes("revenue growth") : variable.includes("margin") ? metric.includes("margin") : false;
  });
  const modelValue = row?.modelValue ?? null;
  const gap = modelValue === null ? null : modelValue - reverse.requiredValue;
  const unit: ExpectationsGap["unit"] = variable.includes("cagr") || variable.includes("growth") || variable.includes("margin") || variable.includes("roe") || variable.includes("nim") ? "decimal" : "currency";
  return {
    variable: reverse.variable,
    marketImplied: reverse.requiredValue,
    modelValue,
    gap,
    unit,
    status: gap === null ? "unverified" : "quantified",
    interpretation: gap === null ? reverse.interpretation : `${reverse.interpretation} APEX model gap: ${gap >= 0 ? "+" : ""}${(gap * 100).toFixed(1)} percentage points.`,
  };
}

export interface RiskValueRow {
  risk: string;
  mechanism: string;
  monitoringIndicator: string;
  valuationConsequence: string;
  bearValue: number | null;
  baseValue: number | null;
  bullValue: number | null;
  downsideToBearPct: number | null;
  status: "scenario-linked" | "unquantified";
}

export function buildRiskValueMap(input: { risks: readonly Risk[]; scenarios: readonly ScenarioSpecification[]; currentPrice: number | null }): RiskValueRow[] {
  const bear = input.scenarios.find((scenario) => scenario.name === "bear")?.targetPrice ?? null;
  const base = input.scenarios.find((scenario) => scenario.name === "base")?.targetPrice ?? null;
  const bull = input.scenarios.find((scenario) => scenario.name === "bull")?.targetPrice ?? null;
  return input.risks.map((risk) => ({
    risk: risk.risk,
    mechanism: risk.mechanism,
    monitoringIndicator: risk.monitoringIndicator,
    valuationConsequence: risk.valuationConsequence,
    bearValue: bear,
    baseValue: base,
    bullValue: bull,
    downsideToBearPct: bear !== null && input.currentPrice !== null && input.currentPrice > 0 ? bear / input.currentPrice - 1 : null,
    status: bear !== null || base !== null || bull !== null ? "scenario-linked" : "unquantified",
  }));
}

export interface OperatingModelProfile {
  primaryAbstraction: string;
  revenueDrivers: string[];
  costDrivers: string[];
  marginDrivers: string[];
  capitalDrivers: string[];
  keyKpis: string[];
  valueQuestions: string[];
  confidence: number;
  source: "ai-economic-engine" | "company-understanding" | "unavailable";
}

export function buildOperatingModelProfile(input: { understanding?: CompanyUnderstanding | null; engine?: EconomicEngine | null }): OperatingModelProfile {
  if (input.engine) {
    return {
      primaryAbstraction: input.engine.primaryAbstraction,
      revenueDrivers: input.engine.revenueDrivers.map((driver) => driver.name),
      costDrivers: input.engine.costDrivers.map((driver) => driver.name),
      marginDrivers: input.engine.marginDrivers.map((driver) => driver.name),
      capitalDrivers: input.engine.capitalDrivers.map((driver) => driver.name),
      keyKpis: input.engine.keyKpis.map((kpi) => kpi.name),
      valueQuestions: [...input.engine.valueQuestions],
      confidence: input.engine.confidence,
      source: "ai-economic-engine",
    };
  }
  if (input.understanding) {
    return {
      primaryAbstraction: input.understanding.primaryEconomicAbstraction,
      revenueDrivers: input.understanding.revenueDrivers.map((driver) => driver.name),
      costDrivers: input.understanding.costDrivers.map((driver) => driver.name),
      marginDrivers: input.understanding.marginDrivers.map((driver) => driver.name),
      capitalDrivers: (input.understanding.capitalEngines ?? []).map((driver) => driver.name),
      keyKpis: input.understanding.keyKpis.map((kpi) => kpi.name),
      valueQuestions: [],
      confidence: input.understanding.confidence.overall,
      source: "company-understanding",
    };
  }
  return { primaryAbstraction: "Unknown", revenueDrivers: [], costDrivers: [], marginDrivers: [], capitalDrivers: [], keyKpis: [], valueQuestions: [], confidence: 0, source: "unavailable" };
}
