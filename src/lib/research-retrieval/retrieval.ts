import { createStableId, stableHash } from "@/lib/research-ledger/stable";
import { deepFreeze, isDeeplyFrozen } from "@/lib/research-ledger/immutable";
import { buildResearchDocument, extractResearchDocumentEvidence } from "./document";
import { compileResearchRetrievalTasks } from "../ai-first/research-planner";
import { sanitizeSourceContent } from "@/lib/security/source-sanitizer";
import {
  DEFAULT_RESEARCH_RETRIEVAL_LIMITS,
  RESEARCH_RETRIEVAL_VERSION,
  type ExecuteResearchRetrievalOptions,
  type ResearchDocument,
  type ResearchRetrievalProviderDocument,
  type ResearchRetrievalProviderResponse,
  type ResearchRetrievalRequest,
  type ResearchRetrievalLimits,
  type ResearchRetrievalProvider,
  type ResearchRetrievalResult,
  type ResearchRetrievalSourceType,
  type ResearchRetrievalTaskLike,
  type ResearchRetrievalTaskResult,
} from "./types";

function requiredText(value: unknown, field: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new TypeError(`${field} must be a non-empty string`);
  return normalized;
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return sanitizeSourceContent(message, 500).content || "RETRIEVAL_PROVIDER_ERROR";
}

function timestamp(value: string | undefined, fallback: string): string {
  const candidate = value ?? fallback;
  const parsed = Date.parse(candidate);
  if (!Number.isFinite(parsed)) throw new TypeError("retrieval timestamp must be valid");
  return new Date(parsed).toISOString();
}

function resolveLimits(input: Partial<ResearchRetrievalLimits> | undefined): ResearchRetrievalLimits {
  const resolve = (value: number | undefined, fallback: number, maximum: number): number => value === undefined || !Number.isFinite(value) ? fallback : Math.max(1, Math.min(Math.trunc(value), maximum));
  const maxDocumentChars = input?.maxDocumentChars ?? input?.maxDocumentBytes ?? input?.maxBytes;
  const maxTotalChars = input?.maxTotalChars ?? input?.maxTotalBytes ?? (input?.maxBytes !== undefined ? input.maxBytes * 5 : undefined);
  return {
    maxDocuments: resolve(input?.maxDocuments, DEFAULT_RESEARCH_RETRIEVAL_LIMITS.maxDocuments, 1_000),
    maxDocumentChars: resolve(maxDocumentChars, DEFAULT_RESEARCH_RETRIEVAL_LIMITS.maxDocumentChars, 100_000),
    maxTotalChars: resolve(maxTotalChars, DEFAULT_RESEARCH_RETRIEVAL_LIMITS.maxTotalChars, 5_000_000),
    ...(input?.maxBytes !== undefined ? { maxBytes: input.maxBytes } : {}),
    ...(input?.maxDocumentBytes !== undefined ? { maxDocumentBytes: input.maxDocumentBytes } : {}),
    ...(input?.maxTotalBytes !== undefined ? { maxTotalBytes: input.maxTotalBytes } : {}),
    maxChunksPerDocument: resolve(input?.maxChunksPerDocument, DEFAULT_RESEARCH_RETRIEVAL_LIMITS.maxChunksPerDocument, 1_000),
    maxChunkChars: resolve(input?.maxChunkChars, DEFAULT_RESEARCH_RETRIEVAL_LIMITS.maxChunkChars, 100_000),
    maxQueryChars: resolve(input?.maxQueryChars, DEFAULT_RESEARCH_RETRIEVAL_LIMITS.maxQueryChars, 20_000),
    timeoutMs: resolve(input?.timeoutMs, DEFAULT_RESEARCH_RETRIEVAL_LIMITS.timeoutMs, 120_000),
  };
}

function taskPriority(task: ResearchRetrievalTaskLike): number {
  return Number.isFinite(task.priority) ? task.priority : 0;
}

function taskKey(task: ResearchRetrievalTaskLike): string {
  return `${String(taskPriority(task)).padStart(8, "0")}|${task.id}`;
}

