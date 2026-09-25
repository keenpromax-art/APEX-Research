import { sanitizeSourceContent } from "@/lib/security/source-sanitizer";
import { createStableId, stableHash, stableStringify } from "@/lib/research-ledger/stable";
import { deepFreeze, isDeeplyFrozen } from "@/lib/research-ledger/immutable";
import type {
  ResearchDocument,
  ResearchDocumentChunk,
  ResearchDocumentEvidence,
  ResearchDocumentPublicationMetadata,
  ResearchDocumentSourceMetadata,
  ResearchDocumentSpan,
  ResearchNumericEvidence,
  ResearchRetrievalLimits,
  ResearchRetrievalProviderDocument,
  ResearchRetrievalProviderEvidence,
  ResearchRetrievalSourceType,
  ResearchStatementEvidence,
  ResearchTableCell,
  ResearchTableEvidence,
  ResearchTableRow,
} from "./types";
import { DEFAULT_RESEARCH_RETRIEVAL_LIMITS, RESEARCH_DOCUMENT_VERSION } from "./types";

const INJECTION_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ["instruction_override", /\b(?:ignore|disregard|forget|override|bypass)\s+(?:all\s+|any\s+)?(?:previous|prior|earlier|above|preceding|system|developer)\s+(?:instructions?|prompts?|rules?|directions?|messages?)\b/i],
  ["role_boundary", /<\|?\s*(?:im_start|im_end|system|assistant|user|endoftext|start_header_id)\s*\|?>|^\s*(?:system|developer|assistant|user)\s*:/im],
  ["role_assignment", /\byou\s+are\s+(?:now\s+)?(?:a|an|the)?\s*(?:new\s+)?(?:system|developer|assistant|model|ai)\b/i],
  ["secret_exfiltration", /\b(?:reveal|show|print|repeat|output|disclose|send)\b[^.\n]{0,80}\b(?:system\s+prompt|developer\s+instructions?|api\s+keys?|credentials?|secrets?)\b/i],
  ["control_directive", /\b(?:execute|run|invoke)\s+(?:the\s+)?(?:following|these|below)\s+(?:commands?|instructions?|code)\b/i],
];

const TABLE_ROW = /\|/;
const NUMERIC_PATTERN = /(?<![A-Za-z])[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:\s*(?:%|x|×|pp|bps|crore|lakh|million|billion|trillion))?/gi;

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function boundedText(value: unknown, max = 2_000): string | undefined {
  const normalized = text(value);
  return normalized ? normalized.slice(0, max) : undefined;
}

function stableJsonValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? (Object.is(value, -0) ? 0 : value) : null;
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry !== undefined) output[key] = stableJsonValue(entry);
    }
    return output;
  }
  return null;
}

function sourceAuthority(sourceType: ResearchRetrievalSourceType): ResearchDocumentSourceMetadata["authority"] {
  if (["annual_report", "quarterly_report", "investor_presentation", "earnings_call", "exchange_filing", "regulatory_filing", "government_regulator", "company_website"].includes(sourceType)) return "primary";
  if (["market_data", "secondary_database"].includes(sourceType)) return "secondary";
  if (sourceType === "news") return "tertiary";
  return "unknown";
}

function valueRole(sourceType: ResearchRetrievalSourceType): ResearchDocumentSourceMetadata["valueRole"] {
  if (["annual_report", "quarterly_report", "exchange_filing", "regulatory_filing", "government_regulator"].includes(sourceType)) return "reported_fact";
  if (["investor_presentation", "earnings_call"].includes(sourceType)) return "management_guidance";
  if (sourceType === "market_data") return "market_observation";
  if (["company_website", "secondary_database", "news"].includes(sourceType)) return "context";
  return "unknown";
}

function sourceConfidence(sourceType: ResearchRetrievalSourceType): number {
  if (["annual_report", "quarterly_report", "exchange_filing", "regulatory_filing", "government_regulator"].includes(sourceType)) return 0.95;
  if (["investor_presentation", "earnings_call"].includes(sourceType)) return 0.8;
  if (sourceType === "market_data") return 0.7;
  if (sourceType === "secondary_database") return 0.6;
  if (sourceType === "news") return 0.45;
  if (sourceType === "company_website") return 0.7;
  return 0;
}

