import type { ResearchEvent, ResearchRunEnvelope } from "@/lib/research-ledger/types";
import {
  researchRunManifestFromEnvelope,
  type ResearchRunManifestV1,
  type ResearchRunPayloadV1,
} from "./manifest";

export interface ResearchRunSummaryView {
  readonly runId: string;
  readonly contentHash: string;
  readonly company: ResearchRunManifestV1["company"];
  readonly occurredAt: string;
  readonly dataCutoff: string;
  readonly schemaVersion: string;
  readonly pipelineVersion: string;
  readonly modelVersion: string;
  readonly promptVersion: string;
  readonly caseId: string;
  readonly report: ResearchRunManifestV1["report"];
  readonly status: ResearchRunManifestV1["status"];
  readonly evidence: ResearchRunManifestV1["evidence"];
  readonly sourceRunIds: readonly string[];
}

export interface ResearchRunDetailView {
  readonly run: ResearchRunEnvelope<ResearchRunPayloadV1>;
  readonly manifest: ResearchRunManifestV1;
  readonly history: readonly ResearchEvent[];
}

export function toResearchRunSummary(
  run: ResearchRunEnvelope<ResearchRunPayloadV1>,
): ResearchRunSummaryView {
  const manifest = researchRunManifestFromEnvelope(run);
  return {
    runId: run.runId,
    contentHash: run.contentHash,
    company: manifest.company,
    occurredAt: run.occurredAt,
    dataCutoff: run.dataCutoff,
    schemaVersion: run.schemaVersion,
    pipelineVersion: run.pipelineVersion,
    modelVersion: run.modelVersion,
    promptVersion: manifest.promptVersion,
    caseId: manifest.caseId,
    report: manifest.report,
    status: manifest.status,
    evidence: manifest.evidence,
    sourceRunIds: manifest.sourceRunIds,
  };
}

export function toResearchRunDetail(
  run: ResearchRunEnvelope<ResearchRunPayloadV1>,
  history: readonly ResearchEvent[],
): ResearchRunDetailView {
  return {
    run,
    manifest: researchRunManifestFromEnvelope(run),
    history: Object.freeze([...history]),
  };
}
