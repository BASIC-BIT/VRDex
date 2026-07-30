"use client";

import { useAuth } from "@clerk/nextjs";
import { ConvexReactClient, useConvexAuth, useMutation } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useEffect, type ReactNode } from "react";

import { api } from "@convex-generated-api";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null;

/**
 * Provisions the VRDex `users` row for a Clerk identity on first authenticated
 * load. Doing it here instead of through a Clerk webhook means no endpoint to
 * expose, no signature to verify, and no replay handling; the mutation is
 * idempotent, so repeat calls just refresh the row.
 */
function EnsureUser() {
  const { isAuthenticated } = useConvexAuth();
  const ensureCurrentUser = useMutation(api.users.ensureCurrentUser);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    void ensureCurrentUser({});
  }, [ensureCurrentUser, isAuthenticated]);

  return null;
}

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  if (!convex) {
    return children;
  }

  return (
    <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
      <EnsureUser />
      {children}
    </ConvexProviderWithClerk>
  );
}