export function normalizeResearchSourceType(value: unknown): ResearchRetrievalSourceType {
  const normalized = text(value)?.toLowerCase().replace(/[^a-z0-9]+/g, "_") ?? "unknown";
  const allowed: ResearchRetrievalSourceType[] = ["annual_report", "quarterly_report", "investor_presentation", "earnings_call", "exchange_filing", "regulatory_filing", "government_regulator", "company_website", "market_data", "secondary_database", "news", "unknown"];
  if (allowed.includes(normalized as ResearchRetrievalSourceType)) return normalized as ResearchRetrievalSourceType;
  if (/annual|report|10k|20f/.test(normalized)) return "annual_report";
  if (/quarter|10q/.test(normalized)) return "quarterly_report";
  if (/presentation|investor|slide/.test(normalized)) return "investor_presentation";
  if (/call|transcript|earnings/.test(normalized)) return "earnings_call";
  if (/exchange|filing/.test(normalized)) return "exchange_filing";
  if (/regulat|sec|government/.test(normalized)) return "regulatory_filing";
  if (/market|quote|price/.test(normalized)) return "market_data";
  if (/news/.test(normalized)) return "news";
  return "unknown";
}

export function detectPromptInjection(value: string): string[] {
  const reasons = new Set<string>();
  for (const [reason, pattern] of INJECTION_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(value)) reasons.add(reason);
  }
  return [...reasons].sort();
}

export interface ResearchContentSanitization {
  content: string;
  originalLength: number;
  sanitizedLength: number;
  wasTruncated: boolean;
  injectionReasons: string[];
  quarantined: boolean;
}

export function sanitizeResearchContent(input: unknown, maxLength = 100_000): ResearchContentSanitization {
  const original = typeof input === "string" ? input : "";
  const reasons = detectPromptInjection(original);
  let replaced = original;
  for (const [, pattern] of INJECTION_PATTERNS) {
    pattern.lastIndex = 0;
    replaced = replaced.replace(pattern, "[quarantined instruction]");
  }
  const sanitized = sanitizeSourceContent(replaced, Math.min(100_000, Math.max(1, maxLength)));
  return {
    content: sanitized.content,
    originalLength: original.length,
    sanitizedLength: sanitized.content.length,
    wasTruncated: sanitized.wasTruncated,
    injectionReasons: reasons,
    quarantined: reasons.length > 0,
  };
}

function chunkBoundaries(content: string, maxChars: number): Array<{ start: number; end: number }> {
  const boundaries: Array<{ start: number; end: number }> = [];
  if (content.length === 0) return boundaries;
  let start = 0;
  while (start < content.length) {
    const remaining = content.length - start;
    const end = remaining <= maxChars ? content.length : start + maxChars;
    if (end === content.length) {
      boundaries.push({ start, end });
      break;
    }
    const window = content.slice(start, end);
    const breakAt = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf("\n"), window.lastIndexOf(". "));
    const safeBreak = breakAt > Math.floor(maxChars * 0.35) ? start + breakAt + (window[breakAt] === "\n" ? 1 : 2) : end;
    const normalizedEnd = Math.min(content.length, Math.max(start + 1, safeBreak));
    boundaries.push({ start, end: normalizedEnd });
    start = normalizedEnd;
  }
  return boundaries;
}

function makeSpans(documentId: string, content: string, start: number, end: number): ResearchDocumentSpan[] {
  const value = content.slice(start, end);
  const id = createStableId("SPAN", { documentId, start, end, value }, "research-retrieval/span/v1");
  return [{ id, start, end, text: value }];
}

