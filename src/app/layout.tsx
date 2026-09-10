import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import Nav from "@/components/Nav";
import ServiceWorker from "@/components/ServiceWorker";
import { getSettings } from "@/lib/bootstrap";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Jarvish — Anime AI Companion",
  description: "JARVIS-style personal AI assistant with anime-character personalities, voice, memory, tools and a token router.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Jarvish" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#05060f",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  // Fill the notch/edge-to-edge on Android/iOS when installed.
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  let name = "Companion";
  let lowPower = false;
  try {
    const st = await getSettings();
    name = st.assistantName;
    lowPower = st.lowPowerMode;
  } catch {
    /* db not ready */
  }
  return (
    <html lang="en">
      <body className={`antialiased ${lowPower ? "low-power" : ""}`}>
        <ServiceWorker />
        <Nav assistantName={name} />
        <main className="min-h-screen px-3 pb-24 pt-4 md:pb-6 md:pl-64 md:pr-6">{children}</main>
      </body>
    </html>
  );
}
