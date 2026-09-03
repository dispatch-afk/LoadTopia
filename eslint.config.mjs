// @ts-check
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.next/**",
      "**/coverage/**",
      "packages/db/src/generated/**",
      "packages/db/prisma/migrations/**",
      "**/next-env.d.ts",
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "warn",
      "no-console": "warn",
    },
  },
  {
    // Config, scripts, tests may use console freely.
    files: ["**/*.config.*", "**/scripts/**", "**/*.test.ts", "**/seed.ts"],
    rules: { "no-console": "off" },
  },
);
