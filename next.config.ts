import type { NextConfig } from "next";

// NEXT_PUBLIC_BASE_PATH is set in CI (GitHub Actions) for project-page deployments.
// Locally it is empty so the dev server works at localhost:3000/ as normal.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

const nextConfig: NextConfig = {
  output: 'export',    // fully static — no server required
  trailingSlash: true,
  basePath,
  assetPrefix: basePath || undefined,
};

export default nextConfig;
