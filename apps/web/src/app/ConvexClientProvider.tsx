"use client";

import { ConvexAuthNextjsProvider } from "@convex-dev/auth/nextjs";
import { ConvexReactClient, useConvexAuth, useQuery } from "convex/react";
import { usePostHog } from "posthog-js/react";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";

import { api } from "@convex-generated-api";
import {
  AUTH_SESSION_RESTORE_SLOW_MS,
  AUTH_SIGNOUT_FAILED_BROWSER_EVENT,
  AUTH_SIGNOUT_REQUESTED_BROWSER_EVENT,
  authLifecycleEvent,
  authSessionRestoreSlowEvent,
  authSessionDiagnosticContext,
  authSessionRouteClass,
  nextAuthRevocationConvergenceStarted,
  shouldConvergeRevokedSession,
  type AuthSessionLifecycleState,
  type AuthSessionTransitionIntent,
} from "@/lib/auth-session";
import { captureProductEvent } from "@/lib/posthog";
import { validateSignInReturnTo } from "@/lib/safe-return-to";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null;
const authRestorePageStartedAt =
  typeof performance === "undefined" ? 0 : performance.now();
let authRestoreSlowReportedForPageLoad = false;

function AuthLifecycleTelemetry({
  credentialPresent,
}: {
  credentialPresent: boolean;
}) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const posthog = usePostHog();
  const pathname = usePathname();
  const activeSessionState = useQuery(
    api.authSessionAuthority.status,
    isAuthenticated ? {} : "skip",
  );
  const routeClass = useMemo(
    () => authSessionRouteClass(pathname),
    [pathname],
  );
  const previousState = useRef<AuthSessionLifecycleState | null>(null);
  const restoreStartedAt = useRef(authRestorePageStartedAt);
  const restoreSlowEmitted = useRef(
    authRestoreSlowReportedForPageLoad,
  );
  const revocationConvergenceStarted = useRef(false);
  const [convergenceRetryVersion, retryConvergence] = useReducer(
    (version: number) => version + 1,
    0,
  );
  const transitionIntent =
    useRef<AuthSessionTransitionIntent>("unclassified");

  const diagnosticContext = () =>
    authSessionDiagnosticContext({
      hostname: window.location.hostname,
      userAgent: navigator.userAgent,
    });

  useEffect(() => {
    if (
      activeSessionState !== "revoked" ||
      revocationConvergenceStarted.current ||
      !shouldConvergeRevokedSession(routeClass)
    ) {
      return;
    }

    revocationConvergenceStarted.current =
      nextAuthRevocationConvergenceStarted(
        revocationConvergenceStarted.current,
        "revocation_detected",
    );
    captureProductEvent(posthog, "session_revocation_detected", {});
    const transientReturnTo =
      pathname === "/sign-in" || pathname.startsWith("/auth/reauth/")
        ? validateSignInReturnTo(
            new URLSearchParams(window.location.search).get("returnTo"),
          )
        : "/account";
    window.location.assign(
      `/auth/session-converge?returnTo=${encodeURIComponent(
        routeClass === "protected" ? pathname : transientReturnTo,
      )}`,
    );
  }, [
    activeSessionState,
    convergenceRetryVersion,
    pathname,
    posthog,
    routeClass,
  ]);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      revocationConvergenceStarted.current =
        nextAuthRevocationConvergenceStarted(
          revocationConvergenceStarted.current,
          "signed_out",
        );
    }
  }, [isAuthenticated, isLoading]);

  useEffect(() => {
    const onSignoutRequested = () => {
      transitionIntent.current = "explicit_signout_current_tab";
      revocationConvergenceStarted.current =
        nextAuthRevocationConvergenceStarted(
          revocationConvergenceStarted.current,
          "signout_requested",
        );
      captureProductEvent(posthog, "auth_session_signout_requested", {});
    };
    const onSignoutFailed = () => {
      transitionIntent.current = "unclassified";
      revocationConvergenceStarted.current =
        nextAuthRevocationConvergenceStarted(
          revocationConvergenceStarted.current,
          "signout_failed",
        );
      retryConvergence();
    };

    window.addEventListener(
      AUTH_SIGNOUT_REQUESTED_BROWSER_EVENT,
      onSignoutRequested,
    );
    window.addEventListener(
      AUTH_SIGNOUT_FAILED_BROWSER_EVENT,
      onSignoutFailed,
    );
    return () => {
      window.removeEventListener(
        AUTH_SIGNOUT_REQUESTED_BROWSER_EVENT,
        onSignoutRequested,
      );
      window.removeEventListener(
        AUTH_SIGNOUT_FAILED_BROWSER_EVENT,
        onSignoutFailed,
      );
    };
  }, [posthog]);

  useEffect(() => {
    if (!isLoading || restoreSlowEmitted.current) {
      return;
    }

    const elapsed = performance.now() - restoreStartedAt.current;
    const timeout = window.setTimeout(() => {
      const slowEvent = authSessionRestoreSlowEvent({
        alreadyEmitted: restoreSlowEmitted.current,
        credentialPresent,
        elapsedMs: performance.now() - restoreStartedAt.current,
        routeClass,
      });
      if (slowEvent === null) {
        return;
      }
      restoreSlowEmitted.current = true;
      authRestoreSlowReportedForPageLoad = true;
      captureProductEvent(posthog, slowEvent.event, {
        ...slowEvent.properties,
        ...diagnosticContext(),
      });
    }, Math.max(0, AUTH_SESSION_RESTORE_SLOW_MS - elapsed));

    return () => window.clearTimeout(timeout);
  }, [credentialPresent, isLoading, posthog, routeClass]);

  useEffect(() => {
    const currentState: AuthSessionLifecycleState = isLoading
      ? "restoring"
      : isAuthenticated
        ? "authenticated"
        : "anonymous";
    const lifecycleEvent = authLifecycleEvent(
      previousState.current,
      currentState,
      {
        credentialPresent,
        intent: transitionIntent.current,
        restoreDurationMs: performance.now() - restoreStartedAt.current,
        routeClass,
      },
    );

    previousState.current = currentState;

    if (lifecycleEvent !== null) {
      posthog?.capture(lifecycleEvent.event, {
        ...lifecycleEvent.properties,
        ...diagnosticContext(),
      });
      transitionIntent.current = "unclassified";
    }
  }, [
    credentialPresent,
    isAuthenticated,
    isLoading,
    posthog,
    routeClass,
  ]);

  return null;
}

export function ConvexClientProvider({
  children,
  credentialPresent,
}: {
  children: ReactNode;
  credentialPresent: boolean;
}) {
  if (!convex) {
    return children;
  }

  return (
    <ConvexAuthNextjsProvider client={convex}>
      <AuthLifecycleTelemetry credentialPresent={credentialPresent} />
      {children}
    </ConvexAuthNextjsProvider>
  );
}
