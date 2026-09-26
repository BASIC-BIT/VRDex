"use client";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { api } from "@convex-generated-api";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, SectionTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { invitationSignInHref } from "./club-workspace-model";

export function ClubInvitation({
  communitySlug,
  token,
}: {
  communitySlug: string;
  token: string;
}) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  // This token-scoped query is the only read before acceptance. Never load getWorkspace here.
  const invitation = useQuery(api.clubStaff.getInvitation, {
    communitySlug,
    token,
  });
  const accept = useMutation(api.clubStaff.acceptStaffInvitation);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (invitation === undefined || isLoading)
    return <Notice role="status">Loading invitation…</Notice>;
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
          {error}
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
              setError(
                cause instanceof Error
                  ? cause.message
                  : "This invitation is no longer valid.",
              );
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