function makeChunks(input: {
  documentId: string;
  documentVersion: string;
  content: string;
  limits: ResearchRetrievalLimits;
  injectionReasons: readonly string[];
}): ResearchDocumentChunk[] {
  const chunks: ResearchDocumentChunk[] = [];
  const boundaries = chunkBoundaries(input.content, input.limits.maxChunkChars).slice(0, input.limits.maxChunksPerDocument);
  for (const [chunkIndex, boundary] of boundaries.entries()) {
    const chunkText = input.content.slice(boundary.start, boundary.end);
    const localReasons = detectPromptInjection(chunkText);
    const quarantineReasons = [...new Set([...input.injectionReasons, ...localReasons])].sort();
    const spans = makeSpans(input.documentId, input.content, boundary.start, boundary.end);
    const spanId = spans[0]?.id ?? createStableId("SPAN", { documentId: input.documentId, start: boundary.start, end: boundary.end }, "research-retrieval/span/v1");
    const chunkId = createStableId("CHUNK", { documentId: input.documentId, documentVersion: input.documentVersion, chunkIndex, start: boundary.start, end: boundary.end, contentHash: stableHash(chunkText, "research-retrieval/chunk/v1") }, "research-retrieval/chunk-id/v1");
    chunks.push({
      id: chunkId,
      documentId: input.documentId,
      documentVersion: input.documentVersion,
      chunkIndex,
      text: chunkText,
      spans: [{ ...spans[0]!, id: spanId }],
      contentHash: stableHash(chunkText, "research-retrieval/chunk/v1"),
      status: quarantineReasons.length > 0 ? "quarantined" : "ready",
      quarantineReasons,
    });
  }
  return chunks;
}

function numericValue(raw: string): number | undefined {
  const normalized = raw.replace(/,/g, "").replace(/[×x%]|pp|bps|crore|lakh|million|billion|trillion/gi, "").trim();
  const negative = /^\(.*\)$/.test(normalized);
  const number = Number(normalized.replace(/[()]/g, ""));
  if (!Number.isFinite(number)) return undefined;
  return negative ? -Math.abs(number) : number;
}

function numericUnit(raw: string): string | undefined {
  const match = raw.match(/(?:%|x|×|pp|bps|crore|lakh|million|billion|trillion)\s*$/i);
  return match?.[1]?.toLowerCase();
}

function fieldBefore(textValue: string, index: number): string {
  const line = textValue.slice(0, index).split(/[\n;]/).at(-1) ?? "";
  const words = line.replace(/[^\p{L}\p{N} _-]/gu, " ").trim().split(/\s+/).filter(Boolean);
  return words.slice(-5).join(" ").trim() || "numeric_value";
}

export function extractNumericEvidence(documentId: string, chunk: ResearchDocumentChunk, source: ResearchDocumentSourceMetadata): ResearchNumericEvidence[] {
  const output: ResearchNumericEvidence[] = [];
  const pattern = new RegExp(NUMERIC_PATTERN.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(chunk.text)) !== null) {
    const value = numericValue(match[0]);
    if (value === undefined) continue;
    const start = chunk.spans[0]?.start ?? 0;
    const spanStart = start + match.index;
    const spanEnd = spanStart + match[0].length;
    const spanId = createStableId("SPAN", { documentId, start: spanStart, end: spanEnd, text: match[0] }, "research-retrieval/span/v1");
    const field = fieldBefore(chunk.text, match.index).toLowerCase().replace(/\s+/g, "_");
    const id = createStableId("NUM", { documentId, chunkId: chunk.id, spanId, field, value, raw: match[0] }, "research-retrieval/evidence/v1");
    output.push({
      id,
      documentId,
      chunkId: chunk.id,
      spanId,
      field,
      value,
      raw: match[0],
      ...(numericUnit(match[0]) ? { unit: numericUnit(match[0]) } : {}),
      text: chunk.text,
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      sourceDocumentId: documentId,
      sourceMetadata: source,
      status: chunk.status === "quarantined" ? "quarantined" : "ready",
    });
  }
  return output;
}

