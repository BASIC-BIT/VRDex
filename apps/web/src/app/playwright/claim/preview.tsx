"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";

import { ClaimFlow } from "@/app/claim/[slug]/claim-flow";

const previewClient = new ConvexReactClient("https://playwright-preview.convex.cloud");

export function ClaimFlowPreview() {
  return (
    <ConvexProvider client={previewClient}>
      <ClaimFlow
        previewContext={{
          emailVerified: true,
          hasDiscord: true,
          ownership: "available",
          verified: false,
          pendingClaimRequest: null,
          pendingProof: null,
        }}
        profile={{
          displayName: "BASICBIT",
          profileType: "person",
          slug: "basicbit",
        }}
        source="profile"
      />
    </ConvexProvider>
  );
}
