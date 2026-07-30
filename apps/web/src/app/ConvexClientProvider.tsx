"use client";

import { useAuth } from "@clerk/nextjs";
import {
  ConvexProviderWithAuth,
  ConvexReactClient,
  useConvexAuth,
  useMutation,
} from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useCallback, useEffect, useMemo, type ReactNode } from "react";

import { api } from "@convex-generated-api";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
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

/**
 * Reports a settled, signed-out state when Clerk has no credentials in this
 * environment. Nine components call `useConvexAuth()`, which requires one of the
 * `ConvexProviderWith*` ancestors — a plain `ConvexProvider` makes every one of
 * them throw and takes down public pages along with sign-in.
 */
function useUnauthenticated() {
  const fetchAccessToken = useCallback(async () => null, []);

  return useMemo(
    () => ({ isLoading: false, isAuthenticated: false, fetchAccessToken }),
    [fetchAccessToken],
  );
}

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  if (!convex) {
    return children;
  }

  if (!clerkConfigured) {
    return (
      <ConvexProviderWithAuth client={convex} useAuth={useUnauthenticated}>
        {children}
      </ConvexProviderWithAuth>
    );
  }

  return (
    <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
      <EnsureUser />
      {children}
    </ConvexProviderWithClerk>
  );
}