function orderTasks(tasks: readonly ResearchRetrievalTaskLike[]): ResearchRetrievalTaskLike[] {
  const remaining = [...tasks].sort((left, right) => taskKey(left).localeCompare(taskKey(right)));
  const known = new Set(remaining.map((task) => task.id));
  const ordered: ResearchRetrievalTaskLike[] = [];
  const completed = new Set<string>();
  while (remaining.length > 0) {
    const index = remaining.findIndex((task) => task.dependencies.every((dependency) => known.has(dependency) && completed.has(dependency)));
    if (index < 0) break;
    const [task] = remaining.splice(index, 1);
    if (!task) break;
    ordered.push(task);
    completed.add(task.id);
  }
  return [...ordered, ...remaining.sort((left, right) => taskKey(left).localeCompare(taskKey(right)))];
}

function requestHash(task: ResearchRetrievalTaskLike, ticker: string): string {
  return stableHash({ ticker: ticker.toUpperCase(), taskId: task.id, question: task.question, query: task.query, sourceType: task.sourceType, asOf: task.asOf, dependencies: [...task.dependencies].sort() }, "research-retrieval/request/v1");
}

function unavailableResult(input: {
  ticker: string;
  asOf: string;
  startedAt: string;
  completedAt: string;
  tasks: ResearchRetrievalTaskLike[];
  provider: ResearchRetrievalProvider | null | undefined;
  allowlist: string[];
  diagnostics: string[];
}): ResearchRetrievalResult {
  const tasks: ResearchRetrievalTaskResult[] = input.tasks.map((task) => ({
    taskId: task.id,
    status: "unavailable",
    attempts: 0,
    resultRefs: [],
    documentIds: [],
    evidenceIds: [],
    diagnostics: [...input.diagnostics],
  }));
  return finalizeResult({
    status: "unavailable",
    available: false,
    providerConfigured: Boolean(input.provider),
    providerId: input.provider?.id ?? null,
    providerAllowlist: input.allowlist,
    ticker: input.ticker.toUpperCase(),
    asOf: input.asOf,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    tasks,
    documents: [],
    evidence: [],
    diagnostics: input.diagnostics,
  });
}

function finalizeResult(input: Omit<ResearchRetrievalResult, "version" | "resultHash">): ResearchRetrievalResult {
  const result = {
    version: RESEARCH_RETRIEVAL_VERSION,
    ...input,
    retrievalStatus: input.status,
    isAvailable: input.available,
    publicationBlocked: input.status !== "ready",
  } as ResearchRetrievalResult;
  const hashContent = { ...result } as Record<string, unknown>;
  delete hashContent.resultHash;
  return deepFreeze({ ...result, resultHash: stableHash(hashContent, "research-retrieval/result/v1") }) as ResearchRetrievalResult;
}

export function createInjectedResearchRetrievalProvider(
  id: string,
  fetch: (request: ResearchRetrievalRequest) => Promise<ResearchRetrievalProviderResponse | readonly ResearchRetrievalProviderDocument[]>,
): ResearchRetrievalProvider {
  return { id: requiredText(id, "providerId"), fetch };
}

export const createResearchRetrievalProvider = createInjectedResearchRetrievalProvider;

export function isResearchRetrievalProviderAllowed(providerId: string, allowlist: readonly string[]): boolean {
  const normalized = requiredText(providerId, "providerId").toLowerCase();
  return allowlist.some((entry) => entry.trim().toLowerCase() === normalized);
}

function providerAllowed(provider: ResearchRetrievalProvider, allowlist: readonly string[]): boolean {
  const normalized = provider.id.trim().toLowerCase();
  return allowlist.some((entry) => entry.trim().toLowerCase() === normalized);
}