export function extractTables(documentId: string, chunk: ResearchDocumentChunk, source: ResearchDocumentSourceMetadata): ResearchTableEvidence[] {
  const lines = chunk.text.split("\n");
  const tableLines = lines.map((line, index) => ({ line, index })).filter(({ line }) => TABLE_ROW.test(line) || line.includes("\t"));
  if (tableLines.length < 2) return [];
  const cellsFor = (line: string): ResearchTableCell[] => {
    const separator = line.includes("\t") ? "\t" : "|";
    const parts = line.split(separator).map((part) => part.trim()).filter((part) => part.length > 0);
    let offset = 0;
    return parts.map((value) => {
      const relative = Math.max(0, line.indexOf(value, offset));
      const cell = { value, start: (chunk.spans[0]?.start ?? 0) + offset + relative, end: (chunk.spans[0]?.start ?? 0) + offset + relative + value.length };
      offset += relative + value.length;
      return cell;
    });
  };
  const first = tableLines[0];
  if (!first) return [];
  const headers = cellsFor(first.line);
  const rows: ResearchTableRow[] = tableLines.slice(1).map(({ line }) => {
    const cells = cellsFor(line);
    return { cells, start: cells[0]?.start ?? (chunk.spans[0]?.start ?? 0), end: cells.at(-1)?.end ?? (chunk.spans[0]?.end ?? 0) };
  });
  const spanStart = headers[0]?.start ?? (chunk.spans[0]?.start ?? 0);
  const spanEnd = rows.at(-1)?.end ?? headers.at(-1)?.end ?? spanStart;
  const spanId = createStableId("SPAN", { documentId, start: spanStart, end: spanEnd, text: tableLines.map(({ line }) => line).join("\n") }, "research-retrieval/span/v1");
  return [{
    id: createStableId("TABLE", { documentId, chunkId: chunk.id, spanId }, "research-retrieval/evidence/v1"),
    documentId,
    chunkId: chunk.id,
    spanId,
    headers,
    rows,
    text: tableLines.map(({ line }) => line).join("\n"),
    sourceType: source.sourceType,
    sourceId: source.sourceId,
    sourceDocumentId: documentId,
    status: chunk.status === "quarantined" ? "quarantined" : "ready",
  }];
}

function statementType(textValue: string): ResearchStatementEvidence["statementType"] {
  if (/risk|uncertain|downside|challenge|headwind|liabilit/i.test(textValue)) return "risk";
  if (/catalyst|opportun|upside|launch|approval|guidance|target/i.test(textValue)) return "catalyst";
  if (/guidance|expects|plans|forecast|outlook|will|target/i.test(textValue)) return "management_guidance";
  if (/reported|actual|was|were|revenue|income|cash|debt|shares|price/i.test(textValue)) return "reported_fact";
  return "context";
}

export function extractStatements(documentId: string, chunk: ResearchDocumentChunk, source: ResearchDocumentSourceMetadata): ResearchStatementEvidence[] {
  const output: ResearchStatementEvidence[] = [];
  const sentences = chunk.text.split(/(?<=[.!?])\s+/).map((value) => value.trim()).filter((value) => value.length >= 8);
  for (const [index, sentence] of sentences.entries()) {
    const start = chunk.spans[0]?.start ?? 0;
    const relative = chunk.text.indexOf(sentence);
    const spanStart = start + Math.max(0, relative);
    const spanEnd = spanStart + sentence.length;
    const spanId = createStableId("SPAN", { documentId, start: spanStart, end: spanEnd, text: sentence }, "research-retrieval/span/v1");
    const type = statementType(sentence);
    output.push({
      id: createStableId("STMT", { documentId, chunkId: chunk.id, spanId, index }, "research-retrieval/evidence/v1"),
      documentId,
      chunkId: chunk.id,
      spanId,
      text: sentence,
      statement: sentence,
      statementType: type === "management_guidance" && source.sourceType !== "investor_presentation" && source.sourceType !== "earnings_call" ? "reported_fact" : type,
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      sourceDocumentId: documentId,
      status: chunk.status === "quarantined" ? "quarantined" : "ready",
    });
  }
  return output;
}

