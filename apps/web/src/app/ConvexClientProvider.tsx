"use client";

import { useAuth, useUser } from "@clerk/nextjs";
import {
  ConvexProviderWithAuth,
  ConvexReactClient,
  useConvexAuth,
  useMutation,
  useQuery,
} from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { api } from "@convex-generated-api";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null;
const PROVISION_RETRY_CEILING_MS = 8_000;

/**
 * Provisions the VRDex `users` row for a Clerk identity, and holds authenticated
 * children until it exists.
 *
 * Provisioning on demand keeps Clerk as the only identity source without a
 * webhook to expose, verify, and make replay-safe. But it cannot be
 * fire-and-forget: a brand-new identity's children mount first, and any query
 * behind `requireUser` throws while the row is missing. `developer-tokens-panel`
 * is the concrete case — its `temporalParsing.getAccess` query throws, and the
 * panel's error boundary latches on "temporarily unavailable" even after the row
 * appears.
 *
 * Gating on `viewer` rather than on the mutation means Convex reactivity opens
 * the gate as soon as the row lands, and an existing user waits only for a query
 * that authenticated pages already make.
 *
 * Provisioning also re-runs whenever Clerk's identity changes, not only when the
 * row is missing. Clerk's profile modal can change the primary email without
 * remounting this provider, and a changed address arrives unverified: syncing
 * only on absence would leave a stale `emailVerificationTime` behind and let a
 * client-side navigation into a claim flow pass the verified-email requirement on
 * an address Clerk no longer vouches for.
 */
function ProvisionedChildren({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useConvexAuth();
  const { user } = useUser();
  const ensureCurrentUser = useMutation(api.users.ensureCurrentUser);
  const viewer = useQuery(api.accounts.viewer, isAuthenticated ? {} : "skip");
  const [retry, setRetry] = useState(0);
  const retryTimer = useRef<number | undefined>(undefined);
  // Render state, not a ref: the gate below has to re-evaluate when a sync
  // completes, and a ref would release children without a re-render.
  const [syncedIdentity, setSyncedIdentity] = useState<string | null>(null);

  const provisioned = viewer !== undefined && viewer !== null;
  // Changes when Clerk's profile does, so an email change resyncs.
  const identitySignature = user
    ? [
        user.id,
        user.primaryEmailAddress?.emailAddress ?? "",
        user.primaryEmailAddress?.verification?.status ?? "",
        user.updatedAt?.getTime() ?? "",
      ].join("|")
    : null;

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    if (provisioned && identitySignature === syncedIdentity) {
      return;
    }

    let cancelled = false;

    void ensureCurrentUser({})
      .then(() => {
        if (!cancelled) {
          setSyncedIdentity(identitySignature);
        }
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        // Nothing else would retry a transient failure while the layout stays
        // mounted, which would leave the account permanently unusable.
        retryTimer.current = window.setTimeout(
          () => setRetry((attempt) => attempt + 1),
          Math.min(PROVISION_RETRY_CEILING_MS, 500 * 2 ** retry),
        );
      });

    return () => {
      cancelled = true;

      if (retryTimer.current !== undefined) {
        window.clearTimeout(retryTimer.current);
        retryTimer.current = undefined;
      }
    };
  }, [
    ensureCurrentUser,
    identitySignature,
    isAuthenticated,
    provisioned,
    retry,
    syncedIdentity,
  ]);

  // Releasing on `provisioned` alone was not enough. After a primary-email change
  // the row still exists, so children would render — and a claim could reach the
  // backend on the previously verified state — while `ensureCurrentUser` was still
  // clearing `emailVerificationTime`. Hold until the row exists *and* the current
  // Clerk identity has been synchronised.
  const identitySettled =
    identitySignature !== null && syncedIdentity === identitySignature;

  if (isAuthenticated && !(provisioned && identitySettled)) {
    return null;
  }

  return children;
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
      <ProvisionedChildren>{children}</ProvisionedChildren>
    </ConvexProviderWithClerk>
  );
}
