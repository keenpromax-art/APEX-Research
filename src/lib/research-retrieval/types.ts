export const RESEARCH_RETRIEVAL_VERSION = "research-retrieval-v1" as const;
export const RESEARCH_DOCUMENT_VERSION = "research-document-v1" as const;

export type ResearchRetrievalSourceType =
  | "annual_report"
  | "quarterly_report"
  | "investor_presentation"
  | "earnings_call"
  | "exchange_filing"
  | "regulatory_filing"
  | "government_regulator"
  | "company_website"
  | "market_data"
  | "secondary_database"
  | "news"
  | "unknown";

export type ResearchDocumentStatus = "ready" | "partial" | "failed" | "quarantined" | "unavailable";
export type ResearchChunkStatus = "ready" | "quarantined" | "failed";
export type ResearchRetrievalStatus = "ready" | "partial" | "failed" | "unavailable";
export type ResearchRetrievalTaskStatus = "pending" | "running" | "completed" | "partial" | "failed" | "blocked" | "unavailable";

export interface ResearchRetrievalLimits {
  maxDocuments: number;
  maxDocumentChars: number;
  maxTotalChars: number;
  maxBytes?: number;
  maxDocumentBytes?: number;
  maxTotalBytes?: number;
  maxChunksPerDocument: number;
  maxChunkChars: number;
  maxQueryChars: number;
  timeoutMs: number;
}

export const DEFAULT_RESEARCH_RETRIEVAL_LIMITS: ResearchRetrievalLimits = Object.freeze({
  maxDocuments: 20,
  maxDocumentChars: 100_000,
  maxTotalChars: 500_000,
  maxChunksPerDocument: 80,
  maxChunkChars: 8_000,
  maxQueryChars: 2_000,
  timeoutMs: 10_000,
});

export interface ResearchRetrievalProviderDocument {
  documentId?: string;
  version?: string;
  title?: string;
  content: string;
  contentType?: string;
  sourceType?: ResearchRetrievalSourceType;
  sourceId?: string;
  sourceUrl?: string;
  publisher?: string;
  publishedAt?: string;
  asOfDate?: string;
  retrievedAt?: string;
  metadata?: Readonly<Record<string, unknown>>;
  evidence?: readonly ResearchRetrievalProviderEvidence[];
}

