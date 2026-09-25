/**
 * buildEvidenceGraph — pure, deterministic Source → Evidence → Claim →
 * Analysis → Conclusion → Section graph over existing canonical objects.
 *
 * Claim extraction + validation reuse `extractClaims` / `validateClaimSet`
 * (claim-validator is the sole scoring engine). Section/module edges come
 * from the Phase 3/4 wiring already on the case — never recomputed here.
 */
import { extractStructuredClaims, type Claim } from "@/lib/claims";
import { validateClaimSet } from "@/lib/claim-validator";
import { resolveValuationAnchors } from "@/lib/research-modules";
import { getEvidence, listEvidenceConflicts, type EvidenceItem } from "@/lib/evidence-registry";
import type { ResearchModuleId } from "@/lib/research-modules";
import type {
  BuildEvidenceGraphInput,
  ClaimTrace,
  EvidenceGraph,
  EvidenceGraphEdge,
  EvidenceGraphNode,
  EvidenceNarrative,
  EvidenceGraphQuestion,
  EvidenceGraphConflict,
  ResearchCompleteness,
} from "./types";
import { EVIDENCE_GRAPH_VERSION } from "./types";

const MATERIAL_KINDS: ReadonlySet<Claim["kind"]> = new Set(["percentage", "currency"]);

function pushUnique<T>(list: T[], item: T, key: (x: T) => string): void {
  const k = key(item);
  if (!list.some((x) => key(x) === k)) list.push(item);
}

function pushEdge(edges: EvidenceGraphEdge[], e: EvidenceGraphEdge): void {
  pushUnique(edges, e, (x) => `${x.from}|${x.kind}|${x.to}`);
}

function emptyCompleteness(): ResearchCompleteness {
  return { totalQuestions: 0, addressedQuestions: 0, evidenceBackedQuestions: 0, unresolvedQuestions: 0, score: 1, evidenceScore: 1 };
}

function sectionIdOf(s: { id: string }): string {
  return s.id;
}

/** Conclusion node from single-source valuation anchors (never a parallel FV). */
function conclusionLabel(input: BuildEvidenceGraphInput): {
  id: string;
  label: string;
  meta: Record<string, string | number | boolean | null>;
} | null {
  const anchors = resolveValuationAnchors(input.researchCase);
  const rating = anchors.rating;
  const fairValue = anchors.fairValue;
  if (rating == null && fairValue == null) return null;
  return {
    id: "conclusion:valuation",
    label:
      rating != null
        ? `Valuation conclusion: ${rating}${fairValue != null ? ` @ FV ${fairValue}` : ""}`
        : `Valuation conclusion: FV ${fairValue}`,
    meta: {
      rating: rating ?? null,
      fairValue: fairValue ?? null,
      source: anchors.anchorsFrom ?? null,
    },
  };
}

function moduleAnalysisNode(
  run: { moduleId: ResearchModuleId; title: string; available: boolean }
): EvidenceGraphNode {
  return {
    id: `analysis:${run.moduleId}`,
    kind: "analysis",
    label: run.title,
    ref: run.moduleId,
    meta: { available: run.available },
  };
}

function addEvidenceNode(
  nodes: EvidenceGraphNode[],
  edges: EvidenceGraphEdge[],
  item: EvidenceItem
): { sourceId: string; evidenceId: string } {
  const sourceId = `source:${item.tier}:${item.source}`;
  const evidenceId = `evidence:${item.id}`;
  pushUnique(nodes, { id: sourceId, kind: "source", label: item.source, ref: item.tier, meta: { tier: item.tier, reliability: item.reliabilityScore ?? null } }, (node) => node.id);
  pushUnique(nodes, { id: evidenceId, kind: "evidence", label: `${item.field}${item.note ? ` (${item.note})` : ""}`, ref: item.id, meta: { tier: item.tier, field: item.field, period: item.periodCovered ?? null, currency: item.currency ?? null, scale: item.scale ?? null } }, (node) => node.id);
  pushEdge(edges, { from: sourceId, to: evidenceId, kind: "source-produces-evidence" });
  return { sourceId, evidenceId };
}

