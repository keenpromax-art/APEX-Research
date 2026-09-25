import { stableHash } from "@/lib/research-ledger/stable";
import { getReportBlueprint, resolveReportOutline } from "@/lib/report-types";
import type { ResearchModuleId } from "@/lib/research-modules";
import type { ReportTypeId, ResearchDepth } from "@/lib/report-types";
import type { CanonicalResearchPackage } from "@/lib/research-package/types";
import type { ResearchDNA } from "@/lib/research-identity";
import type { ResearchPlan } from "@/lib/ai-first/research-planner";
import { REPORT_PLAN_VERSION, REPORT_PLAN_HASH_DOMAIN } from "./types";
import type { CompileReportPlanInput, ReportPlan, ReportPlanCompatibility, ReportPlanSection } from "./types";

function finiteDepth(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    const rounded = Math.round(value);
    if (rounded >= 0 && rounded <= 5) return rounded;
  }
  return fallback;
}
function finitePriority(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    const rounded = Math.round(value);
    if (rounded >= 0 && rounded <= 100) return rounded;
  }
  return fallback;
}

function cleanText(value: unknown, max = 280): string {
  if (typeof value !== "string") return "";
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.length > max ? cleaned.slice(0, max) : cleaned;
}

function dedupeStrings(values: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out.sort();
}

function planIdFor(ticker: string, blueprintId: ReportTypeId, depth: ResearchDepth, packageId: string | null, generatedAt: string): string {
  const digest = stableHash({ ticker, blueprintId, depth, packageId, generatedAt }, REPORT_PLAN_HASH_DOMAIN + "/id");
  return `RPLAN-${digest.slice(0, 24).toUpperCase()}`;
}

function defaultCompatibility(blueprintId: ReportTypeId, depth: ResearchDepth): ReportPlanCompatibility {
  return {
    status: "supported",
    capability: `${blueprintId} at ${depth} depth is supported as a template-derived plan`,
    reasons: [],
  };
}

function questionsForModules(questions: Array<{ question: string; requiredFor: string }>, modules: ResearchModuleId[]): string[] {
  const wanted = new Set(modules.map((m) => m.toLowerCase()));
  const out: string[] = [];
  for (const q of questions) {
    const text = cleanText(q.question, 280);
    if (!text) continue;
    const target = String(q.requiredFor ?? "").toLowerCase();
    if (wanted.has(target) || target === "model" || target === "thesis" || target === "valuation" || out.length < 6) {
      if (!out.includes(text)) out.push(text);
    }
  }
  return out.slice(0, 8);
}