export interface ResearchRetrievalProviderEvidence {
  evidenceId?: string;
  field: string;
  value: number | string;
  unit?: string;
  period?: string;
  asOf?: string;
  page?: number;
  section?: string;
  excerpt?: string;
  statement?: string;
  numeric?: boolean;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface ResearchRetrievalProviderResponse {
  documents?: readonly ResearchRetrievalProviderDocument[];
  results?: { documents?: readonly ResearchRetrievalProviderDocument[]; evidence?: readonly ResearchRetrievalProviderEvidence[] };
  evidence?: readonly ResearchRetrievalProviderEvidence[];
  diagnostics?: readonly string[];
  metadata?: Readonly<Record<string, unknown>>;
}

export interface ResearchRetrievalRequest {
  taskId: string;
  question: string;
  query: string;
  sourceType: ResearchRetrievalSourceType;
  priority: number;
  asOf: string;
  dependencies: readonly string[];
  ticker: string;
  signal?: AbortSignal;
}

export interface ResearchRetrievalProvider {
  readonly id: string;
  fetch?: (request: ResearchRetrievalRequest) => Promise<ResearchRetrievalProviderResponse | readonly ResearchRetrievalProviderDocument[]>;
  retrieve?: (request: ResearchRetrievalRequest) => Promise<ResearchRetrievalProviderResponse | readonly ResearchRetrievalProviderDocument[]>;
  search?: (request: ResearchRetrievalRequest) => Promise<ResearchRetrievalProviderResponse | readonly ResearchRetrievalProviderDocument[]>;
}

export interface ResearchDocumentRetrievalMetadata {
  provider: string;
  taskId: string;
  query: string;
  retrievedAt: string;
  requestHash: string;
  sourceType: ResearchRetrievalSourceType;
}

export interface ResearchDocumentPublicationMetadata {
  publishedAt?: string;
  asOfDate?: string;
  publisher?: string;
  sourceUrl?: string;
  documentDate?: string;
  accessionNumber?: string;
}

export interface ResearchDocumentSpan {
  id: string;
  start: number;
  end: number;
  text: string;
  page?: number;
  section?: string;
}

export interface ResearchDocumentChunk {
  id: string;
  documentId: string;
  documentVersion: string;
  chunkIndex: number;
  text: string;
  spans: ResearchDocumentSpan[];
  contentHash: string;
  status: ResearchChunkStatus;
  quarantineReasons: string[];
}

export interface ResearchNumericEvidence {
  id: string;
  documentId: string;
  chunkId: string;
  spanId: string;
  field: string;
  value: number;
  raw: string;
  unit?: string;
  period?: string;
  asOf?: string;
  text: string;
  sourceType: ResearchRetrievalSourceType;
  sourceId: string;
  sourceDocumentId: string;
  sourceMetadata: ResearchDocumentSourceMetadata;
  status: "ready" | "quarantined";
  metadata?: Readonly<Record<string, unknown>>;
}

export interface ResearchTableCell {
  value: string;
  start: number;
  end: number;
}

export interface ResearchTableRow {
  cells: ResearchTableCell[];
  start: number;
  end: number;
}

export interface ResearchTableEvidence {
  id: string;
  documentId: string;
  chunkId: string;
  spanId: string;
  headers: ResearchTableCell[];
  rows: ResearchTableRow[];
  asOf?: string;
  text: string;
  sourceType: ResearchRetrievalSourceType;
  sourceId: string;
  sourceDocumentId: string;
  status: "ready" | "quarantined";
}

export interface ResearchStatementEvidence {
  id: string;
  documentId: string;
  chunkId: string;
  spanId: string;
  text: string;
  statement: string;
  asOf?: string;
  statementType: "reported_fact" | "management_guidance" | "risk" | "catalyst" | "context" | "unknown";
  sourceType: ResearchRetrievalSourceType;
  sourceId: string;
  sourceDocumentId: string;
  status: "ready" | "quarantined";
}

export type ResearchDocumentEvidence =
  | ResearchNumericEvidence
  | ResearchTableEvidence
  | ResearchStatementEvidence;

export interface ResearchDocumentSourceMetadata {
  sourceId: string;
  sourceType: ResearchRetrievalSourceType;
  provider: string;
  sourceUrl?: string;
  publisher?: string;
  publishedAt?: string;
  asOfDate?: string;
  authority: "primary" | "secondary" | "tertiary" | "unknown";
  valueRole: "reported_fact" | "management_guidance" | "consensus_estimate" | "market_observation" | "context" | "unknown";
  confidence: number;
}

export interface ResearchDocument {
  id: string;
  documentId: string;
  version: string;
  documentVersion: string;
  ticker: string;
  title: string;
  sourceType: ResearchRetrievalSourceType;
  sourceId: string;
  sourceMetadata: ResearchDocumentSourceMetadata;
  contentHash: string;
  documentHash: string;
  originalContentHash: string;
  rawContentHash: string;
  content: string;
  sanitizedContent: string;
  originalLength: number;
  sanitizedLength: number;
  wasTruncated: boolean;
  retrieval: ResearchDocumentRetrievalMetadata;
  retrievalMetadata: ResearchDocumentRetrievalMetadata;
  publication: ResearchDocumentPublicationMetadata;
  publicationMetadata: ResearchDocumentPublicationMetadata;
  chunks: ResearchDocumentChunk[];
  spans: ResearchDocumentSpan[];
  evidence: ResearchDocumentEvidence[];
  numericEvidence: ResearchNumericEvidence[];
  tableEvidence: ResearchTableEvidence[];
  statementEvidence: ResearchStatementEvidence[];
  status: ResearchDocumentStatus;
  quarantined: boolean;
  quarantineReasons: string[];
  diagnostics: string[];
  publicationBlocked: boolean;
}

export interface ResearchRetrievalTaskResult {
  taskId: string;
  status: ResearchRetrievalTaskStatus;
  attempts: number;
  resultRefs: string[];
  documentIds: string[];
  evidenceIds: string[];
  diagnostics: string[];
  error?: string;
}

export interface ResearchRetrievalResult {
  version: typeof RESEARCH_RETRIEVAL_VERSION;
  status: ResearchRetrievalStatus;
  retrievalStatus?: ResearchRetrievalStatus;
  available: boolean;
  isAvailable?: boolean;
  providerConfigured: boolean;
  providerId: string | null;
  providerAllowlist: string[];
  ticker: string;
  asOf: string;
  startedAt: string;
  completedAt: string;
  tasks: ResearchRetrievalTaskResult[];
  documents: ResearchDocument[];
  evidence: ResearchDocumentEvidence[];
  diagnostics: string[];
  publicationBlocked?: boolean;
  resultHash: string;
}

export interface ExecuteResearchRetrievalOptions {
  ticker: string;
  asOf?: string;
  now?: string;
  provider?: ResearchRetrievalProvider | null;
  providerAllowlist?: readonly string[];
  allowedProviders?: readonly string[];
  limits?: Partial<ResearchRetrievalLimits>;
  maxBytes?: number;
  maxDocumentBytes?: number;
  maxTotalBytes?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface ResearchRetrievalTaskLike {
  id: string;
  task: string;
  question: string;
  sourceType: ResearchRetrievalSourceType;
  source_type?: ResearchRetrievalSourceType;
  query: string;
  priority: number;
  asOf: string;
  as_of?: string;
  dependencies: readonly string[];
  status?: string;
  attempts?: number;
  resultRefs?: readonly string[];
  result_refs?: readonly string[];
}

export interface CanonicalEvidenceTier {
  rank: number;
  tier: "PRIMARY" | "SECONDARY" | "TERTIARY" | "MODEL_DERIVED" | "UNKNOWN";
  sourceTypes: readonly ResearchRetrievalSourceType[];
}

export interface CanonicalEvidenceItem {
  id: string;
  field: string;
  value: number | string;
  unit?: string;
  currency?: string;
  period?: string;
  asOf?: string;
  tier: CanonicalEvidenceTier["tier"];
  rank: number;
  sourceId: string;
  source: string;
  sourceType: ResearchRetrievalSourceType;
  authority: "primary" | "secondary" | "tertiary" | "model_derived" | "unknown";
  valueRole: "reported_fact" | "management_guidance" | "consensus_estimate" | "market_observation" | "context" | "unknown";
  sourceDocumentId?: string;
  factId?: string;
  observationId?: string;
  locator?: string;
  excerpt?: string;
  restated: boolean;
  supersedesId?: string;
  metadata: Readonly<Record<string, unknown>>;
}

export interface CanonicalEvidenceConflict {
  id: string;
  field: string;
  period: string | null;
  existingId: string;
  incomingId: string;
  selectedId: string;
  selected: CanonicalEvidenceItem;
  reason: "value_mismatch" | "unit_mismatch" | "currency_mismatch" | "source_restatement" | "period_mismatch";
  material: boolean;
  varianceAbs?: number;
  variancePct?: number | null;
  selectedBy: "source_hierarchy" | "restatement_recency" | "stable_id";
  existing: CanonicalEvidenceItem;
  incoming: CanonicalEvidenceItem;
}

export interface CanonicalEvidenceRestatement {
  id: string;
  field: string;
  period: string;
  priorId: string;
  restatedId: string;
  selectedId: string;
  priorValue: number | string;
  restatedValue: number | string;
  reason: string;
}

export interface CanonicalEvidenceRegistry {
  version: "canonical-evidence-registry-v1";
  asOf: string;
  items: CanonicalEvidenceItem[];
  conflicts: CanonicalEvidenceConflict[];
  restatements: CanonicalEvidenceRestatement[];
  restatementObservations: CanonicalEvidenceRestatement[];
  sourceHierarchy: readonly CanonicalEvidenceTier[];
  hierarchy: readonly CanonicalEvidenceTier[];
  sourceTierRank: Readonly<Record<CanonicalEvidenceTier["tier"], number>>;
  sourceTierRanks: Readonly<Record<CanonicalEvidenceTier["tier"], number>>;
  diagnostics: string[];
  contentHash: string;
}
