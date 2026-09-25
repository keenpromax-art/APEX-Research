import type { ForecastResult, ThesisSpecification } from "@/lib/ai-first/types";
import type { CanonicalForecast } from "@/lib/canonical-forecast";

export const RESEARCH_LEDGER_VERSION = "research-ledger-v1";
export const RESEARCH_RUN_VERSION = "research-run-v1";
export const RESEARCH_EVENT_VERSION = "research-event-v1";
export const UNKNOWN_REGISTRY_VERSION = "unknown-registry-v1";
export const FORECAST_VERSION = "research-forecast-v1";

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer TItem)[]
    ? readonly DeepReadonly<TItem>[]
    : T extends object
      ? { readonly [TKey in keyof T]: DeepReadonly<T[TKey]> }
      : T;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };

export interface ResearchLedgerCompany {
  readonly id: string;
  readonly ticker: string;
  readonly name?: string;
  readonly exchange?: string;
}

export interface ResearchLedgerPayload {
  readonly thesis?: ThesisSpecification;
  readonly canonicalForecast?: CanonicalForecast;
  readonly forecast?: ForecastResult;
  readonly values?: Readonly<Record<string, unknown>>;
}

export interface ResearchRunInput<TPayload = ResearchLedgerPayload> {
  readonly runId?: string;
  readonly company: ResearchLedgerCompany | string;
  readonly occurredAt: string;
  readonly dataCutoff: string;
  readonly schemaVersion?: string;
  readonly pipelineVersion: string;
  readonly modelVersion: string;
  readonly promptVersion?: string;
  readonly payload: TPayload;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ResearchRunEnvelope<TPayload = ResearchLedgerPayload> {
  readonly version: typeof RESEARCH_RUN_VERSION;
  readonly runId: string;
  readonly contentHash: string;
  readonly company: DeepReadonly<ResearchLedgerCompany>;
  readonly occurredAt: string;
  readonly dataCutoff: string;
  readonly schemaVersion: string;
  readonly pipelineVersion: string;
  readonly modelVersion: string;
  readonly promptVersion: string | null;
  readonly payload: DeepReadonly<TPayload>;
  readonly metadata: DeepReadonly<Readonly<Record<string, unknown>>>;
}

export type ResearchEventType =
  | "run-appended"
  | "forecast-issued"
  | "forecast-scored"
  | "unknown-registered"
  | "unknown-transitioned"
  | "thesis-break"
  | "analogue-reviewed"
  | (string & {});

export interface ResearchEventInput {
  readonly eventId?: string;
  readonly type: ResearchEventType;
  readonly company: ResearchLedgerCompany | string;
  readonly runId?: string;
  readonly occurredAt: string;
  readonly summary: string;
  readonly tags?: readonly string[];
  readonly metrics?: Readonly<Record<string, number>>;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface ResearchEvent {
  readonly version: typeof RESEARCH_EVENT_VERSION;
  readonly eventId: string;
  readonly contentHash: string;
  readonly companyId: string;
  readonly runId: string | null;
  readonly type: ResearchEventType;
  readonly occurredAt: string;
  readonly summary: string;
  readonly tags: readonly string[];
  readonly metrics: DeepReadonly<Readonly<Record<string, number>>>;
  readonly details: DeepReadonly<Readonly<Record<string, unknown>>>;
}

export interface ResearchLedgerEvent extends ResearchEvent {
  readonly sequence: number;
  readonly previousEventHash: string | null;
  readonly eventHash: string;
}

export interface AppendRunResult<TPayload = ResearchLedgerPayload> {
  readonly run: ResearchRunEnvelope<TPayload>;
  readonly appended: boolean;
  readonly duplicate: boolean;
  readonly sequence: number;
}

export interface AppendEventResult {
  readonly event: ResearchLedgerEvent;
  readonly appended: boolean;
  readonly duplicate: boolean;
}

export interface RunQuery {
  readonly companyId?: string;
  readonly from?: string;
  readonly to?: string;
}

export interface EventQuery {
  readonly companyId?: string;
  readonly runId?: string;
  readonly type?: ResearchEventType;
  readonly from?: string;
  readonly to?: string;
}
