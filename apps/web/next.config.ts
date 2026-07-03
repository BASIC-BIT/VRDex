import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(appRoot, "../..");

const nextConfig: NextConfig = {
  devIndicators: process.env.VRDEX_ENABLE_PLAYWRIGHT_FIXTURES === "true" ? false : undefined,
  outputFileTracingRoot: workspaceRoot,
  transpilePackages: ["@vrdex/api-contracts"],
  turbopack: {
    root: workspaceRoot,
  },
};

export default nextConfig;
