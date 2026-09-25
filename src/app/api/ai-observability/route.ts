import { NextResponse } from "next/server";
import { getAiMetricsSnapshot } from "@/lib/openrouter";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(getAiMetricsSnapshot());
}