async function fetchWithTimeout(
  provider: ResearchRetrievalProvider,
  request: ResearchRetrievalRequest,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<ResearchRetrievalProviderResponse> {
  const invoke = provider.fetch ?? provider.retrieve ?? provider.search;
  if (!invoke) throw new Error("RETRIEVAL_PROVIDER_INTERFACE_UNAVAILABLE");
  const controller = new AbortController();
  const abort = () => controller.abort();
  externalSignal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = invoke({ ...request, signal: controller.signal });
    const settled = await Promise.race([
      response,
      new Promise<never>((_, reject) => {
        const timerHandle = setTimeout(() => reject(new Error("RETRIEVAL_PROVIDER_TIMEOUT")), timeoutMs);
        response.then(() => clearTimeout(timerHandle), () => clearTimeout(timerHandle));
      }),
    ]);
    return Array.isArray(settled) ? { documents: settled as ResearchRetrievalProviderDocument[] } : settled as ResearchRetrievalProviderResponse;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", abort);
  }
}

function normalizeTask(task: ResearchRetrievalTaskLike, ticker: string, asOf: string): ResearchRetrievalTaskLike {
  return {
    ...task,
    id: requiredText(task.id, "task.id"),
    task: requiredText(task.task, "task.task"),
    question: requiredText(task.question, "task.question"),
    sourceType: task.sourceType ?? task.source_type ?? "unknown",
    query: requiredText(task.query, "task.query").slice(0, 2_000),
    priority: taskPriority(task),
    asOf: task.asOf || task.as_of || asOf,
    dependencies: [...new Set((task.dependencies ?? []).map((dependency) => requiredText(dependency, "task.dependency")))].sort(),
    resultRefs: [...new Set(task.resultRefs ?? task.result_refs ?? [])].sort(),
  };
}

