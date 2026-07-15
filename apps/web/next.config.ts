import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import { apiV0CorsHeaders } from "./api-v0-cors";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(appRoot, "../..");
const posthogHost = (process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim() || "https://us.i.posthog.com")
  .replace(/\/$/, "");
const posthogAssetsHost = posthogHost
  .replace("://us.i.posthog.com", "://us-assets.i.posthog.com")
  .replace("://eu.i.posthog.com", "://eu-assets.i.posthog.com");

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
  skipTrailingSlashRedirect: true,
  turbopack: {
    root: workspaceRoot,
  },
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/ingest/static/:path*",
          destination: `${posthogAssetsHost}/static/:path*`,
        },
        {
          source: "/ingest/:path*",
          destination: `${posthogHost}/:path*`,
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
