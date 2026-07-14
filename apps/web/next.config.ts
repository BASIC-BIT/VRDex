import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(appRoot, "../..");

const apiV0CorsHeaders = [
  { key: "Access-Control-Allow-Origin", value: "*" },
  { key: "Access-Control-Allow-Methods", value: "GET, HEAD, POST, PATCH, DELETE, OPTIONS" },
  {
    key: "Access-Control-Allow-Headers",
    value: "Authorization, Content-Type, If-None-Match, X-VRDEX-Upload-Token",
  },
  {
    key: "Access-Control-Expose-Headers",
    value: "Content-Disposition, ETag, Location, RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, Retry-After, WWW-Authenticate",
  },
  { key: "Access-Control-Max-Age", value: "600" },
] as const;

const nextConfig: NextConfig = {
  devIndicators: process.env.VRDEX_ENABLE_PLAYWRIGHT_FIXTURES === "true" ? false : undefined,
  async headers() {
    return [
      {
        source: "/api/v0/:path*",
        headers: [...apiV0CorsHeaders],
      },
    ];
  },
  outputFileTracingRoot: workspaceRoot,
  transpilePackages: ["@vrdex/api-contracts"],
  turbopack: {
    root: workspaceRoot,
  },
};

export default nextConfig;
