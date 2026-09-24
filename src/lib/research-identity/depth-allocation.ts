import type { ResearchComplexity } from "@/lib/research-case";
import type {
  MaterialityProfile,
  SignatureAnalysis,
} from "./types";
import type { AnalyticalDepth, MaterialityTopicId } from "./proposal";

export interface DepthAllocationInput {
  materiality: MaterialityProfile;
  complexity: ResearchComplexity;
  signatures: SignatureAnalysis[];
  reportDepth: "concise" | "full";
}

function baseDepth(tier: string): AnalyticalDepth {
  if (tier === "TIER_1_CORE") return 4;
  if (tier === "TIER_2_IMPORTANT") return 3;
  if (tier === "TIER_3_SUPPORTING") return 2;
  if (tier === "TIER_4_BACKGROUND") return 1;
  return 0;
}

export function allocateDepth(input: DepthAllocationInput): MaterialityProfile {
  const signatureTopics = new Set(input.signatures.map((s) => s.topicId));
  const assessments = input.materiality.assessments.map((assessment) => {
    let depth = baseDepth(assessment.tier);
    if (depth > 0 && input.reportDepth === "full") depth = Math.min(5, depth + 1) as AnalyticalDepth;
    if (signatureTopics.has(assessment.topicId) && depth > 0 && depth < 5) {
      depth = Math.min(5, depth + 1) as AnalyticalDepth;
    }
    if (input.complexity.score >= 70 && (assessment.tier === "TIER_1_CORE" || assessment.tier === "TIER_2_IMPORTANT")) {
      depth = Math.min(5, depth + (input.reportDepth === "full" ? 0 : 1)) as AnalyticalDepth;
    }
    const supported = assessment.references.filter((r) => r.status === "supported").length;
    if (supported === 0 && depth > 1 && assessment.topicId !== "evidence") {
      depth = (depth - 1) as AnalyticalDepth;
    }
    if (assessment.topicId === "evidence" && depth === 0 && assessment.references.length > 0) {
      depth = 1;
    }
    const result = { ...assessment, depth };
    return result;
  });
  return { ...input.materiality, assessments };
}

export function depthByTopic(materiality: MaterialityProfile): Record<MaterialityTopicId, AnalyticalDepth> {
  const out = {} as Record<MaterialityTopicId, AnalyticalDepth>;
  for (const assessment of materiality.assessments) out[assessment.topicId] = assessment.depth;
  return out;
}
