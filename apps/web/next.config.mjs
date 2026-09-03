/** @type {import('next').NextConfig} */
const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:4000";

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@loadtopia/shared"],
  eslint: { ignoreDuringBuilds: true },
  // The browser only ever talks to the web origin; `/api/*` is reverse-proxied
  // to the API service so the session cookie is first-party in every
  // environment (mirrors the production edge / load-balancer routing).
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_ORIGIN}/api/:path*` }];
  },
};

export default nextConfig;