export function compileReportPlanFromParts(input: CompileReportPlanInput): ReportPlan {
  const blueprintId = input.blueprintId ?? "institutional_equity_v1";
  const depth = input.depth ?? "concise";
  const generatedAt = input.generatedAt;
  const templateSections = input.blueprintSections ?? [];
  const identityById = new Map((input.identitySections ?? []).map((s) => [s.sectionId, s]));
  const researchQuestions = (input.researchQuestions ?? []).map((q) => ({ question: String(q.question ?? ""), requiredFor: String(q.requiredFor ?? "") })).filter((q) => q.question.trim().length > 0);
  const sections: ReportPlanSection[] = templateSections.map((template, index) => {
    const wired = identityById.get(template.id);
    const order = wired ? wired.order : index + 1;
    const depthValue = wired ? finiteDepth(wired.depth, 2) : 2;
    const priority = wired ? finitePriority(wired.priority, 50) : 50;
    const include = wired ? Boolean(wired.include) : true;
    const mandatory = wired ? Boolean(wired.mandatory) : false;
    const chartIds = dedupeStrings([...(wired?.chartIds ?? []), ...((input.identityChartIds ?? []).filter(() => false))]).slice(0, 12);
    const tableIds = dedupeStrings([...(wired?.tableIds ?? []), ...((input.identityTableIds ?? []).filter(() => false))]).slice(0, 12);
    const sourceQuestions = questionsForModules(researchQuestions, template.modules);
    const requiredEvidence = dedupeStrings([...(input.requiredEvidence ?? [])].slice(0, 4)).slice(0, 8);
    const missing = new Set(input.missingEvidence ?? []);
    const coverage = !include ? "unavailable" as const : template.modules.length === 0 ? "partial" as const : missing.size > 0 ? "partial" as const : "ready" as const;
    return {
      id: template.id,
      title: template.title,
      order,
      depth: depthValue,
      priority,
      include,
      mandatory,
      modules: [...template.modules],
      sourceQuestions,
      requiredEvidence,
      chartIds: wired ? [...wired.chartIds].sort().slice(0, 12) : chartIds,
      tableIds: wired ? [...wired.tableIds].sort().slice(0, 12) : tableIds,
      rationale: wired && wired.rationale ? cleanText(wired.rationale, 280) : `Template section ${template.id} retained from blueprint ${blueprintId} as template`,
      coverage,
    };
  });
  const identityExtras = (input.identitySections ?? []).filter((s) => !templateSections.some((t) => t.id === s.sectionId));
  for (const extra of identityExtras) {
    if (!extra.include) continue;
    sections.push({
      id: extra.sectionId,
      title: extra.title,
      order: extra.order,
      depth: finiteDepth(extra.depth, 2),
      priority: finitePriority(extra.priority, 50),
      include: true,
      mandatory: Boolean(extra.mandatory),
      modules: [],
      sourceQuestions: questionsForModules(researchQuestions, []),
      requiredEvidence: dedupeStrings([...(input.requiredEvidence ?? [])].slice(0, 4)).slice(0, 8),
      chartIds: [...extra.chartIds].sort().slice(0, 12),
      tableIds: [...extra.tableIds].sort().slice(0, 12),
      rationale: cleanText(extra.rationale, 280) || `Company-specific section ${extra.sectionId}`,
      coverage: "ready",
    });
  }
  sections.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  sections.forEach((s, i) => { s.order = i + 1; });
  const moduleSet = new Set<ResearchModuleId>();
  for (const s of sections) for (const m of s.modules) moduleSet.add(m);
  for (const m of input.blueprintModuleIds ?? []) moduleSet.add(m);
  const moduleIds = [...moduleSet].sort();
  const chartRequirements = dedupeStrings((input.identityChartIds ?? []).slice(0, 40));
  const tableRequirements = dedupeStrings((input.identityTableIds ?? []).slice(0, 40));
  const requiredEvidence = dedupeStrings([...(input.requiredEvidence ?? [])].slice(0, 40));
  const missingEvidence = dedupeStrings([...(input.missingEvidence ?? [])].slice(0, 40));
  const included = sections.filter((s) => s.include);
  const coverageScore = typeof input.coverageScore === "number" && Number.isFinite(input.coverageScore) ? Math.max(0, Math.min(1, input.coverageScore)) : included.length === 0 ? 0 : Math.round((included.filter((s) => s.coverage === "ready").length / Math.max(1, included.length)) * 1000) / 1000;
  const compatibility = input.compatibility ?? defaultCompatibility(blueprintId, depth);
  const unresolvedBlockers = dedupeStrings([...(input.qualityBlockers ?? []), ...missingEvidence.map((m) => `missing-evidence: ${m}`)].slice(0, 40));
  const warnings = (input.qualityWarnings ?? []).map((w) => w.trim()).filter(Boolean);
  void warnings;
  const planId = planIdFor(input.ticker, blueprintId, depth, input.packageId ?? null, generatedAt);
  const provisional = {
    version: REPORT_PLAN_VERSION as "report-plan-v1",
    planId,
    ticker: input.ticker,
    caseId: input.caseId ?? null,
    packageId: input.packageId ?? null,
    blueprintIdAsTemplate: blueprintId,
    depth,
    generatedAt,
    sections,
    moduleIds,
    chartRequirements,
    tableRequirements,
    requiredEvidence,
    coverage: {
      totalSections: sections.length,
      includedSections: included.length,
      availableEvidence: requiredEvidence.length - missingEvidence.length,
      missingEvidence,
      coverageScore,
    },
    unresolvedBlockers,
    compatibility,
  };
  const planHash = stableHash(provisional, REPORT_PLAN_HASH_DOMAIN);
  return { ...provisional, planHash };
}

export interface CompilePlanFromPackageInput {
  packageValue: CanonicalResearchPackage;
  blueprintId?: ReportTypeId;
  depth?: ResearchDepth;
  identity?: ResearchDNA | null;
  researchPlan?: ResearchPlan | null;
  generatedAt: string;
}

