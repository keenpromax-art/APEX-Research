import { handleAnalyzeRequest } from "@/lib/research-package/server-handler";

export const runtime = "nodejs";
export const maxDuration = 300;
export const POST = handleAnalyzeRequest;