function providerEvidence(document: ResearchDocument, entries: readonly ResearchRetrievalProviderEvidence[] | undefined): ResearchDocumentEvidence[] {
  const chunk = document.chunks.find((entry) => entry.status === "ready") ?? document.chunks[0];
  if (!chunk) return [];
  const output: ResearchDocumentEvidence[] = [];
  for (const [index, entry] of (entries ?? []).entries()) {
    const field = text(entry.field) ?? "provider_evidence";
    const value = typeof entry.value === "number" && Number.isFinite(entry.value) ? entry.value : text(entry.value);
    if (value === undefined || value === "") continue;
    const spanText = text(entry.excerpt) ?? text(entry.statement) ?? `${field}: ${value}`;
    const start = chunk.spans[0]?.start ?? 0;
    const spanId = createStableId("SPAN", { documentId: document.id, index, text: spanText }, "research-retrieval/span/v1");
    if (typeof value === "number") {
      const id = createStableId("NUM", { documentId: document.id, chunkId: chunk.id, spanId, field, value }, "research-retrieval/evidence/v1");
      output.push({
        id,
        documentId: document.id,
        chunkId: chunk.id,
        spanId,
        field,
        value,
        raw: String(value),
        ...(text(entry.unit) ? { unit: text(entry.unit) } : {}),
        ...(text(entry.period) ? { period: text(entry.period) } : {}),
        ...(text(entry.asOf) ? { asOf: text(entry.asOf) } : {}),
        text: spanText,
        sourceType: document.sourceType,
        sourceId: document.sourceId,
        sourceDocumentId: document.id,
        sourceMetadata: document.sourceMetadata,
        status: chunk.status === "quarantined" ? "quarantined" : "ready",
        metadata: entry.metadata ?? {},
      });
    } else {
      const id = createStableId("STMT", { documentId: document.id, chunkId: chunk.id, spanId, field, text: spanText }, "research-retrieval/evidence/v1");
      output.push({
        id,
        documentId: document.id,
        chunkId: chunk.id,
        spanId,
        text: spanText,
        statement: spanText,
        statementType: document.sourceType === "investor_presentation" || document.sourceType === "earnings_call" ? "management_guidance" : "reported_fact",
        sourceType: document.sourceType,
        sourceId: document.sourceId,
        sourceDocumentId: document.id,
        status: chunk.status === "quarantined" ? "quarantined" : "ready",
      });
    }
  }
  return output;
}

export interface BuildResearchDocumentInput {
  ticker: string;
  providerDocument: ResearchRetrievalProviderDocument;
  provider: string;
  taskId: string;
  query: string;
  retrievedAt: string;
  requestHash: string;
  limits: ResearchRetrievalLimits;
  sourceType?: ResearchRetrievalSourceType;
}

