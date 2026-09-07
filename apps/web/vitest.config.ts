import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Web unit tests cover the pure operational read-model + upload helpers
// (src/lib/*.test.ts). Component/route behaviour is verified by `tsc` + the
// production `next build`; there is deliberately no browser test runner.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    name: "web",
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
  },
});
