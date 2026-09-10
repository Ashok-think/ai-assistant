import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  // Vendored read-only material from another project — not part of the build.
  globalIgnores(["reference/**"]),
  ...nextVitals,
  ...nextTs,
]);