export function buildResearchDocument(input: BuildResearchDocumentInput): ResearchDocument {
  const providerDocument = input.providerDocument;
  const sourceType = normalizeResearchSourceType(providerDocument.sourceType ?? input.sourceType);
  const sourceId = text(providerDocument.sourceId) ?? `${input.provider}:${sourceType}:${text(providerDocument.title) ?? "document"}`;
  const original = typeof providerDocument.content === "string" ? providerDocument.content : "";
  const sanitized = sanitizeResearchContent(original, input.limits.maxDocumentChars);
  const originalContentHash = stableHash(original, "research-retrieval/document-original/v1");
  const documentVersion = text(providerDocument.version) ?? "1";
  const documentSeed = { provider: input.provider, sourceId, title: text(providerDocument.title) ?? "Untitled document", originalContentHash, documentVersion };
  const documentId = text(providerDocument.documentId) ?? createStableId("DOC", documentSeed, "research-retrieval/document-id/v1");
  const sourceMetadata: ResearchDocumentSourceMetadata = {
    sourceId,
    sourceType,
    provider: input.provider,
    ...(text(providerDocument.sourceUrl) ? { sourceUrl: text(providerDocument.sourceUrl) } : {}),
    ...(text(providerDocument.publisher) ? { publisher: text(providerDocument.publisher) } : {}),
    ...(text(providerDocument.publishedAt) ? { publishedAt: text(providerDocument.publishedAt) } : {}),
    ...(text(providerDocument.asOfDate) ? { asOfDate: text(providerDocument.asOfDate) } : {}),
    authority: sourceAuthority(sourceType),
    valueRole: valueRole(sourceType),
    confidence: sourceConfidence(sourceType),
  };
  const chunks = makeChunks({ documentId, documentVersion, content: sanitized.content, limits: input.limits, injectionReasons: sanitized.injectionReasons });
  const numericEvidence = chunks.flatMap((chunk) => extractNumericEvidence(documentId, chunk, sourceMetadata));
  const tableEvidence = chunks.flatMap((chunk) => extractTables(documentId, chunk, sourceMetadata));
  const statementEvidence = chunks.flatMap((chunk) => extractStatements(documentId, chunk, sourceMetadata));
  const suppliedEvidence = providerEvidence({ id: documentId, chunks, sourceType, sourceId, sourceMetadata } as ResearchDocument, providerDocument.evidence);
  const allEvidence = [...numericEvidence, ...tableEvidence, ...statementEvidence, ...suppliedEvidence];
  const spans = chunks.flatMap((chunk) => chunk.spans);
  const publication: ResearchDocumentPublicationMetadata = {
    ...(text(providerDocument.publishedAt) ? { publishedAt: text(providerDocument.publishedAt) } : {}),
    ...(text(providerDocument.asOfDate) ? { asOfDate: text(providerDocument.asOfDate) } : {}),
    ...(text(providerDocument.publisher) ? { publisher: text(providerDocument.publisher) } : {}),
    ...(text(providerDocument.sourceUrl) ? { sourceUrl: text(providerDocument.sourceUrl) } : {}),
  };
  const contentHash = stableHash(sanitized.content, "research-retrieval/document-content/v1");
  const documentHash = stableHash({ documentId, documentVersion, sourceId, sourceType, contentHash, metadata: sourceMetadata, publication }, "research-retrieval/document/v1");
  const retrievalMetadata = { provider: input.provider, taskId: input.taskId, query: input.query, retrievedAt: input.retrievedAt, requestHash: input.requestHash, sourceType };
  const chunkLimitReached = sanitized.content.length > input.limits.maxChunkChars * input.limits.maxChunksPerDocument;
  const status = original.length === 0 ? "failed" : sanitized.quarantined ? "quarantined" : sanitized.wasTruncated || chunkLimitReached ? "partial" : "ready";
  const diagnostics = [
    ...(original.length === 0 ? ["document_content_empty"] : []),
    ...(sanitized.wasTruncated ? ["document_truncated"] : []),
    ...(chunkLimitReached ? ["document_chunk_limit_reached"] : []),
    ...(sanitized.injectionReasons.map((reason) => `prompt_injection:${reason}`)),
  ];
  return deepFreeze({
    id: documentId,
    documentId,
    version: RESEARCH_DOCUMENT_VERSION,
    documentVersion,
    ticker: input.ticker.toUpperCase(),
    title: text(providerDocument.title) ?? "Untitled document",
    sourceType,
    sourceId,
    sourceMetadata,
    contentHash,
    documentHash,
    originalContentHash,
    rawContentHash: originalContentHash,
    content: sanitized.content,
    sanitizedContent: sanitized.content,
    originalLength: sanitized.originalLength,
    sanitizedLength: sanitized.sanitizedLength,
    wasTruncated: sanitized.wasTruncated,
    retrieval: retrievalMetadata,
    retrievalMetadata,
    publication,
    publicationMetadata: publication,
    chunks,
    spans,
    evidence: allEvidence,
    numericEvidence,
    tableEvidence,
    statementEvidence,
    status,
    quarantined: sanitized.quarantined,
    quarantineReasons: sanitized.injectionReasons,
    diagnostics,
    publicationBlocked: status !== "ready",
  }) as unknown as ResearchDocument;
}

export function extractResearchDocumentEvidence(document: ResearchDocument): ResearchDocumentEvidence[] {
  return [...document.evidence].sort((left, right) => left.id.localeCompare(right.id));
}

export function extractDocumentNumericEvidence(document: ResearchDocument): ResearchNumericEvidence[] {
  return [...document.numericEvidence].sort((left, right) => left.id.localeCompare(right.id));
}

export function extractDocumentTableEvidence(document: ResearchDocument): ResearchTableEvidence[] {
  return [...document.tableEvidence].sort((left, right) => left.id.localeCompare(right.id));
}

