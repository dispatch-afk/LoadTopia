import { defineConfig } from "vitest/config";

// Integration suite: requires a reachable PostgreSQL at TEST_DATABASE_URL with
// migrations applied. Run via `pnpm --filter @loadtopia/api test:integration`.
export default defineConfig({
  test: {
    name: "integration",
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    hookTimeout: 30_000,
    testTimeout: 20_000,
    fileParallelism: false,
  },
});
