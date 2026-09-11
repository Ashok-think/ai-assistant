import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Unrelated projects with their own lockfiles sit in parent directories. Without pinning
  // the root, Next infers the parent as the workspace root and traces the wrong files.
  turbopack: { root: __dirname },
  // Node-only libraries that must run on the server and never be bundled for the client/edge:
  // the Playwright browser executor and the document parsers.
  serverExternalPackages: ["playwright", "pdf-parse", "mammoth"],
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Strict-Transport-Security", value: "max-age=63072000" },
    ] }];
  },
};

export default nextConfig;