export async function executeResearchRetrieval(
  tasks: readonly ResearchRetrievalTaskLike[] | { retrievalTasks?: readonly ResearchRetrievalTaskLike[]; taskQueue?: readonly ResearchRetrievalTaskLike[]; retrievalTaskQueue?: readonly ResearchRetrievalTaskLike[]; questions?: readonly { question: string; evidenceNeeded?: string; requiredFor?: string }[]; unknowns?: readonly string[]; requiredResearch?: readonly string[]; asOf?: string },
  options: ExecuteResearchRetrievalOptions,
): Promise<ResearchRetrievalResult> {
  const ticker = requiredText(options.ticker, "ticker").toUpperCase();
  const now = options.now ?? (options.asOf && options.asOf !== "unknown" ? options.asOf : new Date().toISOString());
  const startedAt = timestamp(now, now);
  const completedAt = timestamp(now, startedAt);
  const asOf = options.asOf === "unknown" ? "unknown" : timestamp(options.asOf, startedAt.slice(0, 10));
  const limits = resolveLimits({
    ...(options.limits ?? {}),
    ...(options.maxBytes !== undefined ? { maxBytes: options.maxBytes } : {}),
    ...(options.maxDocumentBytes !== undefined ? { maxDocumentBytes: options.maxDocumentBytes } : {}),
    ...(options.maxTotalBytes !== undefined ? { maxTotalBytes: options.maxTotalBytes } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  });
  const taskInput = tasks as readonly ResearchRetrievalTaskLike[] | { retrievalTasks?: readonly ResearchRetrievalTaskLike[]; taskQueue?: readonly ResearchRetrievalTaskLike[]; retrievalTaskQueue?: readonly ResearchRetrievalTaskLike[]; questions?: readonly { question: string; evidenceNeeded?: string; requiredFor?: string }[]; unknowns?: readonly string[]; requiredResearch?: readonly string[]; asOf?: string };
  const taskObject = taskInput as { retrievalTasks?: readonly ResearchRetrievalTaskLike[]; taskQueue?: readonly ResearchRetrievalTaskLike[]; retrievalTaskQueue?: readonly ResearchRetrievalTaskLike[]; questions?: readonly { question: string; evidenceNeeded?: string; requiredFor?: string }[]; unknowns?: readonly string[]; requiredResearch?: readonly string[]; asOf?: string };
  const taskList: readonly ResearchRetrievalTaskLike[] = Array.isArray(taskInput)
    ? taskInput as readonly ResearchRetrievalTaskLike[]
    : taskObject.retrievalTasks ?? taskObject.taskQueue ?? taskObject.retrievalTaskQueue ?? (taskObject.questions || taskObject.unknowns || taskObject.requiredResearch
      ? compileResearchRetrievalTasks({ questions: taskObject.questions?.map((question) => ({ question: question.question, why: "", requiredFor: question.requiredFor ?? "research", yfinanceAvailable: false, evidenceNeeded: question.evidenceNeeded ?? "" })) ?? [], unknowns: [...(taskObject.unknowns ?? [])], requiredResearch: [...(taskObject.requiredResearch ?? [])], asOf: taskObject.asOf }, { asOf: taskObject.asOf })
      : []);
  const normalizedTasks = orderTasks(taskList.map((task) => normalizeTask(task, ticker, asOf)));
  const allowlist = [...new Set((options.providerAllowlist ?? options.allowedProviders ?? ["injected", "fixture", "test", "mock"]).map((entry) => requiredText(entry, "providerAllowlist")))].sort();
  if (!options.provider) {
    return unavailableResult({ ticker, asOf, startedAt, completedAt, tasks: normalizedTasks, provider: null, allowlist, diagnostics: ["RETRIEVAL_PROVIDER_UNAVAILABLE"] });
  }
  if (!providerAllowed(options.provider, allowlist)) {
    return unavailableResult({ ticker, asOf, startedAt, completedAt, tasks: normalizedTasks, provider: options.provider, allowlist, diagnostics: ["RETRIEVAL_PROVIDER_NOT_ALLOWED"] });
  }
  if (normalizedTasks.length === 0) {
    return finalizeResult({
      status: "ready",
      available: true,
      providerConfigured: true,
      providerId: options.provider.id,
      providerAllowlist: allowlist,
      ticker,
      asOf,
      startedAt,
      completedAt,
      tasks: [],
      documents: [],
      evidence: [],
      diagnostics: ["RETRIEVAL_NO_TASKS"],
    });
  }

  const taskResults: ResearchRetrievalTaskResult[] = [];
  const documents: ResearchDocument[] = [];
  const diagnostics: string[] = [];
  const completed = new Set<string>();
  let totalChars = 0;
  for (const task of normalizedTasks) {
    if (task.status === "completed" && (task.resultRefs?.length ?? 0) > 0) {
      taskResults.push({ taskId: task.id, status: "completed", attempts: task.attempts ?? 0, resultRefs: [...(task.resultRefs ?? [])], documentIds: [], evidenceIds: [], diagnostics: [] });
      completed.add(task.id);
      continue;
    }
    const unmet = task.dependencies.filter((dependency) => !completed.has(dependency));
    if (unmet.length > 0) {
      taskResults.push({ taskId: task.id, status: "blocked", attempts: 0, resultRefs: [], documentIds: [], evidenceIds: [], diagnostics: [`UNMET_DEPENDENCY:${unmet.join(",")}`] });
      continue;
    }
    const query = task.query.slice(0, limits.maxQueryChars);
    const request = {
      taskId: task.id,
      question: task.question,
      query,
      sourceType: task.sourceType,
      priority: task.priority,
      asOf: task.asOf,
      dependencies: task.dependencies,
      ticker,
    };
    let response: ResearchRetrievalProviderResponse;
    try {
      response = await fetchWithTimeout(options.provider, request, limits.timeoutMs, options.signal);
    } catch (error) {
      const message = safeErrorMessage(error);
      taskResults.push({ taskId: task.id, status: message.includes("TIMEOUT") ? "failed" : "failed", attempts: 1, resultRefs: [], documentIds: [], evidenceIds: [], diagnostics: [message], error: message });
      continue;
    }
    const responseDiagnostics = [...(response.diagnostics ?? [])];
    const responseDocuments = [...(response.documents ?? response.results?.documents ?? [])].sort((left, right) => stableHash({ documentId: left.documentId ?? null, sourceId: left.sourceId ?? null, title: left.title ?? null, content: left.content }, "research-retrieval/provider-document/v1").localeCompare(stableHash({ documentId: right.documentId ?? null, sourceId: right.sourceId ?? null, title: right.title ?? null, content: right.content }, "research-retrieval/provider-document/v1")));
    const taskDocumentIds: string[] = [];
    const taskEvidenceIds: string[] = [];
    let taskStatus: ResearchRetrievalTaskResult["status"] = responseDocuments.length > 0 ? "completed" : "partial";
    for (const providerDocument of responseDocuments) {
      if (documents.length >= limits.maxDocuments) {
        diagnostics.push("RETRIEVAL_DOCUMENT_LIMIT_REACHED");
        taskStatus = "partial";
        break;
      }
      if (totalChars >= limits.maxTotalChars) {
        diagnostics.push("RETRIEVAL_TOTAL_CHARACTER_LIMIT_REACHED");
        taskStatus = "partial";
        break;
      }
      try {
        const document = buildResearchDocument({
          ticker,
          providerDocument,
          provider: options.provider.id,
          taskId: task.id,
          query,
          retrievedAt: completedAt,
          requestHash: requestHash(task, ticker),
          limits,
          sourceType: task.sourceType,
        });
        const existing = documents.find((entry) => entry.id === document.id);
        if (existing) {
          if (existing.contentHash !== document.contentHash) {
            taskStatus = "partial";
            diagnostics.push(`DOCUMENT_CONTENT_COLLISION:${document.id}`);
            continue;
          }
          taskDocumentIds.push(existing.id);
          taskEvidenceIds.push(...extractResearchDocumentEvidence(existing).map((entry) => entry.id));
          continue;
        }
        documents.push(document);
        totalChars += document.sanitizedLength;
        taskDocumentIds.push(document.id);
        taskEvidenceIds.push(...extractResearchDocumentEvidence(document).map((entry) => entry.id));
        if (document.status === "partial" || document.status === "quarantined" || document.status === "failed") taskStatus = "partial";
      } catch (error) {
        taskStatus = "partial";
        diagnostics.push(`DOCUMENT_BUILD_FAILED:${safeErrorMessage(error)}`);
      }
    }
    if (responseDocuments.length === 0) taskStatus = "partial";
    if (responseDiagnostics.length > 0) {
      diagnostics.push(...responseDiagnostics);
      taskStatus = taskStatus === "completed" ? "partial" : taskStatus;
    }
    taskResults.push({
      taskId: task.id,
      status: taskStatus,
      attempts: 1,
      resultRefs: [...taskDocumentIds, ...taskEvidenceIds],
      documentIds: [...new Set(taskDocumentIds)].sort(),
      evidenceIds: [...new Set(taskEvidenceIds)].sort(),
      diagnostics: responseDiagnostics,
    });
    if (taskStatus === "completed" || taskStatus === "partial") completed.add(task.id);
  }
  const sortedDocuments = [...documents].sort((left, right) => left.id.localeCompare(right.id));
  const evidence = sortedDocuments.flatMap(extractResearchDocumentEvidence).sort((left, right) => left.id.localeCompare(right.id));
  const successful = taskResults.filter((task) => task.status === "completed" || task.status === "partial").length;
  const status: ResearchRetrievalResult["status"] = successful === 0 ? "failed" : successful < taskResults.length || diagnostics.length > 0 || documents.some((document) => document.status !== "ready") ? "partial" : "ready";
  return finalizeResult({
    status,
    available: true,
    providerConfigured: true,
    providerId: options.provider.id,
    providerAllowlist: allowlist,
    ticker,
    asOf,
    startedAt,
    completedAt,
    tasks: taskResults.sort((left, right) => left.taskId.localeCompare(right.taskId)),
    documents: sortedDocuments,
    evidence,
    diagnostics: [...new Set(diagnostics)].sort(),
  });
}

export function verifyResearchRetrievalResult(value: unknown): value is ResearchRetrievalResult {
  if (!value || typeof value !== "object" || !isDeeplyFrozen(value)) return false;
  const result = value as ResearchRetrievalResult;
  if (result.version !== RESEARCH_RETRIEVAL_VERSION || !/^[a-f0-9]{64}$/.test(result.resultHash)) return false;
  const { resultHash: _resultHash, ...content } = result;
  return stableHash(content, "research-retrieval/result/v1") === result.resultHash;
}

export const executeRetrievalTasks = executeResearchRetrieval;
export const runResearchRetrieval = executeResearchRetrieval;
export const retrieveResearchDocuments = executeResearchRetrieval;
