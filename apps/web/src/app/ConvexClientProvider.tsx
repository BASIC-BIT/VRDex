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
 * webhook to expose, verify, and make replay-safe. It cannot be entirely
 * fire-and-forget though: a brand-new identity's children mount first, and any
 * query behind `requireUser` throws while the row is missing.
 * `developer-tokens-panel` is the concrete case — its `temporalParsing.getAccess`
 * query throws, and the panel's error boundary latches on "temporarily
 * unavailable" even after the row appears.
 *
 * What this gate deliberately does *not* do is enforce verification freshness.
 * An earlier revision tried, holding children until the row matched Clerk's
 * current identity, and it could not be made sound: a provisioning outage, a
 * token minted before a profile change, or any caller that is not this browser
 * all defeat a client-side gate. That invariant lives on the server instead —
 * `identityEmailVerified` reads the claim out of the token Convex just validated,
 * so the guards do not trust this component at all. Re-syncing here is
 * best-effort mirroring of display fields, and safe to fail.
 */
function ProvisionedChildren({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useConvexAuth();
  const { user } = useUser();
  const ensureCurrentUser = useMutation(api.users.ensureCurrentUser);
  const viewer = useQuery(api.accounts.viewer, isAuthenticated ? {} : "skip");
  const [retry, setRetry] = useState(0);
  const retryTimer = useRef<number | undefined>(undefined);
  const syncedIdentity = useRef<string | null>(null);

  const provisioned = viewer !== undefined && viewer !== null;
  // Changes when Clerk's profile does, so an email or name edit is mirrored.
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

    if (provisioned && identitySignature === syncedIdentity.current) {
      return;
    }

    let cancelled = false;

    void ensureCurrentUser({})
      .then(() => {
        if (!cancelled) {
          syncedIdentity.current = identitySignature;
        }
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        // Retried because nothing else would while the layout stays mounted, and
        // a row that never appears leaves the account unusable. Unbounded on
        // purpose: this retry no longer gates rendering, so it cannot strand the
        // app, and giving up would silently stop mirroring profile changes.
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
  }, [ensureCurrentUser, identitySignature, isAuthenticated, provisioned, retry]);

  // Waits for the query to resolve, not just for a known-absent row. On a new
  // identity's first render `viewer` is still `undefined`, and letting children
  // mount there is the race this gate exists to close — `temporalParsing.getAccess`
  // would reach `requireUser` before the row lands and latch its error boundary.
  //
  // Bounded by a single Convex query that authenticated pages already issue, so it
  // costs a round-trip rather than stranding anyone. Public pages are unaffected:
  // an anonymous visitor never enters this branch.
  if (isAuthenticated && (viewer === undefined || viewer === null)) {
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
