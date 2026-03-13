"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";

let convexClient: ConvexReactClient | null = null;

function getConvexClient() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

  if (!convexUrl) {
    return null;
  }

  if (!convexClient) {
    convexClient = new ConvexReactClient(convexUrl);
  }

  return convexClient;
}

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const client = getConvexClient();

  if (!client) {
    return <>{children}</>;
  }

  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
