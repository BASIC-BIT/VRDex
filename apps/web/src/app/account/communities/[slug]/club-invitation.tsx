"use client";
import { useAction, useConvexAuth } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@convex-generated-api";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, SectionTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { invitationAcceptanceError, invitationSignInHref } from "./club-workspace-model";

export function ClubInvitation({
  communitySlug,
  token,
}: {
  communitySlug: string;
  token: string;
}) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const getInvitation = useAction(api.clubStaff.getInvitation);
  const accept = useAction(api.clubStaff.acceptStaffInvitation);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ReturnType<typeof invitationAcceptanceError> | null>(null);
  const [retry, setRetry] = useState(0);
  const requestKey = JSON.stringify([communitySlug, token, isAuthenticated, retry]);
  const [preview, setPreview] = useState<{
    requestKey: string;
    outcome: { kind: "loaded"; value: FunctionReturnType<typeof api.clubStaff.getInvitation> }
      | { kind: "failed" };
  } | null>(null);
  useEffect(() => {
    if (isLoading) return;
    let cancelled = false;
    // Recheck after sign-in. Never load the protected workspace before acceptance.
    void getInvitation({ communitySlug, token }).then(
      (value) => {
        if (!cancelled) setPreview({ requestKey, outcome: { kind: "loaded", value } });
      },
      () => {
        if (!cancelled) setPreview({ requestKey, outcome: { kind: "failed" } });
      },
    );
    return () => { cancelled = true; };
  }, [communitySlug, token, isLoading, requestKey, getInvitation]);
  if (isLoading || preview?.requestKey !== requestKey)
    return <Notice role="status">Loading invitation…</Notice>;
  if (preview.outcome.kind === "failed") return (
    <Notice className="flex flex-wrap items-center gap-3" variant="error" role="alert">
      Unable to load this page.
      <Button size="sm" variant="secondary" onClick={() => setRetry((value) => value + 1)}>
        Retry
      </Button>
      {!isAuthenticated ? <Link className="whitespace-nowrap underline" href={invitationSignInHref(communitySlug, token)}>
        Sign in to accept
      </Link> : null}
    </Notice>
  );
  const invitation = preview.outcome.value;
  if (!invitation)
    return (
      <Notice variant="warning">This invitation is no longer valid.</Notice>
    );
  return (
    <Card padding="lg" surface="strong">
      <SectionTitle>{invitation.community.displayName}</SectionTitle>
      <p className="mt-4 text-sm text-muted">
        You have been invited to join the staff of this club.
      </p>
      <ul className="mt-5 list-inside list-disc text-sm">
        {invitation.roles.map((role) => (
          <li key={role._id}>{role.label}</li>
        ))}
      </ul>
      {error ? (
        <Notice className="mt-4" variant="error" role="alert">
          {error.message}
          {error.recoveryHref ? (
            <Link className="ml-2 underline" href={error.recoveryHref}>
              Open account
            </Link>
          ) : null}
        </Notice>
      ) : null}
      {isAuthenticated ? (
        <Button
          className="mt-6"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await accept({ communitySlug, token });
              router.replace(
                `/account/communities/${encodeURIComponent(communitySlug)}`,
              );
            } catch (cause) {
              setError(invitationAcceptanceError(cause));
              setBusy(false);
            }
          }}
        >
          Accept invitation
        </Button>
      ) : (
        <Link
          className={buttonVariants({ className: "mt-6" })}
          href={invitationSignInHref(communitySlug, token)}
        >
          Sign in to accept
        </Link>
      )}
    </Card>
  );
}
