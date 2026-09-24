import type { DebateMap, ResearchDebate, ResearchIdentitySource } from "./types";
import {
  indexResearchReferences,
  makeEvidenceReferences,
  supportedReferences,
} from "./evidence-profile";

type Index = ReturnType<typeof indexResearchReferences>;

function limitText(text: string | null | undefined, max = 320): string | null {
  if (!text) return null;
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function marketSentence(texts: string[]): string | null {
  const joined = texts.join(" ");
  const match = joined.match(/[^.]{0,160}(consensus|street estimate|market expects|market is pricing|what the market may be missing)[^.]{0,220}/i);
  return match ? limitText(match[0], 280) : null;
}

function refsFor(ids: string[], index: Index) {
  return makeEvidenceReferences([...new Set(ids)].slice(0, 10).map((id) => ({ id, kind: "ai-fact" as const })), index, 10);
}

export function buildDebateMap(source: ResearchIdentitySource, index: Index): DebateMap {
  const report = source.researchReport;
  const rawDebates = (report?.debates ?? []).filter((d) => d.debate.trim().length > 0).slice(0, 6);
  if (rawDebates.length === 0) {
    return { status: "unavailable", centralDebateId: null, debates: [], unsupportedCount: 0 };
  }
  const centralIndex = Math.max(0, Math.min(rawDebates.length - 1, 0));
  const centralInvalidation = limitText(report?.thesis?.whatCouldInvalidate?.[0] ?? null, 280);
  const debates: ResearchDebate[] = rawDebates.map((debate, position) => {
    const forRefs = refsFor(debate.evidenceFor.flatMap((e) => e.factIds), index);
    const againstRefs = refsFor(debate.evidenceAgainst.flatMap((e) => e.factIds), index);
    const market = marketSentence([
      debate.debate,
      debate.significance,
      report?.thesis?.whatMarketMayBeMissing ?? "",
      report?.conclusion ?? "",
    ]);
    const central = position === centralIndex;
    const mustHappen = limitText(debate.resolutionSignal ?? debate.financialConsequence ?? null, 280);
    const invalidate = central ? centralInvalidation : limitText(debate.resolutionSignal ?? null, 280);
    const supported = supportedReferences([...forRefs, ...againstRefs]).length;
    return {
      id: `debate-${position + 1}`,
      rank: position + 1,
      central,
      question: limitText(debate.debate, 280) ?? "Untitled debate",
      assumption: limitText(debate.mechanism, 280),
      marketView: {
        value: market,
        status: market ? "supported" : "unavailable",
        confidence: market ? 0.45 : 0,
        rationale: market
          ? "A consensus or market-expectation statement was found in the available research."
          : "No consensus evidence is available; no market view is invented.",
        references: market ? refsFor(debate.evidenceFor.flatMap((e) => e.factIds), index) : [],
      },
      apexEvidence: forRefs,
      counterEvidence: againstRefs,
      difference: limitText(debate.significance, 280),
      mustHappen,
      invalidate,
      financialConsequence: limitText(debate.financialConsequence ?? null, 280),
      valuationConsequence: limitText(debate.valuationConsequence ?? null, 280),
      resolutionSignal: limitText(debate.resolutionSignal ?? null, 200),
      confidence: supported > 1 ? 0.72 : supported === 1 ? 0.5 : 0.25,
      status: supported > 0 ? "supported" : "insufficient_evidence",
    };
  });
  const unsupportedCount = debates.filter((d) => d.status !== "supported").length;
  return {
    status: unsupportedCount === debates.length ? "insufficient" : "available",
    centralDebateId: debates[centralIndex]?.id ?? null,
    debates,
    unsupportedCount,
  };
}
