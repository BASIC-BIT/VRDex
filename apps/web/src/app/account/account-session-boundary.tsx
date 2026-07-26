"use client";

import { useConvexAuth } from "convex/react";

import { AccountPanel } from "./account-panel";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

function ConnectedAccountSessionBoundary({ mediaKitEnabled }: { mediaKitEnabled: boolean }) {
  const { isLoading } = useConvexAuth();

  if (isLoading) {
    return <p className="text-sm text-muted">Loading account…</p>;
  }

  return <AccountPanel mediaKitEnabled={mediaKitEnabled} />;
}

export function AccountSessionBoundary({ mediaKitEnabled }: { mediaKitEnabled: boolean }) {
  if (!convexUrl) {
    return <AccountPanel mediaKitEnabled={mediaKitEnabled} />;
  }

  return <ConnectedAccountSessionBoundary mediaKitEnabled={mediaKitEnabled} />;
}
