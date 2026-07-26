"use client";

import { useConvexAuth } from "convex/react";

import { AccountPanel } from "./account-panel";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

function ConnectedAccountSessionBoundary() {
  const { isLoading } = useConvexAuth();

  if (isLoading) {
    return <p className="text-sm text-muted">Loading account…</p>;
  }

  return <AccountPanel />;
}

export function AccountSessionBoundary() {
  if (!convexUrl) {
    return <AccountPanel />;
  }

  return <ConnectedAccountSessionBoundary />;
}
