"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { api } from "@convex-generated-api";
import { buttonVariants } from "@/components/ui/button";
import { VerifiedTrustMark } from "@/components/ui/verified-trust-mark";
import { profileClaimPath } from "@/lib/profile-claim";

export function ProfileVerificationStatus({ slug, verified, showVerifyAction = true }: { slug: string; verified: boolean; showVerifyAction?: boolean }) {
  return verified ? (
    <>
      <span className="inline-flex items-center gap-2 text-sm"><VerifiedTrustMark label="Verified VRChat connection" />VRChat verified</span>
      <Link className={buttonVariants({ size: "sm", variant: "secondary" })} href={`/account/connections?profileSlug=${encodeURIComponent(slug)}`}>
        Connections
      </Link>
    </>
  ) : showVerifyAction ? (
    <Link className={buttonVariants({ size: "sm", variant: "secondary" })} href={profileClaimPath(slug, "account")}>
      Verify with VRChat
    </Link>
  ) : null;
}

export function ConnectedProfileVerificationStatus({ slug }: { slug: string }) {
  const result = useQuery(api.profileConnections.listProfileConnections, { profileSlug: slug });
  // Do not flash a repeat verification prompt while the connection is loading.
  if (result === undefined) return null;
  return <ProfileVerificationStatus slug={slug} verified={result?.connections.some((connection) =>
    connection.verified && (connection.assetType === "vrchat_user" || connection.assetType === "vrchat_group")) ?? false} />;
}
