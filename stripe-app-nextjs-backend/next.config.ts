import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // This repo has a lockfile per sub-project (no npm workspaces), so the
  // workspace root is this directory, not the repo root Next would infer.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
