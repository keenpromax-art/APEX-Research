import { Metadata } from "next";
import { parseDepthParam, parseReportTypeParam } from "@/lib/report-types";
import ReportClient from "./ReportClient";

interface Props {
  params: Promise<{ ticker: string }>;
  /** Phase 9: ?type=…&depth=… — validated fail-closed before reaching the client. */
  searchParams: Promise<{ type?: string; depth?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { ticker } = await params;
  const decoded = decodeURIComponent(ticker);
  return {
    title: `${decoded} Equity Research Report — Generating...`,
    description: `Generating a professional institutional equity research report for ${decoded}.`,
  };
}

export default async function ReportPage({ params, searchParams }: Props) {
  const { ticker } = await params;
  const sp = await searchParams;
  return (
    <ReportClient
      ticker={decodeURIComponent(ticker)}
      initialReportType={parseReportTypeParam(sp.type)}
      initialDepth={parseDepthParam(sp.depth)}
    />
  );
}
