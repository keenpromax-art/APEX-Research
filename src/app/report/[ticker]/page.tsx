import { Metadata } from "next";
import ReportClient from "./ReportClient";

interface Props {
  params: Promise<{ ticker: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { ticker } = await params;
  const decoded = decodeURIComponent(ticker);
  return {
    title: `${decoded} Equity Research Report — Generating...`,
    description: `Generating a professional institutional equity research report for ${decoded}.`,
  };
}

export default async function ReportPage({ params }: Props) {
  const { ticker } = await params;
  return <ReportClient ticker={decodeURIComponent(ticker)} />;
}
