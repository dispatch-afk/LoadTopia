import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@loadtopia/shared"],
  eslint: { ignoreDuringBuilds: true },
  // Self-hosting (apps/web/Dockerfile): emit a minimal, self-contained server
  // tree. outputFileTracingRoot points at the monorepo root so workspace
  // packages (@loadtopia/shared) are traced into .next/standalone correctly.
  // No effect on `next dev`; no change to routing or the runtime /api proxy.
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../../"),
};

export default nextConfig;
