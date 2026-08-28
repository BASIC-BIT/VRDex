"use client";

import { useConvexAuth } from "convex/react";
import type { ReactNode } from "react";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

function ConnectedAccountSessionBoundary({ children }: { children: ReactNode }) {
  const { isLoading } = useConvexAuth();

  // Full navigations can render before Convex has reattached Clerk's token.
  // Protected account queries must not mount during that reconnect window.
  if (isLoading) {
    return <p className="text-sm text-muted">Loading account…</p>;
  }

  return children;
}

export function AccountSessionBoundary({ children }: { children: ReactNode }) {
  if (!convexUrl) {
    return children;
  }

  return <ConnectedAccountSessionBoundary>{children}</ConnectedAccountSessionBoundary>;
}
