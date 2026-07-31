"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";

import { ClaimFlow } from "@/app/claim/[slug]/claim-flow";

const previewClient = new ConvexReactClient("https://playwright-preview.convex.cloud");

export function ClaimFlowPreview({
  discordLinked = true,
  privateProfile = false,
}: {
  discordLinked?: boolean;
  privateProfile?: boolean;
}) {
  return (
    <ConvexProvider client={previewClient}>
      <ClaimFlow
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
          vrclinkingConfigured: true,
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
