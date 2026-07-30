"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { useState } from "react";

import { api } from "@convex-generated-api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { requestBrowserSignOut } from "@/lib/auth-session";
import { captureProductEvent } from "@/lib/posthog";
import {
  isRecentAuthRequiredError,
  reauthenticationPath,
} from "@/lib/recent-auth";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

function sessionTime(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(value);
}

function ConnectedAccountSessionsPanel() {
  const result = useQuery(api.accountSessions.listMine);
  const revokeMine = useMutation(api.accountSessions.revokeMine);
  const revokeOthers = useAction(api.accountSessions.revokeOthers);
  const revokeAll = useAction(api.accountSessions.revokeAll);
  const { signOut } = useAuthActions();
  const posthog = usePostHog();
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState(false);

  if (result === undefined || result.state === "revoked") {
    return <p className="text-sm text-muted">Loading sessions...</p>;
  }

  if (result.state === "anonymous") {
    return <Notice>Not signed in.</Notice>;
  }

  async function perform(
    key: string,
    scope: "all" | "one" | "others",
    operation: () => Promise<unknown>,
    signOutAfter = false,
  ) {
    setPending(key);
    setError(false);
    captureProductEvent(posthog, "session_revocation_requested", { scope });

    try {
      await operation();
      captureProductEvent(
        posthog,
        scope === "one"
          ? "session_revocation_completed"
          : "session_revocation_started",
        { scope },
      );

      if (signOutAfter) {
        await requestBrowserSignOut(signOut);
        router.replace("/sign-in");
        router.refresh();
      }
    } catch (operationError) {
      if (isRecentAuthRequiredError(operationError)) {
        captureProductEvent(posthog, "sensitive_action_denied", {
          action_class: "session_revocation",
          reason: "stale",
        });
        captureProductEvent(posthog, "recent_auth_challenge_presented", {
          action_class: "session_revocation",
        });
        router.push(reauthenticationPath("/account/security"));
        return;
      }
      setError(true);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="grid gap-6">
      <ul className="divide-y divide-border border-y border-border">
        {result.sessions.map((session) => (
          <li
            className="grid gap-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
            key={session.id}
          >
            <dl className="grid gap-1 text-sm">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <dt className="font-medium">
                  {session.current
                    ? "This session"
                    : `Session from ${sessionTime(session.createdAt)}`}
                </dt>
                <dd className="text-muted">
                  Last active {sessionTime(session.lastActiveAt)}
                </dd>
                {session.status === "expiring" ? (
                  <dd className="text-muted">Expires soon</dd>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-x-3 text-muted">
                <div className="flex gap-1">
                  <dt>Signed in</dt>
                  <dd>{sessionTime(session.createdAt)}</dd>
                </div>
                {session.status === "active" ? (
                  <div className="flex gap-1">
                    <dt>Expires</dt>
                    <dd>{sessionTime(session.expiresAt)}</dd>
                  </div>
                ) : null}
              </div>
            </dl>
            <Button
              aria-label={
                session.current
                  ? "Sign out this session"
                  : `Sign out session from ${sessionTime(session.createdAt)}`
              }
              disabled={pending !== null}
              onClick={() =>
                session.current
                  ? void perform(session.id, "one", async () => {
                      await requestBrowserSignOut(signOut);
                      router.replace("/sign-in");
                      router.refresh();
                    })
                  : void perform(session.id, "one", () =>
                      revokeMine({ sessionId: session.id }),
                    )
              }
              size="sm"
              type="button"
              variant="ghost"
            >
              Sign out
            </Button>
          </li>
        ))}
      </ul>

      {error ? <Notice variant="error">Try again.</Notice> : null}

      <div className="flex flex-wrap gap-3">
        <Button
          disabled={
            pending !== null ||
            result.sessions.every((session) => session.current)
          }
          onClick={() =>
            void perform("others", "others", () => revokeOthers({}))
          }
          type="button"
          variant="secondary"
        >
          Sign out other sessions
        </Button>
        <Button
          disabled={pending !== null}
          onClick={() => {
            if (window.confirm("Sign out everywhere?")) {
              void perform("all", "all", () => revokeAll({}), true);
            }
          }}
          type="button"
          variant="ghost"
        >
          Sign out everywhere
        </Button>
      </div>
    </div>
  );
}

export function AccountSessionsPanel() {
  if (!convexUrl) {
    return <Notice>Sessions unavailable.</Notice>;
  }

  return (
    <Card padding="lg" surface="strong">
      <h1 className="text-3xl font-semibold">Sessions</h1>
      <div className="mt-6">
        <ConnectedAccountSessionsPanel />
      </div>
    </Card>
  );
}