export function extractDocumentStatementEvidence(document: ResearchDocument): ResearchStatementEvidence[] {
  return [...document.statementEvidence].sort((left, right) => left.id.localeCompare(right.id));
}

export function verifyResearchDocument(value: unknown): value is ResearchDocument {
  if (!value || typeof value !== "object" || !isDeeplyFrozen(value)) return false;
  const document = value as ResearchDocument;
  if (document.version !== RESEARCH_DOCUMENT_VERSION || !document.documentId || !document.contentHash) return false;
  if (document.rawContentHash !== document.originalContentHash || document.content !== document.sanitizedContent) return false;
  if (stableStringify(document.retrievalMetadata) !== stableStringify(document.retrieval) || stableStringify(document.publicationMetadata) !== stableStringify(document.publication)) return false;
  if (stableHash(document.sanitizedContent, "research-retrieval/document-content/v1") !== document.contentHash) return false;
  if (stableHash({ documentId: document.documentId, documentVersion: document.documentVersion, sourceId: document.sourceId, sourceType: document.sourceType, contentHash: document.contentHash, metadata: document.sourceMetadata, publication: document.publication }, "research-retrieval/document/v1") !== document.documentHash) return false;
  return document.chunks.every((chunk) => chunk.contentHash === stableHash(chunk.text, "research-retrieval/chunk/v1"));
}

export interface ResearchDocumentInput {
  ticker?: string;
  documentId?: string;
  version?: string;
  title?: string;
  content: string;
  sourceType?: ResearchRetrievalSourceType;
  sourceId?: string;
  sourceUrl?: string;
  publisher?: string;
  publishedAt?: string;
  asOfDate?: string;
  provider?: string;
  taskId?: string;
  query?: string;
  retrievedAt?: string;
  requestHash?: string;
  limits?: Partial<ResearchRetrievalLimits>;
  metadata?: Readonly<Record<string, unknown>>;
  evidence?: readonly ResearchRetrievalProviderEvidence[];
}

export function createResearchDocument(input: ResearchDocumentInput): ResearchDocument {
  const provider = input.provider ?? "injected";
  const taskId = input.taskId ?? "manual";
  const query = input.query ?? "";
  const retrievedAt = input.retrievedAt ?? "1970-01-01T00:00:00.000Z";
  const limits = { ...DEFAULT_RESEARCH_RETRIEVAL_LIMITS, ...(input.limits ?? {}) };
  if (input.limits?.maxBytes !== undefined && input.limits.maxDocumentChars === undefined && input.limits.maxDocumentBytes === undefined) limits.maxDocumentChars = input.limits.maxBytes;
  if (input.limits?.maxBytes !== undefined && input.limits.maxTotalChars === undefined && input.limits.maxTotalBytes === undefined) limits.maxTotalChars = input.limits.maxBytes * 5;
  return buildResearchDocument({
    ticker: input.ticker ?? "UNKNOWN",
    providerDocument: {
      ...(input.documentId ? { documentId: input.documentId } : {}),
      ...(input.version ? { version: input.version } : {}),
      ...(input.title ? { title: input.title } : {}),
      content: input.content,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      sourceUrl: input.sourceUrl,
      publisher: input.publisher,
      publishedAt: input.publishedAt,
      asOfDate: input.asOfDate,
      evidence: input.evidence,
      metadata: input.metadata,
    },
    provider,
    taskId,
    query,
    retrievedAt,
    requestHash: input.requestHash ?? stableHash({ provider, taskId, query, content: input.content }, "research-retrieval/request/v1"),
    limits,
    sourceType: input.sourceType,
  });
}
export const extractDocumentEvidence = extractResearchDocumentEvidence;
export const extractNumericDocumentEvidence = extractDocumentNumericEvidence;
export const extractTableDocumentEvidence = extractDocumentTableEvidence;
export const extractStatementDocumentEvidence = extractDocumentStatementEvidence;
export const sanitizeDocumentContent = sanitizeResearchContent;
export const quarantinePromptInjection = detectPromptInjection;
export { RESEARCH_DOCUMENT_VERSION };
export const RESEARCH_DOCUMENT_INTELLIGENCE_VERSION = RESEARCH_DOCUMENT_VERSION;
