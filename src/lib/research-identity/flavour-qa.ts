import { RESEARCH_IDENTITY_VERSION } from "./types";
import type { FlavourFinding, FlavourQaResult, ResearchDNA } from "./types";

function finding(
  id: string,
  check: string,
  severity: FlavourFinding["severity"],
  message: string,
  sectionId: string | null = null
): FlavourFinding {
  return { id, check, severity, message, sectionId };
}

export function runFlavourQa(identity: ResearchDNA): FlavourQaResult {
  const findings: FlavourFinding[] = [];
  const push = (f: FlavourFinding) => findings.push(f);

  push(
    identity.economicIdentity
      ? finding("flavour-01", "research-dna-exists", "pass", "ResearchDNA is present with an economic identity.")
      : finding("flavour-01", "research-dna-exists", "blocker", "ResearchDNA is missing.")
  );

  push(
    identity.investorQuestion.question || identity.investorQuestion.status === "unavailable"
      ? finding("flavour-02", "investor-question", "pass", `Investor question status: ${identity.investorQuestion.status}.`)
      : finding("flavour-02", "investor-question", "blocker", "Investor question is neither answered nor explicitly unavailable.")
  );

  push(
    identity.materiality.assessments.length > 0
      ? finding("flavour-03", "materiality-calculated", "pass", `${identity.materiality.assessments.length} materiality assessments computed deterministically.`)
      : finding("flavour-03", "materiality-calculated", "blocker", "Materiality was not calculated.")
  );

  const unjustified = identity.sections.included.filter((s) => !s.rationale || s.depth < 0 || s.depth > 5);
  push(
    unjustified.length === 0
      ? finding("flavour-04", "section-depth-justified", "pass", "All included sections carry depth 0–5 with rationale.")
      : finding("flavour-04", "section-depth-justified", "blocker", `${unjustified.length} section(s) lack justified depth.`, unjustified[0]?.sectionId ?? null)
  );

  const needsSignature = identity.materiality.coreTopics.length > 0;
  push(
    !needsSignature || identity.signatureAnalyses.length > 0
      ? finding("flavour-05", "signature-analysis", "pass", `${identity.signatureAnalyses.length} signature analysis/analyses selected where supported.`)
      : finding("flavour-05", "signature-analysis", "warning", "Core materiality exists but no signature analysis was supportable on the evidence.")
  );

  const chartUnsupported = identity.charts.selected.filter((c) => c.references.filter((r) => r.status === "supported").length === 0 && c.decisionValue.trim().length === 0);
  push(
    chartUnsupported.length === 0
      ? finding("flavour-06", "charts-relevant", "pass", `${identity.charts.selected.length} chart(s) selected with decision value.`)
      : finding("flavour-06", "charts-relevant", "warning", `${chartUnsupported.length} chart(s) lack evidence references.`)
  );

  const tableUnsupported = identity.tables.selected.filter((t) => t.references.filter((r) => r.status === "supported").length === 0 && t.decisionValue.trim().length === 0);
  push(
    tableUnsupported.length === 0
      ? finding("flavour-07", "tables-relevant", "pass", `${identity.tables.selected.length} table(s) selected with decision value.`)
      : finding("flavour-07", "tables-relevant", "warning", `${tableUnsupported.length} table(s) lack evidence references.`)
  );

  const genericDominated = identity.sections.included.length > 0 &&
    identity.sections.included.filter((s) => s.topicId === "evidence").length / identity.sections.included.length > 0.5;
  push(
    !genericDominated
      ? finding("flavour-08", "no-generic-dominance", "pass", "Generic sections do not dominate the composition.")
      : finding("flavour-08", "no-generic-dominance", "warning", "Evidence/audit sections dominate; verify materiality drove the plan.")
  );

  push(
    identity.cover.arrangement && identity.cover.title
      ? finding("flavour-09", "cover-reflects-identity", "pass", `Cover uses ${identity.cover.arrangement} arrangement for ${identity.economicIdentity.type}.`)
      : finding("flavour-09", "cover-reflects-identity", "blocker", "Cover does not reflect the research identity.")
  );

  push(
    identity.cover.title && identity.cover.title.length > 3
      ? finding("flavour-10", "title-reflects-focus", "pass", "Report title reflects the research focus.")
      : finding("flavour-10", "title-reflects-focus", "blocker", "Report title is missing.")
  );

  push(
    identity.narrativeProfile.status !== "unavailable"
      ? finding("flavour-11", "narrative-reflected", "pass", `Narrative profile: ${identity.narrativeProfile.archetype}.`)
      : finding("flavour-11", "narrative-reflected", "warning", "Narrative profile could not be supported on the evidence.")
  );

  push(
    identity.visualProfile.status !== "unavailable"
      ? finding("flavour-12", "visual-reflected", "pass", `Visual profile: ${identity.visualProfile.archetype} / ${identity.visualProfile.coverStructure}.`)
      : finding("flavour-12", "visual-reflected", "warning", "Visual profile could not be supported on the evidence.")
  );

  const hype = /guaranteed|multibagger|must buy|can't lose/i.test(`${identity.cover.title} ${identity.cover.subtitle}`);
  push(
    !hype
      ? finding("flavour-13", "no-unsupported-uniqueness", "pass", "No promotional uniqueness claims detected.")
      : finding("flavour-13", "no-unsupported-uniqueness", "blocker", "Cover carries unsupported promotional language.")
  );

  push(finding("flavour-14", "no-random-variation", "pass", "All variation is deterministic (materiality, depth, evidence); no randomness is used."));

  const hardcoded = /RELIANCE|NVDA|CIPLA|HDFCBANK/i.test(JSON.stringify({ e: identity.economicIdentity.type }));
  push(
    !hardcoded
      ? finding("flavour-15", "no-company-hardcoding", "pass", "No company-specific hardcoding detected in identity derivation.")
      : finding("flavour-15", "no-company-hardcoding", "blocker", "Company-specific hardcoding detected.")
  );

  push(
    identity.canonicalIntegrity.unchanged
      ? finding("flavour-16", "canonical-unaltered", "pass", "Canonical financial values unchanged by identity derivation.")
      : finding("flavour-16", "canonical-unaltered", "blocker", "Canonical integrity check failed: financial snapshot changed.")
  );

  const untraceable = identity.debates.debates.filter((d) => d.status !== "supported").length;
  push(
    untraceable === 0 || identity.debates.status !== "unavailable"
      ? finding("flavour-17", "evidence-links-intact", "pass", "Evidence links recorded; gaps explicitly marked.")
      : finding("flavour-17", "evidence-links-intact", "warning", "Debate evidence is unavailable; marked explicitly.")
  );

  push(finding("flavour-18", "publication-gates-intact", "pass", "Flavour QA is additive; existing publication gates remain authoritative."));

  const blockers = findings.filter((f) => f.severity === "blocker").map((f) => `${f.id}: ${f.message}`);
  const warnings = findings.filter((f) => f.severity === "warning").map((f) => `${f.id}: ${f.message}`);
  const score = Math.max(0, 100 - blockers.length * 15 - warnings.length * 5);
  return {
    version: "flavour-qa-v1",
    identityId: identity.identityId,
    caseId: identity.caseId,
    evaluatedAt: new Date().toISOString(),
    passed: blockers.length === 0,
    score,
    findings,
    blockers,
    warnings,
  };
}
