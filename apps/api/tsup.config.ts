import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // Bundle the internal workspace packages (TS source) into the output...
  noExternal: [/^@loadtopia\//],
  // ...but keep native / CJS-heavy runtime deps external. Prisma's client does
  // dynamic require() and ships a native engine — it must not be bundled.
  external: ["@prisma/client", ".prisma/client", "@node-rs/argon2"],
  banner: {
    // Allow the few CJS deps that expect require() to resolve under ESM.
    js: "import { createRequire as __createRequire } from 'module'; const require = __createRequire(import.meta.url);",
  },
});
