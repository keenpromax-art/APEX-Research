import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { Shell } from "@/components/Shell";
import { Suspense } from "react";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "APEX Terminal",
  description: "Institutional-grade AI equity research, modelling and valuation platform",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0B0D10",
};

const themeBootScript = `try{var t=localStorage.getItem("apex-theme");if(t==="light"){document.documentElement.classList.add("light");document.documentElement.style.colorScheme="light"}}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          <Suspense fallback={<div className="p-6 text-muted">Loading...</div>}>
            <Shell>{children}</Shell>
          </Suspense>
        </ThemeProvider>
      </body>
    </html>
  );
}
