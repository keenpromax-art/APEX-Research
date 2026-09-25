import { NextRequest, NextResponse } from "next/server";
import { assertReportArtifactV1, sealReportArtifactV1 } from "@/lib/report-artifact";
import { validateRequestBodySize } from "@/lib/security/request-policy";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ schema: "apex.equity-research-report", version: "report-artifact-v1" });
}

export async function POST(request: NextRequest) {
  const raw = await request.text();
  const size = validateRequestBodySize(raw, request.headers);
  if (!size.ok) return NextResponse.json({ error: size.error.message, code: size.error.code }, { status: size.error.code === "BODY_TOO_LARGE" ? 413 : 400 });
  let artifact: unknown;
  try {
    artifact = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    const validArtifact = assertReportArtifactV1(artifact);
    const sealed = sealReportArtifactV1(validArtifact);
    return NextResponse.json({ artifact: sealed.artifact, hash: sealed.hash, serialized: sealed.serialized });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid report artifact" }, { status: 422 });
  }
}
