import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Equity Research Engine",
  description:
    "AI-native equity research: Yahoo Finance data, deterministic metrics, and AI analysis with numerical integrity.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="bg-glow" aria-hidden="true" />
        {children}
      </body>
    </html>
  );
}