export function compileReportPlan(input: CompilePlanFromPackageInput): ReportPlan {
  const pkg = input.packageValue;
  const blueprintId = input.blueprintId ?? "institutional_equity_v1";
  const depth = input.depth ?? "concise";
  const blueprint = getReportBlueprint(blueprintId);
  const outline = blueprint ? resolveReportOutline(blueprint, { depth, researchReport: pkg.researchReport ?? null, hasResearchDebates: Boolean(pkg.researchReport?.debates?.length), researchCaseHasResearch: Boolean(pkg.researchReport) }) : null;
  const templateSections = (outline?.sections ?? blueprint?.sections ?? []).map((s) => ({ id: s.id, title: s.title, modules: [...s.modules] as ResearchModuleId[] }));
  const identity = input.identity ?? null;
  const identitySections = (identity?.sections.sections ?? []).map((s) => ({ sectionId: s.sectionId, title: s.title, order: s.order, depth: s.depth, priority: s.priority, include: s.include, mandatory: s.mandatory, chartIds: [...s.chartIds].sort(), tableIds: [...s.tableIds].sort(), rationale: s.rationale }));
  const identityChartIds = (identity?.charts.selected ?? []).map((c) => c.id);
  const identityTableIds = (identity?.tables.selected ?? []).map((t) => t.id);
  const plan = input.researchPlan ?? pkg.researchPlan ?? null;
  const researchQuestions = (plan?.questions ?? []).map((q) => ({ question: String((q as { question?: unknown }).question ?? ""), requiredFor: String((q as { requiredFor?: unknown }).requiredFor ?? "") }));
  const evidenceItems = (() => {
    const registry = pkg.evidenceRegistry as unknown as { items?: Array<{ id?: string }> } | undefined;
    const items = Array.isArray(registry?.items) ? registry.items : [];
    return items.map((item) => String(item.id ?? "")).filter(Boolean).slice(0, 40);
  })();
  const missingEvidence = (() => {
    const out: string[] = [];
    const quality = pkg.quality;
    for (const blocker of quality.blockers ?? []) {
      const text = String(blocker ?? "").trim();
      if (text && out.length < 20) out.push(text);
    }
    return out;
  })();
  const compatibility: ReportPlanCompatibility = identity?.compatibility ? { status: identity.compatibility.status === "supported" ? "supported" as const : identity.compatibility.status === "limited" ? "limited" as const : "unsupported" as const, capability: identity.compatibility.capability, reasons: [...identity.compatibility.reasons] } : defaultCompatibility(blueprintId, depth);
  const coverageScore = identity ? undefined : undefined;
  void coverageScore;
  return compileReportPlanFromParts({
    ticker: pkg.ticker,
    caseId: null,
    packageId: (pkg as { packageId?: string }).packageId ?? null,
    blueprintId,
    depth,
    generatedAt: input.generatedAt,
    blueprintSections: templateSections,
    blueprintModuleIds: outline?.moduleIds ? [...outline.moduleIds] : [],
    identitySections,
    identityChartIds,
    identityTableIds,
    researchQuestions,
    requiredEvidence: evidenceItems,
    missingEvidence,
    qualityBlockers: [...(pkg.quality.blockers ?? [])],
    qualityWarnings: [...(pkg.quality.warnings ?? [])],
    compatibility,
  });
}

export function verifyReportPlan(value: unknown): value is ReportPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as ReportPlan;
  if (candidate.version !== REPORT_PLAN_VERSION) return false;
  if (typeof candidate.planId !== "string" || !candidate.planId.startsWith("RPLAN-")) return false;
  if (typeof candidate.ticker !== "string" || !candidate.ticker) return false;
  if (typeof candidate.planHash !== "string" || candidate.planHash.length !== 64) return false;
  if (!Array.isArray(candidate.sections)) return false;
  const recomputed = stableHash({
    version: candidate.version,
    planId: candidate.planId,
    ticker: candidate.ticker,
    caseId: candidate.caseId,
    packageId: candidate.packageId,
    blueprintIdAsTemplate: candidate.blueprintIdAsTemplate,
    depth: candidate.depth,
    generatedAt: candidate.generatedAt,
    sections: candidate.sections,
    moduleIds: candidate.moduleIds,
    chartRequirements: candidate.chartRequirements,
    tableRequirements: candidate.tableRequirements,
    requiredEvidence: candidate.requiredEvidence,
    coverage: candidate.coverage,
    unresolvedBlockers: candidate.unresolvedBlockers,
    compatibility: candidate.compatibility,
  }, REPORT_PLAN_HASH_DOMAIN);
  return recomputed === candidate.planHash;
}
