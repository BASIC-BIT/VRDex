"use client";

import type { FunctionReturnType } from "convex/server";
import { useQuery } from "convex/react";
import Link from "next/link";
import type { PublicVerifiedConnection } from "@vrdex/api-contracts";
import { api } from "@convex-generated-api";
import { buttonVariants } from "@/components/ui/button";
import { ConnectionVerification } from "@/components/ui/connection-verification";
import { profileClaimPath } from "@/lib/profile-claim";

export function ProfileVerificationStatus({ slug, connections, showVerifyAction = true }: {
  slug: string; connections: readonly PublicVerifiedConnection[]; showVerifyAction?: boolean;
}) {
  return connections.length > 0 ? (
    <>
      {connections.map(connection => <span className="grid min-w-0 gap-1 text-sm [overflow-wrap:anywhere]" key={`${connection.assetType}:${connection.assetExternalId}`}>
        <span data-ph-no-capture>{connection.displayName || connection.assetExternalId}</span>
        <ConnectionVerification at={connection.verifiedAt} group={connection.assetType === "vrchat_group"} />
      </span>)}
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
  const connections = verifiedVrchatConnections(result);
  return <ProfileVerificationStatus slug={slug} connections={connections} />;
}

export function verifiedVrchatConnections(result: FunctionReturnType<typeof api.profileConnections.listProfileConnections> | undefined): PublicVerifiedConnection[] {
  return result?.connections.flatMap(connection => {
    if (!connection.verified || connection.verifiedAt === undefined ||
      (connection.assetType !== "vrchat_user" && connection.assetType !== "vrchat_group")) return [];
    return [{ assetType: connection.assetType, assetExternalId: connection.assetExternalId,
      displayName: connection.assetDisplayName, verifiedAt: connection.verifiedAt, linkRole: connection.linkRole,
      url: `https://vrchat.com/home/${connection.assetType === "vrchat_user" ? "user" : "group"}/${connection.assetExternalId}` }];
  }) ?? [];
}
