"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";

import { ClaimFlowContent } from "@/app/claim/[slug]/claim-flow";

const previewClient = new ConvexReactClient("https://playwright-preview.convex.cloud");

export function ClaimFlowPreview({
  discordLinked = true,
  privateProfile = false,
  vrclinkingConfigured = true,
}: {
  discordLinked?: boolean;
  privateProfile?: boolean;
  vrclinkingConfigured?: boolean;
}) {
  return (
    <ConvexProvider client={previewClient}>
      <ClaimFlowContent
        analyticsSessionScope="preview"
        previewContext={{
          emailVerified: true,
          // `hasDiscord` is a VRDex verification watermark, and only the
          // purpose-scoped OAuth round-trip writes one. Its false state is what
          // blocks the Discord and VRCLinking cards and surfaces the verify
          // affordance, so it needs to be reachable here.
          hasDiscord: discordLinked,
          // The visual route is the only place the method picker is
          // screenshotted, and the VRCLinking card renders on this flag alone.
          // Left out, the diff loop would keep asserting the pre-existing VRChat
          // UI and never see a change to the card that was added here.
          //
          // Toggleable because false is the repository default, and an owner on
          // a deployment without the adapter is the state where a Discord
          // affordance would unlock nothing visible.
          vrclinkingConfigured,
          ownership: privateProfile ? "viewer" : "available",
          verified: privateProfile,
          pendingClaimRequest: null,
          pendingProof: null,
        }}
        profile={{
          displayName: "BASICBIT",
          hasPublicProfile: !privateProfile,
          profileId: "playwright-profile",
          profileType: "person",
          slug: "basicbit",
        }}
        source="profile"
      />
    </ConvexProvider>
  );
}