export function buildEvidenceGraph(input: BuildEvidenceGraphInput): EvidenceGraph {
  const rc = input.researchCase;
  const builtAt = input.builtAt ?? new Date().toISOString();
  const nodes: EvidenceGraphNode[] = [];
  const edges: EvidenceGraphEdge[] = [];
  const blockers: string[] = [];
  const unknowns: string[] = [];
  const claims: ClaimTrace[] = [];
  const questions: EvidenceGraphQuestion[] = [];
  const conflicts: EvidenceGraphConflict[] = [];

  if (!rc?.caseId) {
    return {
      version: EVIDENCE_GRAPH_VERSION,
      caseId: "",
      builtAt,
      nodes,
      edges,
      claims,
      questions,
      conflicts,
      completeness: emptyCompleteness(),
      materialClaimsTraceable: false,
      materialClaimCount: 0,
      traceableMaterialCount: 0,
      blockers: ["NO_RESEARCH_CASE"],
      unknowns: ["ResearchCase absent — evidence graph cannot be built."],
    };
  }

  // ── Registry (Source + Evidence nodes) ──────────────────────────────
  const registry = input.registry !== undefined ? input.registry : rc.evidence;
  if (!registry || registry.items.length === 0) {
    blockers.push("EVIDENCE_REGISTRY_MISSING");
    unknowns.push(
      "EvidenceRegistry absent or empty — material claims cannot be traced to a source."
    );
  } else {
    for (const item of registry.items) addEvidenceNode(nodes, edges, item);
    for (const conflict of listEvidenceConflicts(registry)) {
      const nodeId = `conflict:${conflict.id}`;
      pushUnique(nodes, {
        id: nodeId,
        kind: "conflict",
        label: `${conflict.field}: ${conflict.reason}`,
        ref: conflict.id,
        meta: {
          field: conflict.field,
          reason: conflict.reason,
          resolution: conflict.resolution,
          material: conflict.material,
        },
      }, (node) => node.id);
      const selected = addEvidenceNode(nodes, edges, conflict.selected);
      const existing = addEvidenceNode(nodes, edges, conflict.existing);
      const incoming = addEvidenceNode(nodes, edges, conflict.incoming);
      for (const evidenceId of new Set([selected.evidenceId, existing.evidenceId, incoming.evidenceId])) {
        pushEdge(edges, { from: nodeId, to: evidenceId, kind: "conflict-informs-evidence" });
      }
      conflicts.push({
        id: conflict.id,
        nodeId,
        field: conflict.field,
        reason: conflict.reason,
        selectedEvidenceId: conflict.selected.id,
        incomingEvidenceIds: [conflict.existing.id, conflict.incoming.id].filter((id) => id !== conflict.selected.id),
        material: conflict.material,
      });
    }
  }

  for (const [index, question] of (rc.researchQuestions ?? []).entries()) {
    const nodeId = `question:${index + 1}`;
    pushUnique(nodes, {
      id: nodeId,
      kind: "question",
      label: question.question,
      ref: `research-question:${index + 1}`,
      meta: {
        requiredFor: question.requiredFor,
        evidenceNeeded: question.evidenceNeeded,
        yfinanceAvailable: question.yfinanceAvailable,
      },
    }, (node) => node.id);
    questions.push({
      id: `question:${index + 1}`,
      nodeId,
      question: question.question,
      requiredFor: question.requiredFor,
      evidenceNeeded: question.evidenceNeeded,
    });
  }

  // ── Sections (Section nodes + module feed edges) ────────────────────
  const sections = input.sections ?? [];
  const sectionIds = new Set<string>();
  for (const s of sections) {
    const id = sectionIdOf(s);
    sectionIds.add(id);
    pushUnique(
      nodes,
      {
        id: `section:${id}`,
        kind: "section",
        label: s.title,
        ref: id,
        meta: { index: "index" in s ? s.index : null },
      },
      (n) => n.id
    );
    for (const mod of s.modules ?? []) {
      pushEdge(edges, {
        from: `analysis:${mod}`,
        to: `section:${id}`,
        kind: "analysis-feeds-section",
      });
    }
  }

  // ── Analysis (Module runs) ──────────────────────────────────────────
  const moduleIds = new Set<ResearchModuleId>();
  if (input.modules?.modules?.length) {
    for (const run of input.modules.modules) {
      moduleIds.add(run.moduleId);
      pushUnique(nodes, moduleAnalysisNode(run), (n) => n.id);
      if (!run.available) {
        unknowns.push(`Module ${run.moduleId} unavailable — analysis node marked available=false.`);
      }
    }
  } else if (sections.length > 0) {
    // Sections declare wiring even when the runner bundle was not supplied.
    for (const s of sections) {
      for (const mod of s.modules ?? []) {
        moduleIds.add(mod);
        pushUnique(
          nodes,
          {
            id: `analysis:${mod}`,
            kind: "analysis",
            label: mod,
            ref: mod,
            meta: { available: null },
          },
          (n) => n.id
        );
      }
    }
    unknowns.push(
      "ModuleRunBundle not provided — analysis nodes derived from section module ids only."
    );
  } else {
    unknowns.push("No sections or module bundle — analysis stage empty.");
  }

  // ── Conclusion ──────────────────────────────────────────────────────
  const conclusion = conclusionLabel(input);
  if (conclusion) {
    pushUnique(
      nodes,
      {
        id: conclusion.id,
        kind: "conclusion",
        label: conclusion.label,
        ref: conclusion.id,
        meta: conclusion.meta,
      },
      (n) => n.id
    );
    if (moduleIds.has("valuation")) {
      pushEdge(edges, {
        from: "analysis:valuation",
        to: conclusion.id,
        kind: "analysis-supports-conclusion",
      });
    }
    for (const s of sections) {
      pushEdge(edges, {
        from: conclusion.id,
        to: `section:${sectionIdOf(s)}`,
        kind: "conclusion-feeds-section",
      });
    }
  } else {
    unknowns.push(
      "Valuation anchors unavailable (no ledger/facts/dcf rating or fair value) — conclusion node omitted."
    );
  }

  for (const question of questions) {
    const required = question.requiredFor.toLowerCase();
    const target = [...moduleIds].find((moduleId) => required === moduleId || required.includes(moduleId));
    if (target) {
      pushEdge(edges, { from: question.nodeId, to: `analysis:${target}`, kind: "question-informs-analysis" });
    } else if (conclusion) {
      pushEdge(edges, { from: question.nodeId, to: conclusion.id, kind: "question-informs-analysis" });
    }
  }

  // ── Claims from narratives ──────────────────────────────────────────
  const narratives: EvidenceNarrative[] = input.narratives ?? [];
  if (narratives.length === 0) {
    unknowns.push("No narratives supplied — no claims extracted (never invent prose here).");
  }

  for (const narrative of narratives) {
    const text = narrative.text ?? "";
    if (!text.trim()) continue;
    const extracted = extractStructuredClaims(text);
    if (extracted.length === 0) continue;

    const verdicts = registry ? validateClaimSet(extracted, registry) : null;
    const role = narrative.role ?? "analysis";
    const stance = narrative.stance ?? "supports";
    const sectionId = narrative.sectionId ?? null;
    const moduleId = narrative.moduleId ?? null;
    const questionNode = narrative.questionId
      ? questions.find((question) => question.id === narrative.questionId || question.nodeId === narrative.questionId || question.question === narrative.questionId)
      : null;

    if (moduleId) {
      pushUnique(nodes, {
        id: `analysis:${moduleId}`,
        kind: "analysis",
        label: moduleId,
        ref: moduleId,
        meta: { available: null },
      }, (node) => node.id);
    }
    if (sectionId && !sectionIds.has(sectionId)) {
      pushUnique(nodes, {
        id: `section:${sectionId}`,
        kind: "section",
        label: sectionId,
        ref: sectionId,
        meta: { index: null },
      }, (node) => node.id);
      sectionIds.add(sectionId);
    }

    for (const claim of extracted) {
      const verdict = verdicts?.verdicts.find((candidate) => candidate.claimId === claim.id) ?? null;
      const supported = Boolean(verdict?.supported);
      const evidenceId = verdict?.evidenceId ?? null;
      const tier = verdict?.tier ?? null;
      const severity = verdict?.severity ?? "warn";
      const material = MATERIAL_KINDS.has(claim.kind);
      const claimNodeId = `claim:${claim.id}:${narrative.originId}`;
      const claimNodeKind = stance === "contradicts" ? "counter-evidence" : "claim";
      pushUnique(nodes, {
        id: claimNodeId,
        kind: claimNodeKind,
        label: claim.text.slice(0, 160),
        ref: claim.id,
        meta: {
          kind: claim.kind,
          supported,
          material,
          originId: narrative.originId,
          stance,
          field: claim.field ?? null,
          period: claim.period ?? null,
        },
      }, (node) => node.id);

      const path: string[] = [];
      if (supported && evidenceId) {
        const item = registry ? getEvidence(registry, evidenceId) : null;
        const evidenceNodeId = `evidence:${evidenceId}`;
        const sourceNodeId = item ? `source:${item.tier}:${item.source}` : null;
        if (sourceNodeId) {
          path.push(sourceNodeId, evidenceNodeId, claimNodeId);
          pushEdge(edges, {
            from: evidenceNodeId,
            to: claimNodeId,
            kind: stance === "contradicts" ? "evidence-counter-evidence" : "evidence-supports-claim",
          });
        } else {
          path.push(claimNodeId);
          unknowns.push(`Evidence ${evidenceId} resolved by validator but missing from registry at graph build.`);
        }
      } else {
        path.push(claimNodeId);
      }

      if (questionNode) {
        pushEdge(edges, { from: claimNodeId, to: questionNode.nodeId, kind: "question-covers-claim" });
      }
      if (role === "conclusion" && conclusion) {
        pushEdge(edges, { from: claimNodeId, to: conclusion.id, kind: "claim-supports-conclusion" });
        path.push(conclusion.id);
      } else if (moduleId) {
        pushEdge(edges, { from: claimNodeId, to: `analysis:${moduleId}`, kind: "claim-informs-analysis" });
        path.push(`analysis:${moduleId}`);
      }
      if (sectionId) {
        pushEdge(edges, { from: claimNodeId, to: `section:${sectionId}`, kind: "claim-in-section" });
        path.push(`section:${sectionId}`);
      }

      claims.push({
        claimId: claim.id,
        originId: narrative.originId,
        text: claim.text,
        kind: claim.kind,
        numericValue: claim.numericValue,
        numericRaw: claim.numericRaw,
        supported,
        severity,
        evidenceId,
        tier,
        path,
        sectionId,
        moduleId,
        role,
        material,
        field: claim.field,
        unit: claim.unit,
        currency: claim.currency,
        scale: claim.scale,
        period: claim.period,
        periodType: claim.periodType,
        stance,
        targetClaimId: narrative.targetClaimId ?? null,
        questionId: questionNode?.id ?? null,
      });

      if (material && !(supported && evidenceId)) {
        blockers.push(`UNTRACEABLE_CLAIM:${claim.id}: material ${claim.kind} claim has no Source→Evidence chain — ${claim.numericRaw ?? claim.numericValue}`);
      }
    }
  }

  for (const counter of claims.filter((claim) => claim.stance === "contradicts" && claim.targetClaimId)) {
    const target = claims.find((claim) => claim.claimId === counter.targetClaimId && claim.stance !== "contradicts");
    if (!target) {
      unknowns.push(`Counter-evidence ${counter.claimId} targets missing claim ${counter.targetClaimId}.`);
      continue;
    }
    pushEdge(edges, {
      from: `claim:${counter.claimId}:${counter.originId}`,
      to: `claim:${target.claimId}:${target.originId}`,
      kind: "counter-evidence-challenges-claim",
    });
  }

  const materialClaims = claims.filter((c) => c.material);
  const traceableMaterial = materialClaims.filter((c) => c.supported && c.evidenceId);
  // Exit criterion is about material claims: zero material claims is vacuously
  // traceable; any untraceable material claim fails (registry blockers remain
  // on `blockers` for fail-closed awareness even when no claims exist).
  const materialClaimsTraceable =
    materialClaims.length === 0 ||
    (traceableMaterial.length === materialClaims.length &&
      !blockers.some((b) => b.startsWith("UNTRACEABLE_CLAIM:")));

  const addressedQuestions = new Set<string>();
  const evidenceBackedQuestions = new Set<string>();
  for (const edge of edges) {
    if (edge.kind === "question-informs-analysis") addressedQuestions.add(edge.from);
    if (edge.kind === "question-covers-claim") {
      addressedQuestions.add(edge.from);
      const target = nodes.find((node) => node.id === edge.to);
      if (target?.meta?.supported === true) evidenceBackedQuestions.add(edge.from);
    }
  }
  const totalQuestions = questions.length;
  const completeness: ResearchCompleteness = {
    totalQuestions,
    addressedQuestions: addressedQuestions.size,
    evidenceBackedQuestions: evidenceBackedQuestions.size,
    unresolvedQuestions: Math.max(0, totalQuestions - addressedQuestions.size),
    score: totalQuestions === 0 ? 1 : addressedQuestions.size / totalQuestions,
    evidenceScore: totalQuestions === 0 ? 1 : evidenceBackedQuestions.size / totalQuestions,
  };

  return {
    version: EVIDENCE_GRAPH_VERSION,
    caseId: rc.caseId,
    builtAt,
    nodes,
    edges,
    claims,
    questions,
    conflicts,
    completeness,
    materialClaimsTraceable,
    materialClaimCount: materialClaims.length,
    traceableMaterialCount: traceableMaterial.length,
    blockers,
    unknowns,
  };
}

/**
 * Resolve the Source→Evidence→Claim path node ids for a claim id
 * (first match). Returns null when the claim is absent or untraceable.
 */
export function traceClaimPath(
  graph: EvidenceGraph,
  claimId: string
): string[] | null {
  const hit = graph.claims.find((c) => c.claimId === claimId && c.supported && c.evidenceId);
  if (!hit) return null;
  return hit.path.length >= 3 ? [...hit.path] : null;
}
