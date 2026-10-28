import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { Shell } from "@/components/Shell";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "APEX Research",
  description: "Institutional-grade equity research, modelling and valuation platform",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#FFFFFF",
};

const themeBootScript = `try{var t=localStorage.getItem("apex-theme");if(t==="light"){document.documentElement.classList.add("light");document.documentElement.style.colorScheme="light"}}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
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
