"use client";

import { ConvexAuthNextjsProvider } from "@convex-dev/auth/nextjs";
import { ConvexReactClient, useConvexAuth } from "convex/react";
import { usePostHog } from "posthog-js/react";
import { useEffect, useRef, type ReactNode } from "react";

import {
  authLifecycleEvent,
  type AuthSessionLifecycleState,
} from "@/lib/auth-session";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null;

function AuthLifecycleTelemetry() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const posthog = usePostHog();
  const previousState = useRef<AuthSessionLifecycleState | null>(null);

  useEffect(() => {
    const currentState: AuthSessionLifecycleState = isLoading
      ? "restoring"
      : isAuthenticated
        ? "authenticated"
        : "anonymous";
    const lifecycleEvent = authLifecycleEvent(
      previousState.current,
      currentState,
    );

    previousState.current = currentState;

    if (lifecycleEvent !== null) {
      posthog?.capture(lifecycleEvent.event, lifecycleEvent.properties);
    }
  }, [isAuthenticated, isLoading, posthog]);

  return null;
}

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  if (!convex) {
    return children;
  }

  return (
    <ConvexAuthNextjsProvider client={convex}>
      <AuthLifecycleTelemetry />
      {children}
    </ConvexAuthNextjsProvider>
  );
}
