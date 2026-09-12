import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";

const sans = Geist({ subsets: ["latin"], variable: "--font-geist" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });
import "./globals.css";
import Nav from "@/components/Nav";
import ServiceWorker from "@/components/ServiceWorker";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "JARVISH — Your personal AI companion",
  description: "A personal AI command room with hands-free conversations, expressive characters, connected models, memory, and permission-based tools.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Jarvish" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#0c1014",
  width: "device-width",
  initialScale: 1,
  // Fill the notch/edge-to-edge on Android/iOS when installed.
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  let name = "Companion";
  let lowPower = false;
  const cloud = (await headers()).get("x-jarvish-cloud") === "1" || process.env.VERCEL === "1";
  if (!cloud) {
    try {
      const { getSettings } = await import("@/lib/bootstrap");
      const st = await getSettings();
      name = st.assistantName;
      lowPower = st.lowPowerMode;
    } catch {
      /* db not ready */
    }
  }
  return (
    <html lang="en" className={`bg-background ${sans.variable} ${mono.variable}`}>
      <body className={`font-sans antialiased ${lowPower ? "low-power" : ""}`}>
        <ServiceWorker />
        <Nav assistantName={name} cloudOnly={process.env.VERCEL === "1"} />
        <main className="app-content">{children}</main>
      </body>
    </html>
  );
}
