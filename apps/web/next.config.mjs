/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@loadtopia/shared"],
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
