import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // standalone output is for the Docker image only — locally it would break the
  // `npm start` flow (next start refuses to serve a standalone build)
  output: process.env.STANDALONE_OUTPUT ? "standalone" : undefined,
};

export default nextConfig;
