import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Equity Research Generator — Professional Reports for Any Listed Company",
  description:
    "Generate institutional-quality equity research reports for any globally listed company. Powered by AI analysis via OpenRouter. Includes DCF valuation, ratio analysis, SWOT, and professional PDF output.",
  keywords: "equity research, financial analysis, DCF valuation, stock analysis, investment report",
  openGraph: {
    title: "Equity Research Generator",
    description: "Generate professional equity research reports for any listed company worldwide.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📈</text></svg>" />
      </head>
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
