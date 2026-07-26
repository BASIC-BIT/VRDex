"use client";

import { useConvexAuth } from "convex/react";

import { AccountPanel } from "./account-panel";

export function AccountSessionBoundary() {
  const { isLoading } = useConvexAuth();

  if (isLoading) {
    return <p className="text-sm text-muted">Loading account…</p>;
  }

  return <AccountPanel />;
}
