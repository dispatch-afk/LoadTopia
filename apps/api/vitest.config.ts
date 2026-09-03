import { defineConfig } from "vitest/config";

// Unit tests run everywhere with no external dependencies.
// Integration tests (*.integration.test.ts) require a live database and are
// excluded here; run them with `pnpm test:integration`.
export default defineConfig({
  test: {
    name: "unit",
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.integration.test.ts", "node_modules/**", "dist/**"],
  },
});
