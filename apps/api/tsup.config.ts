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
  // dynamic require() and ships a native engine — it must not be bundled. The
  // AWS SDK v3 (S3 storage provider) is large and does dynamic require() too;
  // it ships in the pruned production deploy as a @loadtopia/providers dep.
  external: [
    "@prisma/client",
    ".prisma/client",
    "@node-rs/argon2",
    /^@aws-sdk\//,
    /^@smithy\//,
  ],
  banner: {
    // Allow the few CJS deps that expect require() to resolve under ESM.
    js: "import { createRequire as __createRequire } from 'module'; const require = __createRequire(import.meta.url);",
  },
});
