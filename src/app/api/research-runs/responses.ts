import { NextResponse } from "next/server";
import { RunIdCollisionError } from "@/lib/research-ledger/repository";
import {
  ResearchRunIdempotencyConflictError,
  ResearchRunIntegrityError,
  ResearchRunManifestValidationError,
  ResearchRunPayloadTooLargeError,
  ResearchRunQueryValidationError,
  ResearchRunStoreUnavailableError,
} from "@/lib/research-runs";

export function researchRunErrorResponse(error: unknown): NextResponse {
  if (error instanceof ResearchRunPayloadTooLargeError) {
    return NextResponse.json(
      { error: error.message, code: "PAYLOAD_TOO_LARGE" },
      { status: 413, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (error instanceof ResearchRunManifestValidationError || error instanceof ResearchRunQueryValidationError) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid research run request", code: "INVALID_REQUEST" },
      { status: 422, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (error instanceof ResearchRunIntegrityError) {
    return NextResponse.json(
      { error: "Stored research run failed integrity verification", code: "STORE_INTEGRITY", durable: false },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (error instanceof ResearchRunIdempotencyConflictError || error instanceof RunIdCollisionError) {
    return NextResponse.json(
      { error: "Research run idempotency conflict", code: "IDEMPOTENCY_CONFLICT" },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (error instanceof ResearchRunStoreUnavailableError) {
    return NextResponse.json(
      { error: "Durable research run storage is unavailable", code: "STORE_UNAVAILABLE", durable: false },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json(
    { error: "Research run persistence failed", code: "PERSISTENCE_FAILED" },
    { status: 500, headers: { "Cache-Control": "no-store" } },
  );
}

export function researchRunStoreUnavailableResponse(): NextResponse {
  return NextResponse.json(
    { error: "Durable research run storage is not configured", code: "STORE_UNAVAILABLE", durable: false },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
