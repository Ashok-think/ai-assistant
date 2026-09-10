import type { MetadataRoute } from "next";

/**
 * PWA manifest — lets Jarvish be "Add to Home screen" installed on Android (and iOS/desktop),
 * running full-screen like a native app with mic/voice access. Next.js serves this at
 * /manifest.webmanifest automatically.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Jarvish — Anime AI Companion",
    short_name: "Jarvish",
    description:
      "A personal AI companion with anime personalities, emotional voice, lip-sync, memory, tools and a cost-aware token router.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#05060f",
    theme_color: "#05060f",
    categories: ["productivity", "lifestyle", "entertainment"],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
