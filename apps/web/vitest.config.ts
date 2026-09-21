import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Web unit tests cover the pure operational read-model + upload helpers
// (src/lib/*.test.ts) plus, as of M4 Phase 1, component/interaction tests for
// high-risk client components (src/components/**/*.test.tsx) using Testing
// Library + jsdom. The default environment stays "node" (cheap, and correct
// for the pure-logic tests); component test files opt into jsdom individually
// via a `// @vitest-environment jsdom` pragma at the top of the file, rather
// than paying the jsdom cost for every test in the project.
export default defineConfig({
  // Next's SWC compiler handles JSX for the app itself; Vitest transforms
  // test files (and anything they import) with esbuild directly, which
  // needs to be told to use the automatic runtime to match.
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    name: "web",
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["node_modules/**", ".next/**"],
  },
});
