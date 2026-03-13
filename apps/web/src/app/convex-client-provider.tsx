"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";

let convexClient: ConvexReactClient | null = null;
let convexClientUrl: string | null = null;

function getConvexClient(convexUrl: string | undefined) {
  if (!convexUrl) {
    return null;
  }

  if (!convexClient || convexClientUrl !== convexUrl) {
    convexClient?.close();
    convexClient = new ConvexReactClient(convexUrl);
    convexClientUrl = convexUrl;
  }

  return convexClient;
}

export function resetConvexClientForTests() {
  convexClient?.close();
  convexClient = null;
  convexClientUrl = null;
}

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const client = getConvexClient(convexUrl);

  if (!client) {
    return <>{children}</>;
  }

  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
